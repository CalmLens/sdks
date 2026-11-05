import hashlib
import hmac
import http.client
import json
import unittest
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request

from calmlens import CalmLensAPIError, CalmLensError, CalmLensTimeoutError, CalmLensTransportError, error_codes
from calmlens.testing import MockCalmLensServerClient, create_mock_api_key, default_moderate

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
        c.database_storage.assets[hashed["id"]]["content"].update(perceptualHash="ab" * 32,
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

    def test_previews_get_their_thumbhash_at_decision_and_media_renders_as_processing_makes_it(self):
        c = MockCalmLensServerClient()
        keep = {"keepContentAfterProcessing": True}
        image = c.assets.create(name="a.png", content={"data": b"png", "type": "image/png"}, processing_options=keep)
        self.assertEqual((image["content"]["rendered"], image["content"]["preview"]),
                         ({"kind": "image", "format": "image/png", "width": None, "height": None},
                          {"width": None, "height": None, "thumbhash": None, "averageColor": None}))
        decided = c.complete_processing(image["id"])
        self.assertEqual((decided["content"]["preview"]["thumbhash"] is not None,
                          decided["content"]["preview"]["averageColor"]), (True, "#7f7f7f"))
        audio = c.assets.create(name="a.wav", content={"data": b"wav", "type": "audio/wav"}, processing_options=keep,
                                visibility="public")
        self.assertEqual((audio["content"]["rendered"], audio["content"]["preview"]), (None, None))
        audio = c.complete_processing(audio["id"])
        self.assertEqual((audio["content"]["rendered"]["format"], audio["content"]["rendered"]["peaks"],
                          audio["content"]["preview"]["width"], audio["content"]["preview"]["height"]),
                         ("audio/mp4", [], 1200, 300))
        with c.cdn.serve(asset_identifier=audio["id"], resource="rendered") as rendered:
            self.assertEqual((rendered.status, rendered.content_type, rendered.read()), (200, "audio/mp4", b"wav"))
        with c.cdn.serve(asset_identifier=audio["id"], resource="preview", transform={"width": 10}) as preview:
            self.assertEqual((preview.status, preview.content_type), (200, "image/png"))
        removed = c.assets.delete_content(asset_id=image["id"])
        self.assertEqual((removed["content"]["rendered"], removed["content"]["preview"], removed["content"]["metadata"]),
                         (None, None, None))

    def test_a_safety_hold_withholds_every_resource_and_the_timeline(self):
        c = MockCalmLensServerClient()
        asset = c.assets.classify(name="a.png", content={"data": b"png", "type": "image/png"},
                                  processing_options={"keepContentAfterProcessing": True}, visibility="public")
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.list_timeline(asset_id=asset["id"], cursor="anything")
        self.assertEqual(raised.exception.code, error_codes.INVALID_CURSOR)
        c.database_storage.assets[asset["id"]]["content"]["safetyHold"] = {"placedAt": 1, "reason": "suspected-illegal-content"}
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.list_timeline(asset_id=asset["id"])
        self.assertEqual(raised.exception.code, error_codes.ASSET_SAFETY_HELD)
        for resource in ("original", "rendered", "preview", "placeholder"):
            with c.cdn.serve(asset_identifier=asset["id"], resource=resource) as response:
                self.assertEqual((resource, response.status, json.loads(response.read())["code"]),
                                 (resource, 403, "asset/not-available"))

    def test_unknown_mock_options_and_a_moderate_that_is_not_a_function_are_configuration_errors(self):
        for options in ({"moderate": "blocked"}, {"queued_outcome": "pending"}):
            with self.assertRaises(CalmLensError) as raised:
                MockCalmLensServerClient(mock_options=options)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_CONFIG)

    def test_a_moderate_answer_that_is_not_a_decision_fails_the_upload_and_stores_nothing(self):
        c = MockCalmLensServerClient(mock_options={"moderate": lambda moderation: "maybe"})
        with self.assertRaises(CalmLensError) as raised:
            c.assets.classify(name="a.txt", content={"plainText": "x", "type": "text/plain"})
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual((c.database_storage.assets, c.database_storage.events), ({}, []))

    def test_fail_next_request_refuses_fractional_retry_after_and_details_for_an_exception(self):
        for failure, options in (("asset/not-found", {"retry_after": 1.5}),
                                 (ConnectionResetError(), {"details": {"reason": "reset"}}),
                                 (ConnectionResetError(), {"retry_after": 1})):
            with self.assertRaises(CalmLensError) as raised:
                self.client.fail_next_request(failure, **options)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        # Nothing was queued, so the next request reaches the API.
        self.assertEqual(self.client.events.list()["items"], [])

    def test_explaining_completes_evidence_and_rerun_moderates_again(self):
        c = MockCalmLensServerClient(mock_options={"now": lambda: 7, "moderate": lambda moderation: (
            "blocked" if moderation.trigger == "upload" else default_moderate(moderation))})
        asset = c.assets.classify(name="a.txt", content={"plainText": "no", "type": "text/plain"},
                                  processing_options={"keepContentAfterProcessing": True})
        moderation = c.database_storage.assets[asset["id"]]["classification"]["moderation"]
        moderation["explanationComplete"] = False
        explained = c.assets.explain(asset_id=asset["id"])
        self.assertEqual((explained["classification"]["moderation"]["explanationComplete"],
                          explained["classification"]["moderation"]["status"]), (True, "blocked"))
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

    def test_refuses_raw_uploads_of_types_the_api_refuses_and_stores_nothing(self):
        # The client refuses these before sending, so the request goes straight to the mock's transport.
        fixture = Path(__file__).resolve().parents[2] / "go" / "testdata" / "upload-mime-types.json"
        for mime_type in json.loads(fixture.read_text())["refused"]:
            with self.subTest(mime_type):
                query = urlencode({"name": "x", "queue": "true", "contentType": mime_type, "sizeInBytes": 5})
                request = Request(f"{self.client.base_url}/projects/{self.client.project_id}/assets?{query}",
                                  data=b"hello", method="POST",
                                  headers={"Content-Type": mime_type, "X-CalmLens-Upload": "content"})
                with self.client.transport(request, 1) as response:
                    self.assertEqual(response.status, 400)
                    body = json.loads(response.read())
                self.assertEqual(body["code"], error_codes.INVALID_UPLOAD_MIME_TYPE)
                self.assertEqual(body["details"], {"mimeType": mime_type})
                self.assertEqual(self.client.database_storage.assets, {})

    def test_refuses_null_and_unsigned_resources_where_the_api_does_before_the_asset_lookup(self):
        # The client leaves these out, so the requests go straight to the mock's transport.
        cases = [("POST", "signed-url", {"viewerClaims": None}, "validation/invalid-type", "viewerClaims"),
                 ("POST", "signed-url", {"resource": None}, "validation/invalid-value", "resource"),
                 ("POST", "signed-url", {"resource": "placeholder"}, "validation/invalid-value", "resource"),
                 ("POST", "signed-url", {"expiresInSeconds": None}, "validation/invalid-type", "expiresInSeconds"),
                 ("PATCH", "", {"name": None}, "validation/invalid-type", "name")]
        for method, suffix, body, code, path in cases:
            with self.subTest(method=method, body=body):
                request = Request(f"{self.client.base_url}/assets/missing{'/' + suffix if suffix else ''}",
                                  data=json.dumps(body).encode(), method=method,
                                  headers={"Content-Type": "application/json"})
                with self.client.transport(request, 1) as response:
                    self.assertEqual(response.status, 400)
                    answer = json.loads(response.read())
                self.assertEqual((answer["code"], answer["details"]), (code, {"path": path}))

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

