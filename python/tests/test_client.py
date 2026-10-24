import io
import json
import os
import unittest
import unittest.mock
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlsplit

from calmlens import (CalmLensServerClient, CalmLensError, CalmLensTimeoutError, CalmLensValidationError,
                      __version__, error_codes)

#: The smallest response the client accepts as an asset.
ASSET = {"id": "asset", "upload": {"status": "completed"},
         "classification": {"status": "processing", "moderation": {"status": "pending"}}}


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
        self.result = ASSET
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
    def test_keyword_arguments_match_options_dicts(self):
        self.client.assets.classify(name="n", external_id="e1", processing_options={"keep_content_after_processing": False},
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

    def test_missing_arguments_use_the_invalid_argument_code(self):
        for call in (lambda: self.client.assets.retrieve(), lambda: self.client.assets.delete({}),
                     lambda: self.client.assets.move(asset_id="a"), lambda: self.client.folders.create(),
                     lambda: self.client.assets.search(limit=2),
                     lambda: self.client.cdn.get_asset_url(asset_identifier="a", resource="raw")):
            with self.assertRaises(CalmLensValidationError) as raised:
                call()
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])

    def test_payload_forms_and_url(self):
        for payload in ({"plainText": "abc"}, {"base64": "data:text/plain;base64,YWJj"}, {"data": b"abc"},
                        {"data": bytearray(b"abc")}, {"data": memoryview(b"abc")}):
            self.client.assets.create({"name": "x", "content": {"type": "text/plain", **payload}})
            self.assertEqual(self.bodies[-1], b"abc")
            self.assertEqual(self.query()["queue"], ["true"])
            self.assertEqual(self.calls[-1].headers["Content-length"], "3")
        self.client.assets.classify({"name": "site", "url": "https://example.com", "metadata": [{"id": "a", "value": 1}]})
        self.assertEqual(json.loads(self.calls[-1].data)["metadata"], [{"id": "a", "value": 1}])
        self.assertTrue(urlsplit(self.calls[-1].full_url).path.endswith("/assets"))

    def test_invalid_payload_values_are_rejected_before_sending(self):
        for payload in ({"data": 5}, {"data": "abc"}, {"data": [97, 98]}, {"uint8Array": [97]}, {"buffer": b"a"},
                        {"data": io.StringIO("text mode")}):
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

    def test_multipart_size_refusals_are_raised_before_sending_without_a_status(self):
        mib = 1024 * 1024
        cases = [
            ("create", {"name": "x.mp4", "part": {"data": b"x" * mib, "type": "video/mp4"}},
             error_codes.INVALID_UPLOAD_PAYLOAD),
            ("upload_part", {"assetId": "a", "part": {"data": b"x" * mib, "partNumber": 2}},
             error_codes.INVALID_UPLOAD_PAYLOAD),
            ("create", {"name": "x.png", "part": {"data": b"x" * mib, "isFinal": True, "type": "image/png"}},
             error_codes.MULTIPART_IMAGE_TOO_SMALL),
            ("create", {"name": "x.png", "part": {"data": b"x" * (21 * mib), "type": "image/png"}},
             error_codes.MULTIPART_IMAGE_TOO_LARGE),
        ]
        for method, options, code in cases:
            with self.subTest(code=code), self.assertRaises(CalmLensValidationError) as raised:
                getattr(self.client.assets, method)(options)
            self.assertEqual((raised.exception.code, raised.exception.status), (code, None))
        self.assertEqual(self.calls, [])

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

    def test_version_matches_the_package_manifest(self):
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

    def test_structured_transforms_format_numbers_like_javascript(self):
        options = {"a": 2.0, "b": 0.00001, "c": 1e-7, "d": 1e21, "e": -0.0, "f": 123456789012, "g": -2.5}
        url = self.client.cdn.get_asset_url(asset_identifier="a", transform=(
            {"type": "imageTransform", "options": options}, {"type": "imageTransform", "options": {"blur": 3}}))
        self.assertTrue(url.endswith("/rendered/a=2,b=0.00001,c=1e-7,d=1e%2B21,e=0,f=123456789012,g=-2.5/blur=3"))
        url = self.client.cdn.get_asset_url(asset_identifier="a", transform={"type": "imageTransform", "options": {
            "background": "#FFAA00", "trim": {"border": {"color": "#ABC"}}, "quality": 80}})
        self.assertTrue(url.endswith("/rendered/background=ffaa00,quality=80,trim.border.color=abc"))
        # Keyword arguments are converted to camelCase, but transform option names are CDN names:
        # a snake_case name is sent as written, so it is rejected rather than renamed.
        for bad in (float("nan"), float("inf"), {1: "x"}, {"bad_name": 1}, object()):
            with self.subTest(bad=bad), self.assertRaises(CalmLensError) as raised:
                self.client.cdn.get_asset_url(asset_identifier="a", transform={"type": "imageTransform", "options": {"v": bad}})
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        with self.assertRaises(CalmLensError) as raised:
            self.client.cdn.get_asset_url(asset_identifier="a", transform={"type": "imageTransform", "options": {"keep_me": 1}})
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        with self.assertRaises(CalmLensError) as raised:
            self.client.assets.create_signed_url(asset_id="a", lens="x", transform=[])
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)

    def test_cdn_urls_and_serve_headers(self):
        url = self.client.cdn.get_asset_url({"assetIdentifier": "a/b?", "lens": "my lens"})
        self.assertEqual(url, "https://cdn.calmlens.com/v1/assets/p%20%2F%3F/a%2Fb%3F/rendered/@my%20lens")
        self.assertTrue(self.client.cdn.get_asset_url({"assetIdentifier": "a", "transform": "/width=20/[x]"}).endswith("/rendered/width=20/%5Bx%5D"))
        self.assertEqual(self.client.cdn.get_asset_url({"assetIdentifier": "a", "lens": "x", "transform": "format=avif"}), "https://cdn.calmlens.com/v1/assets/p%20%2F%3F/a/rendered/@x/format=avif")
        self.result, self.headers = b"0123456789", {"Content-Type": "image/png", "X-Request-Id": "req_cdn"}
        with self.client.cdn.serve({"assetIdentifier": "a", "init": {"headers": {"x-api-key": "wrong", "Range": "bytes=0-1"}}}) as response:
            self.assertEqual(self.calls[-1].headers["X-api-key"], "key")
            self.assertEqual(self.calls[-1].headers["Range"], "bytes=0-1")
            self.assertEqual((response.content_type, response.request_id, response.ok), ("image/png", "req_cdn", True))
            self.assertEqual(list(response.iter_bytes(4)), [b"0123", b"4567", b"89"])


