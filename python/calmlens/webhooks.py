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
from typing import Any, Mapping

from . import error_codes
from .errors import CalmLensWebhookVerificationError
from ._object import CalmLensObject
from .types import Event, WebhookEventPayload

__all__ = [
    "WEBHOOK_DELIVERY_HEADER", "WEBHOOK_TIMESTAMP_HEADER", "WEBHOOK_SIGNATURE_HEADER",
    "WEBHOOK_SIGNATURE_TOLERANCE_SECONDS", "to_webhook_event_payload", "create_webhook_signature_header",
    "create_webhook_headers", "verify_webhook_signature", "parse_webhook_event", "is_test_webhook_event",
    "is_newer_asset_event", "get_event_fact", "get_event_facts",
]

WEBHOOK_DELIVERY_HEADER = "x-calmlens-delivery"
WEBHOOK_TIMESTAMP_HEADER = "x-calmlens-timestamp"
WEBHOOK_SIGNATURE_HEADER = "x-calmlens-signature"
#: Deliveries whose timestamp is further than this from the receiver's clock are rejected.
WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300

# ASCII digits only: ``\d`` would also match other scripts' digits, which int() accepts.
_TIMESTAMP = re.compile(r"[0-9]+")


def _wire(event: object) -> Mapping[str, Any]:
    """An event's JSON: a result object's ``to_dict()``, or the JSON itself."""
    if isinstance(event, CalmLensObject):
        return event.to_dict()
    return event if isinstance(event, Mapping) else {}


def _raw(payload: object, name: str = "payload") -> bytes:
    if isinstance(payload, str):
        return payload.encode("utf-8")
    if isinstance(payload, (bytes, bytearray, memoryview)):
        return bytes(payload)
    raise TypeError(f"{name} must be the raw request body as str or bytes, not {type(payload).__name__}; "
                    "verify the body before parsing it")


