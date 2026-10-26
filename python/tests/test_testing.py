import hashlib
import hmac
import http.client
import unittest

from calmlens import CalmLensAPIError, CalmLensError, CalmLensTimeoutError, CalmLensTransportError, error_codes
from calmlens.testing import MockCalmLensServerClient, create_mock_api_key

DOWNLOAD = create_mock_api_key([{"actions": ["assets:download"], "folderId": None, "includeSubfolders": True}])


class MockTests(unittest.TestCase):
    def setUp(self):
        self.client = MockCalmLensServerClient(mock_options={"now": lambda: 123})

    def test_signs_upload_tokens_with_the_mock_key_without_a_request(self):
        signed = self.client.upload_tokens.sign(upload_preset_id="preset-1")
        body, signature = signed["token"][len("clut_"):].split(".")
        secret = hashlib.sha256(self.client.api_key.encode()).hexdigest().encode()
        expected = hmac.new(secret, f"calmlens-upload-token:v1:{body}".encode(), hashlib.sha256).hexdigest()
        self.assertEqual(signature, expected)

    def test_results_are_copies_of_the_stored_records(self):
        c = self.client
        a = c.assets.classify({'name': 'text', 'content': {'plainText': 'hello', 'type': 'text/plain'}})
        a["classification"]["moderation"]["status"] = "blocked"
        self.assertEqual(c.assets.retrieve({"assetId": a["id"]})["classification"]["moderation"]["status"], "allowed")
        c.assets.list()["items"][0]["name"] = "changed"
        self.assertEqual(c.database_storage.assets[a["id"]]["name"], "text")

    def test_hash_list_entries_come_from_assets_once_and_go_with_their_list(self):
        c = MockCalmLensServerClient()
        statuses = []
        serve = c.transport

        def recording(request, timeout):
            response = serve(request, timeout)
            statuses.append(response.status)
            return response
        c.transport = recording
        hashed = c.assets.classify(name="a.png", content={"data": b"png", "type": "image/png"})
        unhashed = c.assets.classify(name="b.png", content={"data": b"png", "type": "image/png"})
        c.database_storage.assets[hashed["id"]]["content"]["image"].update(perceptualHash="ab" * 32,
                                                                            perceptualHashQuality=87)
        hash_list = c.hash_lists.create(name="Removed", action="block")
        added = c.hash_lists.add_entry(hash_list_id=hash_list["id"], asset_id=hashed["id"], label="Report 1")
        self.assertEqual((statuses[-1], added["hash"], added["quality"], added["sourceAssetId"], added["label"]),
                         (201, "ab" * 32, 87, hashed["id"], "Report 1"))
        again = c.hash_lists.add_entry(hash_list_id=hash_list["id"], hash="AB" * 32)
        self.assertEqual((statuses[-1], again["id"]), (200, added["id"]))
        with self.assertRaises(CalmLensAPIError) as raised:
            c.hash_lists.add_entry(hash_list_id=hash_list["id"], asset_id=unhashed["id"])
        self.assertEqual((raised.exception.code, raised.exception.status), (error_codes.HASH_LIST_ASSET_NOT_HASHED, 409))

        second = c.hash_lists.add_entry(hash_list_id=hash_list["id"], hash="cd" * 32)
        first_page = c.hash_lists.list_entries(hash_list_id=hash_list["id"], page_size=1)
        last_page = c.hash_lists.list_entries(hash_list_id=hash_list["id"], page_size=1,
                                              cursor=first_page["nextCursor"])
        self.assertEqual(([e["id"] for e in first_page["items"]], first_page["hasMore"],
                          [e["id"] for e in last_page["items"]], last_page["hasMore"]),
                         ([second["id"]], True, [added["id"]], False))

        other = c.hash_lists.create(name="Other", action="flag")
        kept = c.hash_lists.add_entry(hash_list_id=other["id"], hash="ef" * 32)
        c.hash_lists.delete(hash_list_id=hash_list["id"])
        self.assertEqual(list(c.database_storage.hash_list_entries), [kept["id"]])
        with self.assertRaises(CalmLensAPIError) as raised:
            c.hash_lists.remove_entry(entry_id=added["id"])
        self.assertEqual(raised.exception.code, error_codes.HASH_LIST_ENTRY_NOT_FOUND)

    def test_unknown_mock_options_and_outcomes_are_configuration_errors(self):
        for options in ({"queued_outcome": "error"}, {"queued_status": "pending"}):
            with self.assertRaises(CalmLensError) as raised:
                MockCalmLensServerClient(mock_options=options)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_CONFIG)

    def test_outcomes_can_be_chosen_per_upload(self):
        c = MockCalmLensServerClient(mock_options={
            "analyzed_outcome": lambda asset: "blocked" if asset["name"].startswith("bad") else "allowed"})
        statuses = [c.assets.classify(name=name, content={"plainText": "x", "type": "text/plain"})
                    ["classification"]["moderation"]["status"] for name in ("bad.txt", "good.txt")]
        self.assertEqual(statuses, ["blocked", "allowed"])

    def test_explaining_completes_evidence_and_rerun_moderates_again(self):
        c = MockCalmLensServerClient(mock_options={"now": lambda: 7, "analyzed_outcome": "blocked"})
        asset = c.assets.classify(name="a.txt", content={"plainText": "no", "type": "text/plain"},
                                  processing_options={"keepContentAfterProcessing": True})
        moderation = c.database_storage.assets[asset["id"]]["classification"]["moderation"]
        moderation["policy"] = {"score": 0.9, "categories": {}, "evidence": "decision"}
        explained = c.assets.explain(asset_id=asset["id"])
        self.assertEqual((explained["classification"]["moderation"]["policy"]["evidence"],
                          explained["classification"]["moderation"]["status"]), ("full", "blocked"))
        moderation["manualReviews"] = [{"decision": "blocked"}]
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.explain(asset_id=asset["id"], rerun=True)
        self.assertEqual(raised.exception.code, error_codes.ASSET_REVIEWED)
        moderation["manualReviews"] = []
        rerun = c.assets.explain({"assetId": asset["id"], "rerun": True})
        self.assertEqual((rerun["classification"]["status"], rerun["classification"]["moderation"]["status"]),
                         ("processing", "pending"))
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.explain(asset_id=asset["id"])
        self.assertEqual(raised.exception.code, error_codes.ASSET_NOT_DECIDED)

    def test_errors_have_the_real_status_and_request_id(self):
        with self.assertRaises(CalmLensAPIError) as raised:
            self.client.assets.retrieve(asset_id="missing")
        error = raised.exception
        self.assertEqual((error.code, error.status), (error_codes.ASSET_NOT_FOUND, 404))
        self.assertTrue(error.is_not_found)
        self.assertTrue(error.request_id.startswith("req_mock_"))
        self.assertEqual(error.headers["x-request-id"], error.request_id)
        with self.assertRaises(CalmLensAPIError) as raised:
            self.client.folders.retrieve(folder_id="missing")
        self.assertEqual((raised.exception.code, raised.exception.status), (error_codes.FOLDER_NOT_FOUND, 404))

