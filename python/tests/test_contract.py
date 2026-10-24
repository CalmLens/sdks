"""Replay the shared SDK contract fixtures that packages/sdk-contract/generate.ts writes to
sdks/go/testdata (format in packages/sdk-contract/README.md): requests captured from the
JavaScript SDK, path safety and CDN URLs, transform options, webhooks, the mock behaviour
scenarios, the server SDK surface and rejections. Each fixture case is its own subtest."""
import importlib
import inspect
import io
import json
from pathlib import Path
import re
import unittest
from typing import Any
from urllib.parse import parse_qsl, urlsplit

import calmlens
from calmlens import CalmLensError, CalmLensServerClient, parse_webhook_event, testing, to_webhook_event_payload, verify_webhook_signature
from calmlens.client import _serialize_transform
from calmlens.testing import MockCalmLensServerClient, create_mock_api_key
from calmlens.webhooks import create_webhook_signature_header

TESTDATA = Path(__file__).resolve().parents[2] / "go" / "testdata"


def _fixture(name: str) -> Any:
    return json.loads((TESTDATA / name).read_text(encoding="utf-8"))


SURFACE = _fixture("surface.json")


def _method(target: Any, operation: str) -> Any:
    """The client method for a camelCase ``resource.method`` operation name."""
    for key in operation.split("."):
        target = getattr(target, re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower())
    return target


def _at(value: Any, path: str) -> Any:
    """Follow a dotted path: numeric segments index lists, ``length`` is a list's length."""
    for segment in path.split("."):
        if isinstance(value, list):
            value = len(value) if segment == "length" else value[int(segment)]
        elif isinstance(value, dict):
            value = value.get(segment)
        else:
            return None
    return value


def _resolve(value: Any, saved: dict[str, Any]) -> Any:
    if isinstance(value, dict) and "$ref" in value:
        name, _, path = value["$ref"].partition(".")
        return _at(saved[name], path)
    if isinstance(value, list):
        return [_resolve(item, saved) for item in value]
    if isinstance(value, dict):
        return {key: _resolve(item, saved) for key, item in value.items()}
    return value


def _run(client: MockCalmLensServerClient, operation: str, args: dict[str, Any]) -> Any:
    if operation == "mock.decide":
        return client.decide(args["assetId"], args["outcome"])
    if operation == "mock.enqueueEvent":
        return client.enqueue_event(args["type"], asset_id=args.get("assetId"), facts=args.get("facts"))
    if operation == "cdn.serve":
        with client.cdn.serve(args) as response:
            body = response.read()
            code = json.loads(body).get("code") if response.content_type == "application/json" else None
            return {"status": response.status, "code": code, "body": body.decode("utf-8", "replace")}
    if operation == "assets.waitForDecision":
        options = {key: value for key, value in args.items() if key != "timeoutMs"}
        return client.assets.wait_for_decision({**options, "timeout": args["timeoutMs"] / 1000})
    if operation in ("assets.create", "assets.classify") and "idempotencyKey" in args:
        options = {key: value for key, value in args.items() if key != "idempotencyKey"}
        method = client.assets.create if operation == "assets.create" else client.assets.classify
        return method(options, idempotency_key=args["idempotencyKey"])
    target: Any = client
    for key in operation.split("."):
        target = getattr(target, re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower())
    return target(args)


def _resolve_name(root, path):
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


def _refuse(request, timeout):
    raise AssertionError(f"Sent {request.full_url}")


def _client(transport=_refuse):
    return CalmLensServerClient(api_key="key", project_id="project-1", transport=transport, max_retries=0)


def _raised_error():
    spec = SURFACE["errorResponse"]

    def transport(request, timeout):
        response = io.BytesIO(json.dumps(spec["body"]).encode())
        response.status = spec["status"]
        response.headers = spec["headers"]
        return response

    target = _resolve_name(_client(transport), _snake(spec["operation"]))
    try:
        target(spec["options"])
    except CalmLensError as error:
        return error
    raise AssertionError(f"{spec['operation']} did not fail")


def _snake(path):
    return re.sub(r"(?<!^)(?<!\.)(?=[A-Z])", "_", path).lower()


def _mock_outcome(option):
    mock = testing.MockCalmLensServerClient(mock_options={option: "blocked"})
    content = {"name": "note.txt", "content": {"plainText": "hello", "type": "text/plain"}}
    asset = mock.assets.create(content) if option == "queued_outcome" else mock.assets.classify(content)
    return asset["classification"]["moderation"]["status"]


def _present(capability):
    name, kind = capability["names"]["python"], capability["kind"]
    if kind == "method":
        return callable(_resolve_name(_client(), name))
    if kind in ("function", "mock-client", "mock-function"):
        return callable(_resolve_name(calmlens, name))
    if kind == "constant":
        return _resolve_name(calmlens, name) == capability["value"]
    if kind == "error-field":
        expected = SURFACE["errorResponse"]["expected"]
        want = {"errors.code": expected["code"], "errors.status": expected["status"],
                "errors.requestId": expected["requestId"],
                "errors.retryAfter": expected["retryAfterSeconds"]}[capability["id"]]
        return getattr(_raised_error(), name, None) == want
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


