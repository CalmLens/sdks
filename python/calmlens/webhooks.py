"""Webhook delivery payloads, signing and verification (same wire format as the server).

Always verify the exact raw request body, before parsing it: re-serialising parsed JSON
changes bytes (number formats, key order, whitespace) and the signature no longer matches.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
import time
from typing import Mapping, cast

from . import error_codes
from .errors import WebhookVerificationError
from .types import Event, WebhookEventPayload

__all__ = [
    "WEBHOOK_DELIVERY_HEADER", "WEBHOOK_TIMESTAMP_HEADER", "WEBHOOK_SIGNATURE_HEADER",
    "WEBHOOK_SIGNATURE_TOLERANCE_SECONDS", "to_webhook_event_payload", "create_webhook_signature_header",
    "create_webhook_headers", "verify_webhook_signature", "parse_webhook_event",
]

WEBHOOK_DELIVERY_HEADER = "x-calmlens-delivery"
WEBHOOK_TIMESTAMP_HEADER = "x-calmlens-timestamp"
WEBHOOK_SIGNATURE_HEADER = "x-calmlens-signature"
#: Deliveries whose timestamp is further than this from the receiver's clock are rejected.
WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300

# ASCII digits only: ``\d`` would also match other scripts' digits, which int() accepts.
_TIMESTAMP = re.compile(r"[0-9]+")


def _raw(payload: object, name: str = "payload") -> bytes:
    if isinstance(payload, str):
        return payload.encode("utf-8")
    if isinstance(payload, (bytes, bytearray, memoryview)):
        return bytes(payload)
    raise TypeError(f"{name} must be the raw request body as str or bytes, not {type(payload).__name__}; "
                    "verify the body before parsing it")


def _hmac_hex(secret: str, message: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def to_webhook_event_payload(event: Event) -> WebhookEventPayload:
    """The JSON body a webhook connector delivers for a stored event (e.g. one returned by
    ``events.list``)."""
    return {
        "id": event["id"],
        "type": event["type"],
        "createdAt": event["createdAt"],
        "projectId": event["projectId"],
        "data": {
            "severity": event["severity"],
            "title": event["title"],
            "description": event.get("description"),
            "assetId": event.get("assetId"),
            "asset": event.get("asset"),
            "facts": event["facts"],
        },
    }


def create_webhook_signature_header(payload: str | bytes, timestamp: int | str, secret: str) -> str:
    """``v1=<hex HMAC-SHA256 of "<timestamp>.<payload>">``, the x-calmlens-signature value.

    ``payload`` is the raw body (str or bytes). Useful for signing test deliveries.
    """
    return "v1=" + _hmac_hex(secret, f"{timestamp}.".encode("ascii") + _raw(payload))


def create_webhook_headers(payload: str | bytes, delivery_id: str, secret: str, *,
                           timestamp: int | None = None) -> dict[str, str]:
    """Headers for one signed delivery of the raw body ``payload`` (for tests)."""
    timestamp = int(time.time()) if timestamp is None else timestamp
    return {
        "content-type": "application/json",
        WEBHOOK_DELIVERY_HEADER: delivery_id,
        WEBHOOK_TIMESTAMP_HEADER: str(timestamp),
        WEBHOOK_SIGNATURE_HEADER: create_webhook_signature_header(payload, timestamp, secret),
    }


def _header(headers: Mapping[str, object] | None, name: str) -> str | None:
    if headers is None:
        return None
    value = headers.get(name)
    if value is None:
        # Plain dicts are case-sensitive; framework header objects usually are not.
        value = next((v for k, v in headers.items() if isinstance(k, str) and k.lower() == name), None)
    if isinstance(value, bytes):
        value = value.decode("latin-1")
    return value if value is None or isinstance(value, str) else str(value)


def verify_webhook_signature(payload: str | bytes, *, signature: str | None = None,
                             timestamp: str | int | None = None, secret: str,
                             headers: Mapping[str, object] | None = None,
                             tolerance_seconds: float = WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
                             now: float | None = None) -> bool:
    """Return True when ``payload`` is a delivery signed with ``secret``.

    Args:
        payload: The exact raw request body (``str`` or ``bytes``). Parsed objects are
            rejected with ``TypeError``: re-serialised JSON rarely matches the signed bytes.
        signature: The ``x-calmlens-signature`` header (``v1=<hex>``; a comma-separated
            list is allowed and any matching ``v1=`` entry is accepted).
        timestamp: The ``x-calmlens-timestamp`` header (unix seconds).
        secret: The webhook's signing secret.
        headers: Alternatively, the request headers; ``signature`` and ``timestamp`` are
            read from them when not given.
        tolerance_seconds: Maximum distance between ``timestamp`` and ``now``.
        now: Current unix time in seconds; defaults to ``time.time()``.

    Returns False for a missing, malformed or non-matching signature or a stale timestamp.
    """
    body = _raw(payload)
    if signature is None:
        signature = _header(headers, WEBHOOK_SIGNATURE_HEADER)
    if timestamp is None:
        timestamp = _header(headers, WEBHOOK_TIMESTAMP_HEADER)
    if not secret or not signature or timestamp is None or isinstance(timestamp, bool):
        return False
    timestamp = str(timestamp).strip()
    if not _TIMESTAMP.fullmatch(timestamp):
        return False
    current = math.floor(time.time() if now is None else now)
    if abs(current - int(timestamp)) > tolerance_seconds:
        return False
    candidates = [part.strip()[3:].lower() for part in signature.split(",")
                  if part.strip().startswith("v1=")]
    if not candidates:
        return False
    expected = _hmac_hex(secret, f"{timestamp}.".encode("ascii") + body).encode("ascii")
    matched = False
    for candidate in candidates:
        matched |= hmac.compare_digest(expected, candidate.encode("utf-8"))
    return matched


def parse_webhook_event(payload: str | bytes, *, signature: str | None = None, timestamp: str | int | None = None,
                    secret: str, headers: Mapping[str, object] | None = None,
                    tolerance_seconds: float = WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
                    now: float | None = None) -> WebhookEventPayload:
    """Verify a delivery, then parse it.

    Takes the same arguments as :func:`verify_webhook_signature` and returns the parsed
    :class:`~calmlens.types.WebhookEventPayload`. Raises :class:`WebhookVerificationError`
    with code ``sdk/invalid-webhook-signature`` when verification fails, or
    ``sdk/invalid-webhook-payload`` when the verified body is not a webhook event object.
    """
    body = _raw(payload)
    if not verify_webhook_signature(body, signature=signature, timestamp=timestamp, secret=secret, headers=headers,
                                    tolerance_seconds=tolerance_seconds, now=now):
        raise WebhookVerificationError(error_codes.SDK_INVALID_WEBHOOK_SIGNATURE,
                                       "Webhook signature or timestamp is invalid")
    try:
        event = json.loads(body)
    except (ValueError, UnicodeDecodeError) as error:
        raise WebhookVerificationError(error_codes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not valid JSON") from error
    if not isinstance(event, dict) or not isinstance(event.get("type"), str) or not isinstance(event.get("data"), dict):
        raise WebhookVerificationError(error_codes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not an event")
    return cast(WebhookEventPayload, event)
