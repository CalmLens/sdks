"""Replay the shared SDK contract fixtures that packages/sdk-contract writes to sdks/go/testdata
(format in packages/sdk-contract/README.md): requests captured from the JavaScript SDK, path
safety and CDN URLs, API errors, scripted client cases, transform options, webhooks, upload
tokens, the mock behaviour scenarios, the server SDK surface, defaults, rejections and the declared
types (types.json). Each
fixture case is its own subtest; cases a capability marks not applicable to Python are skipped
by name with the reason."""
from __future__ import annotations

import asyncio
import base64
import copy
import email.message
import hashlib
import hmac
import importlib
import inspect
import io
import json
import re
import struct
import time
import typing
import unittest
import zlib
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast
from urllib.parse import parse_qsl, urlsplit

import calmlens
from calmlens import (CalmLensAPIError, CalmLensError, CalmLensServerClient, CalmLensTimeoutError,
                      CalmLensConnectionError, CalmLensInvalidArgumentError, CalmLensWebhookVerificationError, client as client_module,
                      get_event_fact, get_event_facts, is_newer_asset_event, is_test_webhook_event, parse_webhook_event, testing, to_webhook_event_payload,
                      verify_webhook_signature)
from calmlens import _mock_classification, _signed_test_inputs
from calmlens import errors as errors_module
from calmlens._option_keys import NULLABLE_OPTION_KEYS
from calmlens.client import _serialize_transform
from calmlens.testing import MockCalmLensServerClient, create_mock_api_key, sign_upload_token
from calmlens.types import IMAGE_TRANSFORM_COLOUR_KEYS, ImageTransformOptions
from calmlens.webhooks import create_webhook_headers, create_webhook_signature_header
from upload_form import read_upload_form
from wire import python_options

TESTDATA = Path(__file__).resolve().parents[2] / "go" / "testdata"


def _fixture(name: str) -> Any:
    return json.loads((TESTDATA / name).read_text(encoding="utf-8"))


SURFACE = _fixture("surface.json")
CLIENT_CASES = _fixture("client-cases.json")
#: Capability ID -> why it cannot apply to Python (absent when it applies).
NOT_APPLICABLE = {capability["id"]: (capability.get("notApplicable") or {}).get("python")
                  for capability in SURFACE["capabilities"]}


def _snake(path: str) -> str:
    return re.sub(r"(?<!^)(?<!\.)(?=[A-Z])", "_", path).lower()


def _wire(value: Any) -> Any:
    """Result objects (and lists or dicts of them) as the API's JSON."""
    if isinstance(value, calmlens.CalmLensObject):
        return value.to_dict()
    if isinstance(value, (list, tuple)):
        return [_wire(item) for item in value]
    if isinstance(value, dict):
        return {key: _wire(item) for key, item in value.items()}
    return value


def _json(value: Any) -> Any:
    """A result as the JSON the fixtures hold."""
    return json.loads(json.dumps(_wire(value)))


_python_options = python_options


# ---- Translating JavaScript operations and options --------------------------------------------

#: JavaScript iterator names to Python's, as surface.json names them (``events.pages`` is
#: JavaScript's name for the events iterator).
_ITERATORS = {capability["id"]: capability["names"]["python"] for capability in SURFACE["capabilities"]
              if capability["kind"] == "method" and ".iterate" in capability["id"]}
# JavaScript's ``events.iterate`` yields events and ``events.pages`` the pages: Python's
# ``events.iter`` and ``events.iter_pages``.
_ITERATORS["events.pages"] = "events.iter_pages"
_ITERATORS["events.iterate"] = "events.iter"


class _Partial(Exception):
    """An iterator failed after yielding ``items``."""

    def __init__(self, items: list[Any], error: BaseException):
        super().__init__(str(error))
        self.items, self.error = items, error


def _content(value: Any) -> Any:
    """JavaScript upload content to Python's: byte arrays and buffers are ``data``."""
    if isinstance(value, dict):
        value = dict(value)
        for key in ("uint8Array", "buffer"):
            if key in value:
                value["data"] = value.pop(key)
    return value


class _ReadCDNResponse:
    """An :class:`AsyncCDNResponse` read in full inside the event loop, readable as a CDNResponse."""

    def __init__(self, status: int, headers: dict[str, str], body: bytes):
        self.status, self.headers, self._body = status, headers, body

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> _ReadCDNResponse:
        return self

    def __exit__(self, *args: object) -> None:
        pass


def _await(value: Any) -> Any:
    """An async client's result as the sync client returns it: awaited, an async iterator
    collected (raising ``_Partial`` with the items before a failure), a CDN body read."""
    async def resolve() -> Any:
        if inspect.isawaitable(value):
            result = await value
            if isinstance(result, calmlens.AsyncCDNResponse):
                async with result as response:
                    return _ReadCDNResponse(response.status, response.headers, await response.read())
            return result
        items: list[Any] = []
        try:
            async for item in value:
                items.append(item)
        except CalmLensError as error:
            raise _Partial(items, error) from error
        return items
    return asyncio.run(resolve())


def _invoke(client: CalmLensServerClient, operation: str, args: Any, as_keywords: bool = True,
            use_async: bool = False) -> Any:
    """Run a JavaScript client operation with JavaScript option names on the Python client, as the
    snake_case keyword arguments callers write, such as ``viewer_claims=None``; with ``use_async``
    through an :class:`AsyncCalmLensServerClient` running the same client."""
    args = dict(args or {})
    for key in ("content", "part"):
        if key in args:
            args[key] = _content(args[key])
    root: Any = calmlens.AsyncCalmLensServerClient.from_client(client) if use_async else client

    def call(method: Any, given: dict[str, Any], **keywords: Any) -> Any:
        result = method(**_python_options(given), **keywords)
        return _await(result) if use_async and (inspect.isawaitable(result) or hasattr(result, "__aiter__")) \
            else result
    if operation in _ITERATORS:
        if use_async:
            return call(_resolve_name(root, _ITERATORS[operation]), args)
        items: list[Any] = []
        try:
            for item in call(_resolve_name(client, _ITERATORS[operation]), args):
                items.append(item)
        except CalmLensError as error:
            raise _Partial(items, error) from error
        return items
    if operation == "assets.waitForDecision" and "timeoutMs" in args:
        args["timeout"] = args.pop("timeoutMs") / 1000
    keywords = {}
    if "idempotencyKey" in args:
        keywords["options"] = {"idempotency_key": args.pop("idempotencyKey")}
    return call(_resolve_name(root, _snake(operation)), args, **keywords)


def _client_options(options: dict[str, Any]) -> dict[str, Any]:
    """JavaScript client options to Python's keyword arguments (milliseconds become seconds)."""
    names = {"apiKey": "api_key", "projectId": "project_id", "baseUrl": "base_url", "cdnBaseUrl": "cdn_base_url",
             "maxRetries": "max_retries", "maxResponseBytes": "max_response_bytes", "partSizeBytes": "part_size_bytes"}
    converted = {}
    for key, value in options.items():
        if key == "timeoutMs":
            converted["timeout"] = value / 1000
        else:
            converted[names[key]] = value
    return converted


def _resolve_name(root: Any, path: str) -> Any:
    value = root
    for key in path.split("."):
        if inspect.ismodule(value) and not hasattr(value, key):
            try:
                value = importlib.import_module(f"{value.__name__}.{key}")
                continue
            except ImportError:
                return None
        value = getattr(value, key, None)
        if value is None:
            return None
    return value


def _error_fields(error: BaseException) -> dict[str, Any]:
    """The error fields every runner compares, ``None`` where there is none. Python's ``details``
    is always a dict: an API response's error always has the body's ``details`` object (empty or
    not), and an empty dict on an error raised before sending (an ``sdk/*`` code, or an API code
    such as ``upload-payload/invalid`` without a status) is no details."""
    assert isinstance(error, CalmLensError), repr(error)
    has_details = bool(error.details) or (not error.code.startswith("sdk/") and error.status is not None)
    return {"code": error.code, "status": error.status, "requestId": error.request_id,
            "retryAfter": error.retry_after, "details": _json(error.details) if has_details else None}


class _Response(io.BytesIO):
    """A scripted HTTP response a custom transport returns."""

    def __init__(self, status: int, headers: dict[str, str] | list[tuple[str, str]], body: bytes = b""):
        super().__init__(body)
        self.status = status
        self.headers = headers


def _json_response(body: Any, status: int = 200, headers: dict[str, str] | None = None) -> _Response:
    return _Response(status, {"content-type": "application/json", **(headers or {})}, json.dumps(body).encode())


def _refuse(request: Any, timeout: float) -> Any:
    raise AssertionError(f"Sent {request.url}")


def _client(transport: Any = _refuse, **options: Any) -> CalmLensServerClient:
    return CalmLensServerClient(api_key="key", project_id="project-1", transport=transport, max_retries=0,
                                **options)


def _body_bytes(data: Any) -> bytes:
    if data is None:
        return b""
    if isinstance(data, (bytes, bytearray)):
        return bytes(data)
    return b"".join(iter(lambda: data.read(65536), b""))


# ---- requests.json, paths.json, errors.json ---------------------------------------------------

class RequestTests(unittest.TestCase):
    def test_javascript_requests(self) -> None:
        """Each request fixture sends the recorded request and returns the recorded response."""
        for index, fixture in enumerate(_fixture("requests.json"), 1):
            for use_async in (False, True):
                with self.subTest(f"{index}: {fixture['operation']}", use_async=use_async):
                    self._replay_request(fixture, use_async)

    def _replay_request(self, fixture: dict[str, Any], use_async: bool) -> None:
            if True:
                captured = []

                def transport(request: Any, timeout: float, response: Any = fixture["response"]) -> _Response:
                    captured.append((request, _body_bytes(request.body)))
                    return _json_response(response)
                result = _invoke(_client(transport), fixture["operation"], fixture.get("options"),
                                 use_async=use_async)
                self.assertEqual(len(captured), 1)
                request, data = captured[0]
                url = urlsplit(request.url)
                body: Any = data.decode() if data else None
                if body and request.get_header("Content-type") == "application/json":
                    body = json.loads(body)
                self.assertEqual({"method": request.method, "path": url.path, "query": dict(parse_qsl(url.query)),
                                  "body": body}, fixture["request"])
                # A fixture's ``result`` is what the method returns when it isn't the body: deletes and
                # removeEntry return nothing, ensureLenses the lenses and everything else the body.
                returns_nothing = fixture["operation"].endswith(".delete") or fixture["operation"] == "hashLists.removeEntry"
                expected = (fixture["result"] if "result" in fixture else None if returns_nothing
                            else fixture["response"]["lenses"] if fixture["operation"] == "ensureLenses"
                            else fixture["response"])
                self.assertEqual(_json(result), expected)

    def test_javascript_path_safety(self) -> None:
        paths = _fixture("paths.json")
        c = _client()
        for case in paths["rejections"]:
            with self.subTest(operation=case["operation"], options=case["options"]):
                with self.assertRaises(CalmLensError) as raised:
                    _invoke(c, case["operation"], case["options"])
                self.assertEqual(raised.exception.code, case["error"])
        for case in paths["cdnUrls"]:
            with self.subTest(cdn=case["options"]):
                if "url" in case:
                    self.assertEqual(c.cdn.get_asset_url(**_python_options(case['options'])), case["url"])
                else:
                    with self.assertRaises(CalmLensError) as raised:
                        c.cdn.get_asset_url(**_python_options(case['options']))
                    self.assertEqual(raised.exception.code, case["error"])

    def test_api_errors(self) -> None:
        """Every API error code becomes a typed error with every field."""
        for fixture in _fixture("errors.json"):
            with self.subTest(fixture["code"]):
                response = fixture["response"]

                text = response["bodyText"] if "bodyText" in response else json.dumps(response["body"])

                def transport(request: Any, timeout: float, response: Any = response, text: str = text) -> _Response:
                    return _Response(response["status"], response["headers"], text.encode())
                with self.assertRaises(CalmLensAPIError) as raised:
                    _invoke(_client(transport), fixture["operation"], fixture["args"])
                self.assertEqual(_error_fields(raised.exception), fixture["expected"])
                self.assertEqual(_kind_problems(raised.exception, fixture["kind"]), [])
                # The raw body is kept (a proxy's HTML page among them), and left out of str().
                self.assertEqual(raised.exception.body, text)
                self.assertNotIn(text, str(raised.exception))


