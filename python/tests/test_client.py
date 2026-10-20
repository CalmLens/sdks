import base64
import hashlib
import hmac
import io
import json
import os
import time
import unittest
import unittest.mock
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlsplit

from calmlens import (USER_AGENT, CalmLensAPIError, CalmLensServerClient, CalmLensError, CalmLensTimeoutError,
                      CalmLensTransportError, CalmLensValidationError, __version__, error_codes)
from calmlens.client import ENSURE_LENSES_MAX_PER_REQUEST


class Response(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(json.dumps(body).encode() if not isinstance(body, bytes) else body)
        self.status = status
        self.headers = headers or {}


class Unseekable(io.RawIOBase):
    """A pipe-like binary stream."""

    def __init__(self, data):
        super().__init__()
        self._data = io.BytesIO(data)

    def readable(self):
        return True

    def read(self, amount=-1):
        return self._data.read(amount)


class ClientTestCase(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.bodies = []
        self.result = {"id": "asset", "status": "approved"}
        self.status = 200
        self.headers = {}
        self.script = []
        self.sleeps = []

        def transport(request, timeout):
            self.calls.append(request)
            data = request.data
            self.bodies.append(data.read() if hasattr(data, "read") else data)
            if self.script:
                step = self.script.pop(0)
                if isinstance(step, BaseException):
                    raise step
                return Response(*step)
            return Response(self.result, self.status, self.headers)
        self.client = CalmLensServerClient(api_key="key", project_id="p /?", transport=transport)
        self.client._sleep = self.sleeps.append

    def query(self, index=-1):
        return parse_qs(urlsplit(self.calls[index].full_url).query)


class ClientTests(ClientTestCase):
    def test_text_utf8_and_metadata(self):
        self.client.assets.moderate({'metadata': [{'id': 'x', 'value': False}], 'processingOptions': {'keepContentAfterProcessing': False}, 'name': 'text', 'content': {'plainText': 'héllo 🌍', 'type': 'text/plain'}})
        req = self.calls[-1]
        self.assertEqual(req.data, "héllo 🌍".encode())
        self.assertEqual(req.headers["X-api-key"], "key")
        self.assertEqual(req.headers["Content-type"], "text/plain")
        self.assertIn("/projects/p%20%2F%3F/assets?", req.full_url)
        self.assertEqual(req.headers["X-calmlens-upload"], "content")
        self.assertEqual(self.query()["queue"], ["false"])
        self.assertEqual(self.query()["sizeInBytes"], [str(len(req.data))])
        self.assertEqual(json.loads(self.query()["metadata"][0]), [{"id": "x", "value": False}])
        self.assertEqual(json.loads(self.query()["processingOptions"][0]), {"keepContentAfterProcessing": False})
        for text in ("", " \n", None, 3):
            with self.assertRaises(CalmLensError):
                self.client.assets.moderate({'name': 'text', 'content': {'plainText': text, 'type': 'text/plain'}})

    def test_keyword_arguments_match_options_dicts(self):
        self.client.assets.moderate(name="n", external_id="e1", processing_options={"keep_content_after_processing": False},
                                    metadata=[{"id": "snake_key", "value": 1}],
                                    content={"plain_text": "hi", "type": "text/plain"})
        query = self.query()
        self.assertEqual((query["externalId"], query["name"]), (["e1"], ["n"]))
        self.assertEqual(json.loads(query["processingOptions"][0]), {"keepContentAfterProcessing": False})
        self.assertEqual(json.loads(query["metadata"][0]), [{"id": "snake_key", "value": 1}])
        self.assertEqual(self.calls[-1].data, b"hi")
        with self.assertRaises(CalmLensValidationError) as raised:
            self.client.assets.retrieve({"assetId": "a"}, asset_id="b")
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.client.assets.move(asset_id="a", folder_id=None)
        self.assertEqual(json.loads(self.calls[-1].data), {"folderId": None})

    def test_upload_preset_id_is_sent_as_a_query_parameter(self):
        self.client.assets.create(name="n", upload_preset_id="preset-1", content={"plainText": "hi", "type": "text/plain"})
        self.assertEqual(self.query()["uploadPresetId"], ["preset-1"])
        self.client.assets.moderate({"name": "n", "uploadPresetId": "preset-2",
                                     "content": {"plainText": "hi", "type": "text/plain"}})
        self.assertEqual(self.query()["uploadPresetId"], ["preset-2"])

    def test_path_parameters_are_escaped(self):
        self.client.assets.retrieve({"assetId": "a/b"})
        self.assertTrue(urlsplit(self.calls[-1].full_url).path.endswith("/v1/assets/a%2Fb"))

    def test_missing_arguments_use_the_invalid_argument_code(self):
        for call in (lambda: self.client.assets.retrieve(), lambda: self.client.assets.delete({}),
                     lambda: self.client.assets.move(asset_id="a"), lambda: self.client.folders.create(),
                     lambda: self.client.assets.search(limit=2),
                     lambda: self.client.cdn.get_asset_url(asset_identifier="a", resource="raw")):
            with self.assertRaises(CalmLensValidationError) as raised:
                call()
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])

    def test_folder_list_unwraps_folders(self):
        self.result = {"folders": [{"id": "f"}]}
        self.assertEqual(self.client.folders.list(), [{"id": "f"}])

    def test_payload_forms_and_url(self):
        for payload in ({"plainText": "abc"}, {"base64": "data:text/plain;base64,YWJj"}, {"data": b"abc"},
                        {"data": bytearray(b"abc")}, {"data": memoryview(b"abc")}):
            self.client.assets.create({"name": "x", "content": {"type": "text/plain", **payload}})
            self.assertEqual(self.bodies[-1], b"abc")
            self.assertEqual(self.query()["queue"], ["true"])
            self.assertEqual(self.calls[-1].headers["Content-length"], "3")
        self.client.assets.moderate({"name": "site", "url": "https://example.com", "metadata": [{"id": "a", "value": 1}]})
        self.assertEqual(json.loads(self.calls[-1].data)["metadata"], [{"id": "a", "value": 1}])
        self.assertTrue(urlsplit(self.calls[-1].full_url).path.endswith("/assets"))

    def test_invalid_payload_values_are_rejected_before_sending(self):
        for payload in ({"data": 5}, {"data": "abc"}, {"data": [97, 98]}, {"uint8Array": [97]}, {"buffer": b"a"},
                        {"data": io.StringIO("text mode")}, {"data": Unseekable(b"abc")}):
            with self.subTest(payload=payload), self.assertRaises(CalmLensValidationError) as raised:
                self.client.assets.create({"name": "x", "content": {"type": "text/plain", **payload}})
            self.assertEqual(raised.exception.code, error_codes.INVALID_UPLOAD_PAYLOAD)
        self.assertEqual(self.calls, [])

    def test_seekable_streams_are_sized_and_streamed(self):
        stream = io.BytesIO(b"skip:streamed")
        stream.seek(5)
        self.client.assets.create(name="x", content={"data": stream, "type": "text/plain"})
        self.assertEqual(self.query()["sizeInBytes"], ["8"])
        self.assertEqual(self.calls[-1].headers["Content-length"], "8")
        self.assertEqual(self.bodies[-1], b"streamed")
        # A longer stream sends exactly the declared size.
        self.client.assets.create(name="x", content={"data": Unseekable(b"abcdef"), "sizeInBytes": 3,
                                                     "type": "text/plain"})
        self.assertEqual(self.bodies[-1], b"abc")

    def test_stream_shorter_than_declared_size_fails_clearly(self):
        with self.assertRaises(CalmLensValidationError) as raised:
            self.client.assets.create(name="x", content={"data": io.BytesIO(b"ab"), "sizeInBytes": 3,
                                                         "type": "text/plain"})
        self.assertEqual(raised.exception.code, error_codes.INVALID_UPLOAD_PAYLOAD)

        def reading_transport(request, timeout):
            request.data.read()
            return Response(self.result)
        client = CalmLensServerClient(api_key="key", project_id="p", transport=reading_transport)
        with self.assertRaises(CalmLensValidationError) as raised:
            client.assets.create(name="x", content={"data": Unseekable(b"ab"), "sizeInBytes": 3, "type": "text/plain"})
        self.assertEqual(raised.exception.code, error_codes.INVALID_UPLOAD_PAYLOAD)

    def test_multipart_sends_total_size_and_no_part_queue(self):
        size = 5 * 1024 * 1024
        self.result = {"id": "a", "processing": {"status": "uploading", "updatedAt": 1, "uploadPartsReceived": 1}}
        self.client.assets.create({"name": "x.png", "totalSizeInBytes": 2 * size,
                                   "part": {"type": "image/png", "data": b"x" * size}})
        self.assertEqual((self.query()["partNumber"], self.query()["isFinal"]), (["1"], ["false"]))
        self.assertEqual((self.query()["queue"], self.query()["totalSizeInBytes"]), (["true"], [str(2 * size)]))
        self.client.assets.upload_part({"assetId": "a", "part": {"data": io.BytesIO(b"x" * size), "isFinal": True,
                                                                  "partNumber": 2}})
        self.assertNotIn("queue", self.query())
        self.assertEqual(self.query()["sizeInBytes"], [str(size)])
        self.client.assets.upload_part(asset_id="a", queue=False, part={"data": b"x", "isFinal": True, "partNumber": 3})
        self.assertEqual(self.query()["queue"], ["false"])

    def test_validation_before_network(self):
        cases = [
            {"name": "x"},
            {"name": "x", "content": {"data": b"x", "type": "application/octet-stream"}},
            {"name": "x", "part": {"data": b"x", "type": "image/png"}},
            {"name": "x", "part": {"base64": "YWJ", "isFinal": True, "type": "text/plain"}},
            {"name": "x", "content": {"data": b"x", "sizeInBytes": 2, "type": "text/plain"}},
            {"name": "x", "totalSizeInBytes": 5, "content": {"data": b"x", "type": "text/plain"}},
        ]
        for options in cases:
            with self.subTest(options=list(options)), self.assertRaises(CalmLensValidationError):
                self.client.assets.create(options)
        self.assertFalse(self.calls)

    def test_header_injection_is_rejected_before_sending(self):
        with self.assertRaises(CalmLensValidationError) as raised:
            self.client.assets.create(name="x", content={"plainText": "a", "type": "text/plain"},
                                      idempotency_key="k\r\nX-Evil: 1")
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        with self.assertRaises(CalmLensValidationError):
            self.client.cdn.serve(asset_identifier="a", init={"headers": {"Range": "bytes=0-1\r\nX: y"}})
        self.assertEqual(self.calls, [])

    def test_structured_and_malformed_errors(self):
        self.result = {"code": "asset/not-found", "message": "Missing", "details": {"a": 1}, "traceId": "trace"}
        self.status, self.headers = 404, {"X-Request-Id": "req_1"}
        with self.assertRaises(CalmLensAPIError) as failure:
            self.client.assets.retrieve({"assetId": "x"})
        error = failure.exception
        self.assertEqual((error.code, error.status, error.request_id), ("asset/not-found", 404, "req_1"))
        self.assertEqual(error.details, {"a": 1, "traceId": "trace", "network": True})
        self.assertEqual(error.headers, {"x-request-id": "req_1"})
        self.assertTrue(error.is_not_found)
        self.assertFalse(error.is_retryable)
        self.result, self.status = b"<html>gateway down</html>", 500
        with self.assertRaises(CalmLensAPIError) as failure:
            self.client.assets.create({"name": "x", "content": {"plainText": "hi", "type": "text/plain"}})
        self.assertEqual((failure.exception.code, failure.exception.status), (error_codes.SDK_HTTP_ERROR, 500))
        self.result, self.status = b"not json", 200
        with self.assertRaises(CalmLensError) as failure:
            self.client.assets.retrieve(asset_id="x")
        self.assertEqual(failure.exception.code, error_codes.SDK_INVALID_RESPONSE)
        self.status, self.result = 204, b""
        self.assertIsNone(self.client.folders.delete({"folderId": "f"}))

    def test_oversized_responses_are_rejected(self):
        with unittest.mock.patch("calmlens.client.MAX_RESPONSE_BYTES", 10):
            self.result = {"id": "a" * 20}
            with self.assertRaises(CalmLensError) as raised:
                self.client.assets.retrieve(asset_id="a")
        self.assertEqual(raised.exception.code, error_codes.SDK_RESPONSE_TOO_LARGE)

    def test_user_agent_and_version(self):
        self.client.assets.retrieve(asset_id="a")
        self.assertEqual(self.calls[-1].headers["User-agent"], USER_AGENT)
        self.assertTrue(USER_AGENT.startswith(f"calmlens-python/{__version__} ("))
        with open(os.path.join(os.path.dirname(__file__), "..", "pyproject.toml"), encoding="utf-8") as manifest:
            self.assertIn(f'version = "{__version__}"', manifest.read())

    def test_api_key_is_not_in_repr(self):
        client = CalmLensServerClient(api_key="sk_live_secret", project_id="p", transport=lambda r, t: None)
        self.assertNotIn("sk_live_secret", repr(client))
        self.assertIn("'p'", repr(client))

    def test_environment_defaults(self):
        with unittest.mock.patch.dict(os.environ, {"CALMLENS_API_KEY": "env-key", "CALMLENS_PROJECT_ID": "env-p"}):
            client = CalmLensServerClient(transport=lambda r, t: None)
            self.assertEqual((client.api_key, client.project_id), ("env-key", "env-p"))
            self.assertEqual(CalmLensServerClient(api_key="k", project_id="p", transport=lambda r, t: None).api_key, "k")
        with unittest.mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(CalmLensValidationError) as raised:
                CalmLensServerClient()
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_CONFIG)

    def test_lens_cache_concurrency_invalidation_and_failure(self):
        lens = {"identifier": "thumb", "name": "Thumb", "type": "image", "active": True, "version": 1}
        self.result = {"lenses": [{"id": "l", **lens}]}
        with ThreadPoolExecutor(4) as pool:
            list(pool.map(lambda _: self.client.ensure_lens(lens), range(8)))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(len(self.client.ensure_lenses({"lenses": [lens, lens]})), 2)
        changed = {**lens, "version": 2}
        self.result = {"code": "lens/version-conflict"}
        self.status = 409
        with self.assertRaises(CalmLensError):
            self.client.ensure_lens(changed)
        self.status = 200
        self.result = {"lenses": [{"id": "l", **changed}]}
        self.client.ensure_lens(changed)
        self.result = {"lenses": [{"id": "l", **lens}]}
        self.client.ensure_lens(lens)
        self.assertEqual(len(self.calls), 4)

    def test_ensure_lenses_sends_large_batches_in_consecutive_requests(self):
        lenses = [{"identifier": f"lens-{i}", "name": "Lens", "type": "image", "active": True, "version": 1}
                  for i in range(ENSURE_LENSES_MAX_PER_REQUEST + 1)]
        self.script = [({"lenses": [{"id": f"id-{i}", **lens} for i, lens in enumerate(lenses[:100])]},),
                       ({"lenses": [{"id": "id-100", **lenses[100]}]},)]
        result = self.client.ensure_lenses({"lenses": lenses})
        self.assertEqual([call.get_method() for call in self.calls], ["PUT", "PUT"])
        sent = [[lens["identifier"] for lens in json.loads(body)["lenses"]] for body in self.bodies]
        identifiers = [lens["identifier"] for lens in lenses]
        self.assertEqual(sent, [identifiers[:100], identifiers[100:]])
        self.assertEqual([lens["identifier"] for lens in result], identifiers)
        self.assertEqual([lens["id"] for lens in result], [f"id-{i}" for i in range(101)])

    def test_structured_transforms_format_numbers_like_javascript(self):
        options = {"a": 2.0, "b": 0.00001, "c": 1e-7, "d": 1e21, "e": -0.0, "f": 123456789012, "g": -2.5}
        url = self.client.cdn.get_asset_url(asset_identifier="a",
                                            transform=({"type": "t", "options": options}, {"type": "u"}))
        self.assertTrue(url.endswith("/content/t[a=2,b=0.00001,c=1e-7,d=1e%2B21,e=0,f=123456789012,g=-2.5],u[]"))
        # Keyword arguments are converted to camelCase, but transform option names are CDN names.
        url = self.client.cdn.get_asset_url(asset_identifier="a", transform={"type": "t", "options": {"keep_me": 1}})
        self.assertTrue(url.endswith("/content/t[keep_me=1]"))
        for bad in (float("nan"), float("inf"), {1: "x"}, object()):
            with self.subTest(bad=bad), self.assertRaises(CalmLensError) as raised:
                self.client.cdn.get_asset_url(asset_identifier="a", transform={"type": "t", "options": {"v": bad}})
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        with self.assertRaises(CalmLensError) as raised:
            self.client.assets.create_signed_url(asset_id="a", lens="x", transform=[])
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)

    def test_cdn_urls_and_serve_headers(self):
        url = self.client.cdn.get_asset_url({"assetIdentifier": "a/b?", "lens": "my lens"})
        self.assertEqual(url, "https://cdn.calmlens.com/v1/assets/p%20%2F%3F/a%2Fb%3F/content/@my%20lens")
        self.assertTrue(self.client.cdn.get_asset_url({"assetIdentifier": "a", "transform": "/imageTransform[width=20]"}).endswith("/imageTransform[width=20]"))
        self.assertEqual(self.client.cdn.get_asset_url({"assetIdentifier": "a", "lens": "x", "transform": "imageTransform[format=avif]"}), "https://cdn.calmlens.com/v1/assets/p%20%2F%3F/a/content/@x,imageTransform[format=avif]")
        self.result, self.headers = b"0123456789", {"Content-Type": "image/png", "X-Request-Id": "req_cdn"}
        with self.client.cdn.serve({"assetIdentifier": "a", "init": {"headers": {"x-api-key": "wrong", "Range": "bytes=0-1"}}}) as response:
            self.assertEqual(self.calls[-1].headers["X-api-key"], "key")
            self.assertEqual(self.calls[-1].headers["Range"], "bytes=0-1")
            self.assertEqual((response.content_type, response.request_id, response.ok), ("image/png", "req_cdn", True))
            self.assertEqual(list(response.iter_bytes(4)), [b"0123", b"4567", b"89"])


