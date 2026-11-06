import base64
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
        self.client.text.classify(text="hi", tags=["catalogue", "backpacks"])
        self.assertEqual(json.loads(self.query()["tags"][0]), ["catalogue", "backpacks"])
        with self.assertRaises(CalmLensValidationError) as raised:
            self.client.assets.retrieve({"assetId": "a"}, asset_id="b")
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.client.assets.move(asset_id="a", folder_id=None)
        self.assertEqual(json.loads(self.calls[-1].data), {"folderId": None})

    def test_missing_arguments_use_the_invalid_argument_code(self):
        for call in (lambda: self.client.assets.retrieve(), lambda: self.client.assets.delete({}),
                     lambda: self.client.assets.move(asset_id="a"), lambda: self.client.folders.create(),
                     lambda: self.client.assets.search(page_size=2),
                     lambda: self.client.cdn.get_asset_url(asset_id="a", resource="raw")):
            with self.assertRaises(CalmLensValidationError) as raised:
                call()
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])

    def test_payload_forms_and_url(self):
        for payload in ({"plainText": "abc"}, {"base64": "data:text/plain;base64,YWJj"}, {"data": b"abc"},
                        {"data": bytearray(b"abc")}, {"data": memoryview(b"abc")}):
            self.client.assets.create({"name": "x", "content": {"type": "text/plain", **payload}})
            self.assertEqual(self.bodies[-1], b"abc")
            self.assertEqual(self.query()["wait"], ["false"])
            self.assertEqual(self.calls[-1].headers["Content-length"], "3")
        self.client.assets.classify({"name": "site", "url": "https://example.com", "metadata": [{"id": "a", "value": 1}],
                                     "tags": ["landing"]})
        sent = json.loads(self.calls[-1].data)
        self.assertEqual((sent["metadata"], sent["tags"]), ([{"id": "a", "value": 1}], ["landing"]))
        self.assertTrue(urlsplit(self.calls[-1].full_url).path.endswith("/assets"))

    def test_event_pages_send_their_types_as_one_value_and_keep_the_filters_on_every_page(self):
        page = {"items": [], "excludedTypes": []}
        self.script = [({**page, "nextCursor": "c2", "hasMore": True},), ({**page, "nextCursor": "c3", "hasMore": False},)]
        pages = list(self.client.events.iter_pages(cursor="c1", types=["asset.blocked", "asset.purged"],
                                                   asset_id="asset_1"))
        self.assertEqual(len(pages), 2)
        for index, cursor in ((0, "c1"), (1, "c2")):
            self.assertEqual(self.query(index), {"cursor": [cursor], "types": ["asset.blocked,asset.purged"],
                                                 "assetId": ["asset_1"]})
        # An empty list filters nothing, so nothing is sent for it.
        self.result = {**page, "nextCursor": "c4", "hasMore": False}
        self.client.events.list(cursor="c3", types=[])
        self.assertEqual(self.query(), {"cursor": ["c3"]})

    def test_event_types_must_be_a_list_of_strings(self):
        for types in ("asset.blocked", ["asset.blocked", 1], {"asset.blocked"}):
            with self.subTest(types=types), self.assertRaises(CalmLensValidationError) as raised:
                self.client.events.list(types=types)  # type: ignore[arg-type]
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])

    def test_moderation_context_keeps_an_over_long_newest_post_and_needs_items(self):
        newest = "🌍" * 2001
        self.client.text.classify(text="reply", author_id="user-9",
                                  context={"items": [{"text": "older", "author_id": "user-1"}, {"text": newest}]})
        query = self.query()
        self.assertEqual(query["authorId"], ["user-9"])
        self.assertEqual(json.loads(query["context"][0]), {"items": [{"text": newest}]})
        for context in ({}, {"items": "post"}, None):
            with self.subTest(context=context), self.assertRaises(CalmLensValidationError) as raised:
                self.client.text.classify({"text": "reply", "context": context})
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(len(self.calls), 1)

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

    def test_multipart_sends_total_size_and_no_part_wait(self):
        size = 5 * 1024 * 1024
        self.client.assets.create({"name": "x.png", "totalSizeInBytes": 2 * size,
                                   "part": {"type": "image/png", "data": b"x" * size}})
        self.assertEqual((self.query()["partNumber"], self.query()["isFinal"]), (["1"], ["false"]))
        self.assertEqual((self.query()["wait"], self.query()["totalSizeInBytes"]), (["false"], [str(2 * size)]))
        self.client.assets.upload_part({"assetId": "a", "part": {"data": io.BytesIO(b"x" * size), "isFinal": True,
                                                                  "partNumber": 2}})
        self.assertNotIn("wait", self.query())
        self.assertEqual(self.query()["sizeInBytes"], [str(size)])
        self.client.assets.upload_part(asset_id="a", wait=True, part={"data": b"x", "isFinal": True, "partNumber": 3})
        self.assertEqual(self.query()["wait"], ["true"])

    def test_multipart_size_refusals_are_raised_before_sending_without_a_status(self):
        mib = 1024 * 1024
        cases = [
            ("create", {"name": "x.mp4", "part": {"data": b"x" * mib, "type": "video/mp4"}},
             error_codes.INVALID_UPLOAD_PAYLOAD),
            ("upload_part", {"assetId": "a", "part": {"data": b"x" * mib, "partNumber": 2}},
             error_codes.INVALID_UPLOAD_PAYLOAD),
            ("create", {"name": "x.png", "part": {"data": b"x" * (21 * mib), "type": "image/png"}},
             error_codes.UPLOAD_TOO_LARGE),
        ]
        for method, options, code in cases:
            with self.subTest(code=code), self.assertRaises(CalmLensValidationError) as raised:
                getattr(self.client.assets, method)(options)
            self.assertEqual((raised.exception.code, raised.exception.status), (code, None))
            if code == error_codes.UPLOAD_TOO_LARGE:
                self.assertEqual(raised.exception.details, {"limitBytes": 20 * mib, "source": "plan"})
        self.assertEqual(self.calls, [])
        # A small image may be sent as one final part.
        self.client.assets.create({"name": "x.png", "part": {"data": b"x" * mib, "isFinal": True, "type": "image/png"}})
        self.assertEqual((self.query()["partNumber"], self.query()["isFinal"]), (["1"], ["true"]))

    def test_oversized_one_request_uploads_are_refused_before_sending(self):
        mib = 1024 * 1024
        for mime, limit in [("image/png", 10 * mib), ("video/mp4", 50 * mib), ("application/pdf", 5000 * mib)]:
            size = limit + 1
            # A stream that can't be read again goes in one request; its declared size is refused first.
            content = {"data": Unseekable(b""), "sizeInBytes": size, "type": mime}
            with self.subTest(mime=mime), self.assertRaises(CalmLensValidationError) as raised:
                self.client.assets.create(name="big", content=content)
            self.assertEqual((raised.exception.code, raised.exception.status, raised.exception.details),
                             (error_codes.UPLOAD_TOO_LARGE, None, {"limitBytes": limit, "source": "plan"}))
        self.assertEqual(self.calls, [])
        self.client.assets.create(name="x.png", content={"data": Unseekable(b"x" * 10 * mib), "sizeInBytes": 10 * mib,
                                                          "type": "image/png"})
        self.assertEqual(len(self.calls), 1)

    def test_unknown_option_keys_are_refused_before_sending(self):
        calls = [
            lambda: self.client.text.classify({"text": "hi", "extrenalId": "post-1"}),
            lambda: self.client.assets.retrieve({"assetId": "a", "assetID": "b"}),
            lambda: self.client.assets.create({"name": "a.txt", "content": {"plainText": "a", "type": "text/plain"},
                                               "visiblity": "private"}),
            lambda: self.client.upload_tokens.sign({"uploadPresetId": "preset_1", "external": "x"}),
        ]
        for call in calls:
            with self.assertRaises(CalmLensValidationError) as raised:
                call()
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
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
            self.client.cdn.serve(asset_id="a", init={"headers": {"Range": "bytes=0-1\r\nX: y"}})
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
        lens = {"identifier": "thumb", "name": "Thumb", "type": "image", "active": True}
        self.result = {"lenses": [{"id": "l", **lens}]}
        with ThreadPoolExecutor(4) as pool:
            list(pool.map(lambda _: self.client.ensure_lens(lens), range(8)))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(len(self.client.ensure_lenses({"lenses": [lens, lens]})), 2)
        changed = {**lens, "name": "Thumbnail"}
        self.result = {"code": "server/unavailable"}
        self.status = 503
        with self.assertRaises(CalmLensError):
            self.client.ensure_lens(changed)
        self.status = 200
        self.result = {"lenses": [{"id": "l", **changed}]}
        self.client.ensure_lens(changed)
        # The changed definition replaced the earlier one in the cache, so it is sent again.
        self.result = {"lenses": [{"id": "l", **lens}]}
        self.client.ensure_lens(lens)
        self.assertEqual(len(self.calls), 4)

    def test_a_lens_changed_through_the_lenses_methods_is_sent_again_by_ensure_lens(self):
        lens = {"identifier": "thumb", "name": "Thumb", "type": "image", "active": True}
        for change in ("update", "delete", "create"):
            with self.subTest(change):
                self.calls.clear()
                # A new client, with an empty lens cache.
                client = CalmLensServerClient(api_key="key", project_id="p", transport=self.client.transport)
                self.result = {"lenses": [{"id": "l", **lens}]}
                client.ensure_lens(lens)
                client.ensure_lens(lens)
                self.result = {"id": "l", **lens, "name": "Renamed"}
                if change == "update":
                    client.lenses.update(lens_id="l", name="Renamed")
                elif change == "delete":
                    client.lenses.delete(lens_id="l")
                else:
                    client.lenses.create({**lens, "name": "Renamed"})
                self.result = {"lenses": [{"id": "l", **lens}]}
                client.ensure_lens(lens)
                self.assertEqual([call.get_method() for call in self.calls],
                                 ["PUT", {"update": "PATCH", "delete": "DELETE", "create": "POST"}[change], "PUT"])

    def test_structured_transform_formats_numbers_like_javascript(self):
        options = {"blur": 2.0, "brightness": 0.00001, "contrast": 1e-7, "gamma": 1e21, "saturation": -0.0,
                   "sharpen": 123456789012, "border": {"width": -2.5}}
        url = self.client.cdn.get_asset_url(asset_id="a", resource="rendered", transform=options)
        self.assertTrue(url.endswith("/rendered/blur=2,border.width=-2.5,brightness=0.00001,contrast=1e-7,"
                                     "gamma=1e%2B21,saturation=0,sharpen=123456789012"))
        url = self.client.cdn.get_asset_url(asset_id="a", resource="rendered", transform={
            "background": "#FFAA00", "trim": {"border": {"color": "#ABC"}}, "quality": 80})
        self.assertTrue(url.endswith("/rendered/background=ffaa00,quality=80,trim.border.color=abc"))
        # Keyword arguments are converted to camelCase, but transform option names are CDN names:
        # a snake_case name is sent as written, so it is rejected rather than renamed.
        for bad in (float("nan"), float("inf"), {1: "x"}, {"bad_name": 1}, object()):
            with self.subTest(bad=bad), self.assertRaises(CalmLensError) as raised:
                self.client.cdn.get_asset_url(asset_id="a", resource="rendered", transform={"border": {"width": bad}}
                                              if not isinstance(bad, dict) else {"border": bad})
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        with self.assertRaises(CalmLensError) as raised:
            self.client.cdn.get_asset_url(asset_id="a", resource="rendered", transform={"keep_me": 1})
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        with self.assertRaises(CalmLensError) as raised:
            self.client.cdn.sign_asset_url(asset_id="a", resource="rendered", lens="x", transform=[])
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)

    def test_cdn_urls_and_serve_headers(self):
        url = self.client.cdn.get_asset_url({"assetId": "a/b?", "resource": "rendered", "lens": "my lens"})
        self.assertEqual(url, "https://cdn.calmlens.com/v1/assets/p%20%2F%3F/a%2Fb%3F/rendered/@my%20lens")
        self.assertTrue(self.client.cdn.get_asset_url({"assetId": "a", "resource": "rendered", "transform": "width=20,label=[x]"}).endswith("/rendered/width=20,label=%5Bx%5D"))
        self.assertEqual(self.client.cdn.get_asset_url({"assetId": "a", "resource": "rendered", "lens": "x", "transform": "format=avif"}), "https://cdn.calmlens.com/v1/assets/p%20%2F%3F/a/rendered/@x,format=avif")
        self.result, self.headers = b"0123456789", {"Content-Type": "image/png", "X-Request-Id": "req_cdn"}
        with self.client.cdn.serve({"assetId": "a", "init": {"headers": {"x-api-key": "wrong", "Range": "bytes=0-1"}}}) as response:
            self.assertEqual(self.calls[-1].headers["X-api-key"], "key")
            self.assertEqual(self.calls[-1].headers["Range"], "bytes=0-1")
            self.assertEqual((response.content_type, response.request_id, response.ok), ("image/png", "req_cdn", True))
            self.assertEqual(list(response.iter_bytes(4)), [b"0123", b"4567", b"89"])