# ---- requests.json against the declared types ---------------------------------------------------

def _type_name(hint: Any) -> str:
    return getattr(hint, "__name__", None) or repr(hint)


def _attribute(key: str) -> str:
    """An API field name as a result object's attribute: ``nextCursor`` -> ``next_cursor``."""
    return re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower().replace("-", "_")


def _model_fields(model: type) -> dict[str, Any]:
    return {name: hint for name, hint in typing.get_type_hints(model).items() if not name.startswith("_")}


def _union_members(hint: Any) -> list[Any]:
    origin = typing.get_origin(hint)
    if origin is typing.Union or (origin is not None and getattr(origin, "__name__", "") == "UnionType"):
        return [member for arg in typing.get_args(hint) for member in _union_members(arg)]
    return [hint]


def _type_errors(value: Any, hint: Any, path: str, complete: bool = True) -> list[str]:
    """Where ``value`` (decoded JSON) breaks the declared type ``hint``: keys a ``TypedDict`` does
    not declare, missing required keys (when ``complete``), wrong scalar types, list items and
    mapping keys and values, literals outside the declared set and values matching no union member.
    Open enums are declared as ``Union[Literal[...], str]``, so any string matches them through the
    ``str`` member."""
    origin, args = typing.get_origin(hint), typing.get_args(hint)
    if hint is Any:
        return []
    if hint is None or hint is type(None):
        return [] if value is None else [f"{path}: {value!r} is not None"]
    if origin is typing.Union or (origin is not None and origin.__name__ == "UnionType"):
        failures = [_type_errors(value, member, path, complete) for member in args]
        if any(not errors for errors in failures):
            return []
        # Report the non-None member that came closest, so an undeclared key deep inside shows its
        # path rather than "is not None".
        return min((errors for member, errors in zip(args, failures) if member is not type(None)), key=len)
    if origin is typing.Literal:
        return [] if any(value == arg and type(value) is type(arg) for arg in args) else [
            f"{path}: {value!r} is not one of {list(args)}"]
    if isinstance(hint, type) and issubclass(hint, calmlens.CalmLensObject):
        # A result object: every key the API sent is a declared attribute (its snake_case name),
        # and a field typed without ``None`` is always sent.
        if not isinstance(value, dict):
            return [f"{path}: {value!r} is not an object ({hint.__name__})"]
        fields = _model_fields(hint)
        names = {_attribute(key): key for key in value}
        errors = [f"{path}.{key}: not declared on {hint.__name__}" for key in value if _attribute(key) not in fields]
        errors += [f"{path}.{name}: required by {hint.__name__} but missing" for name, field in fields.items()
                   if complete and name not in names and type(None) not in _union_members(field)]
        for key, item in value.items():
            if _attribute(key) in fields:
                errors += _type_errors(item, fields[_attribute(key)], f"{path}.{key}", complete)
        return errors
    if typing.is_typeddict(hint):
        if not isinstance(value, dict):
            return [f"{path}: {value!r} is not an object ({_type_name(hint)})"]
        fields = typing.get_type_hints(hint)
        errors = [f"{path}.{key}: not declared on {_type_name(hint)}" for key in value if key not in fields]
        errors += [f"{path}.{key}: required by {_type_name(hint)} but missing"
                   for key in sorted(hint.__required_keys__) if complete and key not in value]
        for key, item in value.items():
            if key in fields:
                errors += _type_errors(item, fields[key], f"{path}.{key}", complete)
        return errors
    if origin in (list, typing.List):
        if not isinstance(value, list):
            return [f"{path}: {value!r} is not a list"]
        return [error for index, item in enumerate(value) for error in _type_errors(item, args[0], f"{path}[{index}]", complete)]
    if origin in (dict, typing.Dict) or origin is Mapping:
        if not isinstance(value, dict):
            return [f"{path}: {value!r} is not an object"]
        return [error for key, item in value.items()
                for error in _type_errors(key, args[0], f"{path} key {key!r}", complete)
                + _type_errors(item, args[1], f"{path}.{key}", complete)]
    if hint is bool:
        return [] if isinstance(value, bool) else [f"{path}: {value!r} is not a bool"]
    if hint is int:
        return [] if isinstance(value, int) and not isinstance(value, bool) else [f"{path}: {value!r} is not an int"]
    if hint is float:
        # PEP 484's numeric tower: an int is acceptable where a float is declared.
        return [] if isinstance(value, (int, float)) and not isinstance(value, bool) else [
            f"{path}: {value!r} is not a number"]
    if hint is str:
        return [] if isinstance(value, str) else [f"{path}: {value!r} is not a str"]
    raise AssertionError(f"{path}: the type checker can't check {hint!r}")


def _declared(operation: str) -> tuple[dict[str, Any], Any]:
    """The Python method behind a fixture operation (as ``_invoke`` resolves it): its keyword
    argument types and its return type."""
    method = _resolve_name(_client(), _ITERATORS.get(operation) or _snake(operation))
    assert method is not None, f"no Python method for {operation}"
    hints = typing.get_type_hints(method, vars(client_module))
    keywords = {name: hints[name] for name, parameter in inspect.signature(method).parameters.items()
                if parameter.kind is inspect.Parameter.KEYWORD_ONLY}
    return keywords, hints["return"]


class TypeContractTests(unittest.TestCase):
    """The request fixtures, including the full models the generator fills from the API's schemas,
    match the result objects and keyword arguments the client methods declare: every field the API
    sends is declared, every field typed without ``None`` is present and every value has its
    declared type."""

    def test_responses_match_the_declared_return_types(self) -> None:
        """Every response holds only declared fields of the declared types; the generator's
        full-model cases (``fullModel``) must also hold every field typed without ``None``."""
        for index, fixture in enumerate(_fixture("requests.json"), 1):
            operation = fixture["operation"]
            with self.subTest(f"{index}: {operation}"):
                _, returns = _declared(operation)
                if returns is type(None):
                    continue
                response = fixture["response"]
                if operation == "ensureLenses":
                    response = response["lenses"]
                self.assertEqual(_type_errors(response, returns, "response",
                                              complete=fixture.get("fullModel") is True), [])

    def test_options_match_the_declared_option_types(self) -> None:
        """Every option, in snake_case, is a keyword argument of its declared type, apart from
        ``None`` for an option the API refuses ``null`` for, which the client leaves out (the
        requests fixtures check that it does)."""
        for index, fixture in enumerate(_fixture("requests.json"), 1):
            operation = fixture["operation"]
            with self.subTest(f"{index}: {operation}"):
                keywords, _ = _declared(operation)
                nullable = NULLABLE_OPTION_KEYS.get(operation, frozenset())
                options = {key: _content(value) if key in ("content", "part") else value
                           for key, value in (fixture.get("options") or {}).items()
                           if key != "idempotencyKey" and (value is not None or key in nullable)}
                errors = []
                for key, value in _python_options(options).items():
                    if key not in keywords:
                        errors.append(f"options.{key}: not a keyword argument")
                    else:
                        errors += _type_errors(value, keywords[key], f"options.{key}")
                self.assertEqual(errors, [])
                contract = fixture.get("inputContract", {})
                if "field" in contract:
                    method = _resolve_name(_client(), _snake(operation))
                    keyword = _snake(contract["field"])
                    parameter = inspect.signature(method).parameters[keyword]
                    self.assertEqual(parameter.kind, inspect.Parameter.KEYWORD_ONLY)
                self.assertEqual({_snake(key) for key in contract.get("requiredKeys", [])} - set(keywords), set(),
                                 f"{operation}: required inputs must be keyword arguments")


class TransformTests(unittest.TestCase):
    fixture = _fixture("transform-options.json")

    def test_transform_options(self) -> None:
        """Every transform option serializes to the selector the CDN writes for it."""
        for case in self.fixture["cases"]:
            with self.subTest(options=case["options"]):
                self.assertEqual(_serialize_transform(case["options"]), case["selector"])

    def test_refuses_invalid_transform_options(self) -> None:
        """Options the CDN refuses are refused before any URL is built or request sent, naming every
        unknown and invalid key, in CDN URLs, served requests and signed URLs alike."""
        client = _client()
        calls = {
            "cdn.get_asset_url": lambda options: client.cdn.get_asset_url(asset_id="asset-1", resource="rendered",
                                                                          transform=options),
            "cdn.serve": lambda options: client.cdn.serve(asset_id="asset-1", transform=options),
            "cdn.sign_asset_url": lambda options: client.cdn.sign_asset_url(asset_id="asset-1", resource="rendered",
                                                                            transform=options),
        }
        for case in self.fixture["invalid"]:
            for name, call in calls.items():
                with self.subTest(name, options=case["options"]):
                    with self.assertRaises(CalmLensInvalidArgumentError) as raised:
                        call(case["options"])
                    self.assertEqual(raised.exception.code, "sdk/invalid-argument")
                    self.assertEqual(raised.exception.details,
                                     {"unknownKeys": case["unknownKeys"], "invalidKeys": case["invalidKeys"]})
                    for key in [*case["unknownKeys"], *case["invalidKeys"]]:
                        self.assertIn(key, str(raised.exception))

    def test_option_names(self) -> None:
        self.assertEqual(sorted(typing.get_type_hints(ImageTransformOptions)), sorted(self.fixture["options"]))

    def test_colour_keys(self) -> None:
        self.assertEqual(sorted(IMAGE_TRANSFORM_COLOUR_KEYS), sorted(self.fixture["colourKeys"]))


