"""Replay the shared mock behaviour scenarios (packages/sdk-contract/mockScenarios.ts) against
``MockCalmLensServerClient``. The format is described in packages/sdk-contract/README.md."""
import json
from pathlib import Path
import re
import unittest
from typing import Any

from calmlens import CalmLensError
from calmlens.testing import MockCalmLensServerClient, create_mock_api_key

SCENARIOS = json.loads((Path(__file__).resolve().parents[2] / "go" / "testdata" / "mock-scenarios.json").read_text())


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


class MockScenarioTests(unittest.TestCase):
    def test_shared_scenarios(self):
        for scenario in SCENARIOS["scenarios"]:
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


if __name__ == "__main__":
    unittest.main()