INFO = {"id": "asset", "projectId": "p", "type": "image", "availability": "available",
        "content": {"format": "image/png", "width": 1, "height": 1, "durationSeconds": None, "pageCount": None,
                    "rendered": None, "preview": None, "hls": None}}


class AssetInfoTests(ClientTestCase):
    def test_reads_the_info_beneath_the_url_without_the_api_key_keeping_its_viewer_claims(self):
        self.result = INFO
        claims = "%7B%22region%22%3A%22DE%22%7D"
        info = self.client.cdn.get_asset_info(f"https://cdn.example.test/v1/assets/p/sig_ab/?download=1&viewerClaims={claims}#x")
        self.assertEqual(info, INFO)
        request = self.calls[-1]
        self.assertEqual((request.get_method(), request.full_url),
                         ("GET", f"https://cdn.example.test/v1/assets/p/sig_ab/info?viewerClaims={claims}"))
        self.assertEqual(request.headers["Accept"], "application/json")
        self.assertNotIn("X-api-key", request.headers)

    def test_given_viewer_claims_replace_the_urls_and_default_claims_are_left_out(self):
        self.result = INFO
        url = "https://cdn.example.test/v1/assets/p/a?viewerClaims=%7B%22region%22%3A%22DE%22%7D"
        self.client.cdn.get_asset_info(url, viewer_claims={"ageConfirmed": True})
        self.assertEqual(self.query(), {"viewerClaims": ['{"ageConfirmed":true}']})
        self.client.cdn.get_asset_info(url, {"viewerClaims": {"ageConfirmed": False}})
        self.assertEqual(urlsplit(self.calls[-1].full_url).query, "")

    def test_a_refusal_raises_the_cdns_code_and_a_body_that_is_not_info_is_an_invalid_response(self):
        self.result, self.status = {"code": "signed-url/expired", "message": "Expired"}, 403
        with self.assertRaises(CalmLensError) as raised:
            self.client.cdn.get_asset_info("https://cdn.example.test/v1/assets/p/sig_ab")
        self.assertEqual((raised.exception.code, raised.exception.status), (error_codes.SIGNED_URL_EXPIRED, 403))
        self.result, self.status = {**INFO, "availability": None}, 200
        with self.assertRaises(CalmLensError) as raised:
            self.client.cdn.get_asset_info("https://cdn.example.test/v1/assets/p/a")
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_RESPONSE)

    def test_refuses_a_url_that_is_not_absolute_http_and_claims_that_are_not_json_before_sending(self):
        for url in ("/v1/assets/p/a", "file:///etc/passwd", "https://cdn.example.test/v1/assets/p/a?viewerClaims=%7B"):
            with self.subTest(url=url), self.assertRaises(CalmLensValidationError) as raised:
                self.client.cdn.get_asset_info(url)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])


