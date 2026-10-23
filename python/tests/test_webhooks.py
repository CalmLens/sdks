import json
import unittest
from pathlib import Path

from calmlens import (WebhookVerificationError, parse_webhook_event, error_codes, to_webhook_event_payload,
                      verify_webhook_signature)
from calmlens.webhooks import create_webhook_headers, create_webhook_signature_header

# Shared test vector (packages/sdk-contract/README.md).
SECRET, TIMESTAMP, BODY = "key", "1700000000", "{}"
SIGNATURE = "v1=9d713ed406bb7076d4123f0dc2c39d2df5c654ed4b0cd56b52c8b4c940bd63ae"
NOW = 1700000000


def verify(payload=BODY, signature=SIGNATURE, timestamp=TIMESTAMP, secret=SECRET, **options):
    options.setdefault("now", NOW)
    return verify_webhook_signature(payload, signature=signature, timestamp=timestamp, secret=secret, **options)


class WebhookTests(unittest.TestCase):
    def test_signs_the_shared_vector(self):
        self.assertEqual(create_webhook_signature_header(BODY, 1700000000, SECRET), SIGNATURE)
        self.assertEqual(create_webhook_headers(b"{}", "d1", SECRET, timestamp=1700000000), {
            "content-type": "application/json",
            "x-calmlens-delivery": "d1",
            "x-calmlens-timestamp": "1700000000",
            "x-calmlens-signature": SIGNATURE,
        })

    def test_accepts_the_shared_vector(self):
        self.assertTrue(verify())
        self.assertTrue(verify(payload=b"{}", timestamp=1700000000))
        self.assertTrue(verify(payload=bytearray(b"{}")))
        self.assertTrue(verify(signature=SIGNATURE.upper().replace("V1=", "v1=")))

    def test_accepts_any_matching_v1_entry(self):
        self.assertTrue(verify(signature=f"v0=abc, v1={'0' * 64}, {SIGNATURE}"))

    def test_rejects_tampered_or_malformed(self):
        for options in (
            {"payload": "{ }"}, {"secret": "other"}, {"secret": ""}, {"timestamp": "1700000001"},
            {"signature": SIGNATURE[3:]}, {"signature": "v0=" + SIGNATURE[3:]},
            {"signature": SIGNATURE[:-1] + "0"}, {"signature": ""}, {"signature": None},
            {"signature": "v1=" + "é" * 64}, {"timestamp": ""}, {"timestamp": None},
            {"timestamp": "17e8"}, {"timestamp": "-1700000000"}, {"timestamp": True},
            # Digits from other scripts, which int() would accept.
            {"timestamp": "١٧٠٠٠٠٠٠٠٠"},
            {"timestamp": "１７００００００００"},
        ):
            with self.subTest(**{k: repr(v) for k, v in options.items()}):
                self.assertFalse(verify(**options))

    def test_parsed_payloads_are_rejected(self):
        # Re-serialising parsed JSON changes bytes (Python writes 1e-07 where JS wrote 1e-7).
        body = '{"score":1e-7}'
        signature = create_webhook_signature_header(body, TIMESTAMP, SECRET)
        self.assertTrue(verify(payload=body, signature=signature))
        for parsed in ({}, json.loads(body), [1], None, 5):
            with self.subTest(parsed=parsed), self.assertRaises(TypeError):
                verify(payload=parsed, signature=signature)
        with self.assertRaises(TypeError):
            parse_webhook_event(json.loads(body), signature=signature, timestamp=TIMESTAMP, secret=SECRET, now=NOW)

    def test_arguments_after_the_payload_are_keyword_only(self):
        with self.assertRaises(TypeError):
            verify_webhook_signature(BODY, SIGNATURE, TIMESTAMP, SECRET)  # type: ignore[misc]

    def test_reads_signature_and_timestamp_from_headers(self):
        headers = {"X-CalmLens-Signature": SIGNATURE, "X-CalmLens-Timestamp": TIMESTAMP}
        self.assertTrue(verify_webhook_signature(BODY, headers=headers, secret=SECRET, now=NOW))
        self.assertFalse(verify_webhook_signature(BODY, headers={}, secret=SECRET, now=NOW))
        self.assertFalse(verify_webhook_signature(
            BODY, headers={**headers, "X-CalmLens-Signature": "v1=" + "0" * 64}, secret=SECRET, now=NOW))

    def test_parse_webhook_event_verifies_then_parses(self):
        body = json.dumps({"id": "evt_1", "type": "asset.blocked", "createdAt": 1, "projectId": "p",
                           "data": {"severity": "low", "title": "t", "description": None, "assetId": "a",
                                    "asset": None, "facts": [{"key": "decided-by", "value": "automated"}]}})
        headers = create_webhook_headers(body, "delivery-1", SECRET, timestamp=NOW)
        event = parse_webhook_event(body.encode(), headers=headers, secret=SECRET, now=NOW)
        self.assertEqual((event["id"], event["data"]["facts"]), ("evt_1", [{"key": "decided-by", "value": "automated"}]))
        for tampered, now in ((body + " ", NOW), (body, NOW + 301)):
            with self.assertRaises(WebhookVerificationError) as raised:
                parse_webhook_event(tampered, headers=headers, secret=SECRET, now=now)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_WEBHOOK_SIGNATURE)
        for invalid in ("not json", "[1, 2]", '{"id": "x"}'):
            with self.subTest(body=invalid), self.assertRaises(WebhookVerificationError) as raised:
                parse_webhook_event(invalid, signature=create_webhook_signature_header(invalid, NOW, SECRET),
                                timestamp=NOW, secret=SECRET, now=NOW)
            self.assertEqual(raised.exception.code, error_codes.SDK_INVALID_WEBHOOK_PAYLOAD)

    def test_tolerance(self):
        self.assertTrue(verify(now=NOW + 300))
        self.assertTrue(verify(now=NOW - 300))
        self.assertFalse(verify(now=NOW + 301))
        self.assertFalse(verify(now=NOW - 301))
        self.assertTrue(verify(now=NOW + 600, tolerance_seconds=600))
        self.assertFalse(verify(now=None))  # the real clock: the 2023 vector has expired

    def test_payload_shape(self):
        event = {"id": "e", "projectId": "p", "type": "asset.classified", "severity": "high",
                 "title": "Classified", "description": "d", "assetId": "a", "facts": [],
                 "userId": "u", "notify": True, "createdAt": 1, "updatedAt": 2, "readAt": None}
        self.assertEqual(to_webhook_event_payload(event), {
            "id": "e", "type": "asset.classified", "createdAt": 1, "projectId": "p",
            "data": {"severity": "high", "title": "Classified", "description": "d", "assetId": "a",
                     "asset": None, "facts": []},
        })

    def test_javascript_contract(self):
        # Generated from the JavaScript SDK by packages/sdk-contract/generate.ts.
        path = Path(__file__).resolve().parents[2] / "go" / "testdata" / "webhooks.json"
        fixtures = json.loads(path.read_text(encoding="utf-8"))
        for case in fixtures["parsing"]:
            parsed = parse_webhook_event(case["body"], signature=case["signature"], timestamp=case["timestamp"], secret=case["secret"], now=case["now"])
            self.assertEqual(parsed, json.loads(case["body"]))
            self.assertEqual(parsed["type"], case["expectedType"])
            self.assertEqual(parsed["data"]["facts"][0]["key"], case["expectedFactKey"])
        for case in fixtures["signatures"]:
            self.assertEqual(create_webhook_signature_header(case["body"], case["timestamp"], case["secret"]),
                             case["signature"])
        for case in fixtures["verification"]:
            with self.subTest(case["name"]):
                options = {"now": case["now"]}
                if "toleranceSeconds" in case:
                    options["tolerance_seconds"] = case["toleranceSeconds"]
                self.assertEqual(verify_webhook_signature(case["body"], signature=case["signature"],
                                                          timestamp=case["timestamp"], secret=case["secret"],
                                                          **options), case["valid"])
        for case in fixtures["payloads"]:
            self.assertEqual(to_webhook_event_payload(case["event"]), case["payload"])


if __name__ == "__main__":
    unittest.main()
