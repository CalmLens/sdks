import base64
import io
import json
import os
import asyncio
import unittest
from typing import Any
import unittest.mock
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlsplit

import calmlens
from calmlens import (CalmLensServerClient, CalmLensError, CalmLensTimeoutError, CalmLensInvalidArgumentError,
                      __version__, error_codes)
from upload_form import read_upload_form
from wire import python_options as _python_options, to_json

#: The smallest response the client accepts as an asset.
ASSET = {"id": "asset", "upload": {"status": "completed"},
         "classification": {"status": "processing", "moderation": {"decision": None}}}


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
            data = request.body
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
        return parse_qs(urlsplit(self.calls[index].url).query)

    def json_body(self, index=-1):
        self.assertEqual(self.calls[index].get_header("Content-type"), "application/json")
        return json.loads(self.bodies[index])

    def form(self, index=-1):
        """The upload form request ``index`` sent: its options, file type and file bytes."""
        return read_upload_form(self.bodies[index], self.calls[index].get_header("Content-type"))


class ClientTests(ClientTestCase):
    def test_keyword_arguments_match_options_dicts(self):
        self.client.assets.classify(name="n", external_id="e1", processing_options={"retain_content": False},
                                    metadata=[{"id": "snake_key", "value": 1}],
                                    content={"plain_text": "hi", "type": "text/plain"})
        self.assertEqual(self.json_body(), {"name": "n", "externalId": "e1",
                                            "processingOptions": {"retainContent": False},
                                            "metadata": [{"id": "snake_key", "value": 1}],
                                            "content": {"plainText": "hi", "type": "text/plain"}})
        self.client.text.classify(text="hi", tags=["catalogue", "backpacks"])
        self.assertEqual(self.json_body()["tags"], ["catalogue", "backpacks"])
        self.client.assets.move(asset_id="a", folder_id=None)
        self.assertEqual(json.loads(self.calls[-1].body), {"folderId": None})

    def test_required_options_are_required_keyword_arguments(self):
        # Python itself refuses a call without an option the API requires.
        calls: list[Any] = [lambda: self.client.assets.retrieve(), lambda: self.client.assets.delete(),
                            lambda: self.client.assets.move(asset_id="a"), lambda: self.client.folders.create(),
                            lambda: self.client.assets.search(page_size=2)]
        for call in calls:
            with self.assertRaises(TypeError):
                call()
        self.assertEqual(self.calls, [])

    def test_invalid_arguments_use_the_invalid_argument_code(self):
        for call in (lambda: self.client.assets.retrieve(asset_id=""),
                     lambda: self.client.cdn.get_asset_url(asset_id="a", resource="raw")):
            with self.assertRaises(CalmLensInvalidArgumentError) as raised:
                call()
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])

    def test_payload_forms_and_url(self):
        self.client.assets.create(name='x', content={'type': 'text/plain', 'plain_text': 'abc'})
        self.assertEqual(self.json_body(), {"name": "x", "content": {"plainText": "abc", "type": "text/plain"}})
        self.assertEqual(self.query(), {"wait": ["false"]})
        self.assertIsNone(self.calls[-1].get_header("X-calmlens-upload"))
        for payload in ({"base64": "data:text/plain;base64,YWJj"}, {"data": b"abc"},
                        {"data": bytearray(b"abc")}, {"data": memoryview(b"abc")}):
            self.client.assets.create(name='x', content={'type': 'text/plain', **payload})
            self.assertEqual(self.form(), {"options": {"name": "x"}, "type": "text/plain", "bytes": b"abc"})
            self.assertEqual(self.query(), {"wait": ["false"], "contentType": ["text/plain"], "sizeInBytes": ["3"]})
            self.assertEqual(self.calls[-1].get_header("Content-length"), str(len(self.bodies[-1])))
        self.client.assets.classify(name='site', url='https://example.com', metadata=[{'id': 'a', 'value': 1}], tags=['landing'])
        sent = json.loads(self.calls[-1].body)
        self.assertEqual((sent["metadata"], sent["tags"]), ([{"id": "a", "value": 1}], ["landing"]))
        self.assertTrue(urlsplit(self.calls[-1].url).path.endswith("/assets"))

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
            with self.subTest(types=types), self.assertRaises(CalmLensInvalidArgumentError) as raised:
                self.client.events.list(types=types)  # type: ignore[arg-type]
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])

    def test_moderation_context_keeps_an_over_long_newest_post_and_needs_items(self):
        newest = "🌍" * 2001
        self.client.text.classify(text="reply", author_id="user-9",
                                  context={"items": [{"text": "older", "author_id": "user-1"}, {"text": newest}]})
        sent = self.json_body()
        self.assertEqual((sent["authorId"], sent["context"]), ("user-9", {"items": [{"text": newest}]}))
        for context in ({}, {"items": "post"}, None):
            with self.subTest(context=context), self.assertRaises(CalmLensInvalidArgumentError) as raised:
                self.client.text.classify(text='reply', context=context)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(len(self.calls), 1)

    def test_invalid_payload_values_are_rejected_before_sending(self):
        for payload in ({"data": 5}, {"data": "abc"}, {"data": [97, 98]}, {"uint8Array": [97]}, {"buffer": b"a"},
                        {"data": io.StringIO("text mode")}):
            with self.subTest(payload=payload), self.assertRaises(CalmLensInvalidArgumentError) as raised:
                self.client.assets.create(name='x', content={'type': 'text/plain', **payload})
            self.assertEqual(raised.exception.code, error_codes.INVALID_UPLOAD_PAYLOAD)
        self.assertEqual(self.calls, [])

    def test_seekable_streams_are_sized_and_streamed(self):
        stream = io.BytesIO(b"skip:streamed")
        stream.seek(5)
        self.client.assets.create(name="x", content={"data": stream, "type": "text/plain"})
        self.assertEqual(self.query()["sizeInBytes"], ["8"])
        # The form is read from the file as it is sent, not buffered first.
        self.assertTrue(hasattr(self.calls[-1].body, "read"))
        self.assertEqual(self.calls[-1].get_header("Content-length"), str(len(self.bodies[-1])))
        self.assertEqual(self.form()["bytes"], b"streamed")
        # A longer stream sends exactly the declared size.
        self.client.assets.create(name="x", content={"data": Unseekable(b"abcdef"), "sizeInBytes": 3,
                                                     "type": "text/plain"})
        self.assertEqual(self.form()["bytes"], b"abc")

    def test_stream_shorter_than_declared_size_fails_clearly(self):
        with self.assertRaises(CalmLensInvalidArgumentError) as raised:
            self.client.assets.create(name="x", content={"data": io.BytesIO(b"ab"), "sizeInBytes": 3,
                                                         "type": "text/plain"})
        self.assertEqual(raised.exception.code, error_codes.INVALID_UPLOAD_PAYLOAD)

        def reading_transport(request, timeout):
            request.body.read()
            return Response(self.result)
        client = CalmLensServerClient(api_key="key", project_id="p", transport=reading_transport)
        with self.assertRaises(CalmLensInvalidArgumentError) as raised:
            client.assets.create(name="x", content={"data": Unseekable(b"ab"), "sizeInBytes": 3, "type": "text/plain"})
        self.assertEqual(raised.exception.code, error_codes.INVALID_UPLOAD_PAYLOAD)

    def test_multipart_sends_total_size_and_no_part_wait(self):
        size = 5 * 1024 * 1024
        self.client.assets.create(name='x.png', total_size_in_bytes=2 * size, part={'type': 'image/png', 'data': b'x' * size})
        self.assertEqual((self.query()["partNumber"], self.query()["isFinal"]), (["1"], ["false"]))
        self.assertEqual((self.query()["wait"], self.query()["totalSizeInBytes"]), (["false"], [str(2 * size)]))
        self.client.assets.upload_part(asset_id='a', part={'data': io.BytesIO(b'x' * size), 'is_final': True, 'part_number': 2})
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
            with self.subTest(code=code), self.assertRaises(CalmLensInvalidArgumentError) as raised:
                getattr(self.client.assets, method)(**_python_options(options))
            self.assertEqual((raised.exception.code, raised.exception.status), (code, None))
            if code == error_codes.UPLOAD_TOO_LARGE:
                self.assertEqual(raised.exception.details, {"limitBytes": 20 * mib, "source": "plan"})
        self.assertEqual(self.calls, [])
        # A small image may be sent as one final part.
        self.client.assets.create(name='x.png', part={'data': b'x' * mib, 'is_final': True, 'type': 'image/png'})
        self.assertEqual((self.query()["partNumber"], self.query()["isFinal"]), (["1"], ["true"]))

    def test_oversized_one_request_uploads_are_refused_before_sending(self):
        mib = 1024 * 1024
        for mime, limit in [("image/png", 10 * mib), ("video/mp4", 50 * mib), ("application/pdf", 5000 * mib)]:
            size = limit + 1
            # A stream that can't be read again goes in one request; its declared size is refused first.
            content = {"data": Unseekable(b""), "sizeInBytes": size, "type": mime}
            with self.subTest(mime=mime), self.assertRaises(CalmLensInvalidArgumentError) as raised:
                self.client.assets.create(name="big", content=content)
            self.assertEqual((raised.exception.code, raised.exception.status, raised.exception.details),
                             (error_codes.UPLOAD_TOO_LARGE, None, {"limitBytes": limit, "source": "plan"}))
        self.assertEqual(self.calls, [])
        self.client.assets.create(name="x.png", content={"data": Unseekable(b"x" * 10 * mib), "sizeInBytes": 10 * mib,
                                                          "type": "image/png"})
        self.assertEqual(len(self.calls), 1)

    def test_unknown_option_keys_are_refused_before_sending(self):
        calls = [
            lambda: self.client.text.classify(text='hi', extrenal_id='post-1'),
            lambda: self.client.assets.retrieve(asset_id='a', asset_i_d='b'),
            lambda: self.client.assets.create(name='a.txt', content={'plain_text': 'a', 'type': 'text/plain'}, visiblity='private'),
            lambda: self.client.upload_tokens.sign(upload_preset_id='preset_1', external='x'),
        ]
        for call in calls:
            # A misspelt option is an unknown keyword argument, which Python refuses itself.
            with self.assertRaises(TypeError):
                call()
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
            with self.subTest(options=list(options)), self.assertRaises(CalmLensInvalidArgumentError):
                self.client.assets.create(**_python_options(options))
        self.assertFalse(self.calls)

    def test_header_injection_is_rejected_before_sending(self):
        with self.assertRaises(CalmLensInvalidArgumentError) as raised:
            self.client.assets.create(name="x", content={"plainText": "a", "type": "text/plain"},
                                      options={"idempotency_key": "k\r\nX-Evil: 1"})
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        with self.assertRaises(CalmLensInvalidArgumentError):
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
            with self.assertRaises(CalmLensInvalidArgumentError) as raised:
                CalmLensServerClient()
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_CONFIG)

    def test_an_api_key_that_cant_be_a_header_value_is_refused_and_any_other_is_left_for_the_api(self):
        for api_key in ("key\n", "k\u00e9y", "a\tb", "\x7f"):
            with self.subTest(api_key=api_key), self.assertRaises(CalmLensInvalidArgumentError) as raised:
                CalmLensServerClient(api_key=api_key, project_id="p", transport=lambda r, t: None)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_CONFIG)
        self.assertEqual(CalmLensServerClient(api_key="!~", project_id="p", transport=lambda r, t: None).api_key, "!~")

    def test_a_lens_without_active_shares_its_cached_definition_with_one_that_is_active(self):
        lens = {"identifier": "thumb", "name": "Thumb", "type": "image"}
        self.result = {"lenses": [{"id": "l", **lens, "active": True}]}
        self.client.ensure_lens(**_python_options(lens))
        self.client.ensure_lens(**_python_options({**lens, 'active': True}))
        self.assertEqual(len(self.calls), 1)
        self.result = {"lenses": [{"id": "l", **lens, "active": False}]}
        self.client.ensure_lens(**_python_options({**lens, 'active': False}))
        self.assertEqual(len(self.calls), 2)

    def test_lens_cache_concurrency_invalidation_and_failure(self):
        lens = {"identifier": "thumb", "name": "Thumb", "type": "image", "active": True}
        self.result = {"lenses": [{"id": "l", **lens}]}
        with ThreadPoolExecutor(4) as pool:
            list(pool.map(lambda _: self.client.ensure_lens(**_python_options(lens)), range(8)))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(len(self.client.ensure_lenses(lenses=[lens, lens])), 2)
        changed = {**lens, "name": "Thumbnail"}
        self.result = {"code": "server/unavailable"}
        self.status = 503
        with self.assertRaises(CalmLensError):
            self.client.ensure_lens(**_python_options(changed))
        self.status = 200
        self.result = {"lenses": [{"id": "l", **changed}]}
        self.client.ensure_lens(**_python_options(changed))
        # The changed definition replaced the earlier one in the cache, so it is sent again.
        self.result = {"lenses": [{"id": "l", **lens}]}
        self.client.ensure_lens(**_python_options(lens))
        self.assertEqual(len(self.calls), 4)

    def test_a_lens_changed_through_the_lenses_methods_is_sent_again_by_ensure_lens(self):
        lens = {"identifier": "thumb", "name": "Thumb", "type": "image", "active": True}
        for change in ("update", "delete", "create"):
            with self.subTest(change):
                self.calls.clear()
                # A new client, with an empty lens cache.
                client = CalmLensServerClient(api_key="key", project_id="p", transport=self.client.transport)
                self.result = {"lenses": [{"id": "l", **lens}]}
                client.ensure_lens(**_python_options(lens))
                client.ensure_lens(**_python_options(lens))
                self.result = {"id": "l", **lens, "name": "Renamed"}
                if change == "update":
                    client.lenses.update(lens_id="l", name="Renamed")
                elif change == "delete":
                    client.lenses.delete(lens_id="l")
                else:
                    client.lenses.create(**_python_options({**lens, 'name': 'Renamed'}))
                self.result = {"lenses": [{"id": "l", **lens}]}
                client.ensure_lens(**_python_options(lens))
                self.assertEqual([call.method for call in self.calls],
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
        url = self.client.cdn.get_asset_url(asset_id='a/b?', resource='rendered', lens='my lens')
        self.assertEqual(url, "https://cdn.calmlens.com/v1/assets/p%20%2F%3F/a%2Fb%3F/rendered/@my%20lens")
        self.assertTrue(self.client.cdn.get_asset_url(asset_id='a', resource='rendered', transform='width=20,label=[x]').endswith("/rendered/width=20,label=%5Bx%5D"))
        self.assertEqual(self.client.cdn.get_asset_url(asset_id='a', resource='rendered', lens='x', transform='format=avif'), "https://cdn.calmlens.com/v1/assets/p%20%2F%3F/a/rendered/@x,format=avif")
        self.result, self.headers = b"0123456789", {
            "Content-Type": "image/png", "X-Request-Id": "req_cdn",
            "X-CalmLens-Asset-Info": 'width=80, description="sample, width=42", height=60',
        }
        with self.client.cdn.serve(asset_id='a', init={'headers': {'x-api-key': 'wrong', 'range': 'bytes=0-1'}}) as response:
            self.assertEqual(self.calls[-1].get_header("X-api-key"), "key")
            self.assertEqual(self.calls[-1].get_header("Range"), "bytes=0-1")
            self.assertEqual((response.content_type, response.request_id, response.ok), ("image/png", "req_cdn", True))
            self.assertEqual(response.get_asset_info(), calmlens.ServedAssetInfo(80, 60))
            self.assertEqual(list(response.iter_bytes(4)), [b"0123", b"4567", b"89"])

        async def check_async():
            client = calmlens.AsyncCalmLensServerClient.from_client(self.client)
            async with await client.cdn.serve(asset_id="a") as response:
                self.assertEqual(response.get_asset_info(), calmlens.ServedAssetInfo(80, 60))
                self.assertEqual(await response.read(), b"0123456789")

        asyncio.run(check_async())


INFO = {"id": "asset", "projectId": "p", "type": "image", "availability": "available",
        "content": {"format": "image/png", "width": 1, "height": 1, "durationSeconds": None, "pageCount": None,
                    "rendered": None, "preview": None, "hls": None}}


class AssetInfoTests(ClientTestCase):
    def test_reads_the_info_beneath_the_url_without_the_api_key_keeping_its_viewer_claims(self):
        self.result = INFO
        claims = "%7B%22region%22%3A%22DE%22%7D"
        info = self.client.cdn.get_asset_info(f"https://cdn.example.test/v1/assets/p/sig_ab/?download=1&viewerClaims={claims}#x")
        self.assertEqual(to_json(info), INFO)
        request = self.calls[-1]
        self.assertEqual((request.method, request.url),
                         ("GET", f"https://cdn.example.test/v1/assets/p/sig_ab/info?viewerClaims={claims}"))
        self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertIsNone(request.get_header("X-api-key"))

    def test_given_viewer_claims_replace_the_urls_and_default_claims_are_left_out(self):
        self.result = INFO
        url = "https://cdn.example.test/v1/assets/p/a?viewerClaims=%7B%22region%22%3A%22DE%22%7D"
        self.client.cdn.get_asset_info(url, viewer_claims={'age_confirmed': True})
        self.assertEqual(self.query(), {"viewerClaims": ['{"ageConfirmed":true}']})
        self.client.cdn.get_asset_info(url, viewer_claims={"age_confirmed": False})
        self.assertEqual(urlsplit(self.calls[-1].url).query, "")

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
            with self.subTest(url=url), self.assertRaises(CalmLensInvalidArgumentError) as raised:
                self.client.cdn.get_asset_info(url)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])


