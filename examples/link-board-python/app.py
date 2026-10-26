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
import time
import uuid
from urllib.parse import parse_qs, urlencode, urlsplit

from calmlens import Asset, CalmLensServerClient, CalmLensError, CalmLensTransportError, AssetModeration

HOST = "127.0.0.1"
DEFAULT_PORT = 6401
MAX_NOTE = 280
MAX_URL = 2048
MAX_BODY = 16 * 1024
MAX_LINKS = 50
# Category scores at or above this are shown when explaining a decision. It is a display
# choice for this page; the project's policy decides each moderation status.
SHOWN_SCORE = 0.4
# How often a page the policy acted on is read again, so a moderator's later review shows up.
RECHECK_SECONDS = 60.0
DEMO_RESULTS = {
    "allowed": "Allow the page",
    "limited": "Limit the page",
    "age-restricted": "Age-restrict the page",
    "blocked": "Block the page text",
    "image-blocked": "Block an image on the page",
    "purged": "Purge the page",
    "error": "Processing error",
    "note-blocked": "Block the note",
}
# Moderation statuses once CalmLens has decided. Only `allowed` and `limited` pages become links
# (a `limited` one collapsed behind "Show link", so it reaches fewer members): the board has no age
# gate, so it does not link `age-restricted` pages either.
DECIDED_STATUSES = ("allowed", "limited", "age-restricted", "blocked", "purged")
SHOWN_STATUSES = ("allowed", "limited")
# Decisions a moderator can still change; purged content is gone, so it is not read again.
RECHECKED_STATUSES = ("limited", "age-restricted", "blocked")
# CalmLens names a page's extracted text "<page title> - Text Content", with a default
# description when the page has none.
TEXT_PART_SUFFIX = " - Text Content"
DEFAULT_TEXT_DESCRIPTION = "Extracted text content from website"
CATEGORY_LABELS = {
    "sexual": "Sexual content", "violence": "Violence", "self-harm": "Self-harm", "harassment": "Harassment",
    "hate": "Hate", "criminal-activity": "Criminal activity", "personal-information": "Personal information",
    "profanity": "Profanity",
}
# Redirects carry one of these keys, never free text, so a crafted link cannot put words on the page.
NOTICES = {
    "shared": "Shared. The link goes live once the page has been checked.",
    "note-not-allowed": "Not shared: your note didn't pass moderation.",
    "note-unfinished": "Not shared: moderation didn't finish. Please try again.",
    "retried": "Checking the page again.",
    "removed": "Removed, along with CalmLens's record of the page and note.",
}
# Badge text and tone for each link state.
STATES = {
    "checking-note": ("Checking note", "wait"), "pending": ("Checking page", "wait"),
    "allowed": ("Live", "ok"), "limited": ("Limited", "warn"), "age-restricted": ("18+", "warn"),
    "blocked": ("Blocked", "stop"), "purged": ("Removed", "stop"), "error": ("Couldn't check", "stop"),
    "note-not-allowed": ("Note not allowed", "stop"),
}
SUMMARIES = {
    "limited": "Limited by moderation, so the link stays folded.",
    "age-restricted": "For adults only. The board has no age check, so it isn't linked.",
    "blocked": "Not linked: the page didn't pass moderation.",
    "purged": "Not linked: the page didn't pass moderation and its content was deleted.",
    "note-not-allowed": "Not shared: the note didn't pass moderation, so the page wasn't checked.",
    "error": "The page couldn't be loaded or read.",
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
    """A shared link's state from its asset: the moderation status once CalmLens has decided,
    ``error`` when processing failed, else ``pending``. A status this app doesn't know stays pending."""
    if asset["classification"]["status"] == "failed":
        return "error"
    status = asset["classification"]["moderation"]["status"]
    return status if status in DECIDED_STATUSES else "pending"


def explain(report: AssetModeration | None) -> dict:
    """Reads a classification results without inventing scores: a not-evaluated category (or a
    status this app doesn't know) is unknown, never zero."""
    found: list[tuple[str, float]] = []
    unknown: list[str] = []
    for category, result in sorted(((report or {}).get("categories") or {}).items()):
        if result["status"] in ("evaluated", "partial"):
            if result["score"] >= SHOWN_SCORE:
                found.append((category, result["score"]))
        else:
            unknown.append(category)
    found.sort(key=lambda item: -item[1])
    return {"found": found, "unknown": unknown}


def decision_source(report: AssetModeration | None) -> str | None:
    """Where the decision came from: ``children`` when the page's parts decided it, ``policy``
    when the page's own scores did, or a reviewer's or hash list's decision."""
    return (((report or {}).get("policy") or {}).get("decision") or {}).get("source")


def latest_review(report: AssetModeration | None) -> str | None:
    """The decision of the latest moderator review applied to the asset, if any."""
    reviews = [review for review in (report or {}).get("manualReviews") or [] if review.get("appliedToAsset")]
    return max(reviews, key=lambda review: review["reviewedAt"])["decision"] if reviews else None


def page_preview(children: list[Asset]) -> dict:
    """The page's title and description, read from the text part CalmLens extracted."""
    for child in children:
        name = child.get("name") or ""
        if child.get("type") == "plaintext-document" and name.endswith(TEXT_PART_SUFFIX):
            description = child.get("description") or ""
            return {"title": name[: -len(TEXT_PART_SUFFIX)].strip(),
                    "description": "" if description == DEFAULT_TEXT_DESCRIPTION else description}
    return {"title": "", "description": ""}


def category_label(category: str) -> str:
    return CATEGORY_LABELS.get(category, category.replace("-", " ").capitalize())


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
        return self.client.text.classify(
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
    mode was asked for (--demo or CALMLENS_DEMO=1): it never quietly allows everything."""
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


def ago(seconds: float) -> str:
    minutes = int(seconds // 60)
    if minutes < 1:
        return "just now"
    if minutes < 60:
        return f"{minutes} min ago"
    hours = minutes // 60
    return f"{hours} h ago" if hours < 24 else f"{hours // 24} d ago"


def short_url(url: str, host_only: bool = False) -> str:
    """The address as members see it: host and path, or only the host for pages that were not
    allowed, so a blocked address is not repeated in full."""
    parts = urlsplit(url)
    host = (parts.hostname or "").removeprefix("www.")
    if host_only:
        return host
    path = parts.path.rstrip("/")
    text = host + path + (f"?{parts.query}" if parts.query else "")
    return text if len(text) <= 72 else text[:71] + "…"


class Board:
    def __init__(self, moderator: Moderator, clock=time.monotonic, wall_clock=time.time):
        self.moderator = moderator
        self.clock = clock
        self.wall_clock = wall_clock
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

    def _find(self, link_id: str) -> dict:
        with self.lock:
            link = next((item for item in self.links if item["id"] == link_id), None)
        if not link:
            raise InvalidInput("That link is no longer on the board")
        return link

    def submit(self, url: str, note: str, demo_result: str = "allowed") -> str:
        url = validate_url(url)
        note = note.strip()
        if not note or len(note) > MAX_NOTE:
            raise InvalidInput(f"Write a note of 1 to {MAX_NOTE} characters")
        if demo_result not in DEMO_RESULTS:
            raise InvalidInput("Unknown demo result")
        link: dict = {"id": str(uuid.uuid4()), "url": url, "note": note, "status": "checking-note",
                      "shared_at": self.wall_clock(), "note_asset_id": None, "note_allowed": False,
                      "note_found": [], "asset_id": None, "checked_at": None, "preview": None, "parts": [],
                      "reason": None, "review": None}
        with self.lock:
            self.links.insert(0, link)
            del self.links[MAX_LINKS:]
        return self._check_and_submit(link, demo_result)

    def retry(self, link_id: str) -> str:
        """Submits the page of a link that could not be checked again, as a new asset. Its note is
        checked again only if that check never finished."""
        link = self._find(link_id)
        if link["status"] != "error":
            raise InvalidInput("Only links that couldn't be checked can be tried again")
        if link["asset_id"]:
            self.moderator.delete(link["asset_id"])
        with self.lock:
            link.update(asset_id=None, status="checking-note" if not link["note_allowed"] else "pending")
        # A retried demo link is allowed, so the demo can't fail the same way forever.
        result = self._check_and_submit(link, "allowed")
        return "retried" if result == "shared" else result

    def _check_and_submit(self, link: dict, demo_result: str) -> str:
        try:
            if not link["note_allowed"]:
                note_asset = self.moderator.check_note(link["id"], link["note"], demo_result)
                report = note_asset["classification"]["moderation"]
                with self.lock:
                    link["note_asset_id"] = note_asset["id"]
                if report["status"] not in SHOWN_STATUSES:
                    with self.lock:
                        link.update(status="note-not-allowed", note_found=explain(report)["found"])
                    return "note-not-allowed" if report["status"] in DECIDED_STATUSES else "note-unfinished"
                with self.lock:
                    link["note_allowed"] = True
            asset = self.moderator.submit_link(link["id"], link["url"], demo_result)
        except BaseException:
            with self.lock:
                link["status"] = "error"
            raise
        with self.lock:
            link.update(asset_id=asset["id"], status="pending")
        return "shared"

    def refresh(self):
        """Polls every link still being checked, and reads pages the policy acted on again every
        RECHECK_SECONDS so a moderator's later decision reaches the board. Unknown statuses stay closed."""
        now = self.clock()
        with self.lock:
            due = [(link, link["asset_id"]) for link in self.links if link["asset_id"] and (
                link["status"] == "pending"
                or (link["status"] in RECHECKED_STATUSES and now - (link["checked_at"] or 0) >= RECHECK_SECONDS))]
        for link, asset_id in due:
            try:
                asset = self.moderator.retrieve(asset_id)
            except CalmLensError as error:
                logging.warning("Could not refresh %s: %s (request %s)", asset_id, error.code, error.request_id)
                continue
            update = self._read_page(asset, link)
            with self.lock:
                link.update(update, checked_at=now)

    def _read_page(self, asset: Asset, link: dict) -> dict:
        status = link_status(asset)
        update: dict = {"status": status}
        if status not in DECIDED_STATUSES:
            return update
        report = asset["classification"]["moderation"]
        update["review"] = latest_review(report)
        # The parts are read once, when the page is first decided: they don't change afterwards.
        if link["preview"] is None:
            children = self._children(asset["id"])
            update["preview"] = page_preview(children)
            update["parts"] = [self._part(child) for child in children]
            # The parts that caused the decision first; the rest stay in the API's order (newest first).
            update["parts"].sort(key=lambda part: part["status"] in ("allowed", "pending"))
        # Any decided status other than `allowed` means the policy acted on the page.
        if status != "allowed":
            source = decision_source(report)
            # A decision taken from the page's parts leaves the page's own categories unevaluated:
            # the parts carry the findings.
            update["reason"] = {"source": source,
                                **({"found": [], "unknown": []} if source == "children" else explain(report))}
        else:
            update["reason"] = None
        return update

    def _children(self, asset_id: str) -> list[Asset]:
        try:
            return self.moderator.children(asset_id)
        except CalmLensError as error:
            logging.warning("Could not list parts of %s: %s", asset_id, error.code)
            return []

    @staticmethod
    def _part(child: Asset) -> dict:
        report = child["classification"]["moderation"]
        is_text = child.get("type") == "plaintext-document"
        return {"name": "Page text" if is_text else (child.get("name") or "Image"), "type": child.get("type"),
                "status": report.get("status") or "pending", **explain(report)}

    def remove(self, link_id: str) -> str:
        link = self._find(link_id)
        for asset_id in (link["asset_id"], link["note_asset_id"]):
            if asset_id:
                self.moderator.delete(asset_id)
        with self.lock:
            self.links = [item for item in self.links if item["id"] != link_id]
        return "removed"

    def render(self, notice: str = "") -> bytes:
        with self.lock:
            links = [dict(link) for link in self.links]
        now = self.wall_clock()
        cards = "".join(self._card(link, now) for link in links) or '<p class="empty">No links yet. Share the first one.</p>'
        demo = self.moderator.demo
        live = sum(link["status"] in SHOWN_STATUSES for link in links)
        checking = sum(link["status"] in ("pending", "checking-note") for link in links)
        counts = " · ".join(text for count, text in ((live, f"{live} live"), (checking, f"{checking} checking"),
                                                     (len(links) - live - checking, f"{len(links) - live - checking} not shown")) if count)
        options = "".join(f'<option value="{key}">{escape(label)}</option>' for key, label in DEMO_RESULTS.items())
        selector = (f'<label for="demo_result">Demo outcome</label><select id="demo_result" name="demo_result">{options}</select>'
                    if demo else "")
        refresh = '<meta http-equiv="refresh" content="3">' if checking else ""
        notice_html = f'<p class="notice" role="status">{escape(notice)}</p>' if notice else ""
        demo_tag = '<span class="demo">Demo · decisions are simulated</span>' if demo else ""
        html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8">{refresh}
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Calmboard</title>
<style>
:root{{--ink:#1c2422;--muted:#5d6966;--line:#e2e6e3;--bg:#f6f7f5;--card:#fff;--accent:#1d5c48;--ok:#1d6b4a;--ok-bg:#e3f1ea;
--warn:#7a5310;--warn-bg:#fbf0d9;--stop:#9a2f22;--stop-bg:#fbe7e3;--wait:#3f5a78;--wait-bg:#e7eef6;
font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);line-height:1.5;font-size:15px}}
*{{box-sizing:border-box}}body{{margin:0}}a{{color:var(--accent)}}
.top{{background:var(--card);border-bottom:1px solid var(--line)}}.bar{{max-width:1120px;margin:auto;padding:14px 24px;display:flex;align-items:center;gap:16px}}
.wordmark{{font-weight:700;font-size:18px;letter-spacing:-.3px}}.demo{{margin-left:auto;font-size:13px;color:var(--muted)}}
main{{max-width:1120px;margin:auto;padding:28px 24px 48px;display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:32px;align-items:start}}
.feed-head{{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}}
h1{{font-size:20px;margin:0}}h2{{font-size:16px;margin:0 0 4px}}.counts{{color:var(--muted);font-size:13px}}
.feed{{background:var(--card);border:1px solid var(--line);border-radius:10px}}
article{{padding:16px 20px;border-top:1px solid var(--line)}}article:first-child{{border-top:0}}
.row{{display:flex;gap:16px;align-items:flex-start;justify-content:space-between}}
.title{{font-size:16px;font-weight:600;margin:0;overflow-wrap:anywhere}}.title a{{color:var(--ink);text-decoration:none}}.title a:hover{{text-decoration:underline}}
.meta{{color:var(--muted);font-size:13px;margin:2px 0 0;overflow-wrap:anywhere}}.desc{{color:var(--muted);font-size:14px;margin:6px 0 0}}
.note{{margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}}.note.hidden{{color:var(--muted);font-style:italic}}
.badge{{flex:none;font-size:12px;font-weight:600;border-radius:6px;padding:2px 8px}}
.ok{{background:var(--ok-bg);color:var(--ok)}}.warn{{background:var(--warn-bg);color:var(--warn)}}.stop{{background:var(--stop-bg);color:var(--stop)}}.wait{{background:var(--wait-bg);color:var(--wait)}}
details{{margin-top:6px;font-size:14px}}summary{{cursor:pointer;color:var(--accent)}}
.reason{{margin-top:10px;border-left:3px solid var(--line);padding:2px 0 2px 12px;font-size:14px}}.reason p{{margin:0 0 4px}}
.parts{{list-style:none;margin:4px 0 0;padding:0}}.parts li{{display:flex;gap:10px;justify-content:space-between;padding:3px 0;border-top:1px dashed var(--line)}}
.parts li:first-child{{border-top:0}}.parts .found{{color:var(--stop)}}.parts .clear{{color:var(--muted)}}.part-name{{overflow-wrap:anywhere}}
.unknown{{color:var(--muted);font-size:13px}}
.actions{{display:flex;gap:16px;margin-top:8px}}.actions form{{margin:0}}
.link-button{{background:none;border:0;padding:0;font:inherit;font-size:13px;color:var(--muted);cursor:pointer;text-decoration:underline}}
.link-button.primary{{color:var(--accent);font-weight:600}}
aside form{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px}}
.sub{{color:var(--muted);font-size:13px;margin:0 0 8px}}
label{{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}}
input,textarea,select{{font:inherit;width:100%;border:1px solid #c9d1cd;border-radius:7px;padding:9px 11px;background:#fff;color:var(--ink)}}
textarea{{min-height:96px;resize:vertical}}
.submit{{margin-top:16px;width:100%;font:inherit;font-weight:600;background:var(--accent);color:#fff;border:0;border-radius:7px;padding:10px;cursor:pointer}}
:focus-visible{{outline:3px solid #c08a2b;outline-offset:2px}}
.notice{{margin:0 0 12px;padding:10px 14px;background:var(--ok-bg);border-radius:8px;font-size:14px}}.empty{{padding:40px 20px;text-align:center;color:var(--muted);margin:0}}
@media(max-width:820px){{main{{grid-template-columns:1fr}}aside{{order:-1}}}}
</style></head><body><header class="top"><div class="bar"><span class="wordmark">Calmboard</span>{demo_tag}</div></header>
<main><section aria-labelledby="feed-title"><div class="feed-head"><h1 id="feed-title">Latest links</h1><span class="counts">{counts}</span></div>
{notice_html}<div class="feed">{cards}</div></section>
<aside><form action="/links" method="post"><h2>Share a link</h2><p class="sub">Links go live once the page has been checked.</p>
<input type="hidden" name="csrf" value="{self.csrf_token}">
<label for="url">Link</label><input id="url" name="url" type="url" maxlength="{MAX_URL}" required placeholder="https://">
<label for="note">Note</label><textarea id="note" name="note" maxlength="{MAX_NOTE}" required placeholder="What's worth reading here?"></textarea>
{selector}<button class="submit" type="submit">Share</button></form></aside></main></body></html>'''
        return html.encode("utf-8")

    def _card(self, link: dict, now: float) -> str:
        status = link["status"]
        label, tone = STATES.get(status, STATES["pending"])
        url, preview = link["url"], link.get("preview") or {}
        # Titles and descriptions come from the page, so they're shown only for pages that weren't blocked.
        disclosed = status in ("allowed", "limited", "age-restricted")
        title = escape(preview.get("title") if disclosed and preview.get("title") else
                       short_url(url, host_only=status in ("blocked", "purged")))
        link_html = f'<a href="{escape(url)}" rel="noopener noreferrer nofollow ugc">'
        title_html = f'{link_html}{title}</a>' if status == "allowed" else title
        parts = link.get("parts") or []
        # The host is repeated under the title only when the title is the page's own.
        meta = [escape(short_url(url, host_only=True))] if disclosed and preview.get("title") else []
        meta.append(f'shared {ago(now - link["shared_at"])}')
        if parts:
            meta.append(f'{len(parts)} part{"s" if len(parts) != 1 else ""} checked')
        body = [f'<p class="meta">{" · ".join(meta)}</p>']
        if status == "limited":
            body.append(f'<details><summary>Show link</summary>{link_html}{escape(short_url(url))}</a></details>')
        if disclosed and preview.get("description"):
            body.append(f'<p class="desc">{escape(preview["description"])}</p>')
        # A note that didn't pass moderation is never shown.
        body.append('<p class="note hidden">Note hidden</p>' if status == "note-not-allowed"
                    else f'<p class="note">{escape(link["note"])}</p>')
        if status in SUMMARIES:
            body.append(self._reason(link))
        actions = []
        if status == "error":
            actions.append(self._button(f'/links/{link["id"]}/retry', "Try again", primary=True))
        actions.append(self._button(f'/links/{link["id"]}/delete', "Remove"))
        body.append(f'<div class="actions">{"".join(actions)}</div>')
        return (f'<article><div class="row"><h3 class="title">{title_html}</h3>'
                f'<span class="badge {tone}">{label}</span></div>{"".join(body)}</article>')

    @staticmethod
    def _findings(found: list) -> str:
        return ", ".join(f"{category_label(category)} {score:.0%}" for category, score in found)

    def _reason(self, link: dict) -> str:
        status = link["status"]
        lines = [f'<p>{escape(SUMMARIES[status])}</p>']
        if status == "note-not-allowed" and link.get("note_found"):
            lines.append(f'<p class="unknown">Note flagged for {escape(self._findings(link["note_found"]))}</p>')
        reason = link.get("reason") or {}
        if reason.get("found"):
            lines.append(f'<p>Flagged for {escape(self._findings(reason["found"]))}</p>')
        rows = []
        for part in link.get("parts") or []:
            acted = part["status"] not in ("allowed", "pending")
            finding = (escape(self._findings(part["found"])) if part["found"]
                       else escape(STATES.get(part["status"], ("", ""))[0]) if acted else "Clear")
            rows.append(f'<li><span class="part-name">{escape(part["name"])}</span>'
                        f'<span class="{"found" if acted else "clear"}">{finding}</span></li>')
        if rows and status not in ("note-not-allowed", "error"):
            lines.append(f'<ul class="parts" aria-label="Parts of the page">{"".join(rows)}</ul>')
        unknown = reason.get("unknown") or []
        if unknown:
            lines.append(f'<p class="unknown">Not evaluated: {escape(", ".join(category_label(c) for c in unknown))}</p>')
        if link.get("review"):
            lines.append(f'<p class="unknown">Reviewed by a moderator: {escape(link["review"])}</p>')
        return f'<div class="reason">{"".join(lines)}</div>'

    def _button(self, action: str, text: str, primary: bool = False) -> str:
        return (f'<form action="{escape(action)}" method="post"><input type="hidden" name="csrf" value="{self.csrf_token}">'
                f'<button class="link-button{" primary" if primary else ""}" type="submit">{escape(text)}</button></form>')


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
            if path != "/links" and not (len(parts) == 3 and parts[0] == "links" and parts[2] in ("delete", "retry")):
                self.send_error(404)
                return
            try:
                fields, status = self.read_form()
                if fields is None:
                    self.send_error(status)
                    return
                if path == "/links":
                    # A submitted demo outcome never affects live moderation.
                    choice = fields.get("demo_result", ["allowed"])[0] if board.moderator.demo else "allowed"
                    notice = board.submit(fields.get("url", [""])[0], fields.get("note", [""])[0], choice)
                elif parts[2] == "retry":
                    notice = board.retry(parts[1])
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
    board = Board(moderator)
    if moderator.demo:
        # Sample links in every state, so the demo board isn't empty.
        from demo import seed
        seed(board)
    server = ThreadingHTTPServer((HOST, args.port), make_handler(board))
    print(f"Calmboard: http://{HOST}:{args.port} ({'demo' if moderator.demo else 'live'})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
