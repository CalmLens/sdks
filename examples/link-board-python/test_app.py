import io
import re
import subprocess
import sys
import unittest
from types import SimpleNamespace
from urllib.parse import urlencode

from calmlens import CalmLensError
from calmlens.testing import MockCalmLensServerClient

from app import (Board, ConfigurationError, InvalidInput, Moderator, create_moderator, explain, make_handler,
                 validate_url)
from demo import DemoModerator


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def demo_board():
    clock = Clock()
    return Board(DemoModerator(clock=clock)), clock


def live_board(client=None):
    return Board(Moderator(client or MockCalmLensServerClient()))


def clickable(board):
    return re.findall(rb'<a class="url" href="([^"]+)"', board.render())


class DemoFlowTests(unittest.TestCase):
    def test_link_is_clickable_only_after_the_page_is_approved(self):
        board, clock = demo_board()
        board.submit("https://example.com/good", "Worth a read", "approved")
        board.refresh()
        self.assertEqual(board.links[0]["status"], "pending")
        self.assertEqual(clickable(board), [])
        clock.now = 5
        board.refresh()
        self.assertEqual(board.links[0]["status"], "approved")
        self.assertEqual(clickable(board), [b"https://example.com/good"])
        self.assertIn(b'rel="noopener noreferrer nofollow ugc"', board.render())

    def test_rejected_and_failed_pages_never_link_and_explain_the_decision(self):
        board, clock = demo_board()
        board.submit("https://example.com/bad", "Look", "rejected")
        board.submit("https://example.com/broken", "Look", "error")
        clock.now = 5
        board.refresh()
        broken, bad = board.links
        self.assertEqual((bad["status"], broken["status"]), ("rejected", "error"))
        self.assertEqual(clickable(board), [])
        self.assertEqual(bad["explanation"], {"found": [("criminal-activity", 0.92)], "unknown": ["sexual"]})
        self.assertEqual([(child["type"], child["status"], [c for c, _ in child["found"]]) for child in bad["children"]],
                         [("plaintext-document", "rejected", ["criminal-activity"]), ("image", "approved", [])])
        self.assertIsNone(broken["explanation"])

    def test_flagged_page_links_and_lists_its_findings(self):
        board, clock = demo_board()
        board.submit("https://example.com/edgy", "Look", "flagged")
        clock.now = 5
        board.refresh()
        link = board.links[0]
        self.assertEqual((link["status"], link["flagged"]), ("approved", True))
        self.assertEqual(link["explanation"]["found"], [("criminal-activity", 0.64)])
        self.assertEqual(clickable(board), [b"https://example.com/edgy"])

    def test_rejected_note_stops_before_the_page_is_submitted(self):
        board, _ = demo_board()
        self.assertEqual(board.submit("https://example.com/", "Hello", "note-rejected"), "note-rejected")
        self.assertEqual([request.path for request in board.moderator.client.requests], ["/projects/mock-project/assets"])
        link = board.links[0]
        self.assertEqual((link["status"], link["asset_id"]), ("note-rejected", None))
        self.assertEqual(clickable(board), [])

    def test_page_is_submitted_as_a_queued_url_without_retention(self):
        board, _ = demo_board()
        board.submit("https://example.com/page", "Hello")
        request = board.moderator.client.requests[-1]
        self.assertEqual((request.method, request.path, request.query["queue"]), ("POST", "/projects/mock-project/assets", True))
        self.assertEqual(request.body["url"], "https://example.com/page")
        self.assertEqual(request.body["processingOptions"], {"keepContentAfterProcessing": False})
        self.assertEqual(board.moderator.client.database_storage.assets[board.links[0]["asset_id"]]["type"], "website")

    def test_external_ids_map_back_to_the_link(self):
        board, _ = demo_board()
        board.submit("https://example.com/page", "Hello")
        link = board.links[0]
        stored = board.moderator.client.database_storage.assets
        note, page = stored[link["note_asset_id"]], stored[link["asset_id"]]
        self.assertEqual(board.link_for_external_id(note["externalId"])["id"], link["id"])
        self.assertEqual(board.link_for_external_id(page["externalId"])["asset_id"], page["id"])
        self.assertIsNone(board.link_for_external_id("unknown:page"))

    def test_remove_deletes_the_page_and_note_assets(self):
        board, _ = demo_board()
        board.submit("https://example.com/page", "Hello")
        link = board.links[0]
        self.assertEqual(board.remove(link["id"]), "removed")
        self.assertEqual(board.links, [])
        self.assertEqual(board.moderator.client.database_storage.assets, {})
        self.assertEqual([r.method for r in board.moderator.client.requests[-2:]], ["DELETE", "DELETE"])
        with self.assertRaises(InvalidInput):
            board.remove(link["id"])


