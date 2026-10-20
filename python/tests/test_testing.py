import hashlib
import hmac
import http.client
import unittest
from urllib.parse import parse_qs, urlsplit

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

    def test_asset_lifecycle_and_storage(self):
        c = self.client
        a = c.assets.moderate({'name': 'text', 'content': {'plainText': 'hello', 'type': 'text/plain'}})
        self.assertEqual((a["processing"]["status"], a["moderation"]["status"], a["moderation"]["decidedAt"]),
                         ("done", "approved", 123))
        self.assertEqual((a["content"]["format"], a["content"]["sizeInBytes"]), ("text/plain", 5))
        self.assertEqual(a["createdAt"], 123)
        self.assertEqual(c.assets.retrieve({"assetId": a["id"]}), a)
        self.assertEqual(len(c.assets.list()["items"]), 1)
        a["moderation"]["status"] = "rejected"
        self.assertEqual(c.assets.retrieve({"assetId": a["id"]})["moderation"]["status"], "approved")
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.retry({"assetId": a["id"]})
        self.assertEqual((raised.exception.code, raised.exception.status), (error_codes.ASSET_NOT_RETRYABLE, 409))
        # Processing finished, so the temporarily held content is gone and cannot be processed again.
        c.database_storage.assets[a["id"]]["processing"]["status"] = "failed"
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.retry({"assetId": a["id"]})
        self.assertEqual(raised.exception.code, error_codes.ASSET_CONTENT_UNAVAILABLE)
        signed = c.assets.create_signed_url({"assetId": a["id"], "expiresInSeconds": 1})
        self.assertEqual(signed["expiresAt"], 1123)
        signed = c.assets.create_signed_url(asset_id=a["id"], transform={"type": "imageTransform", "options": {"width": 64}})
        self.assertEqual(parse_qs(urlsplit(signed["url"]).query)["transform"], ["imageTransform[width=64]"])

    def test_content_kept_only_until_processing_finishes_is_removed(self):
        c = MockCalmLensServerClient(api_key=DOWNLOAD, mock_options={"now": lambda: 123})
        temporary = c.assets.moderate(name="a.txt", content={"plainText": "bye", "type": "text/plain"})
        self.assertEqual((temporary["content"]["status"], temporary["content"]["removalReason"],
                          temporary["content"]["updatedAt"]), ("removed", "retention", 123))
        self.assertNotIn(temporary["id"], c.image_storage.content)
        self.assertEqual(c.cdn.serve({"assetIdentifier": temporary["id"]}).status, 404)
        kept = c.assets.moderate(name="b.txt", content={"plainText": "keep", "type": "text/plain"},
                                 processing_options={"keepContentAfterProcessing": True})
        self.assertEqual((kept["content"]["status"], kept["content"]["removalReason"]), ("stored", None))
        self.assertEqual(c.cdn.serve({"assetIdentifier": kept["id"]}).read(), b"keep")
        queued = c.assets.create(name="c.txt", content={"plainText": "wait", "type": "text/plain"})
        self.assertEqual((queued["processing"]["status"], queued["content"]["status"]), ("processing", "temporary"))
        self.assertEqual(c.cdn.serve({"assetIdentifier": queued["id"]}).read(), b"wait")

    def test_configured_outcomes_and_retrying_a_failed_asset(self):
        c = MockCalmLensServerClient(mock_options={"now": lambda: 7, "queued_outcome": "failed",
                                                   "analyzed_outcome": "rejected"})
        rejected = c.assets.moderate(name="a.txt", content={"plainText": "no", "type": "text/plain"})
        self.assertEqual((rejected["processing"]["status"], rejected["moderation"]["status"],
                          rejected["moderation"]["decidedAt"]), ("done", "rejected", 7))
        failed = c.assets.create(name="b.txt", content={"plainText": "retry me", "type": "text/plain"})
        self.assertEqual((failed["processing"]["status"], failed["moderation"]["status"], failed["content"]["status"]),
                         ("failed", "pending", "temporary"))
        self.assertIn(failed["id"], c.image_storage.content)
        retried = c.assets.retry(asset_id=failed["id"])
        self.assertEqual((retried["processing"]["status"], retried["moderation"]["status"]), ("processing", "pending"))
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.retry(asset_id=failed["id"])
        self.assertEqual(raised.exception.code, error_codes.ASSET_NOT_RETRYABLE)
        for options in ({"queued_outcome": "error"}, {"queued_status": "pending"}):
            with self.assertRaises(CalmLensError) as raised:
                MockCalmLensServerClient(mock_options=options)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_CONFIG)

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

    def test_folder_integrity(self):
        c = self.client
        root = c.folders.create({"name": "Root"})
        child = c.folders.create({"name": "Child", "parentId": root["id"]})
        for call, code in ((lambda: c.folders.create({"name": "Root"}), error_codes.DUPLICATE_FOLDER_NAME),
                           (lambda: c.folders.move({"folderId": root["id"], "parentId": child["id"]}),
                            error_codes.FOLDER_PARENT_CYCLE),
                           (lambda: c.folders.delete({"folderId": root["id"]}), error_codes.FOLDER_NOT_EMPTY)):
            with self.assertRaises(CalmLensAPIError) as raised:
                call()
            self.assertEqual((raised.exception.code, raised.exception.status), (code, 409))
        c.folders.move({"folderId": child["id"], "parentId": None})
        c.folders.delete({"folderId": root["id"]})
        self.assertEqual(len(c.folders.list()), 1)
        a = c.assets.moderate({'name': 'text', 'content': {'plainText': 'hi', 'type': 'text/plain'}})
        self.assertEqual(c.assets.move({"assetId": a["id"], "folderId": child["id"]})["folderId"], child["id"])
        with self.assertRaises(CalmLensError):
            c.folders.delete({"folderId": child["id"]})

    def test_private_cdn_grants_and_response_headers(self):
        c = self.client
        a = c.assets.moderate({'name': 'text', 'content': {'plainText': 'hello', 'type': 'text/plain'},
                               'processingOptions': {'keepContentAfterProcessing': True}})
        with c.cdn.serve({"assetIdentifier": a["id"]}) as denied:
            self.assertEqual(denied.status, 403)
        c.api_key = DOWNLOAD
        with c.cdn.serve({"assetIdentifier": a["id"]}) as response:
            self.assertEqual((response.status, response.content_type), (200, "text/plain"))
            self.assertEqual(response.headers["content-length"], "5")
            self.assertTrue(response.request_id)
            self.assertEqual(response.read(), b"hello")
        with c.cdn.serve({"assetIdentifier": "missing"}) as missing:
            self.assertEqual((missing.status, missing.ok), (404, False))

    def test_delete_content_keeps_record_and_stops_cdn_bytes(self):
        c = MockCalmLensServerClient(api_key=DOWNLOAD, mock_options={"now": lambda: 456})
        a = c.assets.create({"name": "a.txt", "content": {"plainText": "keep me", "type": "text/plain"}})
        stored = c.database_storage.assets[a["id"]]
        stored["moderation"]["report"] = {"processedAt": 1, "categories": {}, "score": 0.0}
        stored["content"]["extractedText"] = {"type": "string", "content": "keep me"}
        self.assertEqual(c.cdn.serve({"assetIdentifier": a["id"]}).read(), b"keep me")
        removed = c.assets.delete_content(asset_id=a["id"])
        self.assertEqual((removed["id"], removed["content"]["status"], removed["content"]["removalReason"],
                          removed["content"]["updatedAt"], removed["content"]["extractedText"]),
                         (a["id"], "removed", "requested", 456, None))
        self.assertEqual(c.assets.retrieve({"assetId": a["id"]})["moderation"]["report"],
                         {"processedAt": 1, "categories": {}, "score": 0.0})
        self.assertNotIn(a["id"], c.image_storage.content)
        self.assertEqual(c.cdn.serve({"assetIdentifier": a["id"]}).status, 404)
        self.assertEqual((c.requests[-3].method, c.requests[-3].path), ("DELETE", f"/assets/{a['id']}/content"))

    def test_wait_for_decision_reads_storage_without_real_waiting(self):
        c = self.client
        pending = c.assets.create({"name": "a.txt", "content": {"plainText": "hi", "type": "text/plain"}})
        self.assertEqual(pending["moderation"]["status"], "pending")
        with self.assertRaises(CalmLensError) as raised:
            c.assets.wait_for_decision(asset_id=pending["id"])
        self.assertEqual((raised.exception.code, raised.exception.details),
                         (error_codes.SDK_TIMEOUT, {"assetId": pending["id"], "processingStatus": "processing",
                                                    "moderationStatus": "pending"}))
        self.assertGreater(len(c.requests), 2)
        self.assertEqual({(r.method, r.path) for r in c.requests[1:]}, {("GET", f"/assets/{pending['id']}")})
        c.database_storage.assets[pending["id"]]["moderation"]["status"] = "rejected"
        decided = c.assets.wait_for_decision({"assetId": pending["id"]})
        self.assertEqual((decided["id"], decided["moderation"]["status"]), (pending["id"], "rejected"))
        failed = c.assets.create({"name": "b.txt", "content": {"plainText": "hi", "type": "text/plain"}})
        c.database_storage.assets[failed["id"]]["processing"]["status"] = "failed"
        self.assertEqual(c.assets.wait_for_decision(asset_id=failed["id"])["processing"]["status"], "failed")
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.wait_for_decision(asset_id="missing")
        self.assertEqual(raised.exception.code, error_codes.ASSET_NOT_FOUND)

    def test_delete_removes_record_and_content(self):
        c = self.client
        a = c.assets.create({"name": "site", "url": "https://example.com/page"})
        other = c.assets.moderate({"name": "b", "content": {"plainText": "other", "type": "text/plain"},
                                   "processingOptions": {"keepContentAfterProcessing": True}})
        self.assertEqual((a["type"], a["processing"]["status"], a["moderation"]["status"], a["externalUrl"]),
                         ("website", "processing", "pending", "https://example.com/page"))
        self.assertIsNone(c.assets.delete({"assetId": a["id"]}))
        self.assertEqual((c.requests[-1].method, c.requests[-1].path), ("DELETE", f"/assets/{a['id']}"))
        with self.assertRaises(CalmLensError) as raised:
            c.assets.retrieve({"assetId": a["id"]})
        self.assertEqual(raised.exception.code, "asset/not-found")
        self.assertEqual(list(c.database_storage.assets), [other["id"]])
        self.assertIn(other["id"], c.image_storage.content)
        for call in (lambda: c.assets.delete({"assetId": a["id"]}), lambda: c.assets.delete_content({"assetId": a["id"]})):
            with self.assertRaises(CalmLensError) as raised:
                call()
            self.assertEqual(raised.exception.code, "asset/not-found")
        with self.assertRaises(CalmLensError) as raised:
            c.assets.delete({})
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)

    def test_lens_versions(self):
        c = self.client
        lens = {"identifier": "x", "name": "X", "version": 1, "active": True, "type": "image"}
        c.ensure_lens(lens)
        with self.assertRaises(CalmLensAPIError) as raised:
            c.ensure_lens({**lens, "name": "New"})
        self.assertEqual((raised.exception.code, raised.exception.status), (error_codes.LENS_VERSION_CONFLICT, 409))
        self.assertEqual(c.ensure_lens({**lens, "name": "New", "version": 2})["name"], "New")

    def test_multipart_uses_the_queue_mode_saved_at_start(self):
        size = 5 * 1024 * 1024
        c = self.client
        queued = c.assets.create({"name": "x.png", "totalSizeInBytes": 2 * size,
                                  "part": {"type": "image/png", "data": b"x" * size}})
        self.assertEqual((queued["processing"]["status"], queued["processing"]["uploadPartsReceived"]), ("uploading", 1))
        result = c.assets.upload_part({"assetId": queued["id"], "part": {"data": b"y" * size, "partNumber": 2, "isFinal": True}})
        self.assertEqual((result["processing"]["status"], result["moderation"]["status"],
                          result["processing"]["uploadPartsReceived"], result["content"]["sizeInBytes"]),
                         ("processing", "pending", 2, 2 * size))
        waited = c.assets.moderate({"name": "y.png", "part": {"type": "image/png", "data": b"x" * size}})
        self.assertEqual(c.assets.upload_part(asset_id=waited["id"], part={"data": b"y" * size, "partNumber": 2,
                                                                          "isFinal": True})["moderation"]["status"],
                         "approved")
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.upload_part(asset_id=waited["id"], part={"data": b"z", "partNumber": 3, "isFinal": True})
        self.assertEqual(raised.exception.code, error_codes.UPLOAD_NOT_OPEN)

    def test_multipart_declared_size_is_enforced(self):
        size = 5 * 1024 * 1024
        c = self.client
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.create({"name": "big.png", "totalSizeInBytes": 30 * 1024 * 1024,
                             "part": {"type": "image/png", "data": b"x" * size}})
        self.assertEqual(raised.exception.code, error_codes.MULTIPART_IMAGE_TOO_LARGE)
        doc = c.assets.create({"name": "a.pdf", "totalSizeInBytes": size + 10,
                               "part": {"type": "application/pdf", "data": b"x" * size}})
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.upload_part(asset_id=doc["id"], part={"data": b"y" * 5, "partNumber": 2, "isFinal": True})
        self.assertEqual(raised.exception.code, error_codes.UPLOAD_SIZE_MISMATCH)
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.upload_part(asset_id=doc["id"], part={"data": b"y" * 10, "partNumber": 3, "isFinal": True})
        self.assertEqual(raised.exception.code, error_codes.INVALID_UPLOAD_PART_NUMBER)


