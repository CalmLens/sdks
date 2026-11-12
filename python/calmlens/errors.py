"""The SDK's exception hierarchy.

Every failure the SDK raises is a :class:`CalmLensError` with a stable ``code``. Its class says
what kind of failure it is, and every class is also an instance of the classes above it:

* :class:`CalmLensAPIError`: the API (or a proxy in front of it) answered with a non-2xx status.
  ``code`` is the API's error code (see :mod:`calmlens.error_codes`), or ``sdk/http-error`` when
  the response had no error body; ``body`` keeps the raw body. Its subclass names the status:
  :class:`CalmLensBadRequestError` (400), :class:`CalmLensAuthenticationError` (401),
  :class:`CalmLensPermissionDeniedError` (403), :class:`CalmLensNotFoundError` (404),
  :class:`CalmLensConflictError` (409), :class:`CalmLensPayloadTooLargeError` (413),
  :class:`CalmLensUnprocessableEntityError` (422), :class:`CalmLensRateLimitError` (429) and
  :class:`CalmLensServerError` (500 and above).
* :class:`CalmLensConnectionError`: no complete response arrived (``sdk/transport-error``). The
  native exception is kept as ``__cause__``.
* :class:`CalmLensTimeoutError`: ``sdk/timeout``, when a request took longer than its timeout or
  ``wait_for_decision`` reached its deadline.
* :class:`CalmLensCancelledError`: ``sdk/cancelled``, when the caller cancelled the call.
* :class:`CalmLensInvalidArgumentError`: the SDK refused the call before sending anything, such as
  ``sdk/invalid-argument`` or ``upload-payload/invalid``. It is also a ``ValueError``.
  :class:`CalmLensConfigurationError` is the client's configuration (``sdk/invalid-config``).
* :class:`CalmLensInvalidResponseError`: a response wasn't what the operation returns
  (``sdk/invalid-response``, ``sdk/response-too-large``).
* :class:`CalmLensWebhookVerificationError`: ``parse_webhook_event`` could not verify a delivery
  (``sdk/invalid-webhook-signature``) or parse its body (``sdk/invalid-webhook-payload``).
"""
from __future__ import annotations

import email.utils
import math
import time
from typing import Any, Mapping

from . import error_codes

__all__ = [
    "CalmLensError", "CalmLensAPIError", "CalmLensBadRequestError", "CalmLensAuthenticationError",
    "CalmLensPermissionDeniedError", "CalmLensNotFoundError", "CalmLensConflictError",
    "CalmLensPayloadTooLargeError", "CalmLensUnprocessableEntityError", "CalmLensRateLimitError",
    "CalmLensServerError", "CalmLensConnectionError", "CalmLensTimeoutError", "CalmLensCancelledError",
    "CalmLensInvalidArgumentError", "CalmLensConfigurationError", "CalmLensInvalidResponseError",
    "CalmLensWebhookVerificationError", "MAX_ERROR_BODY_CHARACTERS",
]

#: The most characters of an error response's body that :attr:`CalmLensAPIError.body` keeps.
MAX_ERROR_BODY_CHARACTERS = 16 * 1024

_RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})
_RETRYABLE_CODES = frozenset({error_codes.SDK_TRANSPORT_ERROR, error_codes.SDK_TIMEOUT,
                              error_codes.IDEMPOTENT_REQUEST_IN_PROGRESS})


def _parse_retry_after(value: str | None) -> int | None:
    """Whole seconds from a ``Retry-After`` header: delta-seconds, or an HTTP date (rounded up,
    0 once it has passed)."""
    if not value:
        return None
    value = value.strip()
    if value.isascii() and value.isdigit():
        return int(value)
    try:
        when = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if when is None:
        return None
    try:
        return max(0, math.ceil(when.timestamp() - time.time()))
    except (OverflowError, OSError, ValueError):
        return None


class CalmLensError(Exception):
    """An API, transport or validation failure with a stable ``code``.

    Attributes:
        code: Stable error code, e.g. ``asset/not-found`` or ``sdk/timeout``.
        message: Human-readable description (do not match on it; use ``code``).
        details: Extra diagnostics from the API error body, such as validation issues.
        status: HTTP status for API errors, otherwise ``None``.
        request_id: The response's ``X-Request-Id`` header (the error body's ``requestId``); quote it
            to support.
        headers: Response headers with lower-case names (empty without a response).
        retry_after: Seconds from the ``Retry-After`` header, when present.
    """

    def __init__(self, code: str, message: str | None = None, details: Mapping[str, Any] | None = None,
                 status: int | None = None, *, request_id: str | None = None,
                 headers: Mapping[str, str] | None = None, retry_after: float | None = None,
                 body: str | None = None):
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
        #: The response body as text, cut at :data:`MAX_ERROR_BODY_CHARACTERS` (such as a proxy's
        #: HTML page), or ``None`` without a response. It is kept out of ``str()``.
        self.body = body[:MAX_ERROR_BODY_CHARACTERS] if body is not None else None

    def __repr__(self) -> str:
        parts = [repr(self.code)]
        if self.status is not None:
            parts.append(f"status={self.status}")
        if self.request_id:
            parts.append(f"request_id={self.request_id!r}")
        return f"{type(self).__name__}({', '.join(parts)})"

    @property
    def is_local(self) -> bool:
        """True when the SDK raised this error itself, with no HTTP response: before sending (an
        invalid argument or option, or content it checks first, such as ``upload/unsupported-type``),
        or because no response arrived (a timeout, a cancellation or a connection failure). The code
        is the one the API would use; ``status`` and ``request_id`` are ``None``, so branch on
        ``code``."""
        return self.status is None

    @property
    def is_not_found(self) -> bool:
        """True for ``*/not-found`` codes and HTTP 404 responses."""
        return self.status == 404 or self.code.endswith("/not-found")

    @property
    def is_retryable(self) -> bool:
        """True when sending the same request again later may succeed: network failures,
        timeouts, 429, 500, 502, 503, 504 and ``idempotency/request-in-progress``. Retrying a
        non-idempotent write without an ``Idempotency-Key`` can still create duplicates.

        Decided from ``code`` and ``status`` alone, so every error class agrees: an
        ``sdk/timeout`` from ``wait_for_decision`` is retryable too."""
        return self.code in _RETRYABLE_CODES or self.status in _RETRYABLE_STATUSES


