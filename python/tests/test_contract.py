"""Replay request fixtures captured from the current JavaScript SDK."""
import io
import json
from pathlib import Path
import re
import unittest
from urllib.parse import parse_qsl, urlsplit

from calmlens import CalmLensServerClient, CalmLensError
from calmlens.client import _serialize_transform


class ContractTests(unittest.TestCase):
    def test_javascript_requests(self):
        fixtures = json.loads((Path(__file__).resolve().parents[2] / "go" / "testdata" / "requests.json").read_text())
        for fixture in fixtures:
            with self.subTest(operation=fixture["operation"]):
                captured = []
                def transport(request, timeout):
                    captured.append(request)
                    response = io.BytesIO(json.dumps(fixture["response"]).encode())
                    response.status = 200
                    return response
                c = CalmLensServerClient(api_key="key", project_id="project-1", transport=transport)
                target = c
                for key in fixture["operation"].split("."):
                    target = getattr(target, re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower())
                target(fixture["options"])
                request = captured[0]
                url = urlsplit(request.full_url)
                body = request.data.decode() if request.data else None
                if body and request.headers.get("Content-type") == "application/json":
                    body = json.loads(body)
                self.assertEqual({"method": request.method, "path": url.path, "query": dict(parse_qsl(url.query)), "body": body}, fixture["request"])

    def test_javascript_path_safety(self):
        paths = json.loads((Path(__file__).resolve().parents[2] / "go" / "testdata" / "paths.json").read_text())
        def transport(request, timeout):
            raise AssertionError(f"Sent {request.full_url} for a rejected ID")
        c = CalmLensServerClient(api_key="key", project_id="project-1", transport=transport)
        for case in paths["rejections"]:
            with self.subTest(operation=case["operation"], options=case["options"]):
                target = c
                for key in case["operation"].split("."):
                    target = getattr(target, re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower())
                with self.assertRaises(CalmLensError) as raised:
                    target(case["options"])
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
        fixture = json.loads((Path(__file__).resolve().parents[2] / "go" / "testdata" / "transform-options.json").read_text())
        for case in fixture["cases"]:
            with self.subTest(options=case["options"]):
                step = {"type": "imageTransform", "options": case["options"]}
                self.assertEqual(_serialize_transform(step), case["selector"])
