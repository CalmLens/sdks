"""The SDK's exception hierarchy.

Every failure the SDK raises is a :class:`CalmLensError` (or a subclass), with a stable
``code``:

* :class:`CalmLensAPIError`: the API answered with a non-2xx status. ``code`` is the API's
  error code (see :mod:`calmlens.error_codes`), or ``sdk/http-error`` when the response had
  no error body.
* :class:`CalmLensTransportError`: the request failed before a complete response arrived
  (``sdk/transport-error``); :class:`CalmLensTimeoutError` (``sdk/timeout``) when a
  connection or read timed out. The native exception is kept as ``__cause__``.
* :class:`CalmLensValidationError`: the SDK rejected the call before sending anything,
  for example ``sdk/invalid-argument``, ``sdk/invalid-config`` or ``upload/invalid-payload``.
* :class:`WebhookVerificationError`: ``parse_webhook_event`` could not verify a delivery
  (``sdk/invalid-webhook-signature``) or parse its body (``sdk/invalid-webhook-payload``).
"""
from __future__ import annotations

import email.utils
import time
from typing import Any, Mapping

from . import error_codes

__all__ = [
    "CalmLensError", "CalmLensAPIError", "CalmLensTransportError", "CalmLensTimeoutError",
    "CalmLensValidationError", "WebhookVerificationError",
]

_RETRYABLE_STATUSES = frozenset({429, 502, 503, 504})


def _parse_retry_after(value: str | None) -> float | None:
    """Seconds from a ``Retry-After`` header: delta-seconds or an HTTP date."""
    if not value:
        return None
    value = value.strip()
    if value.isascii() and value.isdigit():
        return float(value)
    try:
        when = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if when is None:
        return None
    return max(0.0, when.timestamp() - time.time())


class CalmLensError(Exception):
    """An API, transport or validation failure with a stable ``code``.

    Attributes:
        code: Stable error code, e.g. ``asset/not-found`` or ``sdk/timeout``.
        message: Human-readable description (do not match on it; use ``code``).
        details: Extra diagnostics from the API error body (``traceId`` included when sent).
        status: HTTP status for API errors, otherwise ``None``.
        request_id: The response's ``X-Request-Id`` header; quote it to support.
        headers: Response headers with lower-case names (empty without a response).
        retry_after: Seconds from the ``Retry-After`` header, when present.
    """

    def __init__(self, code: str, message: str | None = None, details: Mapping[str, Any] | None = None,
                 status: int | None = None, *, request_id: str | None = None,
                 headers: Mapping[str, str] | None = None, retry_after: float | None = None):
        self.code = code
        self.message = message or code
        super().__init__(f"[calmlens] {self.message}")
        # Details differ per error code and may hold any JSON value, so they stay untyped.
        self.details: dict[str, Any] = dict(details or {})
        self.status = status
        self.headers: dict[str, str] = {k.lower(): v for k, v in (headers or {}).items()}
        self.request_id = request_id if request_id is not None else self.headers.get("x-request-id")
        if retry_after is None:
            retry_after = _parse_retry_after(self.headers.get("retry-after"))
        self.retry_after = retry_after

    def __repr__(self) -> str:
        parts = [repr(self.code)]
        if self.status is not None:
            parts.append(f"status={self.status}")
        if self.request_id:
            parts.append(f"request_id={self.request_id!r}")
        return f"{type(self).__name__}({', '.join(parts)})"

    @property
    def is_not_found(self) -> bool:
        """True for ``*/not-found`` codes and HTTP 404 responses."""
        return self.status == 404 or self.code.endswith("/not-found")

    @property
    def is_retryable(self) -> bool:
        """True when sending the same request again later may succeed: network failures,
        timeouts, 429, 502, 503, 504 and ``idempotency/request-in-progress``. Retrying a
        non-idempotent write without an ``Idempotency-Key`` can still create duplicates."""
        return False


class CalmLensAPIError(CalmLensError):
    """The API answered with a non-2xx status."""

    @property
    def is_retryable(self) -> bool:
        return self.status in _RETRYABLE_STATUSES or self.code == error_codes.IDEMPOTENT_REQUEST_IN_PROGRESS


class CalmLensTransportError(CalmLensError):
    """The request failed before a complete response was received."""

    @property
    def is_retryable(self) -> bool:
        return True


class CalmLensTimeoutError(CalmLensTransportError):
    """Connecting or waiting for data took longer than the configured timeout."""


class CalmLensValidationError(CalmLensError, ValueError):
    """The SDK rejected the arguments or configuration before sending a request."""


class WebhookVerificationError(CalmLensError):
    """A webhook delivery failed signature verification or could not be parsed."""