class WaitForDecisionTests(ClientTestCase):
    def test_backs_off_to_two_seconds_and_times_out_at_the_deadline(self):
        self.client._clock = lambda: sum(self.sleeps)
        self.result = {"id": "asset-1", "upload": {"status": "completed"}, "classification": {'status': 'processing', 'moderation': {'decision': None}}}
        # The deadline raises the same class as a request timeout, so one `except` catches both.
        with self.assertRaises(CalmLensTimeoutError) as raised:
            self.client.assets.wait_for_decision(asset_id='asset-1', timeout=20)
        self.assertEqual(raised.exception.code, error_codes.SDK_TIMEOUT)
        self.assertEqual(raised.exception.details,
                         {"assetId": "asset-1", "classificationStatus": "processing", "moderationDecision": None})
        self.assertEqual(self.sleeps, [0.5, 0.75, 1.125, 1.6875] + [2.0] * 7 + [1.9375])
        self.assertEqual(len(self.calls), 12)

    def test_keeps_waiting_while_the_asset_is_queued_or_processing_even_once_a_reviewer_decided_it(self):
        def asset(classification, moderation):
            return ({"id": "asset-1", "upload": {"status": "completed"},
                     "classification": {"status": classification, "moderation": {"decision": moderation}}},)
        self.script = [asset("queued", "pending"), asset("processing", "blocked"), asset("completed", "blocked")]
        settled = self.client.assets.wait_for_decision(asset_id="asset-1")
        self.assertEqual((settled["classification"]["status"], settled["classification"]["moderation"]["decision"]),
                         ("completed", "blocked"))
        self.assertEqual(len(self.calls), 3)

    def test_invalid_arguments_are_rejected_before_sending(self):
        for options in ({}, {"assetId": "a", "timeout": -1}, {"assetId": "a", "timeout": float("nan")},
                        {"assetId": "a", "timeout": "60"}):
            with self.subTest(options=options), self.assertRaises(CalmLensInvalidArgumentError) as raised:
                self.client.assets.wait_for_decision(**_python_options(options))
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])


