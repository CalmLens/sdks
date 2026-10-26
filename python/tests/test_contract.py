"""Replay the shared SDK contract fixtures that packages/sdk-contract writes to sdks/go/testdata
(format in packages/sdk-contract/README.md): requests captured from the JavaScript SDK, path
safety and CDN URLs, API errors, scripted client cases, transform options, webhooks, upload
tokens, the mock behaviour scenarios, the server SDK surface, defaults and rejections. Each
fixture case is its own subtest; cases a capability marks not applicable to Python are skipped
by name with the reason."""
from __future__ import annotations

import base64
import email.message
import hashlib
import hmac
import importlib
import inspect
import io
import json
import re
import typing
import unittest
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit

import calmlens
from calmlens import (CalmLensAPIError, CalmLensError, CalmLensServerClient, CalmLensTimeoutError,
                      CalmLensTransportError, CalmLensValidationError, WebhookVerificationError, client as client_module,
                      is_test_webhook_event, parse_webhook_event, testing, to_webhook_event_payload,
                      verify_webhook_signature)
from calmlens.client import _serialize_transform
from calmlens.testing import MockCalmLensServerClient, create_mock_api_key, sign_upload_token
from calmlens.types import IMAGE_TRANSFORM_COLOUR_KEYS, ImageTransformOptions
from calmlens.webhooks import create_webhook_headers, create_webhook_signature_header

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


def _json(value: Any) -> Any:
    """A result as the JSON the fixtures hold."""
    return json.loads(json.dumps(value))


# ---- Translating JavaScript operations and options --------------------------------------------

#: JavaScript iterator names to Python's.
_ITERATORS = {"assets.iterate": "assets.iter", "assets.iterateChildren": "assets.iter_children",
              "events.iterate": "events.iter_pages", "events.pages": "events.iter_pages"}


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


def _invoke(client: CalmLensServerClient, operation: str, args: Any) -> Any:
    """Run a JavaScript client operation with JavaScript option names on the Python client."""
    args = dict(args or {})
    for key in ("content", "part"):
        if key in args:
            args[key] = _content(args[key])
    if operation in _ITERATORS:
        items: list[Any] = []
        try:
            for item in _resolve_name(client, _ITERATORS[operation])(args):
                items.append(item)
        except CalmLensError as error:
            raise _Partial(items, error) from error
        return items
    if operation == "assets.waitForDecision" and "timeoutMs" in args:
        args["timeout"] = args.pop("timeoutMs") / 1000
    keywords = {}
    if "idempotencyKey" in args:
        keywords["idempotency_key"] = args.pop("idempotencyKey")
    return _resolve_name(client, _snake(operation))(args, **keywords)


def _client_options(options: dict[str, Any]) -> dict[str, Any]:
    """JavaScript client options to Python's keyword arguments (milliseconds become seconds)."""
    names = {"apiKey": "api_key", "projectId": "project_id", "baseUrl": "base_url", "cdnBaseUrl": "cdn_base_url",
             "maxRetries": "max_retries", "maxResponseBytes": "max_response_bytes"}
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
    """The error fields every runner compares, ``None`` where there is none (Python's empty
    ``details`` dict is no details)."""
    assert isinstance(error, CalmLensError), repr(error)
    return {"code": error.code, "status": error.status, "requestId": error.request_id,
            "retryAfter": error.retry_after, "details": _json(error.details) if error.details else None}


class _Response(io.BytesIO):
    """A scripted HTTP response a custom transport returns."""

    def __init__(self, status: int, headers: dict[str, str] | list[tuple[str, str]], body: bytes = b""):
        super().__init__(body)
        self.status = status
        self.headers = headers


def _json_response(body: Any, status: int = 200, headers: dict[str, str] | None = None) -> _Response:
    return _Response(status, {"content-type": "application/json", **(headers or {})}, json.dumps(body).encode())


def _refuse(request: Any, timeout: float) -> Any:
    raise AssertionError(f"Sent {request.full_url}")


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
            with self.subTest(f"{index}: {fixture['operation']}"):
                captured = []

                def transport(request: Any, timeout: float, response: Any = fixture["response"]) -> _Response:
                    captured.append((request, _body_bytes(request.data)))
                    return _json_response(response)
                result = _invoke(_client(transport), fixture["operation"], fixture["options"])
                self.assertEqual(len(captured), 1)
                request, data = captured[0]
                url = urlsplit(request.full_url)
                body: Any = data.decode() if data else None
                if body and request.headers.get("Content-type") == "application/json":
                    body = json.loads(body)
                self.assertEqual({"method": request.method, "path": url.path, "query": dict(parse_qsl(url.query)),
                                  "body": body}, fixture["request"])
                # Deletes and removeEntry return nothing; ensureLenses returns the lenses; everything
                # else the body.
                returns_nothing = fixture["operation"].endswith(".delete") or fixture["operation"] == "hashLists.removeEntry"
                expected = (None if returns_nothing else fixture["response"]["lenses"]
                            if fixture["operation"] == "ensureLenses" else fixture["response"])
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
                    self.assertEqual(c.cdn.get_asset_url(case["options"]), case["url"])
                else:
                    with self.assertRaises(CalmLensError) as raised:
                        c.cdn.get_asset_url(case["options"])
                    self.assertEqual(raised.exception.code, case["error"])

    def test_api_errors(self) -> None:
        """Every API error code becomes a typed error with every field."""
        for fixture in _fixture("errors.json"):
            with self.subTest(fixture["code"]):
                response = fixture["response"]

                def transport(request: Any, timeout: float, response: Any = response) -> _Response:
                    return _Response(response["status"], response["headers"], json.dumps(response["body"]).encode())
                with self.assertRaises(CalmLensAPIError) as raised:
                    _invoke(_client(transport), fixture["operation"], fixture["args"])
                self.assertEqual(_error_fields(raised.exception), fixture["expected"])