class UploadMimeTypeTests(unittest.TestCase):
    fixture = _fixture("upload-mime-types.json")

    def test_refuses_types_the_api_refuses_before_sending(self) -> None:
        """The client refuses each type the API refuses, as content or as a multipart upload's first
        part, without sending a request (``_client`` fails on any request)."""
        for mime_type in self.fixture["refused"]:
            for mode in ("content", "part"):
                with self.subTest(mime_type, mode=mode), self.assertRaises(CalmLensInvalidArgumentError) as raised:
                    _client().assets.create(name="x", **{mode: {"base64": "aGVsbG8=", "type": mime_type}})
                self.assertEqual(raised.exception.code, "upload/unsupported-type")
                self.assertEqual(raised.exception.details, {"mimeType": mime_type, "source": "calmlens"})


# ---- client-cases.json ------------------------------------------------------------------------

_UUID_V4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


class _OneShotStream(io.RawIOBase):
    """A non-seekable stream that can be read once, like a pipe."""

    def __init__(self, data: bytes):
        super().__init__()
        self._data = io.BytesIO(data)

    def readable(self) -> bool:
        return True

    def readinto(self, buffer: Any) -> int:
        chunk = self._data.read(len(buffer))
        buffer[:len(chunk)] = chunk
        return len(chunk)


def _decode_args(value: Any) -> Any:
    if isinstance(value, list):
        return [_decode_args(item) for item in value]
    if isinstance(value, dict):
        if "$bytes" in value:
            return base64.b64decode(value["$bytes"])
        if "$stream" in value:
            return _OneShotStream(base64.b64decode(value["$stream"]))
        if "$fill" in value:
            return bytes([value["$fill"]["byte"]]) * value["$fill"]["length"]
        return {key: _decode_args(item) for key, item in value.items()}
    return value


class _Scripted:
    """A transport answering each request with the case's next scripted response."""

    def __init__(self, case: dict[str, Any]):
        self.case = case
        self.received: list[dict[str, Any]] = []

    def __call__(self, request: Any, timeout: float) -> _Response:
        self.received.append({"method": request.method, "url": request.url,
                              "headers": {name.lower(): value for name, value in request.headers.items()},
                              "body": _body_bytes(request.body)})
        responses = self.case["responses"]
        if len(self.received) > len(responses):
            raise AssertionError(f"request {len(self.received)} has no scripted response")
        scripted = responses[len(self.received) - 1]
        if scripted.get("hang"):
            # The attempt's deadline ends a request that never answers.
            raise TimeoutError("timed out")
        if scripted.get("transportError"):
            raise ConnectionResetError("connection reset")
        if "body" in scripted:
            body = json.dumps(scripted["body"], ensure_ascii=False, separators=(",", ":")).encode()
        elif "bodyBase64" in scripted:
            body = base64.b64decode(scripted["bodyBase64"])
        else:
            body = scripted.get("bodyText", "").encode()
        return _Response(scripted.get("status", 200), scripted.get("headers", {}), body)


def _raw_body(data: bytes, want: Mapping[str, Any]) -> dict[str, Any]:
    """A raw body as a case records it: its length and SHA-256, and its base64 when ``want`` has it."""
    body: dict[str, Any] = {"bodyLength": len(data), "bodySha256": hashlib.sha256(data).hexdigest()}
    if "bodyBase64" in want:
        body["bodyBase64"] = base64.b64encode(data).decode()
    return body


def _matches(want: Any, got: Any) -> bool:
    if isinstance(want, list):
        return want[0] <= got <= want[1]
    return bool(got == want)


class ClientCaseTests(unittest.TestCase):
    """Each case drives the real client through a scripted transport and checks every request
    it sends, the waits between attempts and what it returns or raises."""

    def test_client_cases(self) -> None:
        for case in CLIENT_CASES["cases"]:
            with self.subTest(f"{case['area']}: {case['name']}"):
                requires = case.get("requires")
                if requires is not None:
                    self.assertIn(requires, NOT_APPLICABLE, f"requires unknown capability {requires}")
                    if NOT_APPLICABLE[requires]:
                        print(f"\nskipped {case['name']!r} (not applicable: {NOT_APPLICABLE[requires]})")
                        continue
                for use_async in (False, True):
                    with self.subTest(use_async=use_async):
                        self._run_case(case, use_async)

    def _run_case(self, case: dict[str, Any], use_async: bool = False) -> None:
        transport = _Scripted(case)
        sleeps: list[float] = []
        client: CalmLensServerClient | None = None
        construction_error: BaseException | None = None
        try:
            client = CalmLensServerClient(**_client_options({**CLIENT_CASES["client"], **(case.get("client") or {})}),
                                          transport=transport)
            client._sleep = sleeps.append
        except CalmLensError as error:
            construction_error = error
        for index, step in enumerate(case["steps"], 1):
            label = f"step {index} ({step['operation']})"
            expected = step.get("expect") or {}
            result: Any = None
            error: BaseException | None = construction_error
            partial: list[Any] | None = None
            if error is None:
                assert client is not None
                try:
                    result = _invoke(client, step["operation"], _decode_args(step.get("args") or {}),
                                     use_async=use_async)
                except _Partial as failure:
                    error, partial = failure.error, _json(failure.items)
                except CalmLensError as failure:
                    error = failure
            if "error" in expected:
                self.assertIsNotNone(error, f"{label} succeeded")
                assert error is not None
                want = dict(expected["error"])
                actual = _error_fields(error)
                retry_after = want.pop("retryAfter")
                got_retry_after = actual.pop("retryAfter")
                if isinstance(retry_after, dict):
                    self.assertGreaterEqual(got_retry_after, retry_after["$gte"], f"{label}: retryAfter")
                else:
                    self.assertEqual(got_retry_after, retry_after, f"{label}: retryAfter")
                self.assertEqual(actual, want, label)
                if "partialResult" in expected:
                    self.assertEqual(partial, expected["partialResult"], f"{label}: yielded")
                break
            if error is not None:
                raise error
            if "cdn" in expected:
                with result as response:
                    self.assertEqual({"status": response.status,
                                      "headers": {name: response.headers.get(name.lower())
                                                  for name in expected["cdn"]["headers"]},
                                      "bodyBase64": base64.b64encode(response.read()).decode()},
                                     expected["cdn"], label)
            else:
                self.assertEqual(_json(result), expected.get("result"), label)

        self.assertEqual(len(transport.received), len(case["requests"]), "requests sent")
        uuids: dict[str, str] = {}
        for index, (got, want) in enumerate(zip(transport.received, case["requests"]), 1):
            label = f"request {index}"
            url = urlsplit(got["url"])
            self.assertEqual({"method": got["method"], "origin": f"{url.scheme}://{url.netloc}", "path": url.path},
                             {"method": want["method"], "origin": want["origin"], "path": want["path"]}, label)
            # Queries compare decoded, as the API's parser reads them; pair order is free.
            self.assertEqual(sorted(parse_qsl(url.query, keep_blank_values=True)),
                             sorted(tuple(pair) for pair in want["query"]), f"{label}: query")
            for name, value in {**CLIENT_CASES["everyRequest"]["headers"], **want["headers"]}.items():
                self._check_header(f"{label}: {name}", got["headers"].get(name.lower()), value, uuids)
            if "form" in want:
                form = read_upload_form(got["body"], got["headers"].get("content-type"))
                self.assertEqual(form["options"], want["form"]["options"], f"{label}: options")
                self.assertEqual({"contentType": form["type"], **_raw_body(form["bytes"], want["form"]["file"])},
                                 want["form"]["file"], f"{label}: file")
            elif "body" in want:
                if want["body"] is None:
                    self.assertEqual(got["body"], b"", f"{label}: no body")
                else:
                    self.assertEqual(json.loads(got["body"]), want["body"], f"{label}: body")
            else:
                wanted = {key: want[key] for key in ("bodyLength", "bodySha256", "bodyBase64") if key in want}
                self.assertEqual(_raw_body(got["body"], want), wanted, f"{label}: raw body")
        # The injected sleeper records every wait exactly (milliseconds).
        waits = [round(seconds * 1000) for seconds in sleeps]
        wanted_waits = case.get("sleepsMs") or []
        self.assertEqual(len(waits), len(wanted_waits), f"waits {waits}, want {wanted_waits}")
        for wait, wanted_wait in zip(waits, wanted_waits):
            self.assertTrue(_matches(wanted_wait, wait), f"waits {waits}, want {wanted_waits}")

    def _check_header(self, label: str, actual: str | None, expected: Any, uuids: dict[str, str]) -> None:
        if isinstance(expected, dict) and "$absent" in expected:
            self.assertIsNone(actual, f"{label} is absent")
        elif isinstance(expected, dict) and "$regex" in expected:
            self.assertRegex(actual or "", expected["$regex"], label)
        elif isinstance(expected, dict) and "$uuid" in expected:
            self.assertRegex(actual or "", _UUID_V4, f"{label} is a UUID")
            known = uuids.get(expected["$uuid"])
            if known is None:
                self.assertNotIn(actual, uuids.values(), f"{label} is a new value")
                uuids[expected["$uuid"]] = actual or ""
            else:
                self.assertEqual(actual, known, f"{label} reuses {expected['$uuid']}")
        else:
            self.assertEqual(actual, expected, label)


# ---- surface.json -----------------------------------------------------------------------------

def _raised_error() -> CalmLensError:
    spec = SURFACE["errorResponse"]

    def transport(request: Any, timeout: float) -> _Response:
        return _Response(spec["status"], spec["headers"], json.dumps(spec["body"]).encode())
    try:
        _invoke(_client(transport), spec["operation"], spec["options"])
    except CalmLensError as error:
        return error
    raise AssertionError(f"{spec['operation']} did not fail")


# The class the SDK raises for each SDK error code; errors carrying an HTTP status are
# CalmLensAPIError. Other SDK codes use the base class.
#: The error kinds (surface.json ``errorKinds``) by ID, and the class each one names.
ERROR_KINDS = {kind["id"]: kind for kind in SURFACE["errorKinds"]}


def _kind_class(kind: str) -> type:
    return cast(type, getattr(calmlens, ERROR_KINDS[kind]["names"]["python"]))


def _kind_problems(error: BaseException, kind: str) -> list[str]:
    """Where ``error`` isn't an instance of its kind's class and every ancestor kind's class."""
    problems, current = [], kind
    while current is not None:
        if not isinstance(error, _kind_class(current)):
            problems.append(f"{type(error).__name__} is not a {_kind_class(current).__name__} ({current})")
        current = ERROR_KINDS[current].get("parent")
    return problems