class RetryTests(ClientTestCase):
    def test_uploads_are_retried_with_the_same_idempotency_key(self):
        in_progress = ({"code": error_codes.IDEMPOTENT_REQUEST_IN_PROGRESS}, 409, {"Retry-After": "1"})
        self.script = [in_progress, TimeoutError("slow"), (ASSET,)]
        stream = io.BytesIO(b"hello")
        self.client.assets.create(name="x", content={"data": stream, "type": "text/plain"})
        keys = {call.get_header("Idempotency-key") for call in self.calls}
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(len(keys), 1)
        self.assertEqual([self.form(index)["bytes"] for index in range(3)], [b"hello"] * 3)
        self.client.assets.create(name="x", content={"plainText": "a", "type": "text/plain"}, options={"idempotency_key": "mine"})
        self.assertEqual(self.calls[-1].get_header("Idempotency-key"), "mine")
        self.assertNotIn(self.calls[-1].get_header("Idempotency-key"), keys)

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
        return [(urlsplit(call.url).path, {k: v[0] for k, v in self.query(i).items()
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
                                                    options={"idempotency_key": "K"})
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
                first = self.form(0)
                self.assertEqual((first["options"], first["type"]), ({"name": "v.mp4"}, "video/mp4"))
                self.assertEqual(first["bytes"] + b"".join(self.bodies[1:]), data)

    def test_content_of_one_part_or_from_a_pipe_is_sent_in_one_request(self):
        size = 5 * MIB
        self.client.assets.create(name="v.mp4", content={"data": b"x" * size, "type": "video/mp4"})
        self.client.assets.create(name="v.mp4", content={"data": Unseekable(b"x" * (size + 1)),
                                                         "sizeInBytes": size + 1, "type": "video/mp4"})
        self.client.assets.create(name="t.txt", content={"plainText": "x" * (size + 1), "type": "text/plain"})
        # Text is one JSON request, whatever its size.
        self.assertEqual([call.get_header("X-calmlens-upload") for call in self.calls], ["content", "content", None])
        self.assertEqual(self.json_body()["content"]["plainText"], "x" * (size + 1))

    def test_a_dropped_part_is_retried_with_the_same_key_and_bytes(self):
        data = b"a" * (5 * MIB) + b"b" * 10
        self.script = [(self.result,), ConnectionResetError("reset"), (self.result,)]
        self.client.assets.create(name="v.mp4", content={"data": io.BytesIO(data), "type": "video/mp4"},
                                  options={"idempotency_key": "K"})
        self.assertEqual([sent[2] for sent in self.sent()], ["K", "K:part-2", "K:part-2"])
        self.assertEqual(self.bodies[1:], [b"b" * 10, b"b" * 10])
        self.assertEqual(len(self.sleeps), 1)

    def test_parts_the_api_already_has_are_skipped(self):
        data = b"x" * (3 * 5 * MIB + 1)
        wrong = {"code": error_codes.INVALID_UPLOAD_PART_NUMBER, "message": "Expected part 4",
                 "details": {"expectedPartNumber": 4, "receivedPartNumber": 2}}
        self.script = [(self.result,), (wrong, 400), (self.result,)]
        self.client.assets.create(name="v.mp4", content={"data": data, "type": "video/mp4"}, options={"idempotency_key": "K"})
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
        self.assertEqual(to_json(asset), completed)
        self.assertEqual((self.calls[-1].method, urlsplit(self.calls[-1].url).path),
                         ("GET", "/v1/assets/a1"))

    def test_part_size_must_be_from_5_to_64_mib(self):
        for value in (5 * MIB - 1, 64 * MIB + 1, 0, True, 8.0 * MIB, "8388608"):
            with self.subTest(value=value), self.assertRaises(CalmLensInvalidArgumentError) as raised:
                CalmLensServerClient(api_key="key", project_id="p", part_size_bytes=value)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_CONFIG)
        self.assertEqual(CalmLensServerClient(api_key="key", project_id="p").part_size_bytes, 8 * MIB)
        self.assertEqual(CalmLensServerClient(api_key="key", project_id="p",
                                              part_size_bytes=64 * MIB).part_size_bytes, 64 * MIB)

    def test_split_uploads_refuse_keys_without_room_for_part_suffixes(self):
        content = {"data": b"x" * (5 * MIB + 1), "type": "video/mp4"}
        with self.assertRaises(CalmLensInvalidArgumentError) as raised:
            self.client.assets.create(name="v.mp4", content=content, options={"idempotency_key": "k" * 241})
        self.assertEqual((raised.exception.code, self.calls), (error_codes.SDK_INVALID_ARGUMENT, []))
        self.client.assets.create(name="v.mp4", content=content, options={"idempotency_key": "k" * 240})
        self.assertEqual(self.calls[-1].get_header("Idempotency-key"), "k" * 240 + ":part-2")

    def test_images_over_20_mib_are_refused_before_sending(self):
        with self.assertRaises(CalmLensInvalidArgumentError) as raised:
            self.client.assets.create(name="x.png", content={"data": b"x" * (20 * MIB + 1), "type": "image/png"})
        self.assertEqual((raised.exception.code, raised.exception.details, self.calls),
                         (error_codes.UPLOAD_TOO_LARGE, {"limitBytes": 20 * MIB, "source": "plan"}, []))


if __name__ == "__main__":
    unittest.main()


class ResultObjectTests(ClientTestCase):
    def test_results_read_snake_case_attributes_and_keep_the_api_json(self):
        self.result = {**ASSET, "parentId": None, "newField": {"innerValue": 1}}
        asset = self.client.assets.retrieve(asset_id="asset")
        self.assertEqual(asset.classification.status, "processing")
        self.assertIsNone(asset.parent_id)
        self.assertIn("parentId", asset)
        # A declared field the API left out reads as None, but isn't in the object.
        self.assertIsNone(asset.external_id)
        self.assertNotIn("externalId", asset)
        # A field this SDK version doesn't declare stays readable, by either name.
        self.assertEqual(asset.new_field.inner_value, 1)
        self.assertEqual(asset["newField"]["innerValue"], 1)
        self.assertEqual(asset.to_dict(), self.result)
        with self.assertRaises(AttributeError):
            setattr(asset, "id", "other")
        with self.assertRaises(AttributeError):
            getattr(asset, "missing_field")

    def test_union_values_become_the_variant_their_tag_names(self):
        from calmlens.types import EvaluatedCategoryResult, NotEvaluatedCategoryResult
        categories = {"sexual": {"status": "evaluated", "likelihood": "unlikely", "score": 0.1},
                      "violence": {"status": "not-evaluated", "reason": "unavailable"}}
        moderation = {"decision": "allowed", "categories": None, "raw": {"categories": categories, "hashMatches": []}}
        self.result = {**ASSET, "classification": {"status": "completed", "moderation": moderation}}
        raw = self.client.assets.retrieve(asset_id="asset").classification.moderation.raw
        assert raw is not None
        self.assertIsInstance(raw.categories["sexual"], EvaluatedCategoryResult)
        self.assertIsInstance(raw.categories["violence"], NotEvaluatedCategoryResult)

    def test_every_result_has_the_response_it_came_from(self):
        self.headers = {"X-Request-Id": "req_1"}
        asset = self.client.assets.retrieve(asset_id="asset")
        self.assertEqual((asset.last_response.status, asset.last_response.request_id), (200, "req_1"))
        self.assertIsNone(asset.classification.last_response)


class ListObjectTests(ClientTestCase):
    def test_a_page_iterates_its_items_and_auto_pages_the_rest(self):
        page = {"items": [{**ASSET, "id": "a1"}], "hasMore": True, "nextCursor": "c2"}
        self.script = [(page,), ({"items": [{**ASSET, "id": "a2"}], "hasMore": False, "nextCursor": None},)]
        first = self.client.assets.list(page_size=1, sort="createdAt")
        self.assertEqual(([asset.id for asset in first], len(first), first.next_cursor), (["a1"], 1, "c2"))
        self.assertEqual([asset.id for asset in first.auto_paging_iter()], ["a1", "a2"])
        # The next page keeps the first one's filters, with its cursor.
        self.assertEqual(self.query(), {"pageSize": ["1"], "sort": ["createdAt"], "cursor": ["c2"]})


class RequestOptionsTests(ClientTestCase):
    def test_per_call_options_reach_every_request_the_call_sends(self):
        self.client.assets.update(asset_id="a", name="n", options={
            "headers": {"X-Trace": "t1"}, "extra_query": {"preview": True}, "extra_body": {"future": 1},
            "idempotency_key": "key-1", "timeout": 7})
        self.assertEqual(self.calls[-1].get_header("X-Trace"), "t1")
        self.assertEqual(self.calls[-1].get_header("Idempotency-Key"), "key-1")
        self.assertEqual(self.query(), {"preview": ["true"]})
        self.assertEqual(self.json_body(), {"name": "n", "future": 1})

    def test_per_call_retries_and_the_api_key_cannot_be_replaced(self):
        self.script = [({"code": "server/internal-error"}, 500), ({"code": "server/internal-error"}, 500), (ASSET,)]
        with self.assertRaises(CalmLensError):
            self.client.assets.retrieve(asset_id="a", options={"max_retries": 0, "headers": {"X-Api-Key": "other"}})
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[-1].get_header("X-Api-Key"), "key")

    def test_unknown_request_options_are_refused_before_sending(self):
        with self.assertRaises(CalmLensInvalidArgumentError) as raised:
            self.client.assets.retrieve(asset_id="a", options={"time_out": 5})  # type: ignore[typeddict-unknown-key]
        self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_ARGUMENT)
        self.assertEqual(self.calls, [])

    def test_an_iterator_sends_its_later_pages_with_its_options(self):
        page = {"items": [{**ASSET, "id": "a1"}], "hasMore": True, "nextCursor": "c2"}
        self.script = [(page,), ({"items": [], "hasMore": False, "nextCursor": None},)]
        list(self.client.assets.iter(options={"headers": {"X-Trace": "t2"}}))
        self.assertEqual([call.get_header("X-Trace") for call in self.calls], ["t2", "t2"])