class CalmLensAPIError(CalmLensError):
    """The API, or a proxy in front of it, answered with a non-2xx status."""


class CalmLensBadRequestError(CalmLensAPIError):
    """HTTP 400: the request was invalid."""


class CalmLensAuthenticationError(CalmLensAPIError):
    """HTTP 401: the API key is missing or invalid."""


class CalmLensPermissionDeniedError(CalmLensAPIError):
    """HTTP 403: the API key lacks a grant."""


class CalmLensNotFoundError(CalmLensAPIError):
    """HTTP 404: the resource doesn't exist."""


class CalmLensConflictError(CalmLensAPIError):
    """HTTP 409: the request conflicts with the resource's state."""


class CalmLensPayloadTooLargeError(CalmLensAPIError):
    """HTTP 413: the content is over a size limit."""


class CalmLensUnprocessableEntityError(CalmLensAPIError):
    """HTTP 422: the content can't be processed."""


class CalmLensRateLimitError(CalmLensAPIError):
    """HTTP 429: too many requests. ``retry_after`` says when to try again, when the API said."""


class CalmLensServerError(CalmLensAPIError):
    """HTTP 500 or above: the API failed."""


class CalmLensConnectionError(CalmLensError):
    """``sdk/transport-error``: no complete response, as the connection failed or was cut."""


class CalmLensTimeoutError(CalmLensError):
    """``sdk/timeout``: a request took longer than its timeout, or ``wait_for_decision`` reached
    its deadline without a decision."""


class CalmLensCancelledError(CalmLensError):
    """``sdk/cancelled``: the caller cancelled the call."""


class CalmLensInvalidArgumentError(CalmLensError, ValueError):
    """The SDK refused the call before sending a request, so the error has no HTTP status."""


class CalmLensConfigurationError(CalmLensInvalidArgumentError):
    """The client's configuration is invalid (``sdk/invalid-config``)."""


class CalmLensInvalidResponseError(CalmLensError):
    """A response wasn't what the operation returns (``sdk/invalid-response``,
    ``sdk/response-too-large``)."""


class CalmLensWebhookVerificationError(CalmLensError):
    """A webhook delivery failed signature verification or could not be parsed."""


_API_ERRORS: dict[int, type[CalmLensAPIError]] = {
    400: CalmLensBadRequestError, 401: CalmLensAuthenticationError, 403: CalmLensPermissionDeniedError,
    404: CalmLensNotFoundError, 409: CalmLensConflictError, 413: CalmLensPayloadTooLargeError,
    422: CalmLensUnprocessableEntityError, 429: CalmLensRateLimitError,
}
_LOCAL_ERRORS: dict[str, type[CalmLensError]] = {
    error_codes.SDK_TRANSPORT_ERROR: CalmLensConnectionError,
    error_codes.SDK_TIMEOUT: CalmLensTimeoutError,
    "sdk/cancelled": CalmLensCancelledError,
    error_codes.SDK_INVALID_RESPONSE: CalmLensInvalidResponseError,
    error_codes.SDK_RESPONSE_TOO_LARGE: CalmLensInvalidResponseError,
    error_codes.SDK_INVALID_CONFIG: CalmLensConfigurationError,
    # JavaScript's code for a runtime without fetch; Python never raises it, but its kind is shared.
    "sdk/no-fetch": CalmLensConfigurationError,
    error_codes.SDK_INVALID_WEBHOOK_SIGNATURE: CalmLensWebhookVerificationError,
    error_codes.SDK_INVALID_WEBHOOK_PAYLOAD: CalmLensWebhookVerificationError,
}


def api_error_class(status: int) -> type[CalmLensAPIError]:
    """The :class:`CalmLensAPIError` subclass for an HTTP status."""
    if status >= 500:
        return CalmLensServerError
    return _API_ERRORS.get(status, CalmLensAPIError)


def _error(code: str, message: str | None = None, details: Mapping[str, Any] | None = None,
           status: int | None = None, **keywords: Any) -> CalmLensError:
    """An error of the kind its code and status name: an HTTP error by its status, any other by its
    code, and anything else refused before sending an invalid argument."""
    cls: type[CalmLensError] = (api_error_class(status) if status is not None and status >= 300
                                else _LOCAL_ERRORS.get(code, CalmLensInvalidArgumentError))
    return cls(code, message, details, status, **keywords)