class WaitForDecisionTests(ClientTestCase):
    def test_backs_off_to_two_seconds_and_times_out_at_the_deadline(self):
        self.client._clock = lambda: sum(self.sleeps)
        self.result = {"id": "asset-1", "upload": {"status": "completed"}, "classification": {'status': 'processing', 'moderation': {'status': 'pending'}}}
        with self.assertRaises(CalmLensError) as raised:
            self.client.assets.wait_for_decision({"assetId": "asset-1", "timeout": 20})
        self.assertEqual(raised.exception.code, error_codes.SDK_TIMEOUT)
        self.assertEqual(raised.exception.details,
                         {"assetId": "asset-1", "classificationStatus": "processing", "moderationStatus": "pending"})
        self.assertEqual(self.sleeps, [0.5, 0.75, 1.125, 1.6875] + [2.0] * 7 + [1.9375])
        self.assertEqual(len(self.calls), 13)

    def test_keeps_waiting_while_the_asset_is_queued_or_processing_even_once_a_reviewer_decided_it(self):
        def asset(classification, moderation):
            return ({"id": "asset-1", "upload": {"status": "completed"},
                     "classification": {"status": classification, "moderation": {"status": moderation}}},)
        self.script = [asset("queued", "pending"), asset("processing", "blocked"), asset("completed", "blocked")]
        settled = self.client.assets.wait_for_decision(asset_id="asset-1")
        self.assertEqual((settled["classification"]["status"], settled["classification"]["moderation"]["status"]),
                         ("completed", "blocked"))
        self.assertEqual(len(self.calls), 3)

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