class LiveTests(unittest.TestCase):
    def test_unknown_statuses_and_refresh_failures_stay_closed(self):
        for processing, moderation in (("processing", "pending"), ("uploading", "pending"), ("done", "unknown"),
                                       ("done", None)):
            client = MockCalmLensServerClient()
            board = live_board(client)
            board.submit("https://example.com/", "Hello")
            stored = client.database_storage.assets[board.links[0]["asset_id"]]
            stored["processing"]["status"], stored["moderation"]["status"] = processing, moderation
            board.refresh()
            self.assertEqual(board.links[0]["status"], "pending")
            self.assertEqual(clickable(board), [])
        client = MockCalmLensServerClient()
        board = live_board(client)
        board.submit("https://example.com/", "Hello")
        stored = client.database_storage.assets[board.links[0]["asset_id"]]
        stored["processing"]["status"], stored["moderation"]["status"] = "done", "approved"
        client.enqueue_error(ConnectionResetError("reset"))
        with self.assertLogs(level="WARNING"):
            board.refresh()
        self.assertEqual(clickable(board), [])

    def test_transport_failure_while_sharing_never_links(self):
        board = live_board(MockCalmLensServerClient().enqueue_error(TimeoutError()))
        with self.assertRaises(CalmLensError) as raised:
            board.submit("https://example.com/", "Hello")
        self.assertEqual(raised.exception.code, "sdk/timeout")
        self.assertEqual([link["status"] for link in board.links], ["error"])
        self.assertEqual(clickable(board), [])


class StartupTests(unittest.TestCase):
    def test_missing_credentials_fail_closed_unless_demo_is_requested(self):
        with self.assertRaises(ConfigurationError):
            create_moderator({})
        with self.assertRaises(ConfigurationError):
            create_moderator({"CALMLENS_API_KEY": "only-a-key"}, demo=True)
        self.assertTrue(create_moderator({}, demo=True).demo)
        self.assertTrue(create_moderator({"CALMLENS_DEMO": "1"}).demo)
        live = create_moderator({"CALMLENS_API_KEY": "key", "CALMLENS_PROJECT_ID": "project"}, demo=True)
        self.assertFalse(live.demo)
        self.assertEqual(live.client.project_id, "project")

    def test_live_mode_does_not_load_the_sdk_test_client(self):
        code = ("import sys, app; app.create_moderator({'CALMLENS_API_KEY': 'k', 'CALMLENS_PROJECT_ID': 'p'}); "
                "print('calmlens.testing' in sys.modules)")
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), "False")


class UnitTests(unittest.TestCase):
    def test_not_evaluated_is_unknown_not_zero(self):
        result = explain({"categories": {"hate": {"status": "not-evaluated", "reason": "unavailable"},
                                         "violence": {"status": "partial", "score": 0.5},
                                         "sexual": {"status": "evaluated", "score": 0}}})
        self.assertEqual(result, {"found": [("violence", 0.5)], "unknown": ["hate"]})
        self.assertEqual(explain(None), {"found": [], "unknown": []})

    def test_url_validation(self):
        self.assertEqual(validate_url(" https://example.com/a?b=1 "), "https://example.com/a?b=1")
        for value in ("", "ftp://example.com", "javascript:alert(1)", "https://user:pw@example.com",
                      "http://localhost:8080", "http://127.0.0.1/", "http://10.0.0.2/", "https://" + "a" * 2050):
            with self.assertRaises(InvalidInput, msg=value):
                validate_url(value)