class RawRequestTests(ClientTestCase):
    def test_request_reuses_the_key_retries_and_errors(self):
        self.result = {"futureField": 1}
        result = self.client.request("GET", "/projects/p/future", query={"a": 1})
        self.assertEqual((self.calls[-1].method, urlsplit(self.calls[-1].url).path, self.query()),
                         ("GET", "/v1/projects/p/future", {"a": ["1"]}))
        self.assertEqual((result.future_field, result.last_response.status), (1, 200))
        self.assertEqual(self.calls[-1].get_header("X-Api-Key"), "key")
        self.result, self.status = {"code": "asset/not-found", "message": "x"}, 404
        with self.assertRaises(calmlens.CalmLensNotFoundError):
            self.client.request("POST", "/assets/a/future", body={"x": 1})
        with self.assertRaises(CalmLensInvalidArgumentError):
            self.client.request("GET", "https://elsewhere.test/x")


class ClientSetupTests(unittest.TestCase):
    def test_environment_defaults_and_app_info(self):
        environment = {"CALMLENS_API_KEY": "env-key", "CALMLENS_PROJECT_ID": "env-project",
                       "CALMLENS_BASE_URL": "https://api.example.test/v1"}
        with unittest.mock.patch.dict(os.environ, environment):
            client = CalmLensServerClient(app_info={"name": "shop", "version": "2.1", "url": "https://shop.test"})
        self.assertEqual((client.api_key, client.project_id, client.base_url),
                         ("env-key", "env-project", "https://api.example.test/v1"))
        self.assertTrue(client.user_agent.endswith(" shop/2.1 (https://shop.test)"))
        with self.assertRaises(calmlens.CalmLensConfigurationError):
            CalmLensServerClient(api_key="k", project_id="p", app_info={"version": "1"})  # type: ignore[typeddict-item]

    def test_every_attempt_reaches_the_hook_and_the_log_without_secrets(self):
        attempts = []
        script = [Response({"code": "server/internal-error"}, 503, {"x-request-id": "req-a"}),
                  Response(ASSET, 200, {"x-request-id": "req-b"})]
        client = CalmLensServerClient(api_key="secret-key", project_id="p", on_attempt=attempts.append,
                                      transport=lambda request, timeout: script.pop(0))
        client._sleep = lambda delay: None
        with self.assertLogs("calmlens", "DEBUG") as logs:
            client.assets.retrieve(asset_id="a")
        self.assertEqual([(a.operation, a.method, a.path, a.attempt, a.status, a.request_id) for a in attempts],
                         [("assets.retrieve", "GET", "/v1/assets/a", 1, 503, "req-a"),
                          ("assets.retrieve", "GET", "/v1/assets/a", 2, 200, "req-b")])
        self.assertIsNotNone(attempts[0].delay)
        self.assertIsNone(attempts[1].delay)
        self.assertEqual(len(logs.records), 2)
        self.assertFalse(any("secret-key" in record.getMessage() for record in logs.records))