class RequestTests(unittest.TestCase):
    def test_javascript_requests(self):
        for fixture in _fixture("requests.json"):
            with self.subTest(operation=fixture["operation"]):
                captured = []
                def transport(request, timeout):
                    captured.append(request)
                    response = io.BytesIO(json.dumps(fixture["response"]).encode())
                    response.status = 200
                    return response
                c = CalmLensServerClient(api_key="key", project_id="project-1", transport=transport)
                _method(c, fixture["operation"])(fixture["options"])
                request = captured[0]
                url = urlsplit(request.full_url)
                body = request.data.decode() if request.data else None
                if body and request.headers.get("Content-type") == "application/json":
                    body = json.loads(body)
                self.assertEqual({"method": request.method, "path": url.path, "query": dict(parse_qsl(url.query)), "body": body}, fixture["request"])

    def test_javascript_path_safety(self):
        paths = _fixture("paths.json")
        def transport(request, timeout):
            raise AssertionError(f"Sent {request.full_url} for a rejected ID")
        c = CalmLensServerClient(api_key="key", project_id="project-1", transport=transport)
        for case in paths["rejections"]:
            with self.subTest(operation=case["operation"], options=case["options"]):
                with self.assertRaises(CalmLensError) as raised:
                    _method(c, case["operation"])(case["options"])
                self.assertEqual(raised.exception.code, case["error"])
        for case in paths["cdnUrls"]:
            with self.subTest(cdn=case["options"]):
                if "url" in case:
                    self.assertEqual(c.cdn.get_asset_url(case["options"]), case["url"])
                else:
                    with self.assertRaises(CalmLensError) as raised:
                        c.cdn.get_asset_url(case["options"])
                    self.assertEqual(raised.exception.code, case["error"])

    def test_transform_options(self):
        """Every transform option serializes to the step the CDN writes for it."""
        for case in _fixture("transform-options.json")["cases"]:
            with self.subTest(options=case["options"]):
                step = {"type": "imageTransform", "options": case["options"]}
                self.assertEqual(_serialize_transform(step), case["selector"])


class WebhookContractTests(unittest.TestCase):
    """Webhook vectors generated from the JavaScript SDK."""
    fixtures = _fixture("webhooks.json")

    def test_parsing(self):
        for case in self.fixtures["parsing"]:
            with self.subTest(type=case["expectedType"], fact=case["expectedFactKey"]):
                parsed = parse_webhook_event(case["body"], signature=case["signature"], timestamp=case["timestamp"], secret=case["secret"], now=case["now"])
                self.assertEqual(parsed, json.loads(case["body"]))
                self.assertEqual(parsed["type"], case["expectedType"])
                self.assertEqual(parsed["data"]["facts"][0]["key"], case["expectedFactKey"])

    def test_signatures(self):
        for case in self.fixtures["signatures"]:
            with self.subTest(body=case["body"], timestamp=case["timestamp"]):
                self.assertEqual(create_webhook_signature_header(case["body"], case["timestamp"], case["secret"]),
                                 case["signature"])

    def test_verification(self):
        for case in self.fixtures["verification"]:
            with self.subTest(case["name"]):
                options = {"now": case["now"]}
                if "toleranceSeconds" in case:
                    options["tolerance_seconds"] = case["toleranceSeconds"]
                self.assertEqual(verify_webhook_signature(case["body"], signature=case["signature"],
                                                          timestamp=case["timestamp"], secret=case["secret"],
                                                          **options), case["valid"])

    def test_payloads(self):
        for case in self.fixtures["payloads"]:
            with self.subTest(event=case["event"]["type"], id=case["event"]["id"]):
                self.assertEqual(to_webhook_event_payload(case["event"]), case["payload"])


class MockScenarioTests(unittest.TestCase):
    def test_shared_scenarios(self):
        for scenario in _fixture("mock-scenarios.json")["scenarios"]:
            with self.subTest(scenario=scenario["name"]):
                mock = scenario["mock"]
                options = {key: mock[name] for name, key in (("queuedOutcome", "queued_outcome"),
                                                               ("analyzedOutcome", "analyzed_outcome")) if name in mock}
                client = MockCalmLensServerClient(api_key=create_mock_api_key(mock.get("apiKeyGrants")),
                                                  project_id="project-1", mock_options=options)
                saved: dict[str, Any] = {}
                for index, step in enumerate(scenario["steps"], 1):
                    label = f"step {index} ({step['operation']})"
                    args = _resolve(step.get("args", {}), saved)
                    expect = step.get("expect", {})
                    if "error" in expect:
                        with self.assertRaises(CalmLensError, msg=label) as raised:
                            _run(client, step["operation"], args)
                        self.assertEqual({"code": raised.exception.code, "status": raised.exception.status},
                                         expect["error"], label)
                        continue
                    result = _run(client, step["operation"], args)
                    if "cdn" in expect:
                        self.assertEqual({key: result[key] for key in expect["cdn"]}, expect["cdn"], label)
                    for path, wanted in expect.get("result", {}).items():
                        actual = _at(result, path)
                        if isinstance(wanted, dict) and "$contains" in wanted:
                            self.assertIn(_resolve(wanted["$contains"], saved), actual, f"{label}: {path}")
                        else:
                            self.assertEqual(actual, _resolve(wanted, saved), f"{label}: {path}")
                    if "save" in step:
                        saved[step["save"]] = result



class SurfaceTests(unittest.TestCase):
    def test_offers_every_capability(self):
        for capability in SURFACE["capabilities"]:
            with self.subTest(capability["id"], name=capability["names"]["python"]):
                self.assertTrue(_present(capability))

    def test_refuses_rejected_requests_before_sending(self):
        for case in _fixture("rejections.json"):
            with self.subTest(case["name"]):
                target = _resolve_name(_client(), _snake(case["operation"]))
                with self.assertRaises(CalmLensError) as raised:
                    target(case["options"])
                self.assertEqual(raised.exception.code, case["error"])


if __name__ == "__main__":
    unittest.main()
