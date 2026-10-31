import json
import unittest

from calmlens import parse_webhook_event, to_webhook_event_payload, verify_webhook_signature
from calmlens.webhooks import create_webhook_signature_header

# Shared test vector (packages/sdk-contract/README.md).
SECRET, TIMESTAMP, BODY = "key", "1700000000", "{}"
SIGNATURE = "v1=9d713ed406bb7076d4123f0dc2c39d2df5c654ed4b0cd56b52c8b4c940bd63ae"
NOW = 1700000000


def verify(payload=BODY, signature=SIGNATURE, timestamp=TIMESTAMP, secret=SECRET, **options):
    options.setdefault("now", NOW)
    return verify_webhook_signature(payload, signature=signature, timestamp=timestamp, secret=secret, **options)


class WebhookTests(unittest.TestCase):
    def test_accepts_bytes_payloads_and_integer_timestamps(self):
        self.assertTrue(verify(payload=b"{}", timestamp=1700000000))
        self.assertTrue(verify(payload=bytearray(b"{}")))
        self.assertTrue(verify(payload=memoryview(b"{}")))

    def test_rejects_python_values_that_are_not_headers(self):
        # Python values the shared verification cases cannot express.
        for options in (
            {"signature": None}, {"signature": "v1=" + "é" * 64}, {"timestamp": None}, {"timestamp": True},
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

    def test_payload_is_the_listed_event_without_other_fields(self):
        event = {"id": "evt_1", "projectId": "project-1", "type": "asset.allowed", "severity": "low",
                 "title": "Asset allowed", "description": None, "assetId": "asset_1", "asset": None,
                 "facts": [{"key": "decided-by", "value": "automated"}], "createdAt": 1760000000000}
        stored = {**event, "userId": "user-1", "notify": True, "readAt": 1, "updatedAt": 2}
        self.assertEqual(to_webhook_event_payload(stored), event)  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