class TransformTests(unittest.TestCase):
    fixture = _fixture("transform-options.json")

    def test_transform_options(self) -> None:
        """Every transform option serializes to the step the CDN writes for it."""
        for case in self.fixture["cases"]:
            with self.subTest(options=case["options"]):
                step = {"type": "imageTransform", "options": case["options"]}
                self.assertEqual(_serialize_transform(step), case["selector"])

    def test_option_names(self) -> None:
        self.assertEqual(sorted(typing.get_type_hints(ImageTransformOptions)), sorted(self.fixture["options"]))

    def test_colour_keys(self) -> None:
        self.assertEqual(sorted(IMAGE_TRANSFORM_COLOUR_KEYS), sorted(self.fixture["colourKeys"]))


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
        self.received.append({"method": request.get_method(), "url": request.full_url,
                              "headers": {name.lower(): value for name, value in request.header_items()},
                              "body": _body_bytes(request.data)})
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
                self._run_case(case)

    def _run_case(self, case: dict[str, Any]) -> None:
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
                    result = _invoke(client, step["operation"], _decode_args(step.get("args") or {}))
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
            if "body" in want:
                if want["body"] is None:
                    self.assertEqual(got["body"], b"", f"{label}: no body")
                else:
                    self.assertEqual(json.loads(got["body"]), want["body"], f"{label}: body")
            else:
                actual = {"bodyLength": len(got["body"]), "bodySha256": hashlib.sha256(got["body"]).hexdigest()}
                wanted = {"bodyLength": want["bodyLength"], "bodySha256": want["bodySha256"]}
                if "bodyBase64" in want:
                    actual["bodyBase64"] = base64.b64encode(got["body"]).decode()
                    wanted["bodyBase64"] = want["bodyBase64"]
                self.assertEqual(actual, wanted, f"{label}: raw body")
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
_RAISED_CLASS = {
    "sdk/timeout": CalmLensTimeoutError,
    "sdk/transport-error": CalmLensTransportError,
    "sdk/invalid-argument": CalmLensValidationError,
    "sdk/invalid-config": CalmLensValidationError,
    "sdk/invalid-webhook-signature": WebhookVerificationError,
    "sdk/invalid-webhook-payload": WebhookVerificationError,
}


def _mock_outcome(option: str) -> str:
    mock = testing.MockCalmLensServerClient(mock_options={option: "blocked"})
    content = {"name": "note.txt", "content": {"plainText": "hello", "type": "text/plain"}}
    asset = mock.assets.create(content) if option == "queued_outcome" else mock.assets.classify(content)
    return str(asset["classification"]["moderation"]["status"])


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
        url = _client().cdn.get_asset_url({"assetIdentifier": "asset-1", "resource": name})
        return url.endswith(f"/asset-1/{capability['value']}")
    if kind == "cdn-option":
        get_asset_url = _client().cdn.get_asset_url
        return (name in inspect.signature(get_asset_url).parameters
                and get_asset_url(asset_identifier="asset-1", **{name: True}).endswith("?allowAgeRestricted=true"))
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

    def test_retryable_errors(self) -> None:
        for case in SURFACE["retryable"]:
            raised = CalmLensAPIError if case["status"] is not None else _RAISED_CLASS.get(case["code"], CalmLensError)
            for error_class in dict.fromkeys((CalmLensError, raised)):
                with self.subTest(case["code"], status=case["status"], error_class=error_class.__name__):
                    error = error_class(case["code"], status=case["status"])
                    self.assertIs(error.is_retryable, case["retryable"])

    def test_defaults(self) -> None:
        """The client defaults equal JavaScript's, and the cases that observe them exist."""
        c = CalmLensServerClient(api_key="key", project_id="project-1")
        values = {
            "baseUrl": c.base_url, "cdnBaseUrl": c.cdn_base_url, "timeoutMs": c.timeout * 1000,
            "uploadTimeoutMs": None if c.upload_timeout is None else c.upload_timeout * 1000,
            "maxRetries": c.max_retries, "retryBaseDelayMs": client_module.RETRY_BASE_DELAY * 1000,
            "retryMaxDelayMs": client_module.RETRY_MAX_DELAY * 1000,
            "retryAfterMaxMs": client_module.MAX_RETRY_AFTER_SECONDS * 1000,
            "maxResponseBytes": c.max_response_bytes,
            "signedUrlExpiresInSeconds": client_module.DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS,
            "uploadTokenExpiresInSeconds": client_module.UPLOAD_TOKEN_DEFAULT_EXPIRES_IN_SECONDS,
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


# ---- upload-tokens.json -----------------------------------------------------------------------

def _decode_claims(token: str) -> tuple[dict[str, Any], str, str]:
    body, signature = token.removeprefix("clut_").split(".")
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))), body, signature