class UploadTokenTests(unittest.TestCase):
    API_KEY = "clsk_use_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHabcdef"

    def decode(self, token):
        self.assertTrue(token.startswith("clut_"))
        body, signature = token[len("clut_"):].split(".")
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        return claims, body, signature

    def verify(self, body, signature, api_key):
        secret = hashlib.sha256(api_key.encode()).hexdigest().encode()
        expected = hmac.new(secret, f"calmlens-upload-token:v1:{body}".encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def test_signs_a_token_the_backend_can_verify_against_the_keys_hash(self):
        client = CalmLensServerClient(api_key=self.API_KEY, project_id="p")
        before = int(time.time() * 1000)
        signed = client.upload_tokens.sign(upload_preset_id="preset-1", external_id="post-42", expires_in_seconds=120)
        claims, body, signature = self.decode(signed["token"])
        self.assertEqual((claims["v"], claims["u"], claims["x"], claims["e"], claims["k"]),
                         (1, "preset-1", "post-42", signed["expiresAt"], "clsk_use_abcd"))
        self.assertTrue(120_000 <= signed["expiresAt"] - before < 121_000)
        self.assertTrue(self.verify(body, signature, self.API_KEY))
        self.assertFalse(self.verify(body, signature, "other"))

    def test_every_token_has_its_own_nonce_and_other_keys_use_an_eight_character_prefix(self):
        client = CalmLensServerClient(api_key="legacykey-1234", project_id="p")
        first = self.decode(client.upload_tokens.sign({"uploadPresetId": "p1"})["token"])[0]
        second = self.decode(client.upload_tokens.sign({"uploadPresetId": "p1"})["token"])[0]
        self.assertNotEqual(first["n"], second["n"])
        self.assertEqual(first["k"], "legacyke")
        self.assertNotIn("x", first)

    def test_rejects_invalid_options(self):
        client = CalmLensServerClient(api_key=self.API_KEY, project_id="p")
        for options in ({}, {"uploadPresetId": "p", "expiresInSeconds": 3601}, {"uploadPresetId": "p", "expiresInSeconds": 0},
                        {"uploadPresetId": "p", "expiresInSeconds": 1.5}, {"uploadPresetId": "p", "externalId": ""}):
            with self.assertRaises(CalmLensValidationError) as raised:
                client.upload_tokens.sign(options)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)