class MockFeedSearchAndListTests(unittest.TestCase):
    def setUp(self):
        ids = iter(f"id-{n}" for n in range(100))
        self.clock = [1000]
        self.client = MockCalmLensServerClient(mock_options={"create_id": lambda: next(ids), "now": lambda: self.clock[0]})

    def tick(self):
        self.clock[0] += 1

    def test_enqueued_events_are_returned_after_the_cursor(self):
        c = self.client
        c.enqueue_event("asset.flagged", facts=[{"key": "flagged-categories", "value": ["hate"]}])
        start = c.events.list()
        self.assertEqual(start["events"], [])
        self.tick()
        asset = c.text.moderate(text="hello")
        first = c.enqueue_event("asset.approved", asset_id=asset["id"],
                                facts=[{"key": "decided-by", "value": "automated"}])
        self.tick()
        second = c.enqueue_event("asset.approved", asset_id=asset["id"])
        page = c.events.list(after=start["cursor"], limit=1)
        self.assertEqual(([e["id"] for e in page["events"]], page["hasMore"]), ([first["id"]], True))
        self.assertEqual(page["events"][0]["asset"], {"id": asset["id"], "externalId": None,
                                                      "processing": {"status": "done"},
                                                      "moderation": {"status": "approved", "action": None},
                                                      "content": {"status": "removed"}})
        self.assertEqual(page["events"][0]["facts"], [{"key": "decided-by", "value": "automated"}])
        self.assertEqual([e["id"] for e in c.events.iter(after=start["cursor"], limit=1)], [first["id"], second["id"]])
        last = c.events.list(after=page["cursor"])
        self.assertEqual(([e["type"] for e in last["events"]], last["hasMore"]), (["asset.approved"], False))
        self.assertEqual(c.events.list(after=last["cursor"]), {"events": [], "cursor": last["cursor"], "hasMore": False})
        with self.assertRaises(CalmLensAPIError) as raised:
            c.events.list(after="garbage")
        self.assertEqual((raised.exception.code, raised.exception.status), (error_codes.INVALID_EVENT_CURSOR, 400))

    def test_search_is_routed_and_matches_keywords(self):
        c = self.client
        cat = c.assets.create(name="cat.txt", content={"plainText": "a", "type": "text/plain"})
        c.assets.create(name="dog.txt", content={"plainText": "b", "type": "text/plain"})
        result = c.assets.search(query="CAT", mode="keyword")
        self.assertEqual([(m["asset"]["id"], m["matchedFields"]) for m in result["items"]], [(cat["id"], ["name"])])
        self.assertEqual(result["query"], "CAT")
        self.assertEqual(c.requests[-1].path, "/projects/mock-project/assets/search")

    def test_list_filters_and_orders(self):
        c = self.client
        for name in ("b", "a", "c"):
            self.tick()
            c.assets.create(name=name, content={"plainText": name, "type": "text/plain"})
        c.database_storage.assets["id-1"]["moderation"]["status"] = "rejected"
        c.database_storage.assets["id-2"]["processing"]["status"] = "failed"
        self.assertEqual([a["name"] for a in c.assets.list()["items"]], ["c", "a", "b"])  # newest first
        names = [a["name"] for a in c.assets.list(ordering=[{"field": "createdAt", "direction": "ASC"}])["items"]]
        self.assertEqual(names, ["b", "a", "c"])
        names = [a["name"] for a in c.assets.list(ordering=[{"field": "createdAt", "direction": "DESC"}])["items"]]
        self.assertEqual(names[0], "c")
        self.assertEqual([a["name"] for a in c.assets.list(filter="moderation.status==pending")["items"]], ["c", "b"])
        self.assertEqual([a["name"] for a in c.assets.list(filter="moderation.status==rejected,name==c")["items"]],
                         ["c", "a"])
        self.assertEqual([a["name"] for a in c.assets.list(filter="moderation.status==pending;name=in=(a,b)")["items"]],
                         ["b"])
        self.assertEqual([a["name"] for a in c.assets.list(filter="processing.status==failed")["items"]], ["c"])
        self.assertEqual([a["name"] for a in c.assets.list(filter="content.format==text/plain;name!=c")["items"]],
                         ["a", "b"])
        self.assertEqual([a["name"] for a in c.assets.iter(page_size=1, filter="name!=b")], ["c", "a"])
        with self.assertRaises(NotImplementedError):
            c.assets.list(filter="(name==a,name==b);moderation.status==pending")