class UploadTokenTests(unittest.TestCase):
    fixture = _fixture("upload-tokens.json")

    def test_signs_exactly(self) -> None:
        for case in self.fixture["signing"]:
            with self.subTest(case["name"]):
                signed = sign_upload_token(case["apiKey"], case["options"], now=case["now"], nonce=case["nonce"])
                self.assertEqual(signed, {"token": case["expected"]["token"], "expiresAt": case["expected"]["expiresAt"]})

    def test_signs_with_the_clients_clock_and_a_fresh_nonce(self) -> None:
        import time
        for case in self.fixture["signing"]:
            with self.subTest(case["name"]):
                expected = case["expected"]
                c = CalmLensServerClient(api_key=case["apiKey"], project_id="project-1")
                before = int(time.time() * 1000)
                signed = c.upload_tokens.sign(case["options"])
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
                    c.upload_tokens.sign(case["options"])
                self.assertEqual(raised.exception.code, case["error"])
                with self.assertRaises(CalmLensError) as raised:
                    sign_upload_token(case["apiKey"], case["options"], now=0, nonce="n")
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
                self.assertEqual(parsed, json.loads(case["body"]))
                self.assertEqual(parsed["type"], case["expectedType"])
                self.assertEqual(parsed["data"]["facts"][0]["key"], case["expectedFactKey"])

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
                with self.assertRaises(WebhookVerificationError) as raised:
                    parse_webhook_event(case["body"], signature=case["signature"], timestamp=case["timestamp"],
                                        secret=case["secret"], now=case["now"])
                self.assertEqual(raised.exception.code, case["error"])

    def test_parsed(self) -> None:
        for case in self.fixtures["parsed"]:
            with self.subTest(case["name"]):
                event = parse_webhook_event(case["body"], signature=case["signature"], timestamp=case["timestamp"],
                                            secret=case["secret"], now=case["now"])
                self.assertEqual(event, case["expected"])
                self.assertIs(is_test_webhook_event(event), case["isTest"])

    def test_test_facts(self) -> None:
        for case in self.fixtures["testFacts"]:
            with self.subTest(case["name"]):
                self.assertIs(is_test_webhook_event(case["event"]), case["isTest"])

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
                self.assertEqual(received, case["payload"])
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


def _run(client: MockCalmLensServerClient, operation: str, args: dict[str, Any]) -> Any:
    if operation == "mock.decide":
        return _json(client.decide(args["assetId"], args["outcome"]))
    if operation == "mock.enqueueEvent":
        return _json(client.enqueue_event(args["type"], asset_id=args.get("assetId"), facts=args.get("facts")))
    if operation == "mock.grant":
        client.set_api_key_grants(args["grants"])
        return None
    if operation == "mock.failNext":
        client.fail_next_request(args["failure"], operation=args.get("operation"))
        return None
    if operation == "cdn.serve":
        with client.cdn.serve(args) as response:
            body = response.read()
            code = (json.loads(body).get("code")
                    if (response.content_type or "").startswith("application/json") else None)
            return {"status": response.status, "code": code, "bytes": body, "headers": response.headers}
    try:
        return _json(_invoke(client, operation, args))
    except _Partial as failure:
        raise failure.error from None


class MockScenarioTests(unittest.TestCase):
    def test_shared_scenarios(self) -> None:
        for scenario in _fixture("mock-scenarios.json")["scenarios"]:
            with self.subTest(scenario=scenario["name"]):
                self._run_scenario(scenario)

    def _run_scenario(self, scenario: dict[str, Any]) -> None:
        mock = scenario["mock"]
        options = {key: mock[name] for name, key in (("queuedOutcome", "queued_outcome"),
                                                       ("analyzedOutcome", "analyzed_outcome")) if name in mock}
        client = MockCalmLensServerClient(api_key=create_mock_api_key(mock.get("apiKeyGrants")),
                                          project_id="project-1", mock_options=options)
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
                        _run(client, step["operation"], args)
                    error = raised.exception
                    want = dict(expect["error"])
                    wanted_details = want.pop("details", {})
                    self.assertEqual({"code": error.code, "status": error.status}, want, label)
                    for key, value in wanted_details.items():
                        self.assertEqual(_json(error.details.get(key)), _resolve(value, saved),
                                         f"{label}: details.{key}")
                    continue
                statuses.clear()
                result = _run(client, step["operation"], args)
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


if __name__ == "__main__":
    unittest.main()