class ErrorKindTests(ClientTestCase):
    def test_api_errors_are_their_status_kind_and_keep_the_raw_body(self):
        self.result, self.status = b"<html>Bad gateway</html>", 502
        with self.assertRaises(calmlens.CalmLensServerError) as raised:
            self.client.assets.retrieve(asset_id="a", options={"max_retries": 0})
        self.assertIsInstance(raised.exception, calmlens.CalmLensAPIError)
        self.assertEqual(raised.exception.body, "<html>Bad gateway</html>")
        self.assertNotIn("Bad gateway", str(raised.exception))


class AsyncClientTests(unittest.TestCase):
    def test_every_method_has_an_async_twin_with_the_same_parameters(self):
        import inspect
        sync = CalmLensServerClient(api_key="k", project_id="p")
        async_client = calmlens.AsyncCalmLensServerClient.from_client(sync)
        namespaces = ["assets", "folders", "hash_lists", "upload_tokens", "policies", "lenses", "upload_presets",
                      "project_settings", "metadata_fields", "text", "events", "cdn"]
        pairs = [(sync, async_client, name) for name in ("ensure_lens", "ensure_lenses", "request")]
        for namespace in namespaces:
            sync_resource, async_resource = getattr(sync, namespace), getattr(async_client, namespace)
            pairs += [(sync_resource, async_resource, name) for name in dir(sync_resource) if not name.startswith("_")
                      and callable(getattr(sync_resource, name))]
        for sync_owner, async_owner, name in pairs:
            with self.subTest(name):
                self.assertTrue(hasattr(async_owner, name), name)
                self.assertEqual(list(inspect.signature(getattr(sync_owner, name)).parameters),
                                 list(inspect.signature(getattr(async_owner, name)).parameters))


class ClientConstructorParityTests(unittest.TestCase):
    def test_the_async_client_takes_the_same_arguments(self):
        import inspect
        self.assertEqual(list(inspect.signature(CalmLensServerClient).parameters),
                         list(inspect.signature(calmlens.AsyncCalmLensServerClient).parameters))

    def test_default_headers_go_with_every_request_and_calls_can_override_them(self):
        calls = []

        def transport(request, timeout):
            calls.append(request)
            return Response(ASSET)
        client = CalmLensServerClient(api_key="key", project_id="p", transport=transport,
                                      default_headers={"X-Team": "a", "X-Api-Key": "other"})
        client.assets.retrieve(asset_id="a")
        client.assets.retrieve(asset_id="a", options={"headers": {"X-Team": "b"}})
        self.assertEqual([(call.get_header("X-Team"), call.get_header("X-Api-Key")) for call in calls],
                         [("a", "key"), ("b", "key")])