class MockFilterTests(unittest.TestCase):
    def test_filters_the_mock_cannot_evaluate_raise_instead_of_matching_wrongly(self):
        c = MockCalmLensServerClient()
        c.assets.create(name="a", content={"plainText": "a", "type": "text/plain"})
        with self.assertRaises(NotImplementedError):
            c.assets.list(filter="name=like=a")


class MockConfigurationAndCaptureTests(unittest.TestCase):
    def test_accepts_real_client_configuration(self):
        c = MockCalmLensServerClient(project_id="p1", base_url="https://api.example.test/v2/", cdn_base_url="https://cdn.example.test/v2",
                               timeout=5, mock_options={"create_id": lambda: "a1"})
        self.assertEqual((c.project_id, c.base_url, c.cdn_base_url, c.timeout), ("p1", "https://api.example.test/v2", "https://cdn.example.test/v2", 5))
        self.assertEqual(c.cdn.get_asset_url({"assetIdentifier": "a1"}), "https://cdn.example.test/v2/assets/p1/a1/rendered")
        with self.assertRaises(CalmLensError):
            MockCalmLensServerClient(timeout=0)
        with self.assertRaises(CalmLensError):
            MockCalmLensServerClient(mock_options={"cdn_base_url": "https://x.test"})

    def test_captures_requests(self):
        c = MockCalmLensServerClient(project_id="p1", mock_options={"create_id": lambda: "a1"})
        c.assets.classify(name="note", external_id="e1", content={"plain_text": "hi", "type": "text/plain"})
        c.assets.update({"assetId": "a1", "tags": ["x"]})
        c.events.list(after="mock_0", limit=5)
        c.cdn.serve({"assetIdentifier": "a1", "lens": "thumb"}).close()
        upload, update, events, serve = c.requests
        self.assertEqual((upload.method, upload.path), ("POST", "/projects/p1/assets"))
        self.assertEqual(upload.headers["X-calmlens-upload"], "content")
        self.assertEqual(upload.query["externalId"], "e1")
        self.assertIs(upload.query["queue"], False)
        self.assertEqual(upload.body, b"hi")
        self.assertEqual(upload.headers["Content-type"], "text/plain")
        self.assertIn("Idempotency-key", upload.headers)
        self.assertNotIn(c.api_key, repr(upload))
        self.assertTrue(upload.url.startswith(c.base_url + "/projects/p1/assets?"))
        self.assertEqual((update.method, update.path, update.body), ("PATCH", "/assets/a1", {"tags": ["x"]}))
        self.assertEqual(events.query, {"after": "mock_0", "limit": 5})
        self.assertEqual((serve.method, serve.path), ("GET", "/assets/p1/a1/rendered/@thumb"))
        c.requests[0].query["externalId"] = "changed"
        self.assertEqual(c.requests[0].query["externalId"], "e1")

    def test_enqueued_errors_match_real_failures(self):
        c = MockCalmLensServerClient(mock_options={"create_id": lambda: "a1"})
        timeout, reset = TimeoutError("slow"), ConnectionResetError("reset")
        api = CalmLensError("rate-limit/exceeded", status=429, retry_after=3)
        c.enqueue_error(timeout).enqueue_error(reset).enqueue_error(api).enqueue_error(http.client.IncompleteRead(b""))
        for expected, cause in ((CalmLensTimeoutError, timeout), (CalmLensTransportError, reset)):
            with self.assertRaises(expected) as raised:
                c.text.classify(text="hello")
            self.assertIs(raised.exception.__cause__, cause)
        with self.assertRaises(CalmLensAPIError) as raised:
            c.events.list()
        error = raised.exception
        self.assertEqual((error.code, error.status, error.retry_after), ("rate-limit/exceeded", 429, 3.0))
        self.assertTrue(error.request_id)
        with self.assertRaises(CalmLensTransportError):
            c.cdn.serve({"assetIdentifier": "a1"})
        self.assertEqual(c.database_storage.assets, {})
        self.assertEqual(c.text.classify(text="hello")["classification"]["moderation"]["status"], "allowed")
        self.assertEqual(len(c.requests), 5)
        c.enqueue_error(CalmLensError(error_codes.ASSET_NOT_FOUND))
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.retrieve(asset_id="a1")
        self.assertEqual(raised.exception.status, 404)

    def test_retries_resend_the_idempotency_key(self):
        c = MockCalmLensServerClient(max_retries=1, mock_options={"create_id": lambda: "a1"})
        c.enqueue_error(CalmLensError("server/unavailable", status=503))
        c.assets.create(name="x", content={"plainText": "hi", "type": "text/plain"}, idempotency_key="key-1")
        self.assertEqual([r.headers["Idempotency-key"] for r in c.requests], ["key-1", "key-1"])
        self.assertEqual(len(c.database_storage.assets), 1)


if __name__ == "__main__":
    unittest.main()