def _mock_outcome(option: str) -> str:
    """The status a mock option gives an upload: ``moderate`` answering ``blocked``."""
    mock = testing.MockCalmLensServerClient(mock_options=cast(Any, {option: lambda moderation: "blocked"}))
    asset = mock.assets.classify(name='note.txt', content={'plain_text': 'hello', 'type': 'text/plain'})
    return str(asset["classification"]["moderation"]["decision"])


def _present(capability: dict[str, Any]) -> bool:
    name, kind = capability["names"]["python"], capability["kind"]
    if kind == "method":
        return callable(_resolve_name(_client(), name))
    if kind in ("function", "mock-client", "mock-function"):
        return callable(_resolve_name(calmlens, name))
    if kind == "constant":
        return bool(_resolve_name(calmlens, name) == capability["value"])
    if kind == "error-field":
        expected = SURFACE["errorResponse"]["expected"]
        want = {"errors.code": expected["code"], "errors.status": expected["status"],
                "errors.requestId": expected["requestId"],
                "errors.retryAfter": expected["retryAfterSeconds"]}[capability["id"]]
        return bool(getattr(_raised_error(), name, None) == want)
    if kind == "cdn-resource":
        url = _client().cdn.get_asset_url(asset_id='asset-1', resource=name)
        return url.endswith(f"/asset-1/{capability['path']}")
    if kind == "cdn-option":
        get_asset_url = _client().cdn.get_asset_url
        if name not in inspect.signature(get_asset_url).parameters:
            return False
        if name == "external_id":
            return get_asset_url(external_id="post 1").endswith("/assets/project-1/ext:post%201")
        return get_asset_url(asset_id="asset-1", **{name: {"ageConfirmed": True}}).endswith(
            "/asset-1?viewerClaims=%7B%22ageConfirmed%22%3Atrue%7D")
    if kind == "mock-method":
        return callable(getattr(testing.MockCalmLensServerClient, name, None))
    if kind == "mock-option":
        return _mock_outcome(name) == "blocked"
    raise AssertionError(f"Unknown capability kind {kind}")


class SurfaceTests(unittest.TestCase):
    def test_offers_every_capability(self) -> None:
        for capability in SURFACE["capabilities"]:
            with self.subTest(capability["id"], name=capability["names"]["python"]):
                reason = NOT_APPLICABLE[capability["id"]]
                if reason:
                    print(f"\nskipped {capability['id']} (not applicable: {reason})")
                    continue
                self.assertTrue(_present(capability))

    def test_decision_builder_classification(self) -> None:
        classification = SURFACE["classification"]
        self.assertEqual(list(_mock_classification.CATEGORIES), classification["categories"])
        self.assertEqual({category: list(qualifiers) for category, qualifiers in _mock_classification.QUALIFIERS.items()},
                         classification["qualifiers"])

    def test_retryable_errors(self) -> None:
        """Each code and status raises its kind of error, which says whether it is retryable and
        local; the property comes from the code and status alone, so the base class agrees."""
        for case in SURFACE["retryable"]:
            raised = errors_module._error(case["code"], status=case["status"])
            with self.subTest(case["code"], status=case["status"]):
                self.assertEqual(_kind_problems(raised, case["kind"]), [])
                for error in (raised, CalmLensError(case["code"], status=case["status"])):
                    self.assertIs(error.is_retryable, case["retryable"])
                    self.assertIs(error.is_local, case["local"])

    def test_every_error_kind_has_its_class(self) -> None:
        """Every error kind names a class, exported from ``calmlens``, that subclasses its parent's."""
        for kind in SURFACE["errorKinds"]:
            with self.subTest(kind["id"]):
                cls = _kind_class(kind["id"])
                self.assertTrue(issubclass(cls, BaseException))
                if kind.get("parent"):
                    self.assertTrue(issubclass(cls, _kind_class(kind["parent"])))
                else:
                    self.assertIs(cls, CalmLensError)

    def test_defaults(self) -> None:
        """The client defaults equal JavaScript's, and the cases that observe them exist."""
        c = CalmLensServerClient(api_key="key", project_id="project-1")
        values = {
            "baseUrl": c.base_url, "cdnBaseUrl": c.cdn_base_url, "timeoutMs": c.timeout * 1000,
            "uploadTimeoutMs": None if c.upload_timeout is None else c.upload_timeout * 1000,
            "maxRetries": c.max_retries, "retryBaseDelayMs": client_module._RETRY_BASE_DELAY * 1000,
            "retryMaxDelayMs": client_module._RETRY_MAX_DELAY * 1000,
            "retryAfterMaxMs": client_module._MAX_RETRY_AFTER_SECONDS * 1000,
            "maxResponseBytes": c.max_response_bytes, "partSizeBytes": c.part_size_bytes,
            "signedUrlExpiresIn": client_module.DEFAULT_SIGNED_URL_EXPIRES_IN,
            "uploadTokenExpiresInSeconds": client_module.DEFAULT_UPLOAD_TOKEN_EXPIRES_IN,
            "waitForDecisionTimeoutMs": client_module.DEFAULT_DECISION_TIMEOUT * 1000,
            "waitForDecisionFirstIntervalMs": client_module.DECISION_POLL_FIRST_DELAY * 1000,
            "waitForDecisionIntervalFactor": client_module.DECISION_POLL_DELAY_FACTOR,
            "waitForDecisionMaxIntervalMs": client_module.DECISION_POLL_MAX_DELAY * 1000,
            "ensureLensesBatchSize": client_module.ENSURE_LENSES_MAX_PER_REQUEST,
        }
        names = {case["name"] for case in CLIENT_CASES["cases"]}
        for default in SURFACE["defaults"]:
            with self.subTest(default["id"]):
                self.assertIn(default["id"], values)
                self.assertEqual(values[default["id"]], default["value"])
                for name in default["observedBy"]:
                    self.assertIn(name, names)

    def test_refuses_rejected_requests_before_sending(self) -> None:
        for case in _fixture("rejections.json"):
            with self.subTest(case["name"]):
                with self.assertRaises(CalmLensError) as raised:
                    _invoke(_client(), case["operation"], case["options"])
                self.assertEqual(raised.exception.code, case["error"])
                self.assertEqual(_kind_problems(raised.exception, case["kind"]), [])
                self.assertIs(raised.exception.is_local, True)
                self.assertIsNone(raised.exception.status)
                self.assertIsNone(raised.exception.request_id)


# ---- upload-tokens.json -----------------------------------------------------------------------

def _decode_claims(token: str) -> tuple[dict[str, Any], str, str]:
    body, signature = token.removeprefix("clut_").split(".")
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))), body, signature


class UploadTokenTests(unittest.TestCase):
    fixture = _fixture("upload-tokens.json")

    def test_signs_exactly(self) -> None:
        for case in self.fixture["signing"]:
            with self.subTest(case["name"]):
                signed = sign_upload_token(case['apiKey'], **_python_options(case['options']), now=case['now'], nonce=case['nonce'])
                self.assertEqual(_wire(signed), {"token": case["expected"]["token"], "expiresAt": case["expected"]["expiresAt"]})

    def test_signs_with_the_clients_clock_and_a_fresh_nonce(self) -> None:
        import time
        for case in self.fixture["signing"]:
            with self.subTest(case["name"]):
                expected = case["expected"]
                c = CalmLensServerClient(api_key=case["apiKey"], project_id="project-1")
                before = int(time.time() * 1000)
                signed = c.upload_tokens.sign(**_python_options(case['options']))
                after = int(time.time() * 1000)
                claims, body, signature = _decode_claims(signed["token"])
                lifetime = expected["expiresAt"] - case["now"]
                self.assertEqual(claims, {**expected["claims"], "e": signed["expiresAt"], "n": claims["n"]})
                self.assertNotEqual(claims["n"], case["nonce"])
                self.assertRegex(claims["n"], _UUID_V4)
                self.assertGreaterEqual(signed["expiresAt"] - before, lifetime)
                self.assertLessEqual(signed["expiresAt"] - after, lifetime)
                want = hmac.new(expected["signingSecret"].encode(),
                                (self.fixture["signingContext"] + body).encode(), hashlib.sha256).hexdigest()
                self.assertEqual(signature, want)

    def test_rejections(self) -> None:
        for case in self.fixture["rejections"]:
            with self.subTest(case["name"]):
                c = CalmLensServerClient(api_key=case["apiKey"], project_id="project-1")
                with self.assertRaises(CalmLensError) as raised:
                    c.upload_tokens.sign(**_python_options(case['options']))
                self.assertEqual(raised.exception.code, case["error"])
                with self.assertRaises(CalmLensError) as raised:
                    sign_upload_token(case['apiKey'], **_python_options(case['options']), now=0, nonce='n')
                self.assertEqual(raised.exception.code, case["error"])

    def test_verification_cases_document_the_server(self) -> None:
        # The Python SDK signs tokens but never decodes or verifies them; the server does.
        for case in self.fixture["verification"]:
            print(f"\nskipped upload token verification {case['name']!r} (not applicable: the Python SDK does "
                  "not decode or verify upload tokens)")


# ---- webhooks.json ----------------------------------------------------------------------------

def _header_containers(headers: dict[str, Any]) -> dict[str, Any]:
    """The header containers a Python receiver gets: a plain dict (repeated headers as a list)
    and an ``email.message.Message`` (``http.client.HTTPMessage``, WSGI/ASGI adapters) that holds
    each repeated header separately."""
    message = email.message.Message()
    for name, value in headers.items():
        for item in value if isinstance(value, list) else [value]:
            message[name] = item
    return {"dict": headers, "Message": message}


