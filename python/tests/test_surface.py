"""Replay surface.json and rejections.json (packages/sdk-contract/surface.ts): every capability a
server SDK must offer exists under its Python name, and every request the API would reject is
refused before anything is sent."""
import importlib
import inspect
import io
import json
from pathlib import Path
import re
import unittest

import calmlens
from calmlens import CalmLensError, CalmLensServerClient
from calmlens import testing

TESTDATA = Path(__file__).resolve().parents[2] / "go" / "testdata"
SURFACE = json.loads((TESTDATA / "surface.json").read_text())


def _resolve(root, path):
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

    target = _resolve(_client(transport), _snake(spec["operation"]))
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
        return callable(_resolve(_client(), name))
    if kind in ("function", "mock-client", "mock-function"):
        return callable(_resolve(calmlens, name))
    if kind == "constant":
        return _resolve(calmlens, name) == capability["value"]
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


class SurfaceTests(unittest.TestCase):
    def test_offers_every_capability(self):
        missing = [f"{c['id']} ({c['names']['python']})" for c in SURFACE["capabilities"] if not _present(c)]
        self.assertEqual(missing, [])

    def test_refuses_rejected_requests_before_sending(self):
        for case in json.loads((TESTDATA / "rejections.json").read_text()):
            with self.subTest(case["name"]):
                target = _resolve(_client(), _snake(case["operation"]))
                with self.assertRaises(CalmLensError) as raised:
                    target(case["options"])
                self.assertEqual(raised.exception.code, case["error"])


if __name__ == "__main__":
    unittest.main()