class RequestSocket:
    def __init__(self, request):
        self.request = request
        self.response = bytearray()

    def makefile(self, *args):
        return io.BytesIO(self.request)

    def sendall(self, data):
        self.response.extend(data)


class HandlerTests(unittest.TestCase):
    def request(self, board, method, path, fields=None, length=True):
        body = urlencode(fields or {}).encode()
        head = f"{method} {path} HTTP/1.0\r\nContent-Type: application/x-www-form-urlencoded\r\n"
        if length:
            head += f"Content-Length: {len(body)}\r\n"
        sock = RequestSocket((head + "\r\n").encode() + body)
        make_handler(board)(sock, ("127.0.0.1", 1234), SimpleNamespace())
        return bytes(sock.response)

    def status(self, response):
        return int(response.split(b"\r\n")[0].split(b" ")[1])

    def test_form_token_redirect_and_escaping(self):
        board, _ = demo_board()
        rejected = self.request(board, "POST", "/links", {"url": "https://example.com/", "note": "Hi", "csrf": "wrong"})
        self.assertEqual(self.status(rejected), 403)
        self.assertEqual(board.links, [])
        accepted = self.request(board, "POST", "/links", {"url": "https://example.com/", "note": "<script>x</script>", "csrf": board.csrf_token})
        self.assertEqual(self.status(accepted), 303)
        self.assertIn(b"Location: /?notice=shared", accepted)
        page = self.request(board, "GET", "/")
        self.assertNotIn(b"<script>x", page)
        self.assertIn(b"&lt;script&gt;", page)
        removed = self.request(board, "POST", f"/links/{board.links[0]['id']}/delete", {"csrf": board.csrf_token})
        self.assertEqual(self.status(removed), 303)
        self.assertEqual(board.links, [])

    def test_notices_are_keys_not_text(self):
        board, _ = demo_board()
        page = self.request(board, "GET", "/?" + urlencode({"notice": "Your account is suspended, call 555"}))
        self.assertNotIn(b"call 555", page)
        self.assertNotIn(b'role="status"', page)
        page = self.request(board, "GET", "/?notice=removed")
        self.assertIn(b'role="status"', page)

    def test_form_size_and_length_checks(self):
        board, _ = demo_board()
        self.assertEqual(self.status(self.request(board, "POST", "/links", {"csrf": board.csrf_token}, length=False)), 411)
        large = {"csrf": board.csrf_token, "note": "x" * 20_000}
        self.assertEqual(self.status(self.request(board, "POST", "/links", large)), 413)

    def test_live_handler_ignores_demo_outcomes(self):
        choices = []
        moderator = SimpleNamespace(demo=False, check_note=lambda link_id, note, choice: choices.append(choice) or {"id": "n", "moderation": {"status": "rejected"}})
        board = Board(moderator)
        self.request(board, "POST", "/links", {"url": "https://example.com/", "note": "Hi", "csrf": board.csrf_token, "demo_result": "rejected"})
        self.assertEqual(choices, ["approved"])

    def test_unreachable_api_returns_502(self):
        board = live_board(MockCalmLensServerClient().enqueue_error(TimeoutError()))
        with self.assertLogs(level="WARNING"):
            response = self.request(board, "POST", "/links", {"url": "https://example.com/", "note": "Hi", "csrf": board.csrf_token})
        self.assertEqual(self.status(response), 502)

    def test_sdk_error_text_is_not_shown(self):
        client = MockCalmLensServerClient().enqueue_error(CalmLensError("upload/limit-exceeded", "Secret internal detail", status=403))
        board = live_board(client)
        with self.assertLogs(level="WARNING"):
            response = self.request(board, "POST", "/links", {"url": "https://example.com/", "note": "Hi", "csrf": board.csrf_token})
        self.assertEqual(self.status(response), 502)
        self.assertNotIn(b"Secret internal detail", response)
        self.assertNotIn(b"upload/limit-exceeded", response)


if __name__ == "__main__":
    unittest.main()