class WebhookContractTests(unittest.TestCase):
    """Webhook vectors generated from the JavaScript SDK and the server's payload rules."""
    fixtures = _fixture("webhooks.json")

    def test_parsing(self) -> None:
        for case in self.fixtures["parsing"]:
            with self.subTest(type=case["expectedType"], fact=case["expectedFactKey"]):
                parsed = parse_webhook_event(case["body"], signature=case["signature"], timestamp=case["timestamp"],
                                             secret=case["secret"], now=case["now"])
                self.assertEqual(_wire(parsed), json.loads(case["body"]))
                self.assertEqual(parsed["type"], case["expectedType"])
                self.assertEqual(parsed["facts"][0]["key"], case["expectedFactKey"])

    def test_signatures(self) -> None:
        for case in self.fixtures["signatures"]:
            with self.subTest(body=case["body"], timestamp=case["timestamp"]):
                self.assertEqual(create_webhook_signature_header(case["body"], case["timestamp"], case["secret"]),
                                 case["signature"])

    def test_verification(self) -> None:
        for case in self.fixtures["verification"]:
            with self.subTest(case["name"]):
                options = {"now": case["now"]}
                if "toleranceSeconds" in case:
                    options["tolerance_seconds"] = case["toleranceSeconds"]
                self.assertEqual(verify_webhook_signature(case["body"], signature=case["signature"],
                                                          timestamp=case["timestamp"], secret=case["secret"],
                                                          **options), case["valid"])

    def test_payloads(self) -> None:
        for case in self.fixtures["payloads"]:
            with self.subTest(event=case["event"]["type"], id=case["event"]["id"]):
                self.assertEqual(to_webhook_event_payload(case["event"]), case["payload"])

    def test_header_cases(self) -> None:
        for case in self.fixtures["headerCases"]:
            for container, headers in _header_containers(case["headers"]).items():
                with self.subTest(case["name"], container=container):
                    self.assertEqual(verify_webhook_signature(case["body"], headers=headers, secret=case["secret"],
                                                              now=case["now"]), case["valid"])

    def test_parse_errors(self) -> None:
        for case in self.fixtures["parseErrors"]:
            with self.subTest(case["name"]):
                with self.assertRaises(CalmLensWebhookVerificationError) as raised:
                    parse_webhook_event(case["body"], signature=case["signature"], timestamp=case["timestamp"],
                                        secret=case["secret"], now=case["now"])
                self.assertEqual(raised.exception.code, case["error"])

    def test_parsed(self) -> None:
        for case in self.fixtures["parsed"]:
            with self.subTest(case["name"]):
                event = parse_webhook_event(case["body"], signature=case["signature"], timestamp=case["timestamp"],
                                            secret=case["secret"], now=case["now"])
                self.assertEqual(_wire(event), case["expected"])
                self.assertIs(is_test_webhook_event(event), case["isTest"])

    def test_test_facts(self) -> None:
        for case in self.fixtures["testFacts"]:
            with self.subTest(case["name"]):
                self.assertIs(is_test_webhook_event(case["event"]), case["isTest"])

    def test_fact_lookups(self) -> None:
        for case in self.fixtures["factLookups"]:
            with self.subTest(case["name"]):
                self.assertEqual(get_event_fact(case["event"], case["key"]), case["value"])

    def test_fact_objects(self) -> None:
        for case in self.fixtures["factObjects"]:
            with self.subTest(case["name"]):
                self.assertEqual(get_event_facts(case["event"]), case["facts"])

    def test_asset_sequences(self) -> None:
        for case in self.fixtures["assetSequences"]:
            with self.subTest(case["name"]):
                self.assertIs(is_newer_asset_event(case["event"], case["lastSequence"]), case["newer"])

    def test_round_trips(self) -> None:
        for case in self.fixtures["roundTrips"]:
            with self.subTest(case["name"]):
                payload = to_webhook_event_payload(case["event"])
                self.assertEqual(payload, case["payload"])
                self.assertEqual(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), case["body"])
                headers = create_webhook_headers(case["body"], case["deliveryId"], case["secret"],
                                                 timestamp=case["timestampSeconds"])
                self.assertEqual(headers, case["headers"])
                received = parse_webhook_event(case["body"], headers=headers, secret=case["secret"],
                                               now=case["timestampSeconds"])
                self.assertEqual(_wire(received), case["payload"])
                self.assertIs(is_test_webhook_event(received), case["isTest"])


# ---- mock-scenarios.json ----------------------------------------------------------------------

def _at(value: Any, path: str) -> Any:
    """Follow a dotted path: numeric segments index lists, ``length`` is a list's length."""
    for segment in path.split("."):
        if isinstance(value, list):
            if segment == "length":
                value = len(value)
            else:
                index = int(segment)
                value = value[index] if index < len(value) else None
        elif isinstance(value, dict):
            value = value.get(segment)
        else:
            return None
    return value


def _only_listed(actual: Any, wanted: Any) -> Any:
    """``actual`` with each object narrowed to the fields ``wanted`` lists, recursively, so that an
    equality check compares only those fields (lists must still match item for item)."""
    if isinstance(actual, dict) and isinstance(wanted, dict):
        return {key: _only_listed(actual[key], wanted[key]) for key in wanted if key in actual}
    if isinstance(actual, list) and isinstance(wanted, list) and len(actual) == len(wanted):
        return [_only_listed(item, want) for item, want in zip(actual, wanted)]
    return actual


def _resolve(value: Any, saved: dict[str, Any]) -> Any:
    """Resolve ``$ref``, ``$concat`` and ``$base64Repeat`` values (see the README)."""
    if isinstance(value, dict) and "$ref" in value:
        name, _, path = value["$ref"].partition(".")
        return _at(saved[name], path) if path else saved[name]
    if isinstance(value, dict) and "$concat" in value:
        return "".join(str(_resolve(part, saved)) for part in value["$concat"])
    if isinstance(value, dict) and "$base64Repeat" in value:
        spec = value["$base64Repeat"]
        return base64.b64encode((spec["text"] * spec["count"]).encode("utf-8")).decode()
    if isinstance(value, list):
        return [_resolve(item, saved) for item in value]
    if isinstance(value, dict):
        return {key: _resolve(item, saved) for key, item in value.items()}
    return value


def _build_decision(spec: Any) -> testing.MockDecision:
    """Build ``spec`` with the decision builder, in the order the fixture lists its calls."""
    if isinstance(spec, str):
        return testing.mock_decision(cast(Any, spec))
    decision = testing.mock_decision(spec["status"])
    for flag in spec.get("flags", []):
        decision.flag(flag["category"], flag["score"], flag.get("qualifiers"))
    for category in spec.get("notEvaluated", []):
        decision.not_evaluated(category)
    review = spec.get("pendingReview")
    if review is not None:
        decision.pending_review(review["reason"], review.get("uncertainCategories", []))
    return decision


def _run(client: MockCalmLensServerClient, operation: str, args: dict[str, Any],
         moderate_calls: list[dict[str, Any]]) -> Any:
    if operation == "mock.completeProcessing":
        decision = None if args.get("decision") is None else _build_decision(args["decision"])
        return _json(client.complete_processing(args["assetId"], decision))
    if operation == "mock.moderateCalls":
        return copy.deepcopy(moderate_calls)
    if operation == "mock.buildDecision":
        _build_decision(args)
        return None
    if operation == "mock.requests":
        # ``query`` as sent: the raw parameters of the request URL.
        return [{"method": request.method, "path": request.path,
                 "query": dict(parse_qsl(urlsplit(request.url).query, keep_blank_values=True)),
                 "status": request.status} for request in client.requests]
    if operation == "mock.clearRequests":
        client.clear_requests()
        return None
    if operation == "mock.decide":
        return _json(client.decide(args["assetId"], args["outcome"]))
    if operation == "mock.enqueueEvent":
        return _json(client.enqueue_event(args["type"], asset_id=args.get("assetId"), facts=args.get("facts"),
                                          actor=args.get("actor")))
    if operation == "mock.grant":
        client.set_api_key_grants(_python_options(args["grants"]))
        return None
    if operation == "mock.failNext":
        client.fail_next_request(args["failure"], operation=args.get("operation"), details=args.get("details"),
                                 retry_after=args.get("retryAfter"))
        return None
    if operation in ("cdn.serve", "mock.fetchCdn"):
        served = (client.fetch_cdn(args["url"]) if operation == "mock.fetchCdn"
                  else client.cdn.serve(**{_snake(key): value for key, value in args.items()}))
        with served as response:
            body = response.read()
            code = (json.loads(body).get("code")
                    if (response.content_type or "").startswith("application/json") else None)
            return {"status": response.status, "code": code, "bytes": body, "headers": response.headers}
    if operation == "cdn.getAssetInfo":
        return _json(client.cdn.get_asset_info(args['url'], viewer_claims=_python_options(args.get('viewerClaims', client_module._UNSET))))
    try:
        # Scenarios call the mock as users do, with keyword arguments.
        return _json(_invoke(client, operation, args, as_keywords=True))
    except _Partial as failure:
        raise failure.error from None