class MockConfigurationAndCaptureTests(unittest.TestCase):
    def test_accepts_real_client_configuration(self):
        c = MockCalmLensServerClient(project_id="p1", base_url="https://api.example.test/v2/", cdn_base_url="https://cdn.example.test/v2",
                               timeout=5, mock_options={"create_id": lambda prefix: "a1"})
        self.assertEqual((c.project_id, c.base_url, c.cdn_base_url, c.timeout), ("p1", "https://api.example.test/v2", "https://cdn.example.test/v2", 5))
        self.assertEqual(c.cdn.get_asset_url({"assetIdentifier": "a1"}), "https://cdn.example.test/v2/assets/p1/a1/rendered")
        with self.assertRaises(CalmLensError):
            MockCalmLensServerClient(timeout=0)
        with self.assertRaises(CalmLensError):
            MockCalmLensServerClient(mock_options={"cdn_base_url": "https://x.test"})

    def test_accepts_upload_timeout_and_response_size_limit(self):
        c = MockCalmLensServerClient(upload_timeout=90, max_response_bytes=64,
                                     mock_options={"create_id": lambda prefix: "a1"})
        self.assertEqual(c.upload_timeout, 90)
        # The limit applies to the mock's answers as to the API's.
        with self.assertRaises(CalmLensError) as raised:
            c.assets.create(name="a", content={"plainText": "a", "type": "text/plain"})
        self.assertEqual(raised.exception.code, "sdk/response-too-large")
        with self.assertRaises(CalmLensError) as invalid:
            MockCalmLensServerClient(upload_timeout=0)
        self.assertEqual(invalid.exception.code, "sdk/invalid-config")

    def test_captures_requests(self):
        c = MockCalmLensServerClient(project_id="p1", mock_options={"create_id": lambda prefix: "a1"})
        c.assets.classify(name="note", external_id="e1", content={"plain_text": "hi", "type": "text/plain"})
        c.assets.update({"assetId": "a1", "tags": ["x"]})
        c.events.list(cursor="mock_0", page_size=5)
        c.cdn.serve({"assetIdentifier": "a1", "lens": "thumb"}).close()
        upload, update, events, serve = c.requests
        self.assertEqual((upload.method, upload.path, upload.status), ("POST", "/projects/p1/assets", 200))
        self.assertEqual(upload.headers["X-calmlens-upload"], "content")
        self.assertEqual(upload.query["externalId"], "e1")
        self.assertIs(upload.query["queue"], False)
        self.assertEqual(upload.body, b"hi")
        self.assertEqual(upload.headers["Content-type"], "text/plain")
        self.assertIn("Idempotency-key", upload.headers)
        self.assertNotIn(c.api_key, repr(upload))
        self.assertTrue(upload.url.startswith(c.base_url + "/projects/p1/assets?"))
        self.assertEqual((update.method, update.path, update.body), ("PATCH", "/assets/a1", {"tags": ["x"]}))
        self.assertEqual(events.query, {"cursor": "mock_0", "pageSize": 5})
        self.assertEqual((serve.method, serve.path), ("GET", "/assets/p1/a1/rendered/@thumb"))
        c.requests[0].query["externalId"] = "changed"
        self.assertEqual(c.requests[0].query["externalId"], "e1")

    def test_enqueued_errors_match_real_failures(self):
        c = MockCalmLensServerClient(mock_options={"create_id": lambda prefix: "a1"})
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
        c = MockCalmLensServerClient(max_retries=1, mock_options={"create_id": lambda prefix: "a1"})
        c.enqueue_error(CalmLensError("server/unavailable", status=503))
        c.assets.create(name="x", content={"plainText": "hi", "type": "text/plain"}, idempotency_key="key-1")
        self.assertEqual([r.headers["Idempotency-key"] for r in c.requests], ["key-1", "key-1"])
        self.assertEqual(len(c.database_storage.assets), 1)

    def test_small_images_complete_as_one_final_part(self):
        c = MockCalmLensServerClient()
        asset = c.assets.classify(name="a.png", part={"data": b"png", "isFinal": True, "type": "image/png"})
        self.assertEqual((asset["type"], asset["upload"]["status"], asset["content"]["sizeInBytes"]),
                         ("image", "completed", 3))

    def test_large_content_is_uploaded_in_parts_and_resumes_with_the_same_key(self):
        mib = 1024 * 1024
        moderated = []

        def moderate(moderation):
            moderated.append(moderation.content.bytes)
            return default_moderate(moderation)
        c = MockCalmLensServerClient(part_size_bytes=5 * mib, mock_options={"moderate": moderate})
        data = b"a" * (5 * mib) + b"b" * (5 * mib) + b"c" * 7
        serve, answered = c.transport, []

        def losing_the_second_part(request, timeout):
            response = serve(request, timeout)
            answered.append(response.status)
            if len(answered) == 2:
                raise ConnectionResetError("the response was lost")
            return response
        c.transport = losing_the_second_part
        with self.assertRaises(CalmLensTransportError):
            c.assets.classify(name="a.png", content={"data": data, "type": "image/png"}, idempotency_key="K")
        c.transport = serve
        asset = c.assets.classify(name="a.png", content={"data": data, "type": "image/png"}, idempotency_key="K")
        self.assertEqual((asset["type"], asset["upload"]["status"], asset["content"]["sizeInBytes"]),
                         ("image", "completed", len(data)))
        self.assertEqual(len(c.database_storage.assets), 1)
        self.assertEqual(moderated, [data])
        resumed = c.requests[2:]
        self.assertEqual([(r.query.get("partNumber"), r.headers["Idempotency-key"], r.status) for r in resumed],
                         [(1, "K", 200), (2, "K:part-2", 200), (3, "K:part-3", 200)])
        self.assertEqual(c.assets.retrieve(asset_id=asset["id"]), asset)

if __name__ == "__main__":
    unittest.main()
