"""Calmboard: a community link board that checks shared web pages with the CalmLens Python SDK."""
from __future__ import annotations

import argparse
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import logging
import os
import secrets
import threading
import uuid
from urllib.parse import parse_qs, urlencode, urlsplit

from calmlens import Asset, CalmLensServerClient, CalmLensError, CalmLensTransportError, ClassificationReport

HOST = "127.0.0.1"
DEFAULT_PORT = 6401
MAX_NOTE = 280
MAX_URL = 2048
MAX_BODY = 16 * 1024
MAX_LINKS = 50
# Category scores at or above this are shown when explaining a decision. It is a display
# choice for this page; the project's policy decides what is approved or rejected.
SHOWN_SCORE = 0.4
DEMO_RESULTS = {
    "approved": "Approve the page",
    "flagged": "Approve the page, but flag it",
    "rejected": "Reject the page",
    "error": "Processing error",
    "note-rejected": "Reject the note",
}
# Redirects carry one of these keys, never free text, so a crafted link cannot put words on the page.
NOTICES = {
    "shared": "Shared. The page is being checked before the link goes live.",
    "note-rejected": "Not shared: the note did not pass moderation.",
    "note-unfinished": "Not shared: moderation did not complete. Please try again.",
    "removed": "Removed. CalmLens no longer keeps a record of the page or the note.",
}


class InvalidInput(ValueError):
    """A problem with the submitted form, shown to the member as written here."""


class ConfigurationError(Exception):
    """The app cannot start with the current settings."""


def validate_url(value: str) -> str:
    """Accepts an absolute http(s) URL without credentials. CalmLens checks the rest
    (private addresses, redirects, size) when it fetches the page."""
    value = value.strip()
    if not value or len(value) > MAX_URL:
        raise InvalidInput("Enter a link of up to 2048 characters")
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise InvalidInput("Links must start with http:// or https://")
    if parts.username or parts.password:
        raise InvalidInput("Links cannot contain a user name or password")
    try:
        address = ipaddress.ip_address(parts.hostname)
    except ValueError:
        address = None
    if parts.hostname == "localhost" or (address and not address.is_global):
        raise InvalidInput("Links must point to a public website")
    return value


def link_status(asset: Asset) -> str:
    """A shared link's state from its asset: the moderation decision once there is one, ``error``
    when processing failed, else ``pending``. A status this app doesn't know stays pending."""
    if asset["processing"]["status"] == "failed":
        return "error"
    status = asset["moderation"]["status"]
    return status if status in ("approved", "rejected") else "pending"


def explain(report: ClassificationReport | None) -> dict:
    """Reads a moderation report without inventing scores: a not-evaluated category (or a
    status this app doesn't know) is unknown, never zero."""
    found: list[tuple[str, float]] = []
    unknown: list[str] = []
    for category, result in sorted((report["categories"] if report else {}).items()):
        if result["status"] in ("evaluated", "partial"):
            if result["score"] >= SHOWN_SCORE:
                found.append((category, result["score"]))
        else:
            unknown.append(category)
    found.sort(key=lambda item: -item[1])
    return {"found": found, "unknown": unknown}


def external_id(link_id: str, part: str) -> str:
    """The externalId sent with each asset: `<link id>:note` or `<link id>:page`. The link
    record exists before anything is sent, so every externalId maps back to it."""
    return f"{link_id}:{part}"


class Moderator:
    """Every CalmLens call the board makes. The client is thread-safe and shared."""

    demo = False

    def __init__(self, client: CalmLensServerClient):
        self.client = client

    def check_note(self, link_id: str, note: str, demo_result: str) -> Asset:
        return self.client.text.moderate(
            name="Calmboard note", external_id=external_id(link_id, "note"), text=note,
            processing_options={"keepContentAfterProcessing": False},
        )

    def submit_link(self, link_id: str, url: str, demo_result: str) -> Asset:
        # CalmLens fetches the page itself and moderates it as a `website` asset. The board
        # never serves the page, so nothing is retained after processing.
        return self.client.assets.create(
            name="Calmboard link", url=url, external_id=external_id(link_id, "page"),
            processing_options={"keepContentAfterProcessing": False},
        )

    def retrieve(self, asset_id: str) -> Asset:
        return self.client.assets.retrieve(asset_id=asset_id)

    def children(self, asset_id: str) -> list[Asset]:
        return list(self.client.assets.iter_children(asset_id=asset_id, page_size=20))

    def delete(self, asset_id: str):
        try:
            self.client.assets.delete(asset_id=asset_id)
        except CalmLensError as error:
            if not error.is_not_found:
                raise