class WaitForDecisionTests(ClientTestCase):
    def test_backs_off_to_five_seconds_and_times_out_at_the_deadline(self):
        self.client._clock = lambda: sum(self.sleeps)
        self.result = {"id": "asset-1", "upload": {"status": "completed"}, "classification": {'status': 'processing', 'moderation': {'status': 'pending'}}}
        with self.assertRaises(CalmLensError) as raised:
            self.client.assets.wait_for_decision({"assetId": "asset-1", "timeout": 20})
        self.assertEqual(raised.exception.code, error_codes.SDK_TIMEOUT)
        self.assertEqual(raised.exception.details,
                         {"assetId": "asset-1", "classificationStatus": "processing", "moderationStatus": "pending"})
        self.assertEqual(self.sleeps, [0.5, 0.75, 1.125, 1.6875, 2.53125, 3.796875, 5.0, 4.609375])
        self.assertEqual(len(self.calls), 9)

    def test_invalid_arguments_are_rejected_before_sending(self):
        for options in ({}, {"assetId": "a", "timeout": -1}, {"assetId": "a", "timeout": float("nan")},
                        {"assetId": "a", "timeout": "60"}):
            with self.subTest(options=options), self.assertRaises(CalmLensValidationError) as raised:
                self.client.assets.wait_for_decision(options)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])


class RetryTests(ClientTestCase):
    def test_uploads_are_retried_with_the_same_idempotency_key(self):
        in_progress = ({"code": error_codes.IDEMPOTENT_REQUEST_IN_PROGRESS}, 409, {"Retry-After": "1"})
        self.script = [in_progress, TimeoutError("slow"), (ASSET,)]
        stream = io.BytesIO(b"hello")
        self.client.assets.create(name="x", content={"data": stream, "type": "text/plain"})
        keys = {call.headers["Idempotency-key"] for call in self.calls}
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(len(keys), 1)
        self.assertEqual(self.bodies, [b"hello"] * 3)
        self.client.assets.create(name="x", content={"plainText": "a", "type": "text/plain"}, idempotency_key="mine")
        self.assertEqual(self.calls[-1].headers["Idempotency-key"], "mine")
        self.assertNotIn(self.calls[-1].headers["Idempotency-key"], keys)

    def test_timeouts_are_typed(self):
        self.client = self.client.with_options(max_retries=0)
        self.script = [TimeoutError("slow")]
        with self.assertRaises(CalmLensTimeoutError) as raised:
            self.client.assets.retrieve(asset_id="a")
        self.assertEqual(raised.exception.code, error_codes.SDK_TIMEOUT)
        self.assertTrue(raised.exception.is_retryable)


if __name__ == "__main__":
    unittest.main()