class PaginationTests(ClientTestCase):
    def test_assets_iter_walks_every_page(self):
        pages = [{"items": [{"id": "a"}, {"id": "b"}], "hasMore": True, "nextCursor": "next-token"},
                 {"items": [{"id": "c"}], "hasMore": False}]
        self.script = [(page,) for page in pages]
        ids = [asset["id"] for asset in self.client.assets.iter(page_size=2, filter="moderation.status==approved")]
        self.assertEqual(ids, ["a", "b", "c"])
        self.assertEqual([self.query(i).get("cursor") for i in (0, 1)], [None, ["next-token"]])
        self.assertEqual(self.query(1)["filter"], ["moderation.status==approved"])

    def test_children_iter_walks_every_page(self):
        self.script = [({"items": [{"id": "c1"}], "hasMore": True, "nextCursor": "next-token"},), ({"items": [{"id": "c2"}], "hasMore": False},)]
        self.assertEqual([a["id"] for a in self.client.assets.iter_children(asset_id="parent")], ["c1", "c2"])
        self.assertTrue(all(urlsplit(c.full_url).path.endswith("/assets/parent/children") for c in self.calls))

    def test_events_iter_follows_the_cursor(self):
        self.script = [({"events": [{"id": "e1"}], "cursor": "c1", "hasMore": True, "nextCursor": "next-token"},),
                       ({"events": [{"id": "e2"}], "cursor": "c2", "hasMore": False},)]
        pages = list(self.client.events.iter_pages(after="c0", limit=1))
        self.assertEqual([p["cursor"] for p in pages], ["c1", "c2"])
        self.assertEqual([self.query(i)["after"] for i in (0, 1)], [["c0"], ["c1"]])