class MockConfigurationAndCaptureTests(unittest.TestCase):
    def test_accepts_real_client_configuration(self):
        c = MockCalmLensServerClient(project_id="p1", base_url="https://api.example.test/v2/", cdn_base_url="https://cdn.example.test/v2",
                               timeout=5, mock_options={"create_id": lambda: "a1"})
        self.assertEqual((c.project_id, c.base_url, c.cdn_base_url, c.timeout), ("p1", "https://api.example.test/v2", "https://cdn.example.test/v2", 5))
        self.assertEqual(c.cdn.get_asset_url({"assetIdentifier": "a1"}), "https://cdn.example.test/v2/assets/p1/a1/content")
        with self.assertRaises(CalmLensError):
            MockCalmLensServerClient(timeout=0)
        with self.assertRaises(CalmLensError):
            MockCalmLensServerClient(mock_options={"cdn_base_url": "https://x.test"})

    def test_captures_requests(self):
        c = MockCalmLensServerClient(project_id="p1", mock_options={"create_id": lambda: "a1"})
        c.assets.moderate(name="note", external_id="e1", content={"plain_text": "hi", "type": "text/plain"})
        c.assets.update({"assetId": "a1", "tags": ["x"]})
        c.events.list(after="1_cursor", limit=5)
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
        self.assertEqual(events.query, {"after": "1_cursor", "limit": 5})
        self.assertEqual((serve.method, serve.path), ("GET", "/assets/p1/a1/content/@thumb"))
        c.requests[0].query["externalId"] = "changed"
        self.assertEqual(c.requests[0].query["externalId"], "e1")

    def test_enqueued_errors_match_real_failures(self):
        c = MockCalmLensServerClient(mock_options={"create_id": lambda: "a1"})
        timeout, reset = TimeoutError("slow"), ConnectionResetError("reset")
        api = CalmLensError("rate-limit/exceeded", status=429, retry_after=3)
        c.enqueue_error(timeout).enqueue_error(reset).enqueue_error(api).enqueue_error(http.client.IncompleteRead(b""))
        for expected, cause in ((CalmLensTimeoutError, timeout), (CalmLensTransportError, reset)):
            with self.assertRaises(expected) as raised:
                c.text.moderate(text="hello")
            self.assertIs(raised.exception.__cause__, cause)
        with self.assertRaises(CalmLensAPIError) as raised:
            c.events.list()
        error = raised.exception
        self.assertEqual((error.code, error.status, error.retry_after), ("rate-limit/exceeded", 429, 3.0))
        self.assertTrue(error.request_id)
        with self.assertRaises(CalmLensTransportError):
            c.cdn.serve({"assetIdentifier": "a1"})
        self.assertEqual(c.database_storage.assets, {})
        self.assertEqual(c.text.moderate(text="hello")["moderation"]["status"], "approved")
        self.assertEqual(len(c.requests), 5)
        c.enqueue_error(CalmLensError(error_codes.ASSET_NOT_FOUND))
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.retrieve(asset_id="a1")
        self.assertEqual(raised.exception.status, 404)

    def test_retries_and_idempotent_replays(self):
        c = MockCalmLensServerClient(max_retries=1, mock_options={"create_id": lambda: "a1"})
        c.enqueue_error(CalmLensError("server/unavailable", status=503))
        c.assets.create(name="x", content={"plainText": "hi", "type": "text/plain"}, idempotency_key="key-1")
        self.assertEqual([r.headers["Idempotency-key"] for r in c.requests], ["key-1", "key-1"])
        self.assertEqual(len(c.database_storage.assets), 1)
        replay = c.assets.create(name="x", content={"plainText": "hi", "type": "text/plain"}, idempotency_key="key-1")
        self.assertEqual((replay["id"], len(c.database_storage.assets)), ("a1", 1))
        with self.assertRaises(CalmLensAPIError) as raised:
            c.assets.create(name="other", content={"plainText": "hi", "type": "text/plain"}, idempotency_key="key-1")
        self.assertEqual((raised.exception.code, raised.exception.status), (error_codes.IDEMPOTENCY_KEY_REUSED, 409))


if __name__ == "__main__":
    unittest.main()