MIB = 1024 * 1024


class AutomaticMultipartTests(ClientTestCase):
    """Content larger than ``part_size_bytes`` is uploaded in parts, each retried on its own."""

    def setUp(self):
        super().setUp()
        self.client = CalmLensServerClient(api_key="key", project_id="p", part_size_bytes=5 * MIB,
                                           transport=self.client.transport)
        self.client._sleep = self.sleeps.append
        self.result = {**ASSET, "id": "a1"}

    def sent(self):
        return [(urlsplit(call.full_url).path, {k: v[0] for k, v in self.query(i).items()
                                                if k in ("partNumber", "isFinal", "sizeInBytes", "totalSizeInBytes",
                                                         "wait")},
                 call.get_header("Idempotency-key"), call.get_header("X-calmlens-upload"))
                for i, call in enumerate(self.calls)]

    def test_content_larger_than_a_part_is_split_into_parts(self):
        data = bytes(range(256)) * (2 * 5 * MIB // 256) + b"end"
        stream = io.BytesIO(b"skip" + data)
        stream.seek(4)  # A file is read from its current position.
        for content in ({"data": data}, {"base64": base64.b64encode(data).decode()}, {"data": stream}):
            with self.subTest(source=next(iter(content))):
                self.calls.clear()
                self.bodies.clear()
                stream.seek(4)
                asset = self.client.assets.classify(name="v.mp4", content={**content, "type": "video/mp4"},
                                                    idempotency_key="K")
                self.assertEqual(asset["id"], "a1")
                part = str(5 * MIB)
                self.assertEqual(self.sent(), [
                    ("/v1/projects/p/assets", {"wait": "true", "partNumber": "1", "isFinal": "false",
                                               "sizeInBytes": part, "totalSizeInBytes": str(len(data))}, "K", "part"),
                    ("/v1/assets/a1/part", {"partNumber": "2", "isFinal": "false", "sizeInBytes": part},
                     "K:part-2", "part"),
                    ("/v1/assets/a1/part", {"partNumber": "3", "isFinal": "true", "sizeInBytes": "3"},
                     "K:part-3", "part"),
                ])
                self.assertEqual(self.calls[0].get_header("Content-type"), "video/mp4")
                self.assertEqual(b"".join(self.bodies), data)

    def test_content_of_one_part_or_from_a_pipe_is_sent_in_one_request(self):
        size = 5 * MIB
        self.client.assets.create(name="v.mp4", content={"data": b"x" * size, "type": "video/mp4"})
        self.client.assets.create(name="v.mp4", content={"data": Unseekable(b"x" * (size + 1)),
                                                         "sizeInBytes": size + 1, "type": "video/mp4"})
        self.client.assets.create(name="t.txt", content={"plainText": "x" * (size + 1), "type": "text/plain"})
        self.assertEqual([call.get_header("X-calmlens-upload") for call in self.calls], ["content"] * 3)

    def test_a_dropped_part_is_retried_with_the_same_key_and_bytes(self):
        data = b"a" * (5 * MIB) + b"b" * 10
        self.script = [(self.result,), ConnectionResetError("reset"), (self.result,)]
        self.client.assets.create(name="v.mp4", content={"data": io.BytesIO(data), "type": "video/mp4"},
                                  idempotency_key="K")
        self.assertEqual([sent[2] for sent in self.sent()], ["K", "K:part-2", "K:part-2"])
        self.assertEqual(self.bodies[1:], [b"b" * 10, b"b" * 10])
        self.assertEqual(len(self.sleeps), 1)

    def test_parts_the_api_already_has_are_skipped(self):
        data = b"x" * (3 * 5 * MIB + 1)
        wrong = {"code": error_codes.INVALID_UPLOAD_PART_NUMBER, "message": "Expected part 4",
                 "details": {"expectedPartNumber": 4, "receivedPartNumber": 2}}
        self.script = [(self.result,), (wrong, 400), (self.result,)]
        self.client.assets.create(name="v.mp4", content={"data": data, "type": "video/mp4"}, idempotency_key="K")
        self.assertEqual([sent[1]["partNumber"] for sent in self.sent()], ["1", "2", "4"])
        self.assertEqual(self.sent()[-1][1]["isFinal"], "true")

    def test_an_expected_part_outside_the_upload_is_raised(self):
        wrong = {"code": error_codes.INVALID_UPLOAD_PART_NUMBER, "details": {"expectedPartNumber": 3}}
        self.script = [(self.result,), (wrong, 400)]
        with self.assertRaises(CalmLensError) as raised:
            self.client.assets.create(name="v.mp4", content={"data": b"x" * (5 * MIB + 1), "type": "video/mp4"})
        self.assertEqual((raised.exception.code, len(self.calls)), (error_codes.INVALID_UPLOAD_PART_NUMBER, 2))

    def test_a_completed_upload_is_read_back_when_the_final_part_finds_it_closed(self):
        completed = {**self.result, "upload": {"status": "completed"}, "name": "done"}
        self.script = [({**self.result, "upload": {"status": "uploading"}},),
                       ({"code": error_codes.UPLOAD_NOT_OPEN}, 409), (completed,)]
        asset = self.client.assets.create(name="v.mp4", content={"data": b"x" * (5 * MIB + 1), "type": "video/mp4"})
        self.assertEqual(asset, completed)
        self.assertEqual((self.calls[-1].get_method(), urlsplit(self.calls[-1].full_url).path),
                         ("GET", "/v1/assets/a1"))

    def test_part_size_must_be_from_5_to_64_mib(self):
        for value in (5 * MIB - 1, 64 * MIB + 1, 0, True, 8.0 * MIB, "8388608"):
            with self.subTest(value=value), self.assertRaises(CalmLensValidationError) as raised:
                CalmLensServerClient(api_key="key", project_id="p", part_size_bytes=value)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_CONFIG)
        self.assertEqual(CalmLensServerClient(api_key="key", project_id="p").part_size_bytes, 8 * MIB)
        self.assertEqual(CalmLensServerClient(api_key="key", project_id="p",
                                              part_size_bytes=64 * MIB).part_size_bytes, 64 * MIB)

    def test_split_uploads_refuse_keys_without_room_for_part_suffixes(self):
        content = {"data": b"x" * (5 * MIB + 1), "type": "video/mp4"}
        with self.assertRaises(CalmLensValidationError) as raised:
            self.client.assets.create(name="v.mp4", content=content, idempotency_key="k" * 241)
        self.assertEqual((raised.exception.code, self.calls), (error_codes.SDK_INVALID_ARGUMENT, []))
        self.client.assets.create(name="v.mp4", content=content, idempotency_key="k" * 240)
        self.assertEqual(self.calls[-1].get_header("Idempotency-key"), "k" * 240 + ":part-2")

    def test_images_over_20_mib_are_refused_before_sending(self):
        with self.assertRaises(CalmLensValidationError) as raised:
            self.client.assets.create(name="x.png", content={"data": b"x" * (20 * MIB + 1), "type": "image/png"})
        self.assertEqual((raised.exception.code, raised.exception.details, self.calls),
                         (error_codes.UPLOAD_TOO_LARGE, {"limitBytes": 20 * MIB, "source": "plan"}, []))


if __name__ == "__main__":
    unittest.main()