class WaitForDecisionTests(ClientTestCase):
    def test_retrieves_the_asset_until_it_has_a_decision(self):
        pending = {"id": "asset-1", "processing": {"status": "processing"}, "moderation": {"status": "pending"}}
        decided = {"id": "asset-1", "processing": {"status": "done"}, "moderation": {"status": "rejected"}}
        self.script = [(pending,), (pending,), (decided,)]
        asset = self.client.assets.wait_for_decision(asset_id="asset-1")
        self.assertEqual(asset, decided)
        self.assertEqual([(c.method, urlsplit(c.full_url).path) for c in self.calls], [("GET", "/v1/assets/asset-1")] * 3)
        self.assertEqual(self.sleeps, [0.5, 0.75])

    def test_stops_when_processing_failed(self):
        failed = {"id": "asset-1", "processing": {"status": "failed"}, "moderation": {"status": "pending"}}
        self.script = [({"id": "asset-1", "processing": {"status": "processing"}, "moderation": {"status": "pending"}},),
                       (failed,)]
        self.assertEqual(self.client.assets.wait_for_decision(asset_id="asset-1"), failed)
        self.assertEqual(len(self.calls), 2)

    def test_backs_off_to_five_seconds_and_times_out_at_the_deadline(self):
        self.client._clock = lambda: sum(self.sleeps)
        self.result = {"id": "asset-1", "processing": {"status": "processing"}, "moderation": {"status": "pending"}}
        with self.assertRaises(CalmLensError) as raised:
            self.client.assets.wait_for_decision({"assetId": "asset-1", "timeout": 20})
        self.assertEqual(raised.exception.code, error_codes.SDK_TIMEOUT)
        self.assertEqual(raised.exception.details,
                         {"assetId": "asset-1", "processingStatus": "processing", "moderationStatus": "pending"})
        self.assertEqual(self.sleeps, [0.5, 0.75, 1.125, 1.6875, 2.53125, 3.796875, 5.0, 4.609375])
        self.assertEqual(len(self.calls), 9)

    def test_zero_timeout_checks_once(self):
        self.result = {"id": "asset-1", "processing": {"status": "uploading"}, "moderation": {"status": "pending"}}
        with self.assertRaises(CalmLensError) as raised:
            self.client.assets.wait_for_decision(asset_id="asset-1", timeout=0)
        self.assertEqual((raised.exception.code, raised.exception.details),
                         (error_codes.SDK_TIMEOUT, {"assetId": "asset-1", "processingStatus": "uploading",
                                                    "moderationStatus": "pending"}))
        self.assertEqual((len(self.calls), self.sleeps), (1, []))

    def test_invalid_arguments_are_rejected_before_sending(self):
        for options in ({}, {"assetId": "a", "timeout": -1}, {"assetId": "a", "timeout": float("nan")},
                        {"assetId": "a", "timeout": "60"}):
            with self.subTest(options=options), self.assertRaises(CalmLensValidationError) as raised:
                self.client.assets.wait_for_decision(options)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])