class MockScenarioTests(unittest.TestCase):
    def test_shared_scenarios(self) -> None:
        for scenario in _fixture("mock-scenarios.json")["scenarios"]:
            with self.subTest(scenario=scenario["name"]):
                self._run_scenario(scenario)

    def _run_scenario(self, scenario: dict[str, Any]) -> None:
        mock = scenario["mock"]
        moderate = mock.get("moderate")
        # Records what ``moderate`` was given, and answers by name, then by queue mode for uploads.
        moderate_calls: list[dict[str, Any]] = []

        def recording_moderate(moderation: testing.MockModerationInput) -> Any:
            asset, content = moderation.asset, moderation.content
            moderate_calls.append({
                "trigger": moderation.trigger, "queued": moderation.queued, "assetId": asset["id"],
                "name": asset["name"], "text": content.text,
                "bytesBase64": None if content.bytes is None else base64.b64encode(content.bytes).decode()})
            spec = (moderate.get("byName") or {}).get(asset["name"])
            if spec is None and moderation.trigger == "upload":
                spec = moderate.get("queued" if moderation.queued else "analyzed")
            # Otherwise the mock's default: queued work stays pending until complete_processing.
            return testing.default_moderate(moderation) if spec is None else _build_decision(spec)

        options: dict[str, Any] = {} if moderate is None else {"moderate": recording_moderate}
        retries: dict[str, Any] = {} if "maxRetries" not in mock else {"max_retries": mock["maxRetries"]}
        if "partSizeBytes" in mock:
            retries["part_size_bytes"] = mock["partSizeBytes"]
        if not mock.get("defaultProject"):
            retries["project_id"] = "project-1"
        client = MockCalmLensServerClient(api_key=create_mock_api_key(_python_options(mock.get("apiKeyGrants"))),
                                          mock_options=cast(Any, options), **retries)
        # The status of each response the mock answers, to check a step's final one.
        statuses: list[int] = []
        serve = client.transport

        def recording(request: Any, timeout: float) -> Any:
            response = serve(request, timeout)
            statuses.append(response.status)
            return response

        client.transport = recording
        saved: dict[str, Any] = {}
        for index, step in enumerate(scenario["steps"], 1):
            for run in range(step.get("repeat", 1)):
                label = f"step {index}{f' run {run + 1}' if 'repeat' in step else ''} ({step['operation']})"
                args = _resolve(step.get("args", {}), saved)
                expect = step.get("expect", {})
                if "error" in expect:
                    with self.assertRaises(CalmLensError, msg=label) as raised:
                        _run(client, step["operation"], args, moderate_calls)
                    error = raised.exception
                    want = dict(expect["error"])
                    wanted_details = want.pop("details", {})
                    if "retryAfter" in want:
                        self.assertEqual(error.retry_after, want.pop("retryAfter"), f"{label}: retryAfter")
                    self.assertEqual({"code": error.code, "status": error.status}, want, label)
                    # ``details`` lists only the keys to compare, and objects in them (such as each
                    # of a validation error's ``issues``) only the fields to compare.
                    for key, value in wanted_details.items():
                        wanted = _resolve(value, saved)
                        self.assertEqual(_only_listed(_json(error.details.get(key)), wanted), wanted,
                                         f"{label}: details.{key}")
                    continue
                statuses.clear()
                result = _run(client, step["operation"], args, moderate_calls)
                if "httpStatus" in expect:
                    self.assertEqual(statuses[-1:], [expect["httpStatus"]], f"{label}: final response status")
                if "cdn" in expect:
                    self._check_cdn(result, _resolve(expect["cdn"], saved), label)
                if "sameAs" in expect:
                    self.assertIn(expect["sameAs"], saved, label)
                    self.assertEqual(result, saved[expect["sameAs"]], f"{label}: same as {expect['sameAs']}")
                for path, wanted in expect.get("result", {}).items():
                    actual = _at(result, path)
                    if isinstance(wanted, dict) and "$contains" in wanted:
                        self.assertIn(_resolve(wanted["$contains"], saved), actual, f"{label}: {path}")
                    elif isinstance(wanted, dict) and "$queryJson" in wanted:
                        query = dict(parse_qsl(urlsplit(actual).query))
                        for name, value in wanted["$queryJson"].items():
                            self.assertIn(name, query, f"{label}: {path} ?{name}")
                            self.assertEqual(json.loads(query[name]), value, f"{label}: {path} ?{name}")
                    elif isinstance(wanted, dict) and "$id" in wanted:
                        self.assertIsInstance(actual, str, f"{label}: {path}")
                        self.assertRegex(actual, rf"\A{wanted['$id']}_[0-9A-Za-z]{{20}}\Z", f"{label}: {path}")
                    else:
                        self.assertEqual(actual, _resolve(wanted, saved), f"{label}: {path}")
                if "save" in step:
                    saved[step["save"]] = result

    def _check_cdn(self, result: dict[str, Any], want: dict[str, Any], label: str) -> None:
        self.assertEqual(result["status"], want["status"], f"{label}: status")
        if "code" in want:
            self.assertEqual(result["code"], want["code"], f"{label}: code")
        if "body" in want:
            self.assertEqual(result["bytes"].decode("utf-8", "replace"), want["body"], f"{label}: body")
        # Header names are case-insensitive; CDNResponse.headers has lower-case names.
        for name, value in (want.get("headers") or {}).items():
            self.assertEqual(result["headers"].get(name.lower()), value, f"{label}: {name} header")
        for name in want.get("headersPresent") or []:
            self.assertIn(name.lower(), result["headers"], f"{label}: {name} header")
        if "bodyPrefixBase64" in want:
            prefix = base64.b64decode(want["bodyPrefixBase64"])
            self.assertEqual(result["bytes"][:len(prefix)], prefix, f"{label}: body prefix")


class SignedTestInputTests(unittest.TestCase):
    """The signed test inputs in test-inputs.json, byte for byte."""
    FIXTURE = _fixture("test-inputs.json")

    def test_presets(self) -> None:
        presets = {re.sub(r"_([a-z])", lambda match: match[1].upper(), name): preset
                   for name, preset in testing.TEST_INPUT_PRESETS.items()}
        self.assertEqual(presets, self.FIXTURE["presets"])

    def test_signals(self) -> None:
        self.assertEqual(list(testing.TEXT_TEST_SIGNALS), self.FIXTURE["signals"]["text"])
        self.assertEqual(list(testing.MEDIA_TEST_SIGNALS), self.FIXTURE["signals"]["media"])
        for case in self.FIXTURE["signalInputs"]:
            with self.subTest(signal=case["signal"], kind=case["kind"]):
                self.assertEqual(testing.signal_test_input(case["signal"], case["kind"]), case["input"])

    def test_accepts_exactly_the_fixture_qualifiers(self) -> None:
        key = self.FIXTURE["text"][0]["key"]
        for category, qualifiers in self.FIXTURE["qualifiers"].items():
            with self.subTest(category=category):
                accepted = []
                for qualifier in _mock_classification.QUALIFIERS[category]:
                    try:
                        testing.generate_test_text_code(
                            {"instances": [{"category": category, "qualifiers": [qualifier]}]}, key)
                    except CalmLensInvalidArgumentError as error:
                        self.assertEqual(error.code, "sdk/invalid-argument")
                    else:
                        accepted.append(qualifier)
                self.assertEqual(accepted, qualifiers)

    def test_detection_limits(self) -> None:
        """Detections accept exactly the fixture's limits and age presets."""
        limits, key = self.FIXTURE["detections"], self.FIXTURE["text"][0]["key"]
        self.assertEqual(list(_mock_classification.TEST_FACE_AGE_PRESETS), list(limits["agePresets"]))

        def code(detections: dict[str, Any]) -> str:
            return testing.generate_test_text_code({"instances": [], "detections": detections}, key)

        box_max, age_max = limits["boxMax"], limits["ageMax"]
        accepted = [{"faces": [{"box": [0, 0, 1, 1]}] * limits["maxEntries"]},
                    {"people": [{"box": [0, 0, box_max, box_max]}]},
                    {"faces": [{"box": [0, 0, 1, 1], "age": {"low": 0, "high": age_max}}]},
                    *({"faces": [{"box": [0, 0, 1, 1], "age": preset}]} for preset in limits["agePresets"])]
        for detections in accepted:
            with self.subTest(accepted=detections):
                code(detections)
        rejected = [{"faces": [{"box": [0, 0, 1, 1]}] * (limits["maxEntries"] + 1)},
                    {"people": [{"box": [0, 0, box_max + 1, 1]}]},
                    {"faces": [{"box": [0, 0, 1, 1], "age": {"low": 0, "high": age_max + 1}}]}]
        for detections in rejected:
            with self.subTest(rejected=detections):
                with self.assertRaises(CalmLensInvalidArgumentError) as raised:
                    code(detections)
                self.assertEqual(raised.exception.code, "sdk/invalid-argument")

    def test_text_codes(self) -> None:
        for case in self.FIXTURE["text"]:
            with self.subTest(case["name"]):
                self.assertEqual(testing.generate_test_text_code(case.get("input", case.get("signal")), case["key"]),
                                 case["code"])

    def test_media_phrases(self) -> None:
        for case in self.FIXTURE["media"]:
            with self.subTest(case["signal"]):
                self.assertEqual(testing.generate_media_test_code(case["signal"], case["key"]), case["code"])

    def test_images(self) -> None:
        for case in self.FIXTURE["images"]:
            with self.subTest(case["name"]):
                image = testing.paint_test_image(case.get("input", case.get("signal")), case["key"])
                self.assertEqual((image.width, image.height), (case["width"], case["height"]))
                self.assertEqual(hashlib.sha256(image.rgba).hexdigest(), case["rgbaSha256"])
                self.assertEqual(_fixture_levels(image, case["cells"]), case["levels"])
                self.assertEqual(_decode_png(image.png), (image.width, image.height, image.rgba))
        for case in self.FIXTURE["imageRejections"]:
            with self.subTest(case["name"]):
                with self.assertRaises(CalmLensInvalidArgumentError) as raised:
                    testing.paint_test_image(case.get("input", case.get("signal")), case["key"])
                self.assertEqual(raised.exception.code, "sdk/invalid-argument")

    def test_rejections(self) -> None:
        for case in self.FIXTURE["rejections"]:
            with self.subTest(case["name"], kind=case["kind"]):
                with self.assertRaises(CalmLensInvalidArgumentError) as raised:
                    if case["kind"] == "media":
                        testing.generate_media_test_code(case["signal"], case["key"])
                    else:
                        testing.generate_test_text_code(case.get("input", case.get("signal")), case["key"])
                self.assertEqual(raised.exception.code, "sdk/invalid-argument")


def _fixture_levels(image: testing.PaintedTestImage, cells: int) -> str:
    """Each cell's level as packages/sdk-contract/testInputs.ts records it: "r" for the outer ring,
    else the data level (0-3) nearest the luma of the cell's top-left pixel."""
    levels = _signed_test_inputs._GRID_LEVELS
    size = image.width // cells

    def level(row: int, column: int) -> str:
        if row in (0, cells - 1) or column in (0, cells - 1):
            return "r"
        offset = (row * size * image.width + column * size) * 4
        red, green, blue = image.rgba[offset:offset + 3]
        luma = (77 * red + 150 * green + 29 * blue) >> 8
        return str(min(range(len(levels)), key=lambda index: abs(levels[index] - luma)))

    return "".join(level(row, column) for row in range(cells) for column in range(cells))


def _decode_png(png: bytes) -> tuple[int, int, bytes]:
    """Width, height and RGBA of an unfiltered 8-bit RGBA PNG, checking every chunk's CRC."""
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    offset, chunks = 8, {}
    while offset < len(png):
        (length,) = struct.unpack(">I", png[offset:offset + 4])
        kind, body = png[offset + 4:offset + 8], png[offset + 8:offset + 8 + length]
        assert struct.unpack(">I", png[offset + 8 + length:offset + 12 + length])[0] == zlib.crc32(kind + body)
        chunks[kind] = chunks.get(kind, b"") + body
        offset += 12 + length
    width, height, depth, colour, *_ = struct.unpack(">IIBBBBB", chunks[b"IHDR"])
    assert (depth, colour) == (8, 6)
    raw = zlib.decompress(chunks[b"IDAT"])
    stride = width * 4 + 1
    assert all(raw[row * stride] == 0 for row in range(height))
    return width, height, b"".join(raw[row * stride + 1:(row + 1) * stride] for row in range(height))


if __name__ == "__main__":
    unittest.main()
import collections.abc
# ---- Declared types ---------------------------------------------------------------------------

TYPES = _fixture("types.json")

#: Option fields with Python-native forms that ``types.json`` leaves out, as the README's
#: "Declared types" section describes: upload payloads and the client-side wait.
_NATIVE_OPTIONS: dict[str, dict[str, str]] = {
    "assets.create": {
        "content": "the upload payload (bytes, base64, text or a file), sent as the multipart file",
        "part": "the first part of a multipart upload, sent as the multipart file",
        "url": "a remote URL to fetch, the payload's URL form",
        "totalSizeInBytes": "the multipart upload's total size, sent with the upload payload",
    },
    "assets.uploadPart": {
        "part": "the part's payload, sent as the multipart file",
    },
}

#: Options every operation leaves out of ``types.json``: the client supplies the project, and ``wait``
#: is the classify helpers' own polling (README "Declared types").
_CLIENT_OPTIONS = {"projectId": "the client's project", "wait": "the client's own polling for a decision"}