def _hmac_hex(secret: str, message: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def to_webhook_event_payload(event: Event | Mapping[str, Any]) -> dict[str, Any]:
    """The JSON body a webhook connector delivers for an event, such as one returned by
    ``events.list`` (or its ``to_dict()`` JSON): the event in the same shape ``events.list`` returns
    it. Fields outside that shape are left out."""
    event = _wire(event)
    payload: dict[str, Any] = {"id": event["id"], "projectId": event["projectId"]}
    # ``actor`` follows ``projectId``, as in the API's payloads; an event built without one
    # (such as a hand-written test event) gets none.
    if "actor" in event:
        payload["actor"] = event["actor"]
    payload.update({
        "type": event["type"],
        "severity": event["severity"],
        "title": event["title"],
        "description": event.get("description"),
        "assetId": event.get("assetId"),
        "assetSequence": event.get("assetSequence"),
        "asset": event.get("asset"),
        "facts": event["facts"],
        "createdAt": event["createdAt"],
    })
    return payload


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


def _text(value: object) -> str:
    return value.decode("latin-1") if isinstance(value, bytes) else str(value)


def _header(headers: Any, name: str) -> str | None:
    """A header's value, its name matched in any case. A header repeated in the request (a list
    value, or several entries in an ``email.message.Message``/``http.client.HTTPMessage`` or a
    Werkzeug ``Headers``) is joined with ``,``."""
    if headers is None:
        return None
    values: list[object] = []
    if callable(getattr(headers, "get_all", None)):  # email.message.Message, http.client.HTTPMessage
        values = list(headers.get_all(name) or [])
    elif callable(getattr(headers, "getlist", None)):  # Werkzeug Headers, Django QueryDict-like
        values = list(headers.getlist(name) or [])
    else:
        for key, value in headers.items():
            if isinstance(key, (str, bytes)) and _text(key).lower() == name:
                values.extend(value if isinstance(value, (list, tuple)) else [value])
    values = [value for value in values if value is not None]
    return ",".join(_text(value) for value in values) if values else None


def verify_webhook_signature(payload: str | bytes, *, signature: str | None = None,
                             timestamp: str | int | None = None, secret: str,
                             headers: Mapping[str, object] | Any = None,
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
        headers: Alternatively, the request headers (a mapping, ``email.message.Message``,
            ``http.client.HTTPMessage`` or a framework's header object); ``signature`` and
            ``timestamp`` are read from them when not given, by name in any case, and a header
            repeated in the request is joined with ``,``.
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
                    secret: str, headers: Mapping[str, object] | Any = None,
                    tolerance_seconds: float = WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
                    now: float | None = None) -> WebhookEventPayload:
    """Verify a delivery, then parse it.

    Takes the same arguments as :func:`verify_webhook_signature` and returns the parsed
    :class:`~calmlens.types.WebhookEventPayload` (``event.type``, ``event.asset_id``, ...), unknown
    fields included. Raises
    :class:`CalmLensWebhookVerificationError` with code ``sdk/invalid-webhook-signature`` when
    verification fails, or ``sdk/invalid-webhook-payload`` when the verified body is not a
    webhook event: a JSON object with string ``id``, ``type`` and ``projectId``, a numeric
    ``createdAt``, and the API's types for its other known fields when present.
    """
    body = _raw(payload)
    if not verify_webhook_signature(body, signature=signature, timestamp=timestamp, secret=secret, headers=headers,
                                    tolerance_seconds=tolerance_seconds, now=now):
        raise CalmLensWebhookVerificationError(error_codes.SDK_INVALID_WEBHOOK_SIGNATURE,
                                       "Webhook signature or timestamp is invalid")
    try:
        event = json.loads(body)
    except (ValueError, UnicodeDecodeError) as error:
        raise CalmLensWebhookVerificationError(error_codes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not valid JSON") from error
    if not _is_webhook_event(event):
        raise CalmLensWebhookVerificationError(error_codes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not a CalmLens event")
    return WebhookEventPayload(event)


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _optional(data: Mapping[str, object], key: str, nullable: bool) -> bool:
    return key not in data or (nullable and data[key] is None) or isinstance(data[key], str)


def _optional_number(data: Mapping[str, object], key: str) -> bool:
    return key not in data or data[key] is None or _is_number(data[key])


def _is_webhook_event(value: object) -> bool:
    """Whether ``value`` is a webhook body: the fields CalmLens always sends, and the API's types
    for the other known fields when present. Unknown fields are accepted."""
    if not isinstance(value, dict) or not all(isinstance(value.get(key), str) for key in ("id", "type", "projectId")):
        return False
    if not _is_number(value.get("createdAt")):
        return False
    asset, facts = value.get("asset"), value.get("facts", [])
    return (_optional(value, "severity", False) and _optional(value, "title", False)
            and _optional(value, "description", True) and _optional(value, "assetId", True)
            and _optional_number(value, "assetSequence")
            and (asset is None or (isinstance(asset, dict) and isinstance(asset.get("id"), str)))
            and isinstance(facts, list)
            and all(isinstance(fact, dict) and isinstance(fact.get("key"), str) and "value" in fact
                    and _optional(fact, "url", False) for fact in facts))


def get_event_fact(event: CalmLensObject | Mapping[str, Any], key: str) -> Any:
    """The value of one of an event's facts, by key, such as ``get_event_fact(event,
    "flagged-categories")`` on an ``asset.blocked`` event, or ``None`` when the event doesn't carry
    it. A key the event repeats gives its first value. The fact's ``url``, when it has one, is on
    the fact in ``event.facts``."""
    facts = _wire(event).get("facts")
    for fact in facts if isinstance(facts, list) else []:
        if isinstance(fact, Mapping) and fact.get("key") == key:
            return fact.get("value")
    return None


def get_event_facts(event: CalmLensObject | Mapping[str, Any]) -> dict[str, Any]:
    """An event's facts as a dict of values by key, such as ``{"flagged-categories": ["hate"]}``.
    A key the event repeats keeps its first value, as :func:`get_event_fact` reads it."""
    facts = _wire(event).get("facts")
    values: dict[str, Any] = {}
    for fact in facts if isinstance(facts, list) else []:
        if isinstance(fact, Mapping) and isinstance(fact.get("key"), str) and fact["key"] not in values:
            values[fact["key"]] = fact.get("value")
    return values


def is_test_webhook_event(event: CalmLensObject | Mapping[str, Any]) -> bool:
    """Whether a webhook event is a test send from the portal or the CLI rather than a real
    event: it carries the registered ``{"key": "test", "value": True}`` fact."""
    facts = _wire(event).get("facts")
    return isinstance(facts, list) and any(
        isinstance(fact, Mapping) and fact.get("key") == "test" and fact.get("value") is True for fact in facts)


def is_newer_asset_event(event: CalmLensObject | Mapping[str, Any], last_sequence: int | None) -> bool:
    """Whether to apply ``event`` after ``last_sequence``, the highest ``assetSequence`` you have
    applied for its asset (``None`` when none). Deliveries can arrive out of order: an event about
    an asset is newer only with a higher ``assetSequence``, so a retried or repeated delivery of an
    earlier one returns False. Events that aren't about an asset have no sequence and are always
    new. Store the highest ``assetSequence`` applied per ``assetId`` and ignore lower ones."""
    sequence = _wire(event).get("assetSequence")
    return sequence is None or last_sequence is None or sequence > last_sequence