class RetryTests(ClientTestCase):
    def test_get_is_retried_on_gateway_errors_and_network_failures(self):
        self.script = [({"code": "x"}, 503), ConnectionResetError("reset"), ({"id": "a", "status": "approved"},)]
        self.assertEqual(self.client.assets.retrieve(asset_id="a")["id"], "a")
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(len(self.sleeps), 2)
        self.assertTrue(all(0 <= delay <= 1 for delay in self.sleeps))

    def test_retries_stop_after_max_retries(self):
        self.script = [({}, 502)] * 5
        with self.assertRaises(CalmLensAPIError) as raised:
            self.client.assets.retrieve(asset_id="a")
        self.assertEqual((raised.exception.status, len(self.calls)), (502, 3))
        self.assertTrue(raised.exception.is_retryable)
        self.script = [({}, 502)] * 5
        with self.assertRaises(CalmLensAPIError):
            self.client.with_options(max_retries=0).assets.retrieve(asset_id="a")
        self.assertEqual(len(self.calls), 4)

    def test_rate_limits_honour_retry_after(self):
        self.script = [({"code": "rate-limit/exceeded"}, 429, {"Retry-After": "7"}), ({"id": "a"},)]
        self.client.assets.retrieve(asset_id="a")
        self.assertEqual(self.sleeps, [7.0])
        self.script = [({"code": "rate-limit/exceeded"}, 429, {"Retry-After": "3600"})]
        with self.assertRaises(CalmLensAPIError) as raised:
            self.client.assets.retrieve(asset_id="a")
        self.assertEqual(raised.exception.retry_after, 3600.0)
        self.assertEqual(len(self.calls), 3)

    def test_uploads_are_retried_with_the_same_idempotency_key(self):
        in_progress = ({"code": error_codes.IDEMPOTENT_REQUEST_IN_PROGRESS}, 409, {"Retry-After": "1"})
        self.script = [in_progress, TimeoutError("slow"), ({"id": "a"},)]
        stream = io.BytesIO(b"hello")
        self.client.assets.create(name="x", content={"data": stream, "type": "text/plain"})
        keys = {call.headers["Idempotency-key"] for call in self.calls}
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(len(keys), 1)
        self.assertEqual(self.bodies, [b"hello"] * 3)
        self.client.assets.create(name="x", content={"plainText": "a", "type": "text/plain"}, idempotency_key="mine")
        self.assertEqual(self.calls[-1].headers["Idempotency-key"], "mine")
        self.assertNotIn(self.calls[-1].headers["Idempotency-key"], keys)

    def test_non_idempotent_requests_are_not_retried(self):
        self.script = [({}, 503)]
        with self.assertRaises(CalmLensAPIError):
            self.client.assets.move(asset_id="a", folder_id=None)
        self.script = [ConnectionResetError("reset")]
        with self.assertRaises(CalmLensTransportError):
            self.client.assets.create(name="x", content={"data": Unseekable(b"abc"), "sizeInBytes": 3,
                                                         "type": "text/plain"})
        self.assertEqual(len(self.calls), 2)

    def test_conflicts_and_client_errors_are_not_retried(self):
        self.script = [({"code": error_codes.IDEMPOTENCY_KEY_REUSED}, 409)]
        with self.assertRaises(CalmLensAPIError) as raised:
            self.client.assets.create(name="x", content={"plainText": "a", "type": "text/plain"})
        self.assertEqual(raised.exception.code, error_codes.IDEMPOTENCY_KEY_REUSED)
        self.assertEqual(len(self.calls), 1)

    def test_timeouts_are_typed(self):
        self.client = self.client.with_options(max_retries=0)
        self.script = [TimeoutError("slow")]
        with self.assertRaises(CalmLensTimeoutError) as raised:
            self.client.assets.retrieve(asset_id="a")
        self.assertEqual(raised.exception.code, error_codes.SDK_TIMEOUT)
        self.assertTrue(raised.exception.is_retryable)


if __name__ == "__main__":
    unittest.main()