def create_moderator(env=os.environ, demo: bool = False) -> Moderator:
    """Live moderation with credentials. Without them the app refuses to start unless demo
    mode was asked for (--demo or CALMLENS_DEMO=1): it never quietly approves everything."""
    api_key, project_id = env.get("CALMLENS_API_KEY", ""), env.get("CALMLENS_PROJECT_ID", "")
    if bool(api_key) != bool(project_id):
        raise ConfigurationError("Set both CALMLENS_API_KEY and CALMLENS_PROJECT_ID")
    if api_key:
        options = {"base_url": env["CALMLENS_API_URL"]} if env.get("CALMLENS_API_URL") else {}
        return Moderator(CalmLensServerClient(api_key=api_key, project_id=project_id, **options))
    if not (demo or env.get("CALMLENS_DEMO") == "1"):
        raise ConfigurationError("Set CALMLENS_API_KEY and CALMLENS_PROJECT_ID for live moderation, "
                                 "or run with --demo (or CALMLENS_DEMO=1) for simulated decisions")
    # Imported only here: the SDK's test client never loads in live mode.
    from demo import DemoModerator
    return DemoModerator()


class Board:
    def __init__(self, moderator: Moderator):
        self.moderator = moderator
        self.csrf_token = secrets.token_urlsafe(32)
        self.links: list[dict] = []
        # Guards `links` only; CalmLens calls run outside it, so requests never wait on each other.
        self.lock = threading.Lock()

    def link_for_external_id(self, value: str) -> dict | None:
        """The link an asset's externalId belongs to (for webhooks or the events feed)."""
        link_id, _, part = value.rpartition(":")
        with self.lock:
            link = next((item for item in self.links if item["id"] == link_id), None)
            return dict(link) if link and part in ("note", "page") else None

    def submit(self, url: str, note: str, demo_result: str = "approved") -> str:
        url = validate_url(url)
        note = note.strip()
        if not note or len(note) > MAX_NOTE:
            raise InvalidInput(f"Write a note of 1 to {MAX_NOTE} characters")
        if demo_result not in DEMO_RESULTS:
            raise InvalidInput("Unknown demo result")
        link: dict = {"id": str(uuid.uuid4()), "url": url, "note": note, "status": "checking-note",
                      "note_asset_id": None, "asset_id": None, "flagged": False, "explanation": None, "children": []}
        with self.lock:
            self.links.insert(0, link)
            del self.links[MAX_LINKS:]
        try:
            note_asset = self.moderator.check_note(link["id"], note, demo_result)
            with self.lock:
                link["note_asset_id"] = note_asset["id"]
            note_status = note_asset["moderation"]["status"]
            if note_status != "approved":
                with self.lock:
                    link["status"] = "note-rejected"
                return "note-rejected" if note_status == "rejected" else "note-unfinished"
            asset = self.moderator.submit_link(link["id"], url, demo_result)
        except BaseException:
            with self.lock:
                link["status"] = "error"
            raise
        with self.lock:
            link.update(asset_id=asset["id"], status="pending")
        return "shared"

    def refresh(self):
        """Polls every link still being checked. Unknown statuses stay closed."""
        with self.lock:
            pending = [(link, link["asset_id"]) for link in self.links if link["status"] == "pending"]
        for link, asset_id in pending:
            try:
                asset = self.moderator.retrieve(asset_id)
            except CalmLensError as error:
                logging.warning("Could not refresh %s: %s (request %s)", asset_id, error.code, error.request_id)
                continue
            moderation = asset["moderation"]
            report = moderation["report"]
            # Flagged means the policy took an action (alert, hide or purge) on the page.
            update = {"status": link_status(asset), "flagged": moderation["action"] is not None}
            if update["status"] in ("approved", "rejected") and (update["flagged"] or update["status"] == "rejected"):
                update["explanation"] = explain(report)
                update["children"] = self._child_findings(asset["id"])
            with self.lock:
                link.update(update)

    def _child_findings(self, asset_id: str) -> list[dict]:
        try:
            children = self.moderator.children(asset_id)
        except CalmLensError as error:
            logging.warning("Could not list parts of %s: %s", asset_id, error.code)
            return []
        findings = [{"name": child.get("name") or child.get("type"), "type": child.get("type"),
                     "status": child["moderation"]["status"], "found": explain(child["moderation"]["report"])["found"]}
                    for child in children]
        # The parts that caused the decision first; the rest stay in the API's order (newest first).
        findings.sort(key=lambda part: part["status"] != "rejected")
        return findings

    def remove(self, link_id: str) -> str:
        with self.lock:
            link = next((item for item in self.links if item["id"] == link_id), None)
        if not link:
            raise InvalidInput("That link is no longer on the board")
        for asset_id in (link["asset_id"], link["note_asset_id"]):
            if asset_id:
                self.moderator.delete(asset_id)
        with self.lock:
            self.links = [item for item in self.links if item["id"] != link_id]
        return "removed"

    def render(self, notice: str = "") -> bytes:
        with self.lock:
            links = [dict(link) for link in self.links]
        cards = "".join(self._card(link) for link in links) or '<div class="empty">No links yet.<br><span>Share the first one below.</span></div>'
        demo = self.moderator.demo
        mode = "Demo · simulated decisions" if demo else "Live · CalmLens moderation"
        options = "".join(f'<option value="{key}">{escape(label)}</option>' for key, label in DEMO_RESULTS.items())
        selector = f'<label for="demo_result">Demo outcome</label><select id="demo_result" name="demo_result">{options}</select>' if demo else ""
        refresh = '<meta http-equiv="refresh" content="3">' if any(link["status"] in ("pending", "checking-note") for link in links) else ""
        notice_html = f'<div class="notice" role="status">{escape(notice)}</div>' if notice else ""
        html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8">{refresh}
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Calmboard · Python SDK example</title>
<style>
:root{{font-family:system-ui,sans-serif;color:#16382d;background:#f5f8f4;line-height:1.6}}*{{box-sizing:border-box}}body{{margin:0}}
main{{max-width:1050px;margin:auto;padding:40px 24px}}header{{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid #d8e3d9;padding-bottom:22px}}
.wordmark{{font-size:22px;font-weight:750;letter-spacing:-1px}}.mode,.badge{{border-radius:30px;padding:5px 12px;background:#dfeddf;font-size:12px;font-weight:650}}
h1{{font-size:clamp(32px,5vw,52px);line-height:1.1;letter-spacing:-2px;margin:34px 0 12px}}.intro{{max-width:640px;color:#526e61}}
.layout{{display:grid;grid-template-columns:1.3fr 1fr;gap:28px;margin-top:32px}}h2{{font-size:19px;margin:0 0 18px}}
article,form,.empty{{background:white;border:1px solid #d8e3d9;border-radius:18px;padding:22px;margin-bottom:16px}}article p{{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}}
.card-top{{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px}}.warn{{background:#fff0ca;color:#6a490d}}.stop{{background:#fbe0dc;color:#7a2318}}
.url{{font-family:ui-monospace,monospace;font-size:13px;overflow-wrap:anywhere}}a{{color:#205a42}}ul{{margin:6px 0;padding-left:20px;font-size:13px}}small{{font-size:11px;color:#526e61;overflow-wrap:anywhere}}
label{{display:block;font-size:14px;font-weight:650;margin:14px 0 8px}}input,textarea,select,button{{font:inherit;width:100%;border-radius:9px;padding:12px}}
input,textarea,select{{border:1px solid #b9ccbf;background:#fcfdfb}}textarea{{min-height:90px;resize:vertical}}button{{background:#205a42;color:white;border:0;cursor:pointer;margin-top:20px;font-weight:650}}
.remove button{{background:none;color:#7a2318;border:1px solid #e3c2bc;margin-top:10px;padding:6px 12px;width:auto;font-size:13px}}:focus-visible{{outline:3px solid #bd8725;outline-offset:3px}}
.notice{{padding:16px 20px;border:1px solid #b9ccbf;background:#e9f2e8;border-radius:12px;margin-top:24px}}.empty{{padding:44px 22px;text-align:center;font-weight:650}}.empty span,.hint{{font-size:13px;color:#526e61;font-weight:400}}
footer{{color:#526e61;font-size:12px;margin-top:32px}}@media(max-width:700px){{.layout{{grid-template-columns:1fr}}header{{align-items:flex-start;flex-direction:column}}}}
</style></head><body><main><header><div class="wordmark">◉ Calmboard</div><span class="mode">{mode}</span></header>
<h1>Share links.<br>We read the page first.</h1><p class="intro">A community link board built with the CalmLens Python SDK. CalmLens fetches each shared page and moderates it, including the text and images it finds there. A link becomes clickable only after the page is approved.</p>
{notice_html}<div class="layout"><section aria-label="Shared links"><h2>On the board</h2>{cards}</section>
<section><form action="/links" method="post"><h2>Share a link</h2><input type="hidden" name="csrf" value="{self.csrf_token}">
<label for="url">Link</label><input id="url" name="url" type="url" maxlength="{MAX_URL}" required placeholder="https://example.com/article">
<label for="note">Why it is worth reading</label><textarea id="note" name="note" maxlength="{MAX_NOTE}" required></textarea>
{selector}<button type="submit">Check &amp; share</button><p class="hint">Your note is checked straight away. The page is checked in the background; until it is approved, the link is shown as text only.</p></form></section></div>
<footer>Local learning example · the latest {MAX_LINKS} links live in memory · demo outcomes do not run moderation</footer></main></body></html>'''
        return html.encode("utf-8")

    def _card(self, link: dict) -> str:
        status, flagged = link["status"], link["flagged"]
        if status == "approved":
            badge = '<span class="badge warn">Approved, flagged</span>' if flagged else '<span class="badge">Approved</span>'
            target = f'<a class="url" href="{escape(link["url"])}" rel="noopener noreferrer nofollow ugc">{escape(link["url"])}</a>'
        else:
            label = {"pending": "Checking the page", "checking-note": "Checking the note",
                     "note-rejected": "Not shared: note not approved", "rejected": "Not shared: page rejected",
                     "error": "Not shared: the page could not be checked"}.get(status, "Checking the page")
            badge = f'<span class="badge{" stop" if status in ("rejected", "error", "note-rejected") else ""}">{label}</span>'
            target = f'<span class="url">{escape(link["url"])}</span>'
        why = ""
        explanation = link.get("explanation")
        if explanation:
            found = "".join(f"<li>{escape(category)}: {score:.0%}</li>" for category, score in explanation["found"]) or "<li>No category reached the display threshold</li>"
            unknown = f'<li>Not evaluated: {escape(", ".join(explanation["unknown"]))}</li>' if explanation["unknown"] else ""
            parts = "".join(
                f'<li>{escape(child["name"] or "")} ({escape(child["type"] or "")}, {escape(child["status"] or "")})'
                + (": " + escape(", ".join(category for category, _ in child["found"])) if child["found"] else "") + "</li>"
                for child in link.get("children") or [])
            why = f'<p><strong>Why</strong></p><ul>{found}{unknown}</ul>' + (f'<p><strong>Parts of the page</strong></p><ul>{parts}</ul>' if parts else "")
        reference = f'<small>Asset {escape(link["asset_id"])}</small>' if link.get("asset_id") else ""
        return (f'<article><div class="card-top"><span>Shared link</span>{badge}</div><p>{escape(link["note"])}</p>{target}{why}'
                f'<form class="remove" action="/links/{escape(link["id"])}/delete" method="post"><input type="hidden" name="csrf" value="{self.csrf_token}">'
                f'<button type="submit">Remove</button></form>{reference}</article>')


def make_handler(board: Board):
    class Handler(BaseHTTPRequestHandler):
        def send_page(self, notice="", status=200):
            body = board.render(notice)
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def redirect(self, notice: str):
            self.send_response(303)
            self.send_header("Location", "/?" + urlencode({"notice": notice}))
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            if urlsplit(self.path).path != "/":
                self.send_error(404)
                return
            board.refresh()
            key = parse_qs(urlsplit(self.path).query).get("notice", [""])[0]
            self.send_page(NOTICES.get(key, ""))

        def read_form(self):
            declared = self.headers.get("Content-Length")
            if declared is None:
                return None, 411
            if not declared.isascii() or not declared.isdigit():
                return None, 400
            length = int(declared)
            if length > MAX_BODY:
                return None, 413
            if self.headers.get_content_type() != "application/x-www-form-urlencoded":
                return None, 415
            fields = parse_qs(self.rfile.read(length).decode("utf-8"), max_num_fields=6)
            if not secrets.compare_digest(fields.get("csrf", [""])[0].encode(), board.csrf_token.encode()):
                return None, 403
            return fields, 200

        def do_POST(self):
            path = urlsplit(self.path).path
            parts = path.strip("/").split("/")
            if path != "/links" and not (len(parts) == 3 and parts[0] == "links" and parts[2] == "delete"):
                self.send_error(404)
                return
            try:
                fields, status = self.read_form()
                if fields is None:
                    self.send_error(status)
                    return
                if path == "/links":
                    # A submitted demo outcome never affects live moderation.
                    choice = fields.get("demo_result", ["approved"])[0] if board.moderator.demo else "approved"
                    notice = board.submit(fields.get("url", [""])[0], fields.get("note", [""])[0], choice)
                else:
                    notice = board.remove(parts[1])
            except CalmLensError as error:
                # Logged for the operator (with the request ID to quote to support); the member
                # gets a fixed message, never the SDK's error text.
                logging.warning("CalmLens request failed: %s (status %s, request %s)", error.code, error.status,
                                error.request_id)
                unreachable = isinstance(error, CalmLensTransportError)
                self.send_page("CalmLens could not be reached. Please try again." if unreachable else "The request to CalmLens failed. Please try again.", 502)
                return
            except InvalidInput as error:
                self.send_page(str(error), 400)
                return
            except UnicodeDecodeError:
                self.send_page("The form could not be read.", 400)
                return
            self.redirect(notice)
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--demo", action="store_true", help="simulate decisions without CalmLens credentials")
    args = parser.parse_args()
    try:
        moderator = create_moderator(os.environ, demo=args.demo)
    except ConfigurationError as error:
        parser.exit(2, f"calmboard: {error}\n")
    server = ThreadingHTTPServer((HOST, args.port), make_handler(Board(moderator)))
    print(f"Calmboard: http://{HOST}:{args.port} ({'demo' if moderator.demo else 'live'})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
