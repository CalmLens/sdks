import io
import re
import subprocess
import sys
import unittest
from types import SimpleNamespace
from urllib.parse import urlencode

from calmlens import CalmLensError
from calmlens.testing import MockCalmLensServerClient

from app import (RECHECK_SECONDS, Board, ConfigurationError, InvalidInput, Moderator, create_moderator, explain,
                 make_handler, validate_url)
from demo import DemoModerator, seed


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def demo_board():
    clock = Clock()
    return Board(DemoModerator(clock=clock), clock=clock), clock


def live_board(client=None):
    return Board(Moderator(client or MockCalmLensServerClient()))


def clickable(board):
    return re.findall(rb'<a href="([^"]+)" rel="noopener noreferrer nofollow ugc">', board.render())


class DemoFlowTests(unittest.TestCase):
    def test_link_is_clickable_only_after_the_page_is_allowed(self):
        board, clock = demo_board()
        board.submit("https://example.com/good", "Worth a read", "allowed")
        board.refresh()
        self.assertEqual(board.links[0]["status"], "pending")
        self.assertEqual(clickable(board), [])
        clock.now = 5
        board.refresh()
        self.assertEqual(board.links[0]["status"], "allowed")
        self.assertEqual(clickable(board), [b"https://example.com/good"])
        self.assertIsNone(board.links[0]["reason"])

    def test_blocked_purged_and_failed_pages_never_link_and_name_the_part_that_decided(self):
        board, clock = demo_board()
        board.submit("https://example.com/bad", "Look", "blocked")
        board.submit("https://example.com/worse", "Look", "purged")
        board.submit("https://example.com/broken", "Look", "error")
        board.submit("https://example.com/pictures", "Look", "image-blocked")
        clock.now = 5
        board.refresh()
        pictures, broken, worse, bad = board.links
        self.assertEqual((bad["status"], worse["status"], broken["status"], pictures["status"]),
                         ("blocked", "purged", "error", "blocked"))
        self.assertEqual(clickable(board), [])
        # The page's own categories are not evaluated when its parts decided it, so none are reported.
        self.assertEqual(bad["reason"], {"source": "children", "found": [], "unknown": []})
        self.assertEqual([(part["type"], part["status"], [c for c, _ in part["found"]]) for part in bad["parts"]],
                         [("plaintext-document", "blocked", ["violence"]), ("image", "allowed", [])])
        self.assertEqual([(part["type"], part["status"], [c for c, _ in part["found"]]) for part in pictures["parts"]],
                         [("image", "blocked", ["violence"]), ("plaintext-document", "allowed", [])])
        self.assertEqual(worse["parts"][0]["found"], [("criminal-activity", 0.97)])
        self.assertIsNone(broken["reason"])

    def test_limited_page_is_linked_like_an_allowed_one_and_explains_the_decision(self):
        board, clock = demo_board()
        board.submit("https://example.com/borderline", "Look", "limited")
        clock.now = 5
        board.refresh()
        link = board.links[0]
        self.assertEqual(link["status"], "limited")
        self.assertEqual(link["parts"][0]["found"], [("profanity", 0.62)])
        self.assertEqual(clickable(board), [b"https://example.com/borderline"])

    def test_age_restricted_page_is_not_linked_and_lists_its_findings(self):
        board, clock = demo_board()
        board.submit("https://example.com/edgy", "Look", "age-restricted")
        clock.now = 5
        board.refresh()
        link = board.links[0]
        self.assertEqual(link["status"], "age-restricted")
        self.assertEqual(link["parts"][0]["found"], [("sexual", 0.88)])
        self.assertEqual(clickable(board), [])

    def test_page_title_and_description_come_from_the_text_part_and_stay_hidden_when_blocked(self):
        board, clock = demo_board()
        board.submit("https://recipes.example.net/one-pan-lentil-dal", "Tasty", "allowed")
        board.submit("https://news.example.org/2026/street-trees-cool-cities", "Look", "blocked")
        clock.now = 5
        board.refresh()
        blocked, allowed = board.links
        self.assertEqual(allowed["preview"], {"title": "One-pan lentil dal in 25 minutes",
                                              "description": "A weeknight dal with pantry spices and no special kit."})
        self.assertEqual(blocked["preview"]["title"], "Street trees cool city blocks by up to 4°C")
        page = board.render().decode()
        self.assertIn("One-pan lentil dal in 25 minutes", page)
        self.assertNotIn("Street trees cool city blocks", page)
        self.assertNotIn("/2026/street-trees-cool-cities", page)

    def test_failed_page_can_be_tried_again_as_a_new_asset(self):
        board, clock = demo_board()
        board.submit("https://example.com/broken", "Look", "error")
        clock.now = 5
        board.refresh()
        link = board.links[0]
        failed_id, note_id = link["asset_id"], link["note_asset_id"]
        self.assertEqual(board.retry(link["id"]), "retried")
        stored = board.moderator.client.database_storage.assets
        self.assertNotIn(failed_id, stored)
        self.assertEqual(link["note_asset_id"], note_id)
        self.assertEqual(stored[link["asset_id"]]["externalId"], f"{link['id']}:page")
        self.assertEqual(link["status"], "pending")
        clock.now = 10
        board.refresh()
        self.assertEqual(clickable(board), [b"https://example.com/broken"])
        with self.assertRaises(InvalidInput):
            board.retry(link["id"])

    def test_a_moderators_later_decision_is_read_after_the_recheck_interval(self):
        board, clock = demo_board()
        board.submit("https://example.com/held", "Look", "blocked")
        clock.now = 5
        board.refresh()
        link = board.links[0]
        stored = board.moderator.client.database_storage.assets[link["asset_id"]]
        stored["classification"]["moderation"].update(status="allowed", manualReviews=[
            {"id": "r1", "decision": "allowed", "note": None, "reviewerUserId": "u1", "reviewedAt": 1, "appliedToAsset": True}])
        clock.now = 5 + RECHECK_SECONDS - 1
        board.refresh()
        self.assertEqual(link["status"], "blocked")
        clock.now = 5 + RECHECK_SECONDS
        board.refresh()
        self.assertEqual((link["status"], link["review"], link["reason"]), ("allowed", "allowed", None))
        self.assertEqual(clickable(board), [b"https://example.com/held"])

    def test_demo_seed_fills_the_board_with_every_state(self):
        board, clock = demo_board()
        seed(board)
        self.assertEqual([link["status"] for link in board.links],
                         ["pending", "allowed", "blocked", "limited", "error", "blocked", "note-not-allowed", "age-restricted", "allowed"])
        self.assertEqual(len(clickable(board)), 3)
        clock.now = 20
        board.refresh()
        self.assertEqual(board.links[0]["status"], "allowed")

    def test_blocked_note_stops_before_the_page_is_submitted(self):
        board, _ = demo_board()
        self.assertEqual(board.submit("https://example.com/", "Hello there, unique note", "note-blocked"), "note-not-allowed")
        self.assertEqual(board.links[0]["note_found"], [("harassment", 0.91)])
        self.assertNotIn(b"Hello there, unique note", board.render())
        self.assertEqual([request.path for request in board.moderator.client.requests], ["/projects/mock-project/assets"])
        link = board.links[0]
        self.assertEqual((link["status"], link["asset_id"]), ("note-not-allowed", None))
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
        for processing, moderation in (("processing", "pending"), ("pending", "pending"), ("completed", "unknown"),
                                       ("completed", None)):
            client = MockCalmLensServerClient()
            board = live_board(client)
            board.submit("https://example.com/", "Hello")
            stored = client.database_storage.assets[board.links[0]["asset_id"]]
            stored["classification"]["status"], stored["classification"]["moderation"]["status"] = processing, moderation
            board.refresh()
            self.assertEqual(board.links[0]["status"], "pending")
            self.assertEqual(clickable(board), [])
        client = MockCalmLensServerClient()
        board = live_board(client)
        board.submit("https://example.com/", "Hello")
        stored = client.database_storage.assets[board.links[0]["asset_id"]]
        stored["classification"]["status"], stored["classification"]["moderation"]["status"] = "completed", "allowed"
        client.enqueue_error(ConnectionResetError("reset"))
        with self.assertLogs(level="WARNING"):
            board.refresh()
        self.assertEqual(clickable(board), [])

    def test_a_decision_from_the_pages_own_scores_reports_them_and_unevaluated_categories(self):
        client = MockCalmLensServerClient()
        board = live_board(client)
        board.submit("https://example.com/", "Hello")
        stored = client.database_storage.assets[board.links[0]["asset_id"]]
        stored["classification"]["status"] = "completed"
        stored["classification"]["moderation"].update(status="blocked", categories={
            "hate": {"status": "evaluated", "score": 0.81}, "sexual": {"status": "not-evaluated", "reason": "unavailable"}},
            policy={"score": 0.81, "categories": {}, "decision": {"source": "policy", "action": "block", "flaggedCategories": ["hate"]}})
        board.refresh()
        self.assertEqual(board.links[0]["reason"], {"source": "policy", "found": [("hate", 0.81)], "unknown": ["sexual"]})

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
        moderator = SimpleNamespace(demo=False, check_note=lambda link_id, note, choice: choices.append(choice) or {"id": "n", "classification": {"moderation": {"status": "blocked"}}})
        board = Board(moderator)
        self.request(board, "POST", "/links", {"url": "https://example.com/", "note": "Hi", "csrf": board.csrf_token, "demo_result": "blocked"})
        self.assertEqual(choices, ["allowed"])

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