#: Fields and values the SDK keeps for API features a feature switch in
#: ``packages/shared/src/SharedConstants.ts`` hides, so ``types.json`` lacks them.
_SWITCHED_FIELDS = {"linkSafety": "ENABLE_LINK_SAFETY", "aiGeneratedDetection": "ENABLE_AI_GENERATED_DETECTION"}
_SWITCHED_VALUES = {
    # The asset.link-flagged event, its facts and the link-safety moderation source.
    **{value: "ENABLE_LINK_SAFETY" for value in ("asset.link-flagged", "link-safety", "link-verdict", "link-url",
                                                 "link-final-url", "link-status")},
}

#: Keyword arguments every method takes that aren't API options: per-call request options.
_OPTION_KEYWORDS = {"options"}

#: Differences Python cannot express, keyed by ``(operation, side, path)``, with the reason.
_TYPE_ALLOWLIST: dict[tuple[str, str, str], str] = {
    ("events.list", "result", "$.items[].facts[].value"):
        "one EventFact TypedDict holds every fact; a fact value's type depends on its key, which a "
        "TypedDict cannot tie to another field's literal, so the value is Any",
}

#: Python's JSON value (metadata item values): typing has no JSON type, so it is ``Any``.
_JSON_KINDS = {"string", "number", "boolean", "null", "array", "object"}

#: Literal sets Python keeps open in options too, with the reason.
_OPEN_OPTION_VALUES = {
    "ModerationQualifier": "policy settings are read from a policy and sent back, so their rules share the "
                           "response's open qualifier type",
}

_NONE = type(None)
_UNION_ORIGINS: tuple[Any, ...] = (typing.Union, __import__("types").UnionType)
_LIST_ORIGINS: tuple[Any, ...] = (list, collections.abc.Sequence)
_DICT_ORIGINS: tuple[Any, ...] = (dict, collections.abc.Mapping)


def _unwrap(declared: Any) -> Any:
    """``declared`` without ``Annotated``, ``Required`` and ``NotRequired``."""
    while True:
        origin = typing.get_origin(declared)
        if origin is typing.Annotated:
            declared = typing.get_args(declared)[0]
        elif origin is not None and getattr(origin, "_name", None) in ("Required", "NotRequired"):
            declared = typing.get_args(declared)[0]
        else:
            return declared


def _members(declared: Any) -> list[Any]:
    """A union's members, flattened, or ``[declared]``."""
    declared = _unwrap(declared)
    if typing.get_origin(declared) in _UNION_ORIGINS:
        return [member for arg in typing.get_args(declared) for member in _members(arg)]
    return [declared]


def _describe(declared: Any) -> str:
    return getattr(declared, "__name__", None) or str(declared).replace("typing.", "")


class _TypeWalker:
    """Walks a declared Python type alongside a JSON Schema from ``types.json``."""

    def __init__(self, operation: str, side: str, method: str = "GET"):
        self.operation, self.side, self.method = operation, side, method
        self.problems: list[str] = []

    def report(self, path: str, problem: str) -> None:
        if (self.operation, self.side, path) not in _TYPE_ALLOWLIST:
            self.problems.append(f"{self.operation} {self.side} {path}: {problem}")

    def problems_of(self, schema: Any, declared: Any, path: str, seen: frozenset[str]) -> list[str]:
        """The problems of one comparison, without reporting them."""
        walker = _TypeWalker(self.operation, self.side, self.method)
        walker.compare(schema, declared, path, seen)
        return walker.problems

    @staticmethod
    def deref(schema: Any, seen: frozenset[str]) -> tuple[Any, frozenset[str]] | None:
        """``schema`` with its references resolved, or ``None`` at a reference already being walked."""
        while isinstance(schema, dict) and "$ref" in schema:
            name = schema["$ref"].removeprefix("#/definitions/")
            if name in seen:
                return None
            seen = seen | {name}
            schema = TYPES["definitions"][name]
        return schema, seen

    def split_null(self, schema: dict[str, Any], seen: frozenset[str]) -> tuple[bool, list[Any]]:
        """Whether the schema allows ``null``, and its other branches (each resolved)."""
        branches = schema.get("anyOf") or schema.get("oneOf")
        if branches is None:
            kinds = schema.get("type")
            if isinstance(kinds, list):
                rest = [kind for kind in kinds if kind != "null"]
                if rest == ["boolean", "string"]:
                    # Booleans sent in form fields arrive as strings; the SDK declares bool.
                    rest = ["boolean"]
                branches = [{**schema, "type": kind} for kind in rest]
                return "null" in kinds, branches
            if kinds == "null":
                return True, []
            return False, [schema]
        nullable, rest = False, []
        for branch in branches:
            resolved = self.deref(branch, seen)
            if resolved is None:
                rest.append(branch)
                continue
            inner_nullable, inner = self.split_null(resolved[0], resolved[1])
            nullable = nullable or inner_nullable
            rest.extend(item for item in inner if item != {"type": "null"})
        return nullable, rest

    def compare(self, schema: Any, declared: Any, path: str, seen: frozenset[str], null_checked: bool = False) -> None:
        resolved = self.deref(schema, seen)
        if resolved is None:
            return
        schema, seen = resolved
        members = _members(declared)
        if not {key for key in schema if key not in ("format",)} - {"type"} and "type" not in schema:
            if members != [Any]:
                self.report(path, f"declared {_describe(declared)}, but the schema is an open JSON value (Any)")
            return
        if members == [Any]:
            if not self.is_json_value(schema, seen):
                self.report(path, "declared Any, but the schema has a type")
            return
        nullable, branches = self.split_null(schema, seen)
        declared_nullable = _NONE in members
        members = [member for member in members if member is not _NONE]
        if null_checked:
            pass  # The object's field rule already compared Optional with null and absence.
        elif nullable and not declared_nullable and (self.side == "result" or self.method == "PATCH"):
            self.report(path, "the schema allows null, but the declared type is not Optional")
        elif declared_nullable and not nullable:
            self.report(path, "declared Optional, but the schema does not allow null")
        if not branches:
            return
        self.compare_branches(branches, members, path, seen)

    def compare_branches(self, branches: list[Any], members: list[Any], path: str, seen: frozenset[str]) -> None:
        values = self.values(branches)
        if values is not None:
            self.compare_values(values, members, path)
            return
        if len(branches) == 1:
            self.compare_one(branches[0], members, path, seen)
            return
        objects = [self.deref(branch, seen) for branch in branches]
        typed_dicts = [member for member in members if typing.is_typeddict(member) or _is_model(member)]
        if len(typed_dicts) == 1 and len(members) == 1 and all(
                item is not None and item[0].get("type") == "object" and "properties" in item[0] for item in objects):
            # One TypedDict for every object branch: compare it with their merged properties.
            self.compare_one(self.merge([item[0] for item in objects if item is not None]), members, path, seen)
            return
        tag = self.tag([item[0] for item in objects if item is not None]) if None not in objects else None
        if tag is not None and typed_dicts and len(typed_dicts) == len(members):
            self.compare_tagged(tag, [item[0] for item in objects if item is not None], typed_dicts, path, seen)
            return
        unmatched = list(members)
        leftovers: list[Any] = []
        for branch in branches:
            match = next((member for member in unmatched
                          if not self.problems_of(branch, member, path, seen)), None)
            if match is None:
                leftovers.append(branch)
            else:
                unmatched.remove(match)
        for branch in leftovers:
            if len(leftovers) == 1 and len(unmatched) == 1:
                self.compare(branch, unmatched.pop(), path, seen)
            else:
                self.report(path, f"no declared member covers the schema branch {self.summary(branch)}")
        for member in unmatched:
            self.report(path, f"declared member {_describe(member)} matches no schema branch")

    def is_json_value(self, schema: dict[str, Any], seen: frozenset[str]) -> bool:
        """Whether ``schema`` is any JSON value: a union of every JSON kind."""
        branches = schema.get("anyOf") or schema.get("oneOf") or []
        kinds: set[str] = set()
        for branch in branches:
            resolved = self.deref(branch, frozenset())
            kind = resolved[0].get("type") if resolved else None
            kinds.update(kind if isinstance(kind, list) else [str(kind)])
        return kinds == _JSON_KINDS

    @staticmethod
    def tag(objects: list[dict[str, Any]]) -> str | None:
        """The property every object branch holds as a distinct constant (``type`` or ``key``)."""
        for name in ("type", "key", "kind"):
            values = [item.get("properties", {}).get(name, {}).get("const") for item in objects]
            if None not in values and len(set(values)) == len(values):
                return name
        return None

    def compare_tagged(self, tag: str, objects: list[dict[str, Any]], members: list[Any], path: str,
                       seen: frozenset[str]) -> None:
        """Pair a tagged union's branches with the TypedDicts whose ``tag`` literal holds their value."""
        by_value: dict[Any, Any] = {}
        for member in members:
            hint = typing.get_type_hints(member, include_extras=True).get(tag)
            for value in [arg for item in _members(hint) if typing.get_origin(item) is typing.Literal
                          for arg in typing.get_args(item)]:
                by_value[value] = member
        grouped: dict[Any, list[dict[str, Any]]] = {}
        for item in objects:
            value = item["properties"][tag]["const"]
            member = by_value.get(value)
            if member is None:
                self.report(path, f"no declared member has {tag} {value!r}")
            else:
                grouped.setdefault(member, []).append(item)
        for member in members:
            items = grouped.get(member)
            if not items:
                self.report(path, f"declared member {_describe(member)} matches no schema branch")
                continue
            values = ",".join(str(item["properties"][tag]["const"]) for item in items)
            # A member may cover several tags (``kind: Literal["default", "below-threshold"]``).
            self.compare_object(items[0] if len(items) == 1 else self.merge(items), member, f"{path}<{values}>", seen)

    @staticmethod
    def summary(schema: Any) -> str:
        return json.dumps(schema)[:120]

    def merge(self, objects: list[dict[str, Any]]) -> dict[str, Any]:
        """Object branches as one object: every property, as the union of its branches' schemas,
        required where every branch requires it."""
        properties: dict[str, list[Any]] = {}
        for item in objects:
            for name, property_schema in item["properties"].items():
                if property_schema not in properties.setdefault(name, []):
                    properties[name].append(property_schema)
        required = set.intersection(*(set(item.get("required", [])) for item in objects))
        return {"type": "object",
                "properties": {name: self.merge_values(schemas) for name, schemas in properties.items()},
                "required": sorted(required)}

    def merge_values(self, schemas: list[Any]) -> Any:
        """One property's schemas across merged branches: arrays as one array of their items."""
        if len(schemas) == 1:
            return schemas[0]
        resolved = [self.deref(schema, frozenset()) for schema in schemas]
        if all(item is not None and item[0].get("type") == "array" and "items" in item[0] for item in resolved):
            items: list[Any] = []
            for item in resolved:
                assert item is not None
                inner = item[0]["items"]
                for branch in inner.get("oneOf") or inner.get("anyOf") or [inner]:
                    if branch not in items:
                        items.append(branch)
            return {"type": "array", "items": {"anyOf": items}}
        return {"anyOf": schemas}

    def values(self, branches: list[Any]) -> list[Any] | None:
        """The listed values when every branch is an ``enum`` or ``const``."""
        values: list[Any] = []
        for branch in branches:
            resolved = self.deref(branch, frozenset())
            if resolved is None:
                return None
            item = resolved[0]
            if "const" in item:
                values.append(item["const"])
            elif "enum" in item:
                values.extend(item["enum"])
            else:
                return None
        return values

    def compare_values(self, values: list[Any], members: list[Any], path: str) -> None:
        declared: list[Any] = []
        others = []
        for member in members:
            if typing.get_origin(member) is typing.Literal:
                declared.extend(typing.get_args(member))
            else:
                others.append(member)
        kinds = {type(value) for value in values}
        if others == [str] and kinds == {str} and declared and (
                self.side == "result" or self.open_in_options(members)):
            others = []  # Responses keep enum-like strings open: the listed literals or str.
        if others:
            self.report(path, f"declared {', '.join(map(_describe, others))}, but the schema lists only "
                              f"{sorted(map(str, values))}")
        if not declared and others:
            return
        missing = [value for value in values if value not in declared]
        extra = [value for value in declared if value not in values and value not in _SWITCHED_VALUES]
        if missing:
            self.report(path, f"the declared literals lack {missing}")
        if extra:
            self.report(path, f"declared literals {extra} the schema lacks")

    @staticmethod
    def open_in_options(members: list[Any]) -> bool:
        return any(set(members) == set(_members(getattr(calmlens.types, name))) for name in _OPEN_OPTION_VALUES)

    def compare_one(self, schema: dict[str, Any], members: list[Any], path: str, seen: frozenset[str]) -> None:
        kind = schema.get("type")
        if len(members) != 1:
            self.report(path, f"declared a union of {', '.join(map(_describe, members))}, but the schema "
                              f"has one branch {self.summary(schema)}")
            return
        declared = members[0]
        origin = typing.get_origin(declared)
        if typing.get_origin(declared) is typing.Literal:
            self.report(path, f"declared literals {list(typing.get_args(declared))}, but the schema lists no values")
            return
        if kind == "string":
            if declared is not str:
                self.report(path, f"declared {_describe(declared)}, but the schema is a string")
        elif kind == "boolean":
            if declared is not bool:
                self.report(path, f"declared {_describe(declared)}, but the schema is a boolean")
        elif kind == "integer":
            if declared not in (int, float):
                self.report(path, f"declared {_describe(declared)}, but the schema is an integer")
        elif kind == "number":
            if declared is int:
                self.report(path, "declared int, but the schema is a number that can have a fraction")
            elif declared is not float:
                self.report(path, f"declared {_describe(declared)}, but the schema is a number")
        elif kind == "array":
            if "prefixItems" in schema:
                args = typing.get_args(declared)
                if origin is not tuple or len(args) != len(schema["prefixItems"]):
                    self.report(path, f"declared {_describe(declared)}, but the schema is a "
                                      f"{len(schema['prefixItems'])}-item tuple")
                    return
                for index, (item, arg) in enumerate(zip(schema["prefixItems"], args)):
                    self.compare(item, arg, f"{path}[{index}]", seen)
            elif origin not in _LIST_ORIGINS:
                self.report(path, f"declared {_describe(declared)}, but the schema is an array")
            else:
                self.compare(schema.get("items", {}), typing.get_args(declared)[0], f"{path}[]", seen)
        elif kind == "object":
            if "properties" in schema:
                self.compare_object(schema, declared, path, seen)
            elif schema.get("additionalProperties", {}) == {} and (typing.is_typeddict(declared) or origin in _DICT_ORIGINS):
                pass  # A record of open values accepts any declared object.
            elif origin in _DICT_ORIGINS:
                key, value = typing.get_args(declared)
                names = schema.get("propertyNames")
                if names is not None:
                    _, branches = self.split_null(names, seen)
                    self.compare_branches(branches, _members(key), f"{path}{{key}}", seen)
                elif key is not str:
                    self.report(path, f"declared keys {_describe(key)}, but the schema's keys are strings")
                additional = schema.get("additionalProperties")
                self.compare(additional if isinstance(additional, dict) else {}, value, f"{path}{{}}", seen)
            else:
                self.report(path, f"declared {_describe(declared)}, but the schema is a record")
        elif kind is None and not ({"enum", "const", "properties", "items"} & schema.keys()):
            if declared is not Any:
                self.report(path, f"declared {_describe(declared)}, but the schema is an open JSON value (Any)")
        else:
            self.report(path, f"the schema type {kind!r} has no Python mapping in this runner")

    def compare_object(self, schema: dict[str, Any], declared: Any, path: str, seen: frozenset[str]) -> None:
        if typing.get_origin(declared) in _DICT_ORIGINS and set(schema.get("required", [])) == set(schema["properties"]):
            # A map keyed by a literal set, every key present (``Dict[ClassificationCategory, ...]``).
            key, value = typing.get_args(declared)
            self.compare_values(list(schema["properties"]), _members(key), f"{path}{{key}}")
            for name, property_schema in schema["properties"].items():
                self.compare(property_schema, value, f"{path}.{name}", seen)
            return
        model = _is_model(declared)
        if not model and not typing.is_typeddict(declared):
            self.report(path, f"declared {_describe(declared)}, but the schema is an object with properties")
            return
        hints = _declared_fields(declared)
        required = set(schema.get("required", []))
        for name, property_schema in schema["properties"].items():
            field = f"{path}.{name}"
            attribute = name if name in hints else _attribute(name)
            if attribute not in hints:
                self.report(field, f"the schema property is not declared (as {attribute})")
                continue
            if model:
                # A result object reads an absent field as None, so a field the API may leave out
                # is Optional, as one it may send as null is.
                nullable, _ = self.split_null(self.deref(property_schema, seen)[0], seen) \
                    if self.deref(property_schema, seen) else (False, [])
                optional = _NONE in _members(hints[attribute]) or hints[attribute] is Any
                if hints[attribute] is Any:
                    pass  # A JSON value: Any holds null and absence too.
                elif optional and not (nullable or name not in required):
                    self.report(field, "declared Optional, but the API always sends it and never null")
                elif not optional and (nullable or name not in required):
                    self.report(field, "the API may leave it out or send null, but it is not declared Optional")
                self.compare(property_schema, hints[attribute], field, seen, null_checked=True)
                continue
            required_keys = declared.__required_keys__
            if name in required and attribute not in required_keys:
                self.report(field, "the schema requires it, but it is declared NotRequired")
            elif name not in required and attribute in required_keys:
                self.report(field, "the schema does not require it, but it is declared Required")
            self.compare(property_schema, hints[attribute], field, seen)
        names = {name if name in hints else _attribute(name) for name in schema["properties"]}
        for attribute in hints:
            if attribute not in names and attribute not in _SWITCHED_FIELDS \
                    and _camel_attribute(attribute) not in _SWITCHED_FIELDS:
                self.report(f"{path}.{attribute}", "declared, but the schema lacks it")


def _is_model(declared: Any) -> bool:
    return isinstance(declared, type) and issubclass(declared, calmlens.CalmLensObject)


def _declared_fields(declared: Any) -> dict[str, Any]:
    """A result object's attributes, or a TypedDict's keys, with their types."""
    return {name: hint for name, hint in typing.get_type_hints(declared, include_extras=True).items()
            if not name.startswith("_")}


def _camel_attribute(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(word.title() for word in tail)


def _operation_method(operation: dict[str, Any]) -> Any:
    client = CalmLensServerClient(api_key="ck_test", project_id="project-1")
    return _resolve_name(client, operation["names"]["python"])


def _check_options(operation: dict[str, Any]) -> list[str]:
    """The method's keyword arguments against the operation's options: one keyword per option, in
    snake_case, with no default exactly when the API requires the option."""
    walker = _TypeWalker(operation["id"], "options", operation["method"])
    method = _operation_method(operation)
    native = {**_NATIVE_OPTIONS.get(operation["id"], {}), **_CLIENT_OPTIONS,
              **{name: "a client option (types.json clientOptions)" for name in operation["options"].get("clientOptions", [])}}
    properties = {name: spec["schema"] for name, spec in operation["options"]["properties"].items()}
    required = set(operation["options"]["required"])
    hints = typing.get_type_hints(method, include_extras=True)
    keywords = {name: parameter for name, parameter in inspect.signature(method).parameters.items()
                if parameter.kind is inspect.Parameter.KEYWORD_ONLY}
    for name, property_schema in properties.items():
        keyword = _attribute(name)
        if keyword not in keywords:
            walker.report(f"$.{name}", f"no keyword argument {keyword}")
            continue
        has_default = keywords[keyword].default is not inspect.Parameter.empty
        if name in required and has_default:
            walker.report(f"$.{name}", f"the API requires it, but keyword {keyword} has a default")
        elif name not in required and not has_default:
            walker.report(f"$.{name}", f"the API does not require it, but keyword {keyword} has no default")
        walker.compare(property_schema, hints[keyword], f"$.{name}", frozenset())
    for keyword in keywords:
        if _camel_attribute(keyword) not in properties and _camel_attribute(keyword) not in native \
                and keyword not in _OPTION_KEYWORDS:
            walker.report(f"$.{keyword}", "a keyword argument the API's options lack")
    return walker.problems


def _check_result(operation: dict[str, Any]) -> list[str]:
    walker = _TypeWalker(operation["id"], "result")
    if operation["result"] is None:
        return walker.problems  # No model: deletes, and the lens helpers' own results.
    declared = typing.get_type_hints(_operation_method(operation), include_extras=True)["return"]
    if declared is _NONE:
        walker.report("$", "declared None, but the operation returns a model")
    else:
        walker.compare(operation["result"], declared, "$", frozenset())
    return walker.problems


class DeclaredTypeTests(unittest.TestCase):
    """Each operation's declared options and result types against ``types.json``."""

    def test_every_operation_has_a_method(self) -> None:
        missing = [operation["id"] for operation in TYPES["operations"] if _operation_method(operation) is None]
        self.assertEqual(missing, [])

    def test_option_types_match_the_api(self) -> None:
        problems = [problem for operation in TYPES["operations"] for problem in _check_options(operation)]
        self.assertEqual(problems, [], "\n" + "\n".join(problems))

    def test_result_types_match_the_api(self) -> None:
        problems = [problem for operation in TYPES["operations"] for problem in _check_result(operation)]
        self.assertEqual(problems, [], "\n" + "\n".join(problems))


