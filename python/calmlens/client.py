"""Standard-library HTTP client. Options and responses keep the API's camelCase keys."""
from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import http.client
import io
import json
import math
import os
import platform
import queue
import random
import re
import select
import threading
import time
import uuid
import zlib
from collections.abc import Iterator, Mapping
from decimal import Decimal
from types import TracebackType
from typing import Any, BinaryIO, Callable, List, Literal, Protocol, TypeVar, cast
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit
from urllib.request import Request, getproxies, proxy_bypass

from . import error_codes
from ._option_keys import NULLABLE_OPTION_KEYS
from ._transform_schema import TRANSFORM_OPTIONS_SCHEMA
from ._upload_mime_types import UPLOAD_MIME_PREFIXES, UPLOAD_MIME_REJECTED, UPLOAD_MIME_SUFFIXES, UPLOAD_MIME_TYPES
from ._version import __version__
from .errors import (CalmLensAPIError, CalmLensError, CalmLensTimeoutError, CalmLensTransportError,
                     CalmLensValidationError, _parse_retry_after)
from .moderation_context import select_moderation_context_items
from .types import (IMAGE_TRANSFORM_COLOUR_KEYS, Asset, AssetBatchOperation, AssetIdOptions, AssetPage, AssetTimelinePage, AssetSearchResponse, AssetInfo, AssetUrlOptions, CdnResource, CdnTransform,
                    Content, CreateFolderOptions, EnsureLensesOptions, Event, EventType, EventsPage, Folder, FolderPage, ListFoldersOptions, FolderIdOptions, Lens,
                    ImageTransformOptions, LensDefinition, LensType, ListAssetsOptions, ListChildrenOptions, ListTimelineOptions, ListEventsOptions,
                    BatchAssetsOptions, BatchAssetsResponse,
                    MetadataItem, ModerationContext, ClassifyTextOptions, ExplainAssetOptions, MoveAssetOptions, MoveFolderOptions, PartContent,
                    ProcessingOptions, SearchAssetsOptions, SearchMode, ServeInit, ServeOptions, SignedAssetUrl,
                    SignedUploadToken, SignAssetUrlOptions, GetAssetInfoOptions, SignUploadTokenOptions, SubmitAssetOptions,
                    UpdateAssetOptions, UpdateFolderOptions, UploadPartOptions,
                    AddHashListEntryOptions, CreateHashListOptions, HashList, HashListAction, HashListEntry,
                    HashListEntryIdOptions, HashListEntryPage, HashListIdOptions, HashListPage,
                    ListHashListEntriesOptions, ListHashListsOptions, DecideAssetOptions, UpdateHashListOptions,
                    AssignPolicyOptions, CreatePolicyOptions, ListPoliciesOptions, Policy, PolicyIdOptions, PolicyPage,
                    PolicySettings, ResetPolicyOptions, SetPolicyAutomaticUpdatesOptions, UpdatePolicyOptions,
                    UpgradePolicyOptions, LensIdOptions, LensPage, ListLensesOptions, UpdateLensOptions, AssetTimelineSegment,
                    DeleteMetadataFieldOptions, EnsureMetadataFieldsOptions, EnsureUploadPresetsOptions,
                    EnsureUploadPresetsResponse, ListUploadPresetsOptions, MetadataFieldDefinition, MetadataFieldsResource,
                    ProjectSettingsResource, PublicProjectSettingsInput, UpdateProjectSettingsOptions, UploadPreset,
                    UploadPresetDefinition, UploadPresetIdOptions, UploadPresetPage,
                    ViewerClaims, Visibility, WaitForDecisionOptions)
from .webhooks import parse_webhook_event, verify_webhook_signature

__all__ = ["CalmLensServerClient", "CDNResponse", "Transport", "TransportResponse", "DEFAULT_TIMEOUT", "CDN_RESOURCES",
           "DEFAULT_SIGNED_URL_EXPIRES_IN", "MAX_SIGNED_URL_EXPIRES_IN",
           "DEFAULT_CONNECT_TIMEOUT", "DEFAULT_MAX_RETRIES", "DEFAULT_MAX_RESPONSE_BYTES", "DEFAULT_PART_SIZE_BYTES",
           "MIN_PART_SIZE_BYTES", "MAX_PART_SIZE_BYTES", "USER_AGENT"]


class TransportResponse(Protocol):
    """The context-managed response a custom ``transport`` returns. A ``headers`` attribute (a
    mapping or ``(name, value)`` pairs) is read when present."""
    status: int

    def read(self, amount: int | None = ..., /) -> bytes: ...

    def close(self) -> None: ...

    def __enter__(self) -> TransportResponse: ...

    def __exit__(self, exc_type: type[BaseException] | None, exc: BaseException | None,
                 traceback: TracebackType | None, /) -> object: ...


#: ``transport(request, timeout)``: sends ``request`` and returns its response.
Transport = Callable[[Request, float], TransportResponse]

#: Seconds a connection may stay silent (no bytes sent or received) before ``sdk/timeout``.
#: It is not a limit on the whole transfer, so large uploads and downloads are not cut off.
DEFAULT_TIMEOUT = 120.0
#: Seconds allowed to open a connection (TCP, proxy CONNECT and TLS handshake).
DEFAULT_CONNECT_TIMEOUT = 10.0
#: Retries after the first attempt for requests that are safe to resend.
DEFAULT_MAX_RETRIES = 2
#: Default largest API response body the client reads (CDN downloads are streamed and unlimited).
DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024
#: Content larger than ``part_size_bytes`` is uploaded automatically in parts of this many bytes.
DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024
#: The smallest and largest ``part_size_bytes`` (every part but the last is at least 5 MiB).
MIN_PART_SIZE_BYTES = 5 * 1024 * 1024
MAX_PART_SIZE_BYTES = 64 * 1024 * 1024
#: The longest ``idempotency_key`` of an upload that is split: each part's key adds ``:part-<n>``.
_MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH = 240
#: Seconds before the first retry; each later retry waits twice as long, up to ``RETRY_MAX_DELAY``.
#: Half of each wait is fixed and half random.
RETRY_BASE_DELAY = 0.5
RETRY_MAX_DELAY = 8.0
#: ``Retry-After`` values above this are not waited for; the error is raised instead.
MAX_RETRY_AFTER_SECONDS = 60.0
USER_AGENT = f"calmlens-python/{__version__} ({platform.python_implementation().lower()}/{platform.python_version()})"

_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
_ENV_API_KEY, _ENV_PROJECT_ID = "CALMLENS_API_KEY", "CALMLENS_PROJECT_ID"


class _Unset:
    def __repr__(self) -> str:
        return "UNSET"


#: Default for keyword arguments: distinguishes "not given" from an explicit ``None``.
_UNSET: Any = _Unset()


def _json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as error:
        raise CalmLensValidationError(error_codes.SDK_INVALID_ARGUMENT, f"Value is not JSON serialisable: {error}") from error


def _invalid(message: str, code: str = error_codes.SDK_INVALID_ARGUMENT) -> CalmLensValidationError:
    return CalmLensValidationError(code, message)


def _id(value: object, name: str = "Identifier") -> str:
    """Encode an identifier as one path segment, like JavaScript's encodeURIComponent."""
    if not isinstance(value, str) or not value:
        raise _invalid(f"{name} is required")
    # URL resolution treats these as relative segments, which would reach another route.
    if value in (".", ".."):
        raise _invalid(f'{name} cannot be "." or ".."')
    return quote(value, safe="~!*'()-._")


_TRANSFORM_OPTION_NAME = re.compile(r"[a-z][a-zA-Z0-9]*")
_HEX_COLOUR = re.compile(r"#((?:[0-9a-fA-F]{3}){1,2}|(?:[0-9a-fA-F]{4}){1,2})")


def _transform_component(value: str) -> str:
    """Percent-encode everything except RFC 3986 unreserved characters (``A-Z a-z 0-9 - . _ ~``)."""
    try:
        return quote(value, safe="-._~")
    except UnicodeEncodeError as error:
        raise _invalid("Transform options must be valid Unicode") from error


def _js_number(value: float) -> str:
    """Format a finite number like JavaScript's ``String(number)``."""
    if value == 0:
        return "0"
    sign, digits, exponent = Decimal(repr(value)).normalize().as_tuple()
    text = "".join(map(str, digits))
    point = len(text) + cast(int, exponent)  # Digits before the decimal point.
    if len(text) <= point <= 21:
        out = text + "0" * (point - len(text))
    elif 0 < point <= 21:
        out = text[:point] + "." + text[point:]
    elif -6 < point <= 0:
        out = "0." + "0" * -point + text
    else:
        power = point - 1
        out = text[0] + ("." + text[1:] if len(text) > 1 else "") + ("e+" if power >= 0 else "e-") + str(abs(power))
    return ("-" if sign else "") + out


def _transform_options(pairs: list[str], key: str, value: Any) -> None:
    if value is None:
        return
    if isinstance(value, Mapping):
        for child in _sorted_keys(value, f"{key}."):
            _transform_options(pairs, f"{key}.{child}", value[child])
        return
    if isinstance(value, str):
        hex_colour = _HEX_COLOUR.fullmatch(value) if key in IMAGE_TRANSFORM_COLOUR_KEYS else None
        text = hex_colour.group(1).lower() if hex_colour else value
    elif isinstance(value, bool):
        text = "true" if value else "false"
    elif isinstance(value, int) and abs(value) < 10 ** 21:
        text = str(value)
    elif isinstance(value, (int, float)):
        try:
            number = float(value)
        except OverflowError:
            number = math.inf
        if not math.isfinite(number):
            raise _invalid(f'Transform option "{key}" must be a finite number')
        text = _js_number(number)
    else:
        raise _invalid(f'Transform option "{key}" must be a string, number, boolean or mapping')
    pairs.append(key + "=" + _transform_component(text))


def _sorted_keys(options: Mapping[Any, Any], prefix: str = "") -> list[str]:
    for key in options:
        if not isinstance(key, str) or not _TRANSFORM_OPTION_NAME.fullmatch(key):
            raise _invalid(f'Transform option "{prefix}{key}" is not a valid name')
    return sorted(options)


def _has_rule_type(type: Any, value: Any) -> bool:
    if type == "object":
        return isinstance(value, Mapping)
    if type == "string":
        return isinstance(value, str)
    if type == "boolean":
        return isinstance(value, bool)
    if type in ("number", "integer"):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False
        try:
            if not math.isfinite(value):
                return False
        except OverflowError:
            return False
        return type == "number" or float(value).is_integer()
    return True


def _check_transform_options(options: Mapping[str, Any]) -> tuple[list[str], list[str]]:
    """Check transform options against the image transform schema, as the CDN does: the dotted
    keys it doesn't know and those whose values it refuses (or that are required and missing).
    ``None`` options are left out of a selector, so they are not checked."""
    unknown_keys: list[str] = []
    invalid_keys: list[str] = []

    def check(schema: Mapping[str, Any], value: Any, key: str) -> None:
        branches = schema.get("oneOf")
        rule = next((branch for branch in branches if _has_rule_type(branch.get("type"), value)), None) \
            if branches is not None else schema
        if (rule is None or not _has_rule_type(rule.get("type"), value)
                or ("enum" in rule and not any(type(value) is type(item) and value == item for item in rule["enum"]))
                or ("minimum" in rule and value < rule["minimum"])
                or ("maximum" in rule and value > rule["maximum"])):
            invalid_keys.append(key)
            return
        if rule.get("type") != "object":
            return

        def path(name: str) -> str:
            return f"{key}.{name}" if key else name
        for name in rule.get("required", []):
            if value.get(name) is None:
                invalid_keys.append(path(name))
        properties = rule.get("properties", {})
        for name in sorted(str(name) for name in value):
            if value.get(name) is None:
                continue
            if name in properties:
                check(properties[name], value[name], path(name))
            else:
                unknown_keys.append(path(name))

    check(TRANSFORM_OPTIONS_SCHEMA, options, "")
    return unknown_keys, invalid_keys


def _assert_transform_options(options: Mapping[str, Any]) -> None:
    """Raise ``sdk/invalid-argument`` naming each transform option the CDN would refuse."""
    unknown_keys, invalid_keys = _check_transform_options(options)
    if not unknown_keys and not invalid_keys:
        return
    problems = []
    if unknown_keys:
        problems.append(f"unknown option{'s' if len(unknown_keys) > 1 else ''} {', '.join(unknown_keys)}")
    if invalid_keys:
        problems.append(f"invalid value{'s' if len(invalid_keys) > 1 else ''} for {', '.join(invalid_keys)}")
    raise CalmLensValidationError(
        error_codes.SDK_INVALID_ARGUMENT,
        f"Transform options are invalid: {'; '.join(problems)}. Pass the options themselves, such as "
        '{"width": 640, "format": "webp"}.', {"unknownKeys": unknown_keys, "invalidKeys": invalid_keys})


def _serialize_transform(transform: Any) -> str:
    """Serialize structured transform options as a CDN selector, such as ``fit=cover,width=640``.

    Option keys are sorted so equal transforms share a URL, nested keys are dotted
    (``border.color``), hex colours are written without ``#`` and values are percent-encoded, so
    the result is already path-safe.
    """
    if not isinstance(transform, Mapping):
        raise _invalid("Transform options must be a mapping")
    _assert_transform_options(transform)
    pairs: list[str] = []
    for key in _sorted_keys(transform):
        _transform_options(pairs, key, transform[key])
    if not pairs:
        raise _invalid("A transform needs at least one option")
    return ",".join(pairs)


def _transform_selector(transform: Any) -> Any:
    """The selector string the API and CDN accept for a string or structured transform."""
    if transform is None:
        return None
    if not isinstance(transform, str):
        return _serialize_transform(transform)
    # A transform is one path segment of options: it must not add a segment, lens, query or fragment.
    if any(c in transform for c in "/?#") or ".." in transform or transform.startswith("@"):
        raise _invalid('Transform cannot contain "/", "..", "?" or "#", or start with "@"')
    return transform


def _has_transform(transform: Any) -> bool:
    return transform is not None and transform != ""


#: The ISO 3166-1 alpha-2 countries a viewer's ``region`` can be, as the CDN accepts them.
VIEWER_COUNTRIES: frozenset[str] = frozenset(
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ "
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO "
    "FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE "
    "JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO "
    "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW "
    "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM "
    "TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split())


def _url_viewer_claims(claims: Any) -> dict[str, Any] | None:
    """The viewer claims a URL carries: ``region`` when set and ``ageConfirmed`` only when true, in
    that order. No region and an unconfirmed age are the CDN's defaults, left out so default URLs
    stay cacheable (``None`` when nothing is left)."""
    if claims is None:
        return None
    if not isinstance(claims, Mapping) or any(key not in ("region", "ageConfirmed") for key in claims):
        raise _invalid("viewer_claims takes only region and ageConfirmed")
    region, age_confirmed = claims.get("region"), claims.get("ageConfirmed")
    if "region" in claims and (not isinstance(region, str) or region not in VIEWER_COUNTRIES):
        raise _invalid("viewer_claims region must be an ISO 3166-1 alpha-2 country code, such as DE")
    if "ageConfirmed" in claims and not isinstance(age_confirmed, bool):
        raise _invalid("viewer_claims ageConfirmed must be a boolean")
    sent = {**({"region": region} if region else {}), **({"ageConfirmed": True} if age_confirmed is True else {})}
    return sent or None


def _viewer_claims_query(claims: Any) -> str:
    """The ``?viewerClaims=`` query of a URL with these claims, or an empty string for the defaults."""
    sent = _url_viewer_claims(claims)
    return "?" + urlencode({"viewerClaims": json.dumps(sent, separators=(",", ":"))}) if sent else ""


def _transform_path(value: Any) -> str:
    """A transform as a URL path selector: structured options serialized, strings checked and
    encoded like JavaScript's encodeURI."""
    selector: str = _transform_selector(value)
    if not isinstance(value, str):
        return selector
    try:
        return quote(selector, safe=";/:@&=+$,~!*'()-._")
    except UnicodeEncodeError as error:
        raise _invalid("Transform must be valid Unicode") from error


def _header_value(name: str, value: object) -> str:
    """Reject header values that http.client would refuse (or that would split headers)."""
    if not isinstance(value, str) or any(c in value for c in "\r\n\0"):
        raise _invalid(f"Header {name} must be a string without line breaks")
    return value


# Failures raised while sending a request or reading its response: sockets, TLS, DNS, HTTP
# protocol errors, truncated bodies and decompression errors. ValueError is deliberately
# absent: it signals a bug or invalid input, never a network problem.
_TRANSPORT_ERRORS = (OSError, http.client.HTTPException, EOFError, zlib.error)


def _transport_error(error: BaseException) -> CalmLensError:
    """Wrap a transport failure; callers raise it ``from error`` to keep the native cause."""
    if isinstance(error, TimeoutError) or isinstance(getattr(error, "reason", None), TimeoutError):
        return CalmLensTimeoutError(error_codes.SDK_TIMEOUT, str(error) or type(error).__name__)
    return CalmLensTransportError(error_codes.SDK_TRANSPORT_ERROR, str(error) or type(error).__name__)


def _response_headers(response: Any) -> dict[str, str]:
    headers = getattr(response, "headers", None)
    if headers is None:
        return {}
    items = headers.items() if hasattr(headers, "items") else headers
    return {str(k).lower(): str(v) for k, v in items}


def _read_body(response: Any, headers: Mapping[str, str], limit: int) -> bytes | None:
    """Read an API response body; None when it exceeds ``limit`` bytes (a body that declares a
    larger ``Content-Length`` is not read at all)."""
    declared = headers.get("content-length", "")
    if declared.isascii() and declared.isdigit():
        if int(declared) > limit:
            return None
        # read() without a size raises IncompleteRead when the connection ends early.
        content = cast(bytes, response.read())
    else:
        content = cast(bytes, response.read(limit + 1))
    return None if len(content) > limit else content


def _is_redirect(status: int, headers: Mapping[str, str]) -> bool:
    """A redirect the SDK must not follow: it would send the API key to another origin."""
    return 300 <= status < 400 and "location" in headers


def _redirect_error(status: int, headers: dict[str, str]) -> CalmLensAPIError:
    # An HTTP failure like any other non-2xx: repeating the request redirects again.
    return CalmLensAPIError(error_codes.SDK_HTTP_ERROR, f"Unexpected redirect (HTTP {status})", status=status,
                            headers=headers)


def _too_large(status: int, headers: dict[str, str], limit: int) -> CalmLensError:
    return CalmLensError(error_codes.SDK_RESPONSE_TOO_LARGE, f"Response body exceeds {limit} bytes", status=status,
                         headers=headers)


def _retry_delay(attempt: int) -> float:
    """Seconds to wait before retry ``attempt`` (0-based): half of the exponential delay is fixed,
    the other half random, rounded to milliseconds like the JavaScript SDK."""
    delay = min(RETRY_MAX_DELAY, RETRY_BASE_DELAY * float(2 ** attempt))
    return round((delay / 2 + random.random() * delay / 2) * 1000) / 1000


class _PooledResponse:
    def __init__(self, response: http.client.HTTPResponse, connection: http.client.HTTPConnection,
                 pool: _ConnectionPool):
        self._response: http.client.HTTPResponse = response
        self._connection: http.client.HTTPConnection | None = connection
        self._pool = pool
        self.status, self.headers = response.status, response.headers

    def read(self, amount: int | None = None) -> bytes:
        try:
            data = self._response.read(amount)
        except BaseException:
            self.close()
            raise
        if self._response.isclosed() and self._connection is not None:
            connection, self._connection = self._connection, None
            self._pool.release(connection, not self._response.will_close)
        return data

    def close(self) -> None:
        self._response.close()
        if self._connection is not None:
            connection, self._connection = self._connection, None
            self._pool.release(connection, False)

    def __enter__(self) -> _PooledResponse:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


# Servers and proxies close idle keep-alive connections, often after a few seconds, so
# connections idle for longer are not reused.
_MAX_IDLE_SECONDS = 4.0
# Errors a reused connection raises when the server closed it before reading the request.
_STALE_CONNECTION_ERRORS = (http.client.RemoteDisconnected, http.client.BadStatusLine,
                            ConnectionResetError, ConnectionAbortedError, BrokenPipeError)


def _closed_by_server(connection: http.client.HTTPConnection) -> bool:
    """An idle HTTP connection is readable only when the server closed it (or sent junk)."""
    if connection.sock is None:
        return True
    try:
        return bool(select.select([connection.sock], [], [], 0)[0])
    except (OSError, ValueError):
        return True


class _ConnectionPool:
    def __init__(self) -> None:
        self.idle: queue.Queue[tuple[http.client.HTTPConnection, float]] = queue.Queue(maxsize=8)
        self.closed = False
        self.lock = threading.Lock()

    def acquire(self) -> http.client.HTTPConnection | None:
        """Return an idle connection that still looks usable, or None."""
        while True:
            try:
                connection, released_at = self.idle.get_nowait()
            except queue.Empty:
                return None
            if time.monotonic() - released_at <= _MAX_IDLE_SECONDS and not _closed_by_server(connection):
                return connection
            connection.close()

    def release(self, connection: http.client.HTTPConnection, reusable: bool) -> None:
        with self.lock:
            if not self.closed and reusable:
                try:
                    self.idle.put_nowait((connection, time.monotonic()))
                    return
                except queue.Full:
                    pass
        connection.close()

    def close(self) -> None:
        with self.lock:
            self.closed = True
            while not self.idle.empty():
                self.idle.get_nowait()[0].close()


class _Transport:
    """One pooled connection per in-flight request; safe to share between threads.

    Redirects are not followed, so the API key never leaves the configured endpoint. A
    request is resent here only when a reused idle connection turns out to have been closed
    by the server; other retries are the client's. After ``os.fork()`` the child starts with
    an empty pool instead of sharing the parent's sockets.
    """

    def __init__(self, connect_timeout: float = DEFAULT_CONNECT_TIMEOUT):
        self.connect_timeout = connect_timeout
        self.pools: dict[tuple[Any, ...], _ConnectionPool] = {}
        self.proxies = getproxies()
        # Proxy bypass decisions per host. Cached because they can query the OS (macOS
        # system configuration), which is also unsafe to call in a forked child.
        self.bypass: dict[str, bool] = {}
        self.lock = threading.Lock()
        self.closed = False
        self.pid = os.getpid()

    def _after_fork(self) -> None:
        # Sockets inherited from the parent belong to the parent's requests. Drop them
        # without closing (closing a TLS socket could disturb the parent's session).
        if self.pid != os.getpid():
            self.lock = threading.Lock()
            self.pools = {}
            self.pid = os.getpid()

    def __call__(self, request: Request, timeout: float) -> _PooledResponse:
        self._after_fork()
        url = urlsplit(request.full_url)
        if url.scheme not in ("http", "https") or not url.hostname:
            raise _invalid("Expected an HTTP(S) URL", error_codes.SDK_INVALID_CONFIG)
        proxy_url = self.proxies.get(url.scheme)
        if proxy_url:
            bypass = self.bypass.get(url.hostname)
            if bypass is None:
                bypass = self.bypass[url.hostname] = bool(proxy_bypass(url.hostname))
            if bypass:
                proxy_url = None
        proxy = urlsplit(proxy_url if proxy_url and "://" in proxy_url else "http://" + proxy_url) if proxy_url else None
        if proxy and proxy.scheme == "https" and url.scheme == "https":
            # http.client cannot run TLS to the target inside a TLS connection to the proxy.
            raise _invalid("HTTPS requests cannot use an https:// proxy URL; set HTTPS_PROXY to the "
                           "proxy's http:// address (the connection to CalmLens is still encrypted end to end)",
                           error_codes.SDK_INVALID_CONFIG)
        origin = (url.scheme, url.hostname, url.port, proxy_url)
        headers = dict(request.header_items())
        target = url.path + ("?" + url.query if url.query else "")
        proxy_headers = {}
        if proxy and proxy.username:
            credentials = unquote(proxy.username) + ":" + unquote(proxy.password or "")
            proxy_headers["Proxy-Authorization"] = "Basic " + base64.b64encode(credentials.encode()).decode()
        if proxy and url.scheme == "http":
            target = request.full_url
            headers.update(proxy_headers)
        with self.lock:
            if self.closed:
                raise CalmLensValidationError(error_codes.SDK_INVALID_CONFIG, "Client is closed")
            pool = self.pools.setdefault(origin, _ConnectionPool())

        def connect() -> http.client.HTTPConnection:
            cls = (http.client.HTTPSConnection if url.scheme == "https" or (proxy and proxy.scheme == "https")
                   else http.client.HTTPConnection)
            host: str | None
            port: int | None
            if proxy:
                host, port = proxy.hostname, proxy.port or (443 if proxy.scheme == "https" else 80)
            else:
                host, port = url.hostname, url.port
            connection = cls(host, port, timeout=self.connect_timeout)  # type: ignore[arg-type]
            if proxy and url.scheme == "https":
                connection.set_tunnel(url.hostname, url.port or 443, headers=proxy_headers)  # type: ignore[arg-type]
            return connection

        def send(connection: http.client.HTTPConnection) -> _PooledResponse:
            try:
                if connection.sock is None:
                    connection.timeout = self.connect_timeout
                    connection.connect()
                connection.timeout = timeout
                connection.sock.settimeout(timeout)
                connection.request(request.get_method(), target, body=request.data, headers=headers)
                return _PooledResponse(connection.getresponse(), connection, pool)
            except BaseException:
                pool.release(connection, False)
                raise

        # A stream body cannot be sent twice, so it always gets a new connection.
        reused = pool.acquire() if request.data is None or isinstance(request.data, (bytes, bytearray)) else None
        if reused is None:
            return send(connect())
        try:
            return send(reused)
        except _STALE_CONNECTION_ERRORS:
            # The server closed the idle connection before reading the request: send it once more.
            return send(connect())

    def close(self) -> None:
        with self.lock:
            self.closed = True
            for pool in self.pools.values():
                pool.close()


class _LimitedReader(io.RawIOBase):
    """Streams exactly ``size`` bytes of a binary file object, so a stream that is longer
    than declared cannot corrupt the HTTP request and a shorter one fails clearly. Without a
    ``size`` it streams until the end (the request is then sent with chunked encoding)."""

    def __init__(self, stream: BinaryIO, size: int | None):
        super().__init__()
        self._stream, self._remaining, self._size = stream, size, size

    def readable(self) -> bool:
        return True

    def read(self, amount: int | None = -1) -> bytes:
        if amount is None or amount < 0:
            chunks: list[bytes] = []
            while True:
                chunk = self.read(1024 * 1024)
                if not chunk:
                    return b"".join(chunks)
                chunks.append(chunk)
        if self._remaining is not None and self._remaining <= 0:
            return b""
        wanted = amount if self._remaining is None else min(amount, self._remaining)
        data = self._stream.read(wanted)
        if not isinstance(data, (bytes, bytearray)):
            raise CalmLensValidationError(error_codes.INVALID_UPLOAD_PAYLOAD,
                                          "Upload streams must be opened in binary mode")
        if self._remaining is None:
            return bytes(data)
        if not data:
            raise CalmLensValidationError(
                error_codes.INVALID_UPLOAD_PAYLOAD,
                f"The stream ended after {cast(int, self._size) - self._remaining} of {self._size} bytes "
                "(sizeInBytes)")
        self._remaining -= len(data)
        return bytes(data)


def _stream_size(stream: Any) -> int | None:
    """Bytes left in a seekable stream (from its current position), or None."""
    try:
        if not stream.seekable():
            return None
        position = stream.tell()
        end = stream.seek(0, io.SEEK_END)
        stream.seek(position)
        return max(0, int(end) - int(position))
    except (AttributeError, OSError, ValueError):
        return None


class _Body:
    """An upload body that can be rewound for a retry when its source allows it."""

    def __init__(self, data: bytes | None = None, stream: Any = None, size: int | None = 0):
        self.data, self.stream, self.size = data, stream, size
        self.start: int | None = None
        if stream is not None and _stream_size(stream) is not None:
            self.start = stream.tell()

    @property
    def rewindable(self) -> bool:
        return self.stream is None or self.start is not None

    def slice(self, offset: int, size: int) -> _Body:
        """``size`` bytes from ``offset``, re-read from the source on every attempt (rewindable
        bodies only)."""
        if self.stream is None:
            return _Body(cast(bytes, self.data)[offset:offset + size], size=size)
        piece = _Body(size=size)
        piece.stream, piece.start = self.stream, cast(int, self.start) + offset
        return piece

    def open(self) -> bytes | BinaryIO:
        if self.stream is None:
            return cast(bytes, self.data)
        if self.start is not None:
            self.stream.seek(self.start)
        return cast(BinaryIO, _LimitedReader(self.stream, self.size))


class _ConcatReader(io.RawIOBase):
    """Reads several binary sources one after another, so a form's file part is streamed."""

    def __init__(self, sources: list[Any]):
        super().__init__()
        self._sources = sources

    def readable(self) -> bool:
        return True

    def read(self, amount: int | None = -1) -> bytes:
        if amount is None or amount < 0:
            return b"".join(iter(lambda: self.read(1024 * 1024), b""))
        while self._sources:
            chunk = self._sources[0].read(amount)
            if chunk:
                return bytes(chunk)
            self._sources.pop(0)
        return b""


class _FormBody:
    """An upload form (``multipart/form-data``): the asset's fields as the JSON ``options`` part,
    then the file's bytes as the ``file`` part. Asset fields never go in the URL, which proxies and
    servers log. The file is read from its source as the form is sent, so a stream stays streamed
    and the form can be resent only when its file can be."""

    def __init__(self, options: Mapping[str, Any], mime: str, file: _Body):
        boundary = "calmlens-" + uuid.uuid4().hex
        self.content_type = "multipart/form-data; boundary=" + boundary
        self.head = (f'--{boundary}\r\nContent-Disposition: form-data; name="options"\r\n'
                     f"Content-Type: application/json\r\n\r\n{_json(options)}\r\n"
                     f'--{boundary}\r\nContent-Disposition: form-data; name="file"\r\n'
                     f"Content-Type: {_header_value('type', mime)}\r\n\r\n").encode("utf-8")
        self.tail = f"\r\n--{boundary}--\r\n".encode("ascii")
        self.file = file
        self.size = None if file.size is None else len(self.head) + file.size + len(self.tail)

    @property
    def rewindable(self) -> bool:
        return self.file.rewindable

    def open(self) -> bytes | BinaryIO:
        data = self.file.open()
        if isinstance(data, bytes):
            return self.head + data + self.tail
        return cast(BinaryIO, _ConcatReader([io.BytesIO(self.head), data, io.BytesIO(self.tail)]))


_PAYLOAD_KEYS = ("plainText", "base64", "data")


def _payload(payload: object, multipart: bool = False, part_size: bool = True) -> _Body:
    if not isinstance(payload, Mapping):
        raise _invalid("content must be a dict")
    legacy = [k for k in ("uint8Array", "buffer", "bytes") if k in payload]
    if legacy:
        raise _invalid(f"Use data= for raw bytes or a binary file (not {legacy[0]})", error_codes.INVALID_UPLOAD_PAYLOAD)
    keys = [k for k in _PAYLOAD_KEYS if k in payload]
    if len(keys) != 1:
        raise _invalid("Supply exactly one of plainText, base64 or data", error_codes.INVALID_UPLOAD_PAYLOAD)
    key = keys[0]
    value = payload[key]
    declared = payload.get("sizeInBytes")
    if declared is not None and (type(declared) is not int or declared < 0):
        raise _invalid("sizeInBytes must be a non-negative integer", error_codes.INVALID_UPLOAD_PAYLOAD)
    body: _Body
    if key in ("plainText", "base64") and not isinstance(value, str):
        raise _invalid(f"{key} must be a string", error_codes.INVALID_UPLOAD_PAYLOAD)
    if key == "plainText":
        body = _Body(value.encode("utf-8"))
    elif key == "base64":
        raw = "".join(value.split(";base64,", 1)[-1].split())
        if multipart and len(raw) % 4:
            raise _invalid("Split bytes before base64-encoding each part", error_codes.INVALID_UPLOAD_PAYLOAD)
        try:
            body = _Body(base64.b64decode(raw + "=" * (-len(raw) % 4), validate=True))
        except (ValueError, TypeError) as error:
            raise _invalid("Invalid base64", error_codes.INVALID_UPLOAD_PAYLOAD) from error
    elif isinstance(value, (bytes, bytearray, memoryview)):
        body = _Body(bytes(value))
    elif hasattr(value, "read"):
        if isinstance(value, io.TextIOBase):
            raise _invalid("Open upload files in binary mode ('rb')", error_codes.INVALID_UPLOAD_PAYLOAD)
        available = _stream_size(value)
        if declared is None and available is None and multipart:
            raise _invalid("sizeInBytes is required for multipart parts from streams that cannot seek (pipes, "
                           "sockets, generators)", error_codes.INVALID_UPLOAD_PAYLOAD)
        # A stream of unknown length is sent with chunked encoding and no sizeInBytes.
        size = declared if declared is not None else available
        if available is not None and size is not None and available < size:
            raise _invalid(f"sizeInBytes is {size} but the stream has {available} bytes left",
                           error_codes.INVALID_UPLOAD_PAYLOAD)
        body = _Body(stream=value, size=size)
    else:
        raise _invalid(f"data must be bytes, bytearray, memoryview or a binary file, not {type(value).__name__}",
                       error_codes.INVALID_UPLOAD_PAYLOAD)
    if body.stream is None:
        body.size = len(cast(bytes, body.data))
        if declared is not None and declared != body.size:
            raise _invalid("sizeInBytes must match the payload byte length", error_codes.INVALID_UPLOAD_PAYLOAD)
    if part_size and multipart and not payload.get("isFinal", False) and cast(int, body.size) < 5 * 1024 * 1024:
        raise _invalid("Multipart upload parts must be at least 5MiB except the final part.",
                       error_codes.INVALID_UPLOAD_PAYLOAD)
    return body


def _upload_too_large(limit: int, message: str) -> CalmLensValidationError:
    """``upload/too-large`` for content over the plan's ``limit`` bytes, as the API answers."""
    return CalmLensValidationError(error_codes.UPLOAD_TOO_LARGE, message, {"limitBytes": limit, "source": "plan"})


def _image_size(size: int | None) -> None:
    limit = 20 * 1024 * 1024
    if size is not None and size > limit:
        raise _upload_too_large(limit, "Multipart image uploads cannot exceed 20 MiB.")


def _upload_size(mime: str, size: int | None, in_parts: bool = False) -> None:
    """Refuse content whose known size is over the API's limit for its type, before any of it is
    sent. In one request, images can be up to 10 MiB (larger ones are uploaded in parts), audio and
    video up to 50 MiB and other files up to 5,000 MiB. Sent in parts (``in_parts``), audio and video
    can be up to 2 GiB; the API holds free uploads, made before billing is set up, to 50 MiB itself.
    Images in parts are checked by ``_image_size``."""
    if size is None:
        return
    if mime.startswith("image/"):
        limit, message = 10 * 1024 * 1024, "Images uploaded in one request can be at most 10 MiB; upload larger images in parts"
    elif mime.startswith(("audio/", "video/")):
        limit = (2 * 1024 if in_parts else 50) * 1024 * 1024
        message = "Audio and video files can be at most 50 MiB in one request, or 2 GiB in parts"
    else:
        limit, message = 5000 * 1024 * 1024, "Files can be at most 5,000 MiB"
    if size > limit:
        raise _upload_too_large(limit, message)


def _normalize_upload_mime_type(mime_type: str) -> str:
    return mime_type.lower().split(";", 1)[0].strip()


def _is_accepted_upload_mime_type(mime_type: str) -> bool:
    """Whether the API accepts an upload of this MIME type: an image, audio, video, text, document
    or website type, not a container such as ``application/octet-stream``. It refuses any other
    type with ``upload/unsupported-type``."""
    normalized = _normalize_upload_mime_type(mime_type)
    if normalized in UPLOAD_MIME_REJECTED:
        return False
    return (normalized.startswith(UPLOAD_MIME_PREFIXES) or normalized.endswith(UPLOAD_MIME_SUFFIXES)
            or normalized in UPLOAD_MIME_TYPES)


def _invalid_upload_mime_type(mime_type: object) -> CalmLensValidationError:
    normalized = _normalize_upload_mime_type(mime_type) if isinstance(mime_type, str) else ""
    return CalmLensValidationError(
        error_codes.UNSUPPORTED_UPLOAD_TYPE,
        f"{normalized or 'A missing type'} is not a valid upload file type. Uploads must use a concrete file "
        "MIME type that CalmLens can store and process, such as image/png, image/jpeg, application/pdf, or "
        "text/plain.", {"mimeType": mime_type, "source": "calmlens"})


def _camel(key: str) -> str:
    head, *tail = key.split("_")
    return head + "".join(word[:1].upper() + word[1:] for word in tail)


def _convert(value: Any) -> Any:
    if isinstance(value, Mapping):
        # Metadata values are user data and transform options are CDN names: their keys are never renamed.
        return {_camel(k) if isinstance(k, str) else k: item if k in ("metadata", "transform") else _convert(item)
                for k, item in value.items()}
    if isinstance(value, list):
        return [_convert(item) for item in value]
    return value


#: The most assets one ``assets.batch`` request takes.
ASSET_BATCH_MAX_ASSETS = 500
#: The operations ``assets.batch`` runs.
ASSET_BATCH_OPERATIONS: tuple[str, ...] = ("delete", "remove-content")


def _validate_batch(options: Mapping[str, Any]) -> None:
    """Refuse a batch the API would reject for its size, an ID or the operation."""
    asset_ids = options.get("assetIds")
    if not isinstance(asset_ids, list) or not 1 <= len(asset_ids) <= ASSET_BATCH_MAX_ASSETS:
        raise _invalid(f"assetIds must list 1 to {ASSET_BATCH_MAX_ASSETS} asset IDs")
    if any(not isinstance(asset_id, str) or not asset_id for asset_id in asset_ids):
        raise _invalid("Every asset ID must be a non-empty string")
    if options.get("operation") not in ASSET_BATCH_OPERATIONS:
        raise _invalid("operation must be one of " + ", ".join(ASSET_BATCH_OPERATIONS))


def _merge(operation: str, options: Mapping[str, Any] | None, /, **keywords: Any) -> dict[str, Any]:
    """One options dict (camelCase, as in the API) or snake_case keyword arguments for
    ``operation`` (its camelCase name, such as ``cdn.signAssetUrl``). An option given as
    ``None`` is left out, as if omitted, unless the API takes ``null`` for it (``NULLABLE_OPTION_KEYS``)."""
    nullable = NULLABLE_OPTION_KEYS.get(operation, frozenset())
    merged = _merge_options(options, **keywords)
    return {key: value for key, value in merged.items() if value is not None or key in nullable}


def _merge_options(options: Mapping[str, Any] | None, /, **keywords: Any) -> dict[str, Any]:
    """One options dict (camelCase, as in the API) or snake_case keyword arguments, as given."""
    given = {k: v for k, v in keywords.items() if v is not _UNSET}
    if options is not None:
        if given:
            raise _invalid("Use keyword arguments or one options dict, not both")
        if not isinstance(options, Mapping):
            raise _invalid(f"options must be a dict, not {type(options).__name__}")
        # The dict takes the keyword arguments' camelCase names; a misspelt key fails, as a keyword would.
        allowed = {_camel(name) for name in keywords}
        unknown = [str(key) for key in options if key not in allowed]
        if unknown:
            raise _invalid(f"Unknown option{'s' if len(unknown) > 1 else ''}: {', '.join(unknown)}")
        return dict(options)
    return cast(dict[str, Any], _convert(given))


def _require(options: Mapping[str, Any], key: str) -> Any:
    if options.get(key) is None:
        raise _invalid(f"{key} is required")
    return options[key]


def _positive_number(name: str, value: object, allow_zero: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or value < 0 or (value == 0 and not allow_zero):
        raise _invalid(f"{name} must be a positive number of seconds", error_codes.SDK_INVALID_CONFIG)
    return float(value)


def _max_retries(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise _invalid("max_retries must be a non-negative integer", error_codes.SDK_INVALID_CONFIG)
    return value


def _part_size_bytes(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not MIN_PART_SIZE_BYTES <= value <= MAX_PART_SIZE_BYTES:
        raise _invalid(f"part_size_bytes must be an integer from {MIN_PART_SIZE_BYTES} (5 MiB) to "
                       f"{MAX_PART_SIZE_BYTES} (64 MiB)", error_codes.SDK_INVALID_CONFIG)
    return value


def _max_response_bytes(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise _invalid("max_response_bytes must be a positive integer", error_codes.SDK_INVALID_CONFIG)
    return value


def _is_asset(data: Any) -> bool:
    """Whether a response is an asset: a non-empty ``id`` and string upload, classification and
    moderation statuses."""
    if not isinstance(data, dict) or not isinstance(data.get("id"), str) or not data["id"]:
        return False
    classification, upload = data.get("classification"), data.get("upload")
    return (isinstance(classification, dict) and isinstance(classification.get("status"), str)
            and isinstance(upload, dict) and isinstance(upload.get("status"), str)
            and isinstance(classification.get("moderation"), dict)
            and isinstance(classification["moderation"].get("status"), str))


def _expect_asset(data: Any) -> Asset:
    if not _is_asset(data):
        raise CalmLensError(error_codes.SDK_INVALID_RESPONSE, "Expected an asset response", status=200)
    return cast(Asset, data)


_Item = TypeVar("_Item")


def _iterate_pages(fetch: Callable[[str | None], Mapping[str, Any]], index: str | None) -> Iterator[Any]:
    """Yield every item of a cursor list, fetching pages lazily: follow ``nextCursor`` while
    ``hasMore``, stop at an empty page or a ``None`` cursor, and raise ``sdk/invalid-response``
    rather than loop when a page repeats a cursor."""
    sent: set[str] = set()
    while True:
        page = fetch(index)
        cursor = page.get("nextCursor")
        more = bool(cursor) and bool(page.get("hasMore")) and bool(page["items"])
        if more:
            _new_cursor(sent, cast(str, cursor))
        yield from page["items"]
        if not more:
            return
        index = cursor


def _new_cursor(sent: set[str], cursor: str) -> None:
    """Iterators stop rather than loop: a page that says more follow must not hand back a cursor
    the iteration has already sent, which would repeat the same pages forever."""
    if cursor in sent:
        raise CalmLensError(error_codes.SDK_INVALID_RESPONSE,
                            "The API returned a cursor it had already returned, with more pages to follow",
                            {"cursor": cursor})
    sent.add(cursor)


class CalmLensServerClient:
    """Synchronous CalmLens API client.

    Thread-safe: share one client between threads (and with ``asyncio.to_thread``) to reuse
    pooled connections. After ``os.fork()`` the child process opens its own connections.

    Args:
        api_key: Project API key. Defaults to the ``CALMLENS_API_KEY`` environment variable.
        project_id: Project ID. Defaults to ``CALMLENS_PROJECT_ID``.
        base_url: API base URL.
        cdn_base_url: CDN base URL.
        timeout: Seconds without any bytes sent or received before a request fails with
            ``sdk/timeout`` (an inactivity limit, not a limit on the whole transfer).
        upload_timeout: The ``timeout`` of binary uploads (file content and multipart parts);
            ``None`` (the default) uses ``timeout``.
        connect_timeout: Seconds allowed to open a connection.
        max_retries: Retries for requests that are safe to resend (``GET`` and writes sent
            with an ``Idempotency-Key``) after network failures, timeouts, 429, 500, 502, 503, 504 and
            ``idempotency/request-in-progress``; 0 disables retries.
        max_response_bytes: The largest API response body the client reads; a larger one fails
            with ``sdk/response-too-large``. CDN downloads are not limited.
        part_size_bytes: Content larger than this (bytes, base64 or a seekable binary file) is
            uploaded automatically as a multipart upload in parts of this size, from 5 MiB to
            64 MiB (default 8 MiB). Each part is retried on its own and an interrupted upload
            resumes when the call is repeated with the same ``idempotency_key``.
        transport: Optional ``transport(request, timeout)`` callable returning a
            context-managed response with ``status``, ``headers`` and ``read()``.

    Raises:
        CalmLensValidationError: ``sdk/invalid-config`` for invalid options, before any
            state (such as a connection pool) is created.
    """

    def __init__(self, *, api_key: str | None = None, project_id: str | None = None,
                 base_url: str = "https://api.calmlens.com/v1",
                 cdn_base_url: str = "https://cdn.calmlens.com/v1",
                 timeout: float = DEFAULT_TIMEOUT, upload_timeout: float | None = None,
                 connect_timeout: float = DEFAULT_CONNECT_TIMEOUT,
                 max_retries: int = DEFAULT_MAX_RETRIES, max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
                 part_size_bytes: int = DEFAULT_PART_SIZE_BYTES, transport: Transport | None = None):
        # Validate every option before creating any state (connection pools, caches).
        api_key = os.environ.get(_ENV_API_KEY) if api_key is None else api_key
        project_id = os.environ.get(_ENV_PROJECT_ID) if project_id is None else project_id
        timeout = _positive_number("timeout", timeout)
        upload = None if upload_timeout is None else _positive_number("upload_timeout", upload_timeout)
        connect_timeout = _positive_number("connect_timeout", connect_timeout)
        if not isinstance(api_key, str) or not api_key:
            raise _invalid(f"api_key is required (or set {_ENV_API_KEY})", error_codes.SDK_INVALID_CONFIG)
        if not isinstance(project_id, str) or not project_id or project_id in (".", ".."):
            raise _invalid(f"project_id is required (or set {_ENV_PROJECT_ID})", error_codes.SDK_INVALID_CONFIG)
        for name, url in (("base_url", base_url), ("cdn_base_url", cdn_base_url)):
            if not isinstance(url, str) or urlsplit(url).scheme not in ("http", "https") or not urlsplit(url).netloc:
                raise _invalid(f"{name} must be an HTTP(S) URL", error_codes.SDK_INVALID_CONFIG)
        max_retries = _max_retries(max_retries)
        max_response_bytes = _max_response_bytes(max_response_bytes)
        part_size_bytes = _part_size_bytes(part_size_bytes)
        if transport is not None and not callable(transport):
            raise _invalid("transport must be callable", error_codes.SDK_INVALID_CONFIG)
        self.api_key, self.project_id = api_key, project_id
        self.base_url, self.cdn_base_url = base_url.rstrip("/"), cdn_base_url.rstrip("/")
        self.timeout, self.upload_timeout, self.connect_timeout = timeout, upload, connect_timeout
        self.max_retries, self.max_response_bytes = max_retries, max_response_bytes
        self.part_size_bytes = part_size_bytes
        self.transport: Transport = transport if transport is not None else _Transport(connect_timeout)
        self._lenses: dict[str, Lens] = {}
        self._lens_lock = threading.RLock()
        self._sleep: Callable[[float], None] = time.sleep
        self._clock: Callable[[], float] = time.monotonic
        # Leaves multipart size checks to the API; set by the mock so it answers them in the API's order.
        self._defer_upload_checks = False
        self._bind()

    def _bind(self) -> None:
        self.assets, self.folders, self.hash_lists = Assets(self), Folders(self), HashLists(self)
        self.upload_tokens = UploadTokens(self)
        self.policies, self.lenses = Policies(self), Lenses(self)
        self.upload_presets, self.project_settings = UploadPresets(self), ProjectSettings(self)
        self.metadata_fields = MetadataFields(self)
        self.text, self.events, self.cdn = Text(self), Events(self), CDN(self)

    def __repr__(self) -> str:
        # Never include the API key.
        return f"{type(self).__name__}(project_id={self.project_id!r}, base_url={self.base_url!r})"

    def with_options(self, *, timeout: float | None = None, upload_timeout: float | None = None,
                     max_retries: int | None = None, max_response_bytes: int | None = None) -> CalmLensServerClient:
        """A client sharing this one's connections and lens cache with other per-call settings,
        e.g. ``client.with_options(timeout=300).cdn.serve(...)`` or ``max_retries=0``. Options
        left out (``None``) keep this client's values."""
        clone = copy.copy(self)
        if timeout is not None:
            clone.timeout = _positive_number("timeout", timeout)
        if upload_timeout is not None:
            clone.upload_timeout = _positive_number("upload_timeout", upload_timeout)
        if max_retries is not None:
            clone.max_retries = _max_retries(max_retries)
        if max_response_bytes is not None:
            clone.max_response_bytes = _max_response_bytes(max_response_bytes)
        clone._bind()
        return clone

    def close(self) -> None:
        """Close the owned connection pool (shared with ``with_options`` copies). Injected
        transports remain caller-owned."""
        if isinstance(self.transport, _Transport):
            self.transport.close()

    def __enter__(self) -> CalmLensServerClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    verify_webhook_signature = staticmethod(verify_webhook_signature)
    parse_webhook_event = staticmethod(parse_webhook_event)

    def _project(self, path: str) -> str:
        return f"/projects/{_id(self.project_id)}/{path}"

    def _url(self, path: str, query: Mapping[str, Any] | None = None) -> str:
        params = {k: v if isinstance(v, str) else _json(v) for k, v in (query or {}).items() if v is not None}
        return self.base_url + path + ("?" + urlencode(params) if params else "")

    def _headers(self, extra: Mapping[str, str] | None = None, *, api: bool = True) -> dict[str, str]:
        headers = {"User-Agent": USER_AGENT}
        if api:
            headers["Accept"] = "application/json"
        for name, value in (extra or {}).items():
            # One value per header name, whatever its case.
            for existing in [key for key in headers if key.lower() == name.lower()]:
                del headers[existing]
            headers[name] = value
        headers["X-Api-Key"] = _header_value("X-Api-Key", self.api_key)
        return headers

    def _request(self, method: str, path: str, *, query: Mapping[str, Any] | None = None, body: Any = None,
                 raw: _Body | _FormBody | None = None, headers: Mapping[str, str] | None = None,
                 idempotency_key: str | None = None, timeout: float | None = None) -> Any:
        request_headers = self._headers(headers)
        if idempotency_key is not None:
            request_headers["Idempotency-Key"] = _header_value("Idempotency-Key", idempotency_key)
        if body is not None:
            raw = _Body(_json(body).encode("utf-8"))
            request_headers["Content-Type"] = "application/json"
        url = self._url(path, query)
        retryable = (method in ("GET", "HEAD") or idempotency_key is not None) and (raw is None or raw.rewindable)
        limit = self.max_response_bytes
        attempt = 0
        while True:
            can_retry = retryable and attempt < self.max_retries
            request = Request(url, data=raw.open() if raw is not None else None, headers=request_headers, method=method)
            error: CalmLensError | None = None
            content: bytes | None = None
            try:
                with self.transport(request, self.timeout if timeout is None else timeout) as response:
                    status, response_headers = response.status, _response_headers(response)
                    if _is_redirect(status, response_headers):
                        error = _redirect_error(status, response_headers)
                    else:
                        content = _read_body(response, response_headers, limit)
            except _TRANSPORT_ERRORS as cause:
                failure = _transport_error(cause)
                if not can_retry:
                    raise failure from cause
                self._sleep(_retry_delay(attempt))
                attempt += 1
                continue
            if error is None:
                if content is None:
                    error = _too_large(status, response_headers, limit)
                elif 200 <= status < 300:
                    if not content and (status == 204 or method == "DELETE"):
                        return None
                    try:
                        return json.loads(content)
                    except (ValueError, UnicodeDecodeError) as cause:
                        raise CalmLensError(error_codes.SDK_INVALID_RESPONSE, f"Invalid JSON response (HTTP {status})",
                                            status=status, headers=response_headers) from cause
                else:
                    error = self._api_error(status, response_headers, content)
            delay = error.retry_after if error.retry_after is not None else _retry_delay(attempt)
            if not (can_retry and error.is_retryable and delay <= MAX_RETRY_AFTER_SECONDS):
                raise error
            self._sleep(delay)
            attempt += 1

    @staticmethod
    def _api_error(status: int, headers: dict[str, str], content: bytes) -> CalmLensAPIError:
        try:
            data = json.loads(content) if content else None
        except (ValueError, UnicodeDecodeError):
            data = None
        if isinstance(data, dict) and isinstance(data.get("code"), str):
            details = data["details"] if isinstance(data.get("details"), dict) else {}
            message = data.get("message") if isinstance(data.get("message"), str) else None
            body_request_id = data.get("requestId") if isinstance(data.get("requestId"), str) else None
            return CalmLensAPIError(data["code"], message, details, status, headers=headers,
                                    request_id=headers.get("x-request-id") or body_request_id)
        return CalmLensAPIError(error_codes.SDK_HTTP_ERROR, f"HTTP {status}", status=status, headers=headers)

    def ensure_lens(self, options: LensDefinition | None = None, /, *, identifier: str = _UNSET, name: str = _UNSET,
                    type: LensType = _UNSET, description: str | None = _UNSET,
                    active: bool = _UNSET, transform: ImageTransformOptions | None = _UNSET) -> Lens:
        """Create one named lens, or change it to this definition (see :meth:`ensure_lenses`)."""
        # A lens definition is sent as given: ``description=None`` clears the lens's description.
        lens = _merge_options(options, identifier=identifier, name=name, type=type,
                              description=description, active=active, transform=transform)
        return self.ensure_lenses({"lenses": [cast(LensDefinition, lens)]})[0]

    def ensure_lenses(self, options: EnsureLensesOptions | None = None, /, *,
                      lenses: list[LensDefinition] = _UNSET) -> list[Lens]:
        """Create each named lens, or change it to the definition sent, by identifier. Sending the
        same definition again returns the lens unchanged, from the client's lens cache once it has
        seen it, so applications can send their lenses every time they start.

        Identical concurrent calls share one request; a changed definition replaces the cached one
        for that identifier. More than ``ENSURE_LENSES_MAX_PER_REQUEST`` new definitions are sent in
        consecutive requests, in order.
        """
        merged = _merge("ensureLenses", options, lenses=lenses)
        definitions = merged.get("lenses")
        if not isinstance(definitions, list) or not definitions or any(
                not isinstance(lens, Mapping) or not lens.get("identifier") for lens in definitions):
            raise _invalid("At least one lens with an identifier is required")

        def cache_key(lens: Mapping[str, Any]) -> str:
            return json.dumps({k: lens.get(k) for k in (
                "identifier", "name", "description", "type", "active", "transform"
            )}, sort_keys=True, separators=(",", ":"))
        keys = [cache_key(lens) for lens in definitions]
        # Serialize ensure calls so identical concurrent definitions use one request.
        with self._lens_lock:
            missing = {k: lens for k, lens in zip(keys, definitions) if k not in self._lenses}
            pending = list(missing.items())
            resolved = dict(self._lenses)
            for start in range(0, len(pending), ENSURE_LENSES_MAX_PER_REQUEST):
                chunk = dict(pending[start:start + ENSURE_LENSES_MAX_PER_REQUEST])
                result = self._request("PUT", self._project("lenses"), body={"lenses": list(chunk.values())})
                returned = result.get("lenses", []) if isinstance(result, dict) else []
                if len(returned) != len(chunk):
                    raise CalmLensError(error_codes.SDK_INVALID_RESPONSE, "Unexpected lens response")
                for key, lens in zip(chunk, returned):
                    if lens.get("identifier") != chunk[key]["identifier"]:
                        raise CalmLensError(error_codes.SDK_INVALID_RESPONSE, "Unexpected lens identifier")
                resolved.update(zip(chunk, returned))
                for key, lens in zip(chunk, returned):
                    self._forget_lenses("identifier", lens["identifier"])
                    self._lenses[key] = copy.deepcopy(lens)
            return copy.deepcopy([resolved[key] for key in keys])

    def _forget_lenses(self, field: Literal["id", "identifier"], value: object) -> None:
        """Drop the cached ensure results of the lens whose ``field`` is ``value``, so a lens changed
        another way is sent again by ``ensure_lens``."""
        with self._lens_lock:
            for key in [key for key, lens in self._lenses.items() if lens.get(field) == value]:
                del self._lenses[key]


#: The most lens definitions :meth:`CalmLensServerClient.ensure_lenses` sends in one request.
ENSURE_LENSES_MAX_PER_REQUEST = 100

_UPLOAD_TOKEN_CONTEXT = "calmlens-upload-token:v1:"
#: ``upload_tokens.sign``'s lifetime in seconds when ``expires_in`` is omitted: 10 minutes.
DEFAULT_UPLOAD_TOKEN_EXPIRES_IN = 600
_UPLOAD_TOKEN_MAX_TTL_SECONDS = 3600


def _sign_upload_token(api_key: str, options: Mapping[str, Any], now: int, nonce: str) -> SignedUploadToken:
    """Sign an upload token at ``now`` (milliseconds since the epoch) with ``nonce``."""
    preset_id = options.get("uploadPresetId")
    _id(preset_id, "Upload preset ID")
    ttl = options.get("expiresIn", DEFAULT_UPLOAD_TOKEN_EXPIRES_IN)
    if isinstance(ttl, bool) or not isinstance(ttl, int) or not 1 <= ttl <= _UPLOAD_TOKEN_MAX_TTL_SECONDS:
        raise _invalid(f"expires_in must be a whole number of seconds from 1 to {_UPLOAD_TOKEN_MAX_TTL_SECONDS}")
    external = options.get("externalId")
    if "externalId" in options and (not isinstance(external, str) or not external):
        raise _invalid("externalId must be a non-empty string")
    expires_at = now + ttl * 1000
    claims: dict[str, Any] = {"v": 1, "u": preset_id, "k": api_key[:13 if api_key.startswith("clsk_") else 8],
                              "e": expires_at, "n": nonce}
    if external is not None:
        claims["x"] = external
    # The claims as JSON.stringify writes them: no whitespace, raw UTF-8, "/" and "<>&" unescaped.
    body = base64.urlsafe_b64encode(_json(claims).encode("utf-8")).rstrip(b"=").decode("ascii")
    secret = hashlib.sha256(api_key.encode("utf-8")).hexdigest().encode("ascii")
    signature = hmac.new(secret, (_UPLOAD_TOKEN_CONTEXT + body).encode("utf-8"), hashlib.sha256).hexdigest()
    return {"token": f"clut_{body}.{signature}", "expiresAt": expires_at}


class UploadTokens:
    """``client.upload_tokens``: sign single-use tokens that let a browser upload through an upload preset."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def sign(self, options: SignUploadTokenOptions | None = None, /, *, upload_preset_id: str = _UNSET,
             external_id: str = _UNSET, expires_in: int = _UNSET) -> SignedUploadToken:
        """Sign an upload token with the client's API key. Makes no request.

        The token lets one browser upload through ``upload_preset_id`` until it expires
        (``expires_in`` seconds, 1 to 3600, default 600). ``external_id`` becomes the external
        ID of the uploaded asset. Returns ``{"token": ..., "expiresAt": <ms since epoch>}``.
        """
        merged = _merge("uploadTokens.sign", options, upload_preset_id=upload_preset_id, external_id=external_id,
                        expires_in=expires_in)
        return _sign_upload_token(self._c.api_key, merged, int(time.time() * 1000), str(uuid.uuid4()))


#: ``wait_for_decision`` checks again after this many seconds, then waits
#: ``DECISION_POLL_DELAY_FACTOR`` times longer each time, up to ``DECISION_POLL_MAX_DELAY``.
DECISION_POLL_FIRST_DELAY = 0.5
DECISION_POLL_DELAY_FACTOR = 1.5
DECISION_POLL_MAX_DELAY = 2.0
#: Seconds ``wait_for_decision`` polls before ``sdk/timeout`` when ``timeout`` is omitted.
DEFAULT_DECISION_TIMEOUT = 60.0
#: A signed asset URL's lifetime in seconds when ``expires_in`` is omitted: 15 minutes.
DEFAULT_SIGNED_URL_EXPIRES_IN = 900
#: The longest signed asset URL lifetime the API accepts, in seconds: 24 hours.
MAX_SIGNED_URL_EXPIRES_IN = 86400
#: Where each CDN resource is served beneath an asset's URL. The adaptive stream is its HLS master
#: playlist; its media playlists and segments are the other files beneath ``hls/``.
_CDN_RESOURCE_PATHS: dict[CdnResource, str] = {
    "original": "original", "rendered": "rendered", "preview": "preview", "placeholder": "placeholder",
    "hls": "hls/index.m3u8", "embed": "embed", "info": "info"}
#: Every resource beneath an asset URL, as ``cdn.get_asset_url`` and ``cdn.sign_asset_url`` accept them.
CDN_RESOURCES: tuple[CdnResource, ...] = tuple(_CDN_RESOURCE_PATHS)
#: The resources that take a lens or transform: the others are served as they are.
_SELECTABLE_CDN_RESOURCES = ("rendered", "preview")
#: The asset segment of a URL that names the asset by its external ID starts with this.
_EXTERNAL_ID_SEGMENT_PREFIX = "ext:"


def _asset_segment(options: Mapping[str, Any]) -> str:
    """The asset segment of a CDN URL: the asset ID, or ``ext:`` and the URL-encoded external ID.
    Exactly one of them must be given."""
    asset_id, external_id = options.get("assetId"), options.get("externalId")
    if (asset_id is None) == (external_id is None):
        raise _invalid("Pass either asset_id or external_id")
    if asset_id is not None:
        return _id(asset_id, "assetId")
    if not isinstance(external_id, str) or not external_id:
        raise _invalid("externalId is required")
    try:
        return _EXTERNAL_ID_SEGMENT_PREFIX + quote(external_id, safe="~!*'()-._")
    except UnicodeEncodeError as error:
        raise _invalid("externalId must be valid Unicode") from error


def _append_asset_location(asset_url: str, options: Mapping[str, Any]) -> str:
    """Append a resource, its ``@lens`` and transform selector, and the viewer claims to an asset URL
    (public or signed). Without a resource the URL stays the asset URL, which takes no selector."""
    resource, lens, transform = options.get("resource"), options.get("lens"), options.get("transform")
    selected = lens is not None or transform is not None
    url = asset_url
    if resource is None:
        if selected:
            raise _invalid("A lens or transform needs a resource, such as rendered")
    else:
        if not isinstance(resource, str) or resource not in _CDN_RESOURCE_PATHS:
            raise _invalid("resource must be one of " + ", ".join(CDN_RESOURCES))
        if resource not in _SELECTABLE_CDN_RESOURCES and selected:
            raise _invalid(f"The {resource} resource takes no lens or transform")
        url += "/" + _CDN_RESOURCE_PATHS[resource]
        selector = [] if lens is None else ["@" + _id(lens, "lens")]
        if _has_transform(transform):
            selector.append(_transform_path(transform))
        if selector:
            url += "/" + ",".join(selector)
    return url + _viewer_claims_query(options.get("viewerClaims"))


def _is_asset_info(data: Any) -> bool:
    return (isinstance(data, dict) and all(isinstance(data.get(key), str) for key in ("id", "projectId", "type"))
            and isinstance(data.get("content"), dict)
            and data.get("availability") in ("available", "age-restricted", "unavailable"))


#: The asset fields an upload carries in its body (the JSON body or the form's ``options`` part):
#: the API refuses them in the query string.
_UPLOAD_OPTION_KEYS = ("name", "description", "processingOptions", "visibility", "metadata", "tags", "authorId",
                       "context", "externalId", "externalUrl", "folderId", "uploadPresetId")


class Assets:
    """``client.assets``: upload, classify, list and manage assets."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def search(self, options: SearchAssetsOptions | None = None, /, *, query: str = _UNSET,
               page_size: int = _UNSET, mode: SearchMode = _UNSET) -> AssetSearchResponse:
        """Search the project's assets by keyword and/or meaning (``mode``: ``keyword``,
        ``semantic`` or ``hybrid``), returning the best ``page_size`` matches (1 to 20, default 10)."""
        merged = _merge("assets.search", options, query=query, page_size=page_size, mode=mode)
        _require(merged, "query")
        return cast(AssetSearchResponse, self._c._request("GET", self._c._project("assets/search"), query=merged))

    def list(self, options: ListAssetsOptions | None = None, /, *, cursor: str = _UNSET,
             page_size: int = _UNSET, sort: str = _UNSET, filter: str = _UNSET) -> AssetPage:
        """One page of the project's assets (``cursor`` resumes a previous page). ``filter`` is RSQL,
        such as ``classification.moderation.status==allowed`` or ``folderId==fldr_…`` (``folderId==null``
        for the project root). ``sort`` is comma-separated ``createdAt`` and ``id``, each descending
        when prefixed with ``-``; the default is ``-createdAt``. Use :meth:`iter` to walk every page."""
        merged = _merge("assets.list", options, cursor=cursor, page_size=page_size, sort=sort, filter=filter)
        return cast(AssetPage, self._c._request("GET", self._c._project("assets"), query=merged))

    def iter(self, options: ListAssetsOptions | None = None, /, *, page_size: int = _UNSET,
             sort: str = _UNSET, filter: str = _UNSET) -> Iterator[Asset]:
        """Yield every matching asset, requesting pages lazily as you iterate."""
        merged = _merge("assets.each", options, page_size=page_size, sort=sort, filter=filter)
        return cast(Iterator[Asset], _iterate_pages(
            lambda index: self.list(cast(ListAssetsOptions, {**merged, "cursor": index})), merged.get("cursor")))

    def retrieve(self, options: AssetIdOptions | None = None, /, *, asset_id: str = _UNSET) -> Asset:
        """Fetch an asset by ID."""
        merged = _merge("assets.retrieve", options, asset_id=asset_id)
        return cast(Asset, self._c._request("GET", "/assets/" + _id(merged.get("assetId"), "assetId")))

    def wait_for_decision(self, options: WaitForDecisionOptions | None = None, /, *, asset_id: str = _UNSET,
                          timeout: float = _UNSET) -> Asset:
        """Retrieve an asset until it is settled, its ``classification.status`` ``completed`` (with
        its decision in ``classification.moderation.status``) or ``failed``, and return that asset.
        A ``queued`` or ``processing`` asset is still waiting, even when a reviewer has already
        decided it.

        Checks again after 0.5 seconds, then waits 1.5 times longer each time, up to 2
        seconds between checks. Raises :class:`CalmLensError` with ``sdk/timeout`` and
        ``details`` ``{"assetId", "classificationStatus", "moderationStatus"}`` (the last statuses
        seen) when it is not settled within ``timeout`` seconds (default 60). Webhooks
        report decisions without polling.
        """
        merged = _merge("assets.waitForDecision", options, asset_id=asset_id, timeout=timeout)
        _id(merged.get("assetId"), "assetId")
        wanted = cast(AssetIdOptions, {"assetId": merged["assetId"]})
        limit = merged.get("timeout", DEFAULT_DECISION_TIMEOUT)
        if isinstance(limit, bool) or not isinstance(limit, (int, float)) or not math.isfinite(limit) or limit < 0:
            raise _invalid("timeout must be a non-negative number of seconds")
        deadline = self._c._clock() + limit
        delay = DECISION_POLL_FIRST_DELAY
        while True:
            asset = self.retrieve(wanted)
            classification_status = asset["classification"]["status"]
            moderation_status = asset["classification"]["moderation"]["status"]
            if classification_status in ("completed", "failed"):
                return asset
            remaining = deadline - self._c._clock()
            if remaining <= 0:
                raise CalmLensError(
                    error_codes.SDK_TIMEOUT,
                    f"Asset {asset.get('id')} had no moderation decision after {limit:g}s "
                    f"(processing {classification_status}, moderation {moderation_status})",
                    {"assetId": asset.get("id"), "classificationStatus": classification_status,
                     "moderationStatus": moderation_status})
            self._c._sleep(min(delay, remaining))
            delay = min(DECISION_POLL_MAX_DELAY, delay * DECISION_POLL_DELAY_FACTOR)

    def update(self, options: UpdateAssetOptions | None = None, /, *, asset_id: str = _UNSET, name: str = _UNSET,
               description: str | None = _UNSET, tags: List[str] | None = _UNSET,
               metadata: List[MetadataItem] | None = _UNSET, external_id: str | None = _UNSET,
               external_url: str | None = _UNSET, visibility: Visibility | None = _UNSET) -> Asset:
        """Change asset fields. Omitted fields are unchanged; ``None`` clears a nullable field
        (``name=None`` is left out, as the API takes no ``null`` name)."""
        merged = _merge("assets.update", options, asset_id=asset_id, name=name, description=description, tags=tags,
                        metadata=metadata, external_id=external_id, external_url=external_url, visibility=visibility)
        return cast(Asset, self._c._request("PATCH", "/assets/" + _id(merged.get("assetId"), "assetId"),
                                            body={k: v for k, v in merged.items() if k != "assetId"}))

    def list_children(self, options: ListChildrenOptions | None = None, /, *, asset_id: str = _UNSET,
                      cursor: str = _UNSET, page_size: int = _UNSET, sort: str = _UNSET,
                      filter: str = _UNSET) -> AssetPage:
        """One page of the assets extracted from an asset (pages of a document, a website's
        text and images, ...), sorted like :meth:`list`. Use :meth:`iter_children` to walk every page."""
        merged = _merge("assets.listChildren", options, asset_id=asset_id, cursor=cursor, page_size=page_size, sort=sort,
                        filter=filter)
        return cast(AssetPage, self._c._request(
            "GET", "/assets/" + _id(merged.get("assetId"), "assetId") + "/children",
            query={k: v for k, v in merged.items() if k != "assetId"}))

    def iter_children(self, options: ListChildrenOptions | None = None, /, *, asset_id: str = _UNSET,
                      page_size: int = _UNSET, sort: str = _UNSET,
                      filter: str = _UNSET) -> Iterator[Asset]:
        """Yield every child of an asset, requesting pages lazily."""
        merged = _merge("assets.eachChild", options, asset_id=asset_id, page_size=page_size, sort=sort, filter=filter)
        _id(merged.get("assetId"), "assetId")
        return cast(Iterator[Asset], _iterate_pages(
            lambda index: self.list_children(cast(ListChildrenOptions, {**merged, "cursor": index})),
            merged.get("cursor")))

    def list_timeline(self, options: ListTimelineOptions | None = None, /, *, asset_id: str = _UNSET,
                      cursor: str = _UNSET, page_size: int = _UNSET) -> AssetTimelinePage:
        """One page of an audio or video asset's findings timeline, in time order.
        ``classification.moderation.timeline.segmentCount`` says how many segments there are. Pass
        each page's ``nextCursor`` back unchanged; cursors are opaque."""
        merged = _merge("assets.listTimeline", options, asset_id=asset_id, cursor=cursor, page_size=page_size)
        return cast(AssetTimelinePage, self._c._request(
            "GET", self._c._project("assets/" + _id(merged.get("assetId"), "assetId") + "/timeline"),
            query={k: v for k, v in merged.items() if k != "assetId"}))

    def iter_timeline(self, options: ListTimelineOptions | None = None, /, *, asset_id: str = _UNSET,
                      page_size: int = _UNSET) -> Iterator[AssetTimelineSegment]:
        """Yield every segment of an audio or video asset's findings timeline, in time order,
        requesting pages lazily."""
        merged = _merge("assets.eachTimelineSegment", options, asset_id=asset_id, page_size=page_size)
        _id(merged.get("assetId"), "assetId")
        return cast(Iterator[AssetTimelineSegment], _iterate_pages(
            lambda index: self.list_timeline(cast(ListTimelineOptions, {**merged, "cursor": index})),
            merged.get("cursor")))

    def create(self, options: SubmitAssetOptions | None = None, /, *, name: str = _UNSET, content: Content = _UNSET,
               part: Content = _UNSET, url: str = _UNSET, description: str = _UNSET,
               processing_options: ProcessingOptions = _UNSET, visibility: Visibility = _UNSET,
               metadata: List[MetadataItem] = _UNSET, tags: List[str] = _UNSET, author_id: str = _UNSET,
               context: ModerationContext = _UNSET, external_id: str = _UNSET, external_url: str = _UNSET,
               folder_id: str | None = _UNSET, upload_preset_id: str = _UNSET,
               total_size_in_bytes: int = _UNSET, idempotency_key: str | None = None) -> Asset:
        """Upload content (or submit a ``url``) and return without waiting for its decision
        (``wait=false``): the asset's ``classification.status`` is ``queued``.

        Supply exactly one of ``content``, ``part`` (first part of a multipart upload) or
        ``url``. ``idempotency_key`` makes retries safe; one is generated per call when
        omitted, and reused for the client's own retries.

        ``content`` larger than the client's ``part_size_bytes`` (bytes, base64 or a seekable
        binary file) is sent as a multipart upload in parts of that size, each retried on its own;
        calling again with the same ``idempotency_key`` (at most 240 characters) resumes an
        interrupted upload instead of starting a new one.

        ``tags`` are strings the asset keeps in ``tags``, such as ``["catalogue", "backpacks"]``.

        ``author_id`` is your label for who wrote the content. ``context`` holds earlier posts in
        the conversation, oldest first (``{"items": [{"text": ..., "authorId": ...}]}``); CalmLens
        moderates only the content and uses them to read it in context. Only the posts CalmLens
        uses are sent: the most recent 5 that fit in 2,000 characters.
        """
        merged = _merge("assets.create", options, name=name, content=content, part=part, url=url, description=description,
                        processing_options=processing_options, visibility=visibility, metadata=metadata, tags=tags,
                        author_id=author_id, context=context, external_id=external_id, external_url=external_url, folder_id=folder_id,
                        upload_preset_id=upload_preset_id, total_size_in_bytes=total_size_in_bytes)
        return self._submit(merged, False, idempotency_key)

    def classify(self, options: SubmitAssetOptions | None = None, /, *, name: str = _UNSET, content: Content = _UNSET,
                 part: Content = _UNSET, url: str = _UNSET, description: str = _UNSET,
                 processing_options: ProcessingOptions = _UNSET, visibility: Visibility = _UNSET,
                 metadata: List[MetadataItem] = _UNSET, tags: List[str] = _UNSET, author_id: str = _UNSET,
                 context: ModerationContext = _UNSET, external_id: str = _UNSET, external_url: str = _UNSET,
                 folder_id: str | None = _UNSET, upload_preset_id: str = _UNSET,
                 total_size_in_bytes: int = _UNSET, idempotency_key: str | None = None) -> Asset:
        """Like :meth:`create`, but waits for the decision where supported (audio and video
        are always asynchronous and return before moderation decides them)."""
        merged = _merge("assets.classify", options, name=name, content=content, part=part, url=url, description=description,
                        processing_options=processing_options, visibility=visibility, metadata=metadata, tags=tags,
                        author_id=author_id, context=context, external_id=external_id, external_url=external_url, folder_id=folder_id,
                        upload_preset_id=upload_preset_id, total_size_in_bytes=total_size_in_bytes)
        payload = merged.get("content")
        if isinstance(payload, Mapping) and "plainText" in payload and (
                not isinstance(payload["plainText"], str) or not payload["plainText"].strip()):
            raise _invalid("Text to classify must be a non-empty string", error_codes.INVALID_UPLOAD_PAYLOAD)
        return self._submit(merged, True, idempotency_key)

    def _submit(self, options: dict[str, Any], wait: bool, idempotency_key: str | None) -> Asset:
        if not options.get("name"):
            raise _invalid("Asset name is required", error_codes.INVALID_UPLOAD_PAYLOAD)
        if "context" in options:
            context = options["context"]
            if not isinstance(context, Mapping) or not isinstance(context.get("items"), list):
                raise _invalid("context.items must be a list of earlier posts")
            # Only the posts CalmLens uses are sent, which keeps the request small.
            options["context"] = {"items": select_moderation_context_items(context["items"])}
        if sum(k in options for k in ("content", "part", "url")) != 1 or "isFinal" in options:
            raise _invalid("Supply exactly one of content, part, or url; isFinal belongs in part",
                           error_codes.INVALID_UPLOAD_PAYLOAD)
        key = idempotency_key if idempotency_key is not None else str(uuid.uuid4())
        if "url" in options:
            return _expect_asset(self._c._request("POST", self._c._project("assets"), query={"wait": wait},
                                                  body=options, idempotency_key=key))
        multipart = "part" in options
        payload = options["part" if multipart else "content"]
        if not isinstance(payload, Mapping):
            raise _invalid("content must be a dict")
        mime = payload.get("type", "")
        if not isinstance(mime, str) or not _is_accepted_upload_mime_type(mime):
            raise _invalid_upload_mime_type(mime)
        normalized = _normalize_upload_mime_type(mime)
        if multipart and payload.get("partNumber", 1) != 1:
            raise CalmLensValidationError(error_codes.USE_UPLOAD_PART,
                                          "Use upload_part for multipart upload parts after the first part")
        total = options.get("totalSizeInBytes")
        if total is not None and (not multipart or type(total) is not int or total <= 0):
            raise _invalid("total_size_in_bytes is a positive integer for multipart uploads",
                           error_codes.INVALID_UPLOAD_PAYLOAD)
        checked = not self._c._defer_upload_checks
        if checked and multipart and normalized.startswith("image/") and total is not None:
            # Like the API, a declared image total is checked before the part itself.
            _image_size(total)
        elif checked and multipart:
            # A declared whole-file size over the limit for parts can never finish.
            _upload_size(normalized, total, in_parts=True)
        body = _payload(payload, multipart, checked)
        if checked and multipart and normalized.startswith("image/"):
            _image_size(body.size)
        fields = {k: options[k] for k in _UPLOAD_OPTION_KEYS if options.get(k) is not None}
        # The query holds only transport values; the asset's fields go in the body.
        query: dict[str, Any] = {"wait": wait, "contentType": mime, "sizeInBytes": body.size}
        # Content the client can read again is split into parts when it is larger than one part.
        split = (not multipart and "plainText" not in payload and body.rewindable and body.size is not None
                 and body.size > self._c.part_size_bytes)
        if split:
            if len(key) > _MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH:
                raise _invalid(f"idempotency_key can have at most {_MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH} characters "
                               "for content uploaded in parts")
            if checked and normalized.startswith("image/"):
                _image_size(body.size)
            elif checked:
                _upload_size(normalized, body.size, in_parts=True)
            return self._upload_in_parts(fields, query, mime, body, key)
        if checked and not multipart:
            _upload_size(normalized, body.size)
        if "plainText" in payload:
            # Text is a JSON body, with only ``wait`` in the query, sent with the API timeout.
            text: dict[str, Any] = {"plainText": payload["plainText"], "type": mime}
            sent: dict[str, Any] = dict(fields)
            if multipart:
                sent["part"] = {**text, **({"partNumber": payload["partNumber"]} if "partNumber" in payload else {}),
                                "isFinal": bool(payload.get("isFinal", False))}
                if payload.get("sizeInBytes") is not None:
                    sent["sizeInBytes"] = payload["sizeInBytes"]
                if total is not None:
                    sent["totalSizeInBytes"] = total
            else:
                sent["content"] = text
            return _expect_asset(self._c._request("POST", self._c._project("assets"), query={"wait": wait},
                                                  body=sent, idempotency_key=key))
        if multipart:
            query.update(partNumber=1, isFinal=payload.get("isFinal", False), totalSizeInBytes=total)
        form = _FormBody(fields, mime, body)
        headers = {"Content-Type": form.content_type, "X-CalmLens-Upload": "part" if multipart else "content"}
        if form.size is not None:
            headers["Content-Length"] = str(form.size)
        # Binary content is sent with the upload timeout when one is set.
        return _expect_asset(self._c._request(
            "POST", self._c._project("assets"), query=query, raw=form, headers=headers, idempotency_key=key,
            timeout=self._c.upload_timeout))

    def _upload_in_parts(self, fields: dict[str, Any], query: dict[str, Any], mime: str, body: _Body,
                         key: str) -> Asset:
        """Upload ``body`` as a multipart upload of ``part_size_bytes`` parts and return the final
        part's asset. Part ``n`` after the first carries the key ``<key>:part-<n>``, so repeating
        the call with the same key replays the parts the API already has and sends the rest."""
        total, part_size = cast(int, body.size), self._c.part_size_bytes
        count = -(-total // part_size)

        def piece(number: int) -> _Body:
            offset = (number - 1) * part_size
            return body.slice(offset, min(part_size, total - offset))

        first = piece(1)
        query = {**query, "sizeInBytes": first.size, "partNumber": 1, "isFinal": False, "totalSizeInBytes": total}
        form = _FormBody(fields, mime, first)
        headers = {"Content-Type": form.content_type, "X-CalmLens-Upload": "part",
                   "Content-Length": str(form.size)}
        asset = _expect_asset(self._c._request("POST", self._c._project("assets"), query=query, raw=form,
                                               headers=headers, idempotency_key=key, timeout=self._c.upload_timeout))
        asset_id = asset["id"]
        number = 2
        while number <= count:
            final = number == count
            try:
                asset = self._send_part(asset_id, number, final, piece(number), None, f"{key}:part-{number}")
            except CalmLensAPIError as error:
                expected = error.details.get("expectedPartNumber")
                if (error.code == error_codes.INVALID_UPLOAD_PART_NUMBER and type(expected) is int
                        and number < expected <= count):
                    # The parts before ``expected`` arrived, but their responses were lost.
                    number = expected
                    continue
                if final and error.code == error_codes.UPLOAD_NOT_OPEN:
                    # The final part completed the upload, but its response was lost.
                    return self.retrieve(cast(AssetIdOptions, {"assetId": asset_id}))
                raise
            number += 1
        return asset

    def _send_part(self, asset_id: str, number: int, final: bool, body: _Body, wait: bool | None,
                   idempotency_key: str) -> Asset:
        query: dict[str, Any] = {"partNumber": number, "isFinal": final, "sizeInBytes": body.size}
        if wait is not None:
            query["wait"] = wait
        headers = {"X-CalmLens-Upload": "part", "Content-Length": str(body.size)}
        return _expect_asset(self._c._request(
            "POST", "/assets/" + _id(asset_id, "assetId") + "/part", raw=body, headers=headers, query=query,
            idempotency_key=idempotency_key, timeout=self._c.upload_timeout))

    def upload_part(self, options: UploadPartOptions | None = None, /, *, asset_id: str = _UNSET,
                    part: PartContent = _UNSET, wait: bool = _UNSET, idempotency_key: str | None = None) -> Asset:
        """Send the next part of a multipart upload (``partNumber`` 2, 3, ...; parts are
        sequential and all but the final one are at least 5 MiB).

        Whether the final part waits for the decision was chosen when the upload started
        (``classify`` waits, ``create`` doesn't); pass ``wait`` only to override it.
        """
        merged = _merge("assets.uploadPart", options, asset_id=asset_id, part=part, wait=wait)
        asset = merged.get("assetId")
        _id(asset, "assetId")
        payload = merged.get("part")
        if not isinstance(payload, Mapping):
            raise _invalid("part must be a dict")
        if type(payload.get("partNumber")) is not int or payload["partNumber"] < 1:
            raise CalmLensValidationError(error_codes.INVALID_UPLOAD_PART_NUMBER)
        body = _payload(payload, True, not self._c._defer_upload_checks)
        return self._send_part(cast(str, asset), payload["partNumber"], bool(payload.get("isFinal", False)), body,
                               None if merged.get("wait") is None else bool(merged["wait"]),
                               idempotency_key if idempotency_key is not None else str(uuid.uuid4()))

    def move(self, options: MoveAssetOptions | None = None, /, *, asset_id: str = _UNSET,
             folder_id: str | None = _UNSET) -> Asset:
        """Move an asset into a folder, or to the project root with ``folder_id=None``."""
        merged = _merge("assets.move", options, asset_id=asset_id, folder_id=folder_id)
        if "folderId" not in merged:
            raise _invalid("folderId is required (None moves the asset to the project root)")
        return cast(Asset, self._c._request("POST", "/assets/" + _id(merged.get("assetId"), "assetId") + "/move",
                                            body={"folderId": merged["folderId"]}))

    def retry(self, options: AssetIdOptions | None = None, /, *, asset_id: str = _UNSET) -> Asset:
        """Reprocess an asset whose ``classification.status`` is ``failed`` and whose content is
        still held (``content.status`` is not ``removed``)."""
        merged = _merge("assets.retry", options, asset_id=asset_id)
        return cast(Asset, self._c._request("POST", "/assets/" + _id(merged.get("assetId"), "assetId") + "/retry"))

    def decide(self, options: DecideAssetOptions | None = None, /, *, asset_id: str = _UNSET,
               decision: Literal["allowed", "limited", "age-restricted", "blocked", "purged"] = _UNSET,
               note: str = _UNSET, confirm_purge: bool = _UNSET) -> Asset:
        """Record a reviewer's decision, replacing the policy's: ``classification.moderation.status``
        becomes ``decision``, the decision and ``note`` join ``classification.moderation.manualReviews``
        and the matching ``asset.<status>`` event is sent with the API key as its ``actor``. An asset still
        pending moderation can only be ``blocked`` or ``purged``. Purging needs ``confirm_purge=True``
        and the ``assets:delete`` permission, and permanently deletes the stored content. Not
        retried: it carries no ``Idempotency-Key``."""
        merged = _merge("assets.decide", options, asset_id=asset_id, decision=decision, note=note, confirm_purge=confirm_purge)
        path = "/assets/" + _id(merged.get("assetId"), "assetId") + "/decision"
        _require(merged, "decision")
        _require(merged, "note")
        return cast(Asset, self._c._request("POST", path, body={k: v for k, v in merged.items() if k != "assetId"}))

    def explain(self, options: ExplainAssetOptions | None = None, /, *, asset_id: str = _UNSET,
                rerun: bool = _UNSET) -> Asset:
        """Complete the policy evidence behind a decided asset's moderation decision: the report's
        ``classification.moderation.explanationComplete`` becomes ``True`` and every action stays as
        decided. With ``rerun=True`` the asset is moderated again with the project's current policy and
        an ``asset.rerun-requested`` event is recorded; use it when the policy changed since the
        decision (``asset/policy-changed``). The asset returns unchanged: it keeps its decision until
        the re-run's is stored, reported by ``asset.classified`` and ``asset.<status>`` events, and a
        failed re-run keeps it. A reviewed asset raises ``asset/reviewed``, and one whose content is
        gone ``asset/content-unavailable``."""
        merged = _merge("assets.explain", options, asset_id=asset_id, rerun=rerun)
        body = {"rerun": True} if merged.get("rerun") else {}
        return cast(Asset, self._c._request(
            "POST", "/assets/" + _id(merged.get("assetId"), "assetId") + "/explain", body=body))

    def remove_content(self, options: AssetIdOptions | None = None, /, *, asset_id: str = _UNSET) -> Asset:
        """Remove stored content (source, preview and retained extracted text) but keep the
        asset record, metadata and classification results. The returned asset's ``content.status`` is
        ``removed`` and the CDN no longer serves its content."""
        merged = _merge("assets.removeContent", options, asset_id=asset_id)
        return cast(Asset, self._c._request("DELETE", "/assets/" + _id(merged.get("assetId"), "assetId") + "/content"))

    def delete(self, options: AssetIdOptions | None = None, /, *, asset_id: str = _UNSET) -> None:
        """Delete the asset record together with its stored content. An asset extracted from another
        (one with a ``parentId``) raises ``asset/child-not-deletable``: delete its parent instead."""
        merged = _merge("assets.delete", options, asset_id=asset_id)
        self._c._request("DELETE", "/assets/" + _id(merged.get("assetId"), "assetId"))

    def batch(self, options: BatchAssetsOptions | None = None, /, *, asset_ids: List[str] = _UNSET,
              operation: AssetBatchOperation = _UNSET) -> BatchAssetsResponse:
        """Delete up to 500 assets (``operation="delete"``) or remove their stored content
        (``"remove-content"``) in one request. Every asset must exist in the project and the key needs
        ``assets:delete`` for its folder, and a deletion can't name an asset extracted from another
        (``asset/child-not-deletable``), or nothing is queued. Returns ``{"batchId", "status": "queued",
        "assetCount"}`` once queued; the work runs in the background and records ``asset.deleted`` or
        ``asset.content-removed`` for each asset, with a ``batch-id`` fact naming ``batchId``. Assets
        under a safety hold are skipped. Not retried: it carries no ``Idempotency-Key``."""
        merged = _merge("assets.batch", options, asset_ids=asset_ids, operation=operation)
        _validate_batch(merged)
        return cast(BatchAssetsResponse, self._c._request(
            "POST", self._c._project("assets/batch"),
            body={"assetIds": merged["assetIds"], "operation": merged["operation"]}))


class Folders:
    """``client.folders``: organise assets in nested folders."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def list(self, options: ListFoldersOptions | None = None, /, *, parent_id: str = _UNSET, cursor: str = _UNSET,
             page_size: int = _UNSET, sort: str = _UNSET, search: str = _UNSET) -> FolderPage:
        """One page of child folders (of ``parent_id``, or the project root), with ``ancestors`` for
        showing their paths. ``sort`` is ``name`` (the default) or ``createdAt``, descending when
        prefixed with ``-``. Pass the page's ``nextCursor`` as ``cursor`` for the next page."""
        merged = _merge("folders.list", options, parent_id=parent_id, cursor=cursor, page_size=page_size, sort=sort,
                        search=search)
        return cast(FolderPage, self._c._request("GET", self._c._project("folders"), query=merged))

    def iter(self, options: ListFoldersOptions | None = None, /, *, parent_id: str = _UNSET, page_size: int = _UNSET,
             sort: str = _UNSET, search: str = _UNSET) -> Iterator[Folder]:
        """Yield every child folder of ``parent_id`` (or the project root), requesting pages lazily."""
        merged = _merge("folders.each", options, parent_id=parent_id, page_size=page_size, sort=sort, search=search)
        return cast(Iterator[Folder], _iterate_pages(
            lambda index: self.list(cast(ListFoldersOptions, {**merged, "cursor": index})), merged.get("cursor")))

    def retrieve(self, options: FolderIdOptions | None = None, /, *, folder_id: str = _UNSET) -> Folder:
        """Fetch a folder by ID."""
        merged = _merge("folders.retrieve", options, folder_id=folder_id)
        return cast(Folder, self._c._request("GET", "/folders/" + _id(merged.get("folderId"), "folderId")))

    def create(self, options: CreateFolderOptions | None = None, /, *, name: str = _UNSET,
               parent_id: str | None = _UNSET) -> Folder:
        """Create a folder, at the project root or inside ``parent_id``."""
        merged = _merge("folders.create", options, name=name, parent_id=parent_id)
        _require(merged, "name")
        return cast(Folder, self._c._request("POST", self._c._project("folders"), body=merged))

    def update(self, options: UpdateFolderOptions | None = None, /, *, folder_id: str = _UNSET,
               name: str = _UNSET) -> Folder:
        """Rename a folder."""
        merged = _merge("folders.update", options, folder_id=folder_id, name=name)
        return cast(Folder, self._c._request("PATCH", "/folders/" + _id(merged.get("folderId"), "folderId"),
                                             body={k: v for k, v in merged.items() if k != "folderId"}))

    def move(self, options: MoveFolderOptions | None = None, /, *, folder_id: str = _UNSET,
             parent_id: str | None = _UNSET) -> Folder:
        """Move a folder inside another, or to the root with ``parent_id=None``."""
        merged = _merge("folders.move", options, folder_id=folder_id, parent_id=parent_id)
        if "parentId" not in merged:
            raise _invalid("parentId is required (None moves the folder to the project root)")
        return cast(Folder, self._c._request("POST", "/folders/" + _id(merged.get("folderId"), "folderId") + "/move",
                                             body={"parentId": merged["parentId"]}))

    def delete(self, options: FolderIdOptions | None = None, /, *, folder_id: str = _UNSET) -> None:
        """Delete an empty folder."""
        merged = _merge("folders.delete", options, folder_id=folder_id)
        self._c._request("DELETE", "/folders/" + _id(merged.get("folderId"), "folderId"))


class HashLists:
    """``client.hash_lists``: perceptual hashes that image uploads are compared with. A ``flag``
    list reports matches; a ``block`` list also blocks close matches."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def list(self, options: ListHashListsOptions | None = None, /, *, cursor: str = _UNSET,
             page_size: int = _UNSET, sort: str = _UNSET) -> HashListPage:
        """One page of the project's hash lists, newest first unless ``sort`` (comma-separated
        ``createdAt`` and ``id``, descending when prefixed with ``-``) says otherwise; pass the
        previous page's ``nextCursor`` as ``cursor`` for the next."""
        merged = _merge("hashLists.list", options, cursor=cursor, page_size=page_size, sort=sort)
        return cast(HashListPage, self._c._request("GET", self._c._project("hash-lists"), query=merged))

    def iter(self, options: ListHashListsOptions | None = None, /, *, page_size: int = _UNSET,
             sort: str = _UNSET) -> Iterator[HashList]:
        """Yield every hash list of the project, requesting pages lazily."""
        merged = _merge("hashLists.each", options, page_size=page_size, sort=sort)
        return cast(Iterator[HashList], _iterate_pages(
            lambda index: self.list(cast(ListHashListsOptions, {**merged, "cursor": index})), merged.get("cursor")))

    def retrieve(self, options: HashListIdOptions | None = None, /, *, hash_list_id: str = _UNSET) -> HashList:
        """Fetch a hash list by ID."""
        merged = _merge("hashLists.retrieve", options, hash_list_id=hash_list_id)
        return cast(HashList, self._c._request("GET", "/hash-lists/" + _id(merged.get("hashListId"), "hashListId")))

    def create(self, options: CreateHashListOptions | None = None, /, *, name: str = _UNSET,
               action: HashListAction = _UNSET, description: str | None = _UNSET) -> HashList:
        """Create a hash list. ``action`` is ``flag`` (report matches) or ``block`` (also block
        close matches)."""
        merged = _merge("hashLists.create", options, name=name, action=action, description=description)
        _require(merged, "name")
        _require(merged, "action")
        return cast(HashList, self._c._request("POST", self._c._project("hash-lists"), body=merged))

    def update(self, options: UpdateHashListOptions | None = None, /, *, hash_list_id: str = _UNSET,
               name: str = _UNSET, description: str | None = _UNSET, action: HashListAction = _UNSET) -> HashList:
        """Rename a list or change what its matches do; the new action applies to later uploads.
        ``description=None`` clears the description."""
        merged = _merge("hashLists.update", options, hash_list_id=hash_list_id, name=name, description=description, action=action)
        return cast(HashList, self._c._request("PATCH", "/hash-lists/" + _id(merged.get("hashListId"), "hashListId"),
                                               body={k: v for k, v in merged.items() if k != "hashListId"}))

    def delete(self, options: HashListIdOptions | None = None, /, *, hash_list_id: str = _UNSET) -> None:
        """Delete a hash list and every entry in it."""
        merged = _merge("hashLists.delete", options, hash_list_id=hash_list_id)
        self._c._request("DELETE", "/hash-lists/" + _id(merged.get("hashListId"), "hashListId"))

    def list_entries(self, options: ListHashListEntriesOptions | None = None, /, *, hash_list_id: str = _UNSET,
                     cursor: str = _UNSET, page_size: int = _UNSET, sort: str = _UNSET) -> HashListEntryPage:
        """One page of a list's entries, newest first unless ``sort`` says otherwise, as for
        :meth:`list`; pass the previous page's ``nextCursor`` as ``cursor`` for the next."""
        merged = _merge("hashLists.listEntries", options, hash_list_id=hash_list_id, cursor=cursor, page_size=page_size,
                        sort=sort)
        path = "/hash-lists/" + _id(merged.get("hashListId"), "hashListId") + "/entries"
        return cast(HashListEntryPage, self._c._request(
            "GET", path, query={k: v for k, v in merged.items() if k != "hashListId"}))

    def iter_entries(self, options: ListHashListEntriesOptions | None = None, /, *, hash_list_id: str = _UNSET,
                     page_size: int = _UNSET, sort: str = _UNSET) -> Iterator[HashListEntry]:
        """Yield every entry of a list, requesting pages lazily."""
        merged = _merge("hashLists.eachEntry", options, hash_list_id=hash_list_id, page_size=page_size, sort=sort)
        _id(merged.get("hashListId"), "hashListId")
        return cast(Iterator[HashListEntry], _iterate_pages(
            lambda index: self.list_entries(cast(ListHashListEntriesOptions, {**merged, "cursor": index})),
            merged.get("cursor")))

    def add_entry(self, options: AddHashListEntryOptions | None = None, /, *, hash_list_id: str = _UNSET,
                  hash: str = _UNSET, quality: int | None = _UNSET, asset_id: str = _UNSET,
                  label: str | None = _UNSET) -> HashListEntry:
        """Add a PDQ ``hash`` (with its ``quality`` when known), or the hash of the image asset
        ``asset_id``. A hash already in the list returns its existing entry."""
        merged = _merge("hashLists.addEntry", options, hash_list_id=hash_list_id, hash=hash, quality=quality, asset_id=asset_id,
                        label=label)
        path = "/hash-lists/" + _id(merged.get("hashListId"), "hashListId") + "/entries"
        return cast(HashListEntry, self._c._request(
            "POST", path, body={k: v for k, v in merged.items() if k != "hashListId"}))

    def remove_entry(self, options: HashListEntryIdOptions | None = None, /, *, entry_id: str = _UNSET) -> None:
        """Remove one entry from its list."""
        merged = _merge("hashLists.removeEntry", options, entry_id=entry_id)
        self._c._request("DELETE", "/hash-list-entries/" + _id(merged.get("entryId"), "entryId"))


class Policies:
    """``client.policies``: moderation policies. Policies belong to the API key's organisation and
    its projects share them. Every change sends the policy's ``revision``, so a policy changed since
    is refused with ``policy/revision-conflict``. Through a project's key you can change only
    policies no other project uses."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    @staticmethod
    def _path(policy_id: object) -> str:
        return "/policies/" + _id(policy_id, "policyId")

    def list(self, options: ListPoliciesOptions | None = None, /, *, cursor: str = _UNSET,
             page_size: int = _UNSET, sort: str = _UNSET) -> PolicyPage:
        """One page of the organisation's policies, oldest first unless ``sort`` (comma-separated
        ``createdAt`` and ``id``, descending when prefixed with ``-``) says otherwise. Use
        :meth:`retrieve_assigned` for the one the project moderates with."""
        merged = _merge("policies.list", options, cursor=cursor, page_size=page_size, sort=sort)
        return cast(PolicyPage, self._c._request("GET", "/policies", query=merged))

    def iter(self, options: ListPoliciesOptions | None = None, /, *, page_size: int = _UNSET,
             sort: str = _UNSET) -> Iterator[Policy]:
        """Yield every policy of the organisation, requesting pages lazily."""
        merged = _merge("policies.each", options, page_size=page_size, sort=sort)
        return cast(Iterator[Policy], _iterate_pages(
            lambda index: self.list(cast(ListPoliciesOptions, {**merged, "cursor": index})), merged.get("cursor")))

    def retrieve(self, options: PolicyIdOptions | None = None, /, *, policy_id: str = _UNSET) -> Policy:
        """Fetch one of the organisation's policies by ID."""
        merged = _merge("policies.retrieve", options, policy_id=policy_id)
        return cast(Policy, self._c._request("GET", self._path(merged.get("policyId"))))

    def create(self, options: CreatePolicyOptions | None = None, /, *, name: str = _UNSET,
               description: str = _UNSET, settings: PolicySettings = _UNSET, preset_id: str = _UNSET) -> Policy:
        """Create a policy from ``settings`` (defining every category) with a ``name``, or a copy of
        the latest release of a built-in preset with ``preset_id``. It moderates nothing until it is
        assigned to a project or named on an upload preset."""
        merged = _merge("policies.create", options, name=name, description=description, settings=settings, preset_id=preset_id)
        return cast(Policy, self._c._request("POST", "/policies", body=merged))

    def update(self, options: UpdatePolicyOptions | None = None, /, *, policy_id: str = _UNSET,
               revision: int = _UNSET, name: str = _UNSET, description: str = _UNSET,
               settings: PolicySettings = _UNSET) -> Policy:
        """Change the name, description or settings (complete, defining every category); later
        moderation uses them. Saving a ``live`` policy pins it under the same ID."""
        merged = _merge("policies.update", options, policy_id=policy_id, revision=revision, name=name, description=description,
                        settings=settings)
        return cast(Policy, self._c._request("PATCH", self._path(merged.get("policyId")),
                                             body={k: v for k, v in merged.items() if k != "policyId"}))

    def reset(self, options: ResetPolicyOptions | None = None, /, *, policy_id: str = _UNSET,
              revision: int = _UNSET, preset_version: int = _UNSET) -> Policy:
        """Restore the settings of the preset release a ``pinned`` or ``copy`` policy is pinned to,
        discarding its edits. Send the pinned ``preset.version`` you reviewed."""
        merged = _merge("policies.reset", options, policy_id=policy_id, revision=revision, preset_version=preset_version)
        return cast(Policy, self._c._request("POST", self._path(merged.get("policyId")) + "/reset",
                                             body={k: v for k, v in merged.items() if k != "policyId"}))

    def upgrade(self, options: UpgradePolicyOptions | None = None, /, *, policy_id: str = _UNSET,
                revision: int = _UNSET, preset_version: int = _UNSET) -> Policy:
        """Move an unchanged ``pinned`` or ``copy`` policy to the latest release of its preset. Send
        the ``preset.latestVersion`` you reviewed."""
        merged = _merge("policies.upgrade", options, policy_id=policy_id, revision=revision, preset_version=preset_version)
        return cast(Policy, self._c._request("POST", self._path(merged.get("policyId")) + "/upgrade",
                                             body={k: v for k, v in merged.items() if k != "policyId"}))

    def set_automatic_updates(self, options: SetPolicyAutomaticUpdatesOptions | None = None, /, *,
                              policy_id: str = _UNSET, enabled: bool = _UNSET, revision: int = _UNSET,
                              preset_version: int = _UNSET) -> Policy:
        """Switch automatic updates on (``live``) or off (``pinned``) for the organisation's own
        preset policy. Switching on replaces its settings with the latest preset settings under the
        same ID; switching off pins the current preset version with unchanged settings."""
        merged = _merge("policies.setAutomaticUpdates", options, policy_id=policy_id, enabled=enabled, revision=revision,
                        preset_version=preset_version)
        return cast(Policy, self._c._request("PUT", self._path(merged.get("policyId")) + "/automatic-updates",
                                             body={k: v for k, v in merged.items() if k != "policyId"}))

    def delete(self, options: PolicyIdOptions | None = None, /, *, policy_id: str = _UNSET) -> None:
        """Delete a policy that no project or upload preset uses."""
        merged = _merge("policies.delete", options, policy_id=policy_id)
        self._c._request("DELETE", self._path(merged.get("policyId")))

    def retrieve_assigned(self, options: Mapping[str, Any] | None = None, /) -> Policy:
        """The policy the project moderates with. It takes no options."""
        _merge("policies.retrieveAssigned", options)
        return cast(Policy, self._c._request("GET", self._c._project("policy")))

    def assign(self, options: AssignPolicyOptions | None = None, /, *, policy_id: str = _UNSET) -> Policy:
        """Choose the policy the project moderates with. Later uploads use it, except those through
        an upload preset that names its own policy."""
        merged = _merge("policies.assign", options, policy_id=policy_id)
        return cast(Policy, self._c._request("PUT", self._c._project("policy"), body=merged))


class UploadPresets:
    """``client.upload_presets``: the project's upload presets, the rules for uploads from browsers
    and apps. :meth:`ensure` creates or replaces presets by key, for deploys that declare them in
    code; send each preset's ``revision`` to refuse a change made since you read it."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def list(self, options: ListUploadPresetsOptions | None = None, /, *, cursor: str = _UNSET,
             page_size: int = _UNSET, sort: str = _UNSET) -> UploadPresetPage:
        """One page of the project's upload presets, oldest first unless ``sort`` (comma-separated
        ``createdAt`` and ``id``, descending when prefixed with ``-``) says otherwise."""
        merged = _merge("uploadPresets.list", options, cursor=cursor, page_size=page_size, sort=sort)
        return cast(UploadPresetPage, self._c._request("GET", self._c._project("upload-presets"), query=merged))

    def iter(self, options: ListUploadPresetsOptions | None = None, /, *, page_size: int = _UNSET,
             sort: str = _UNSET) -> Iterator[UploadPreset]:
        """Yield every upload preset of the project, requesting pages lazily."""
        merged = _merge("uploadPresets.each", options, page_size=page_size, sort=sort)
        return cast(Iterator[UploadPreset], _iterate_pages(
            lambda index: self.list(cast(ListUploadPresetsOptions, {**merged, "cursor": index})), merged.get("cursor")))

    def ensure(self, options: EnsureUploadPresetsOptions | None = None, /, *,
               upload_presets: List[UploadPresetDefinition] = _UNSET) -> EnsureUploadPresetsResponse:
        """Create each preset, or replace it with the definition sent, by key; fields left out take
        their defaults. Every preset is checked before any is saved, and an unchanged preset keeps
        its revision. Returns the stored presets in the order sent."""
        merged = _merge("uploadPresets.ensure", options, upload_presets=upload_presets)
        return cast(EnsureUploadPresetsResponse, self._c._request("PUT", self._c._project("upload-presets"), body=merged))

    def delete(self, options: UploadPresetIdOptions | None = None, /, *, upload_preset_id: str = _UNSET) -> None:
        """Delete an upload preset; assets already uploaded through it stay."""
        merged = _merge("uploadPresets.delete", options, upload_preset_id=upload_preset_id)
        self._c._request("DELETE", "/upload-presets/" + _id(merged.get("uploadPresetId"), "uploadPresetId"))


class ProjectSettings:
    """``client.project_settings``: the project's settings, with defaults filled in. Its policy and
    metadata fields have their own methods."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def get(self, options: Mapping[str, Any] | None = None, /) -> ProjectSettingsResource:
        """The project's settings and the revision to send back with a change. It takes no options."""
        _merge("projectSettings.get", options)
        return cast(ProjectSettingsResource, self._c._request("GET", self._c._project("settings")))

    def update(self, options: UpdateProjectSettingsOptions | None = None, /, *,
               settings: PublicProjectSettingsInput = _UNSET, revision: int = _UNSET,
               search_indexing_budget_units: float = _UNSET) -> ProjectSettingsResource:
        """Replace the settings: those left out return to their defaults. Send the ``revision`` you
        read to refuse a change made since; unchanged settings keep their revision. Turning on
        ``aiMediaSearchEnabled`` needs ``search_indexing_budget_units``."""
        merged = _merge("projectSettings.update", options, settings=settings, revision=revision,
                        search_indexing_budget_units=search_indexing_budget_units)
        return cast(ProjectSettingsResource, self._c._request("PUT", self._c._project("settings"), body=merged))


class MetadataFields:
    """``client.metadata_fields``: the project's metadata fields. They share the project settings'
    ``revision``."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def list(self, options: Mapping[str, Any] | None = None, /) -> MetadataFieldsResource:
        """The project's fields in display order and the revision to send back with a change. It
        takes no options."""
        _merge("metadataFields.list", options)
        return cast(MetadataFieldsResource, self._c._request("GET", self._c._project("metadata-fields")))

    def ensure(self, options: EnsureMetadataFieldsOptions | None = None, /, *,
               fields: List[MetadataFieldDefinition] = _UNSET, revision: int = _UNSET) -> MetadataFieldsResource:
        """Create or replace fields by ID. Other fields are kept, new ones are added at the end, and
        unchanged fields keep the revision. Send the ``revision`` you read to refuse a change made
        since."""
        merged = _merge("metadataFields.ensure", options, fields=fields, revision=revision)
        return cast(MetadataFieldsResource, self._c._request("PUT", self._c._project("metadata-fields"), body=merged))

    def delete(self, options: DeleteMetadataFieldOptions | None = None, /, *, field_id: str = _UNSET,
               revision: int = _UNSET) -> None:
        """Delete a field definition; assets keep their values. Send the ``revision`` you read to
        refuse a change made since."""
        merged = _merge("metadataFields.delete", options, field_id=field_id, revision=revision)
        path = self._c._project("metadata-fields/" + _id(merged.get("fieldId"), "fieldId"))
        self._c._request("DELETE", path, query={k: v for k, v in merged.items() if k != "fieldId"})


class Lenses:
    """``client.lenses``: the project's lenses, named image transforms the CDN applies at
    ``/@<identifier>``. The CDN serves files made with each lens's current definition.
    :meth:`CalmLensServerClient.ensure_lenses` creates or changes lenses by identifier, for
    applications that declare theirs in code."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    @staticmethod
    def _path(lens_id: object) -> str:
        return "/lenses/" + _id(lens_id, "lensId")

    def list(self, options: ListLensesOptions | None = None, /, *, cursor: str = _UNSET,
             page_size: int = _UNSET, sort: str = _UNSET) -> LensPage:
        """One page of the project's lenses, newest first unless ``sort`` (comma-separated
        ``createdAt`` and ``id``, descending when prefixed with ``-``) says otherwise. The built-in
        lenses are always available and aren't listed."""
        merged = _merge("lenses.list", options, cursor=cursor, page_size=page_size, sort=sort)
        return cast(LensPage, self._c._request("GET", self._c._project("lenses"), query=merged))

    def iter(self, options: ListLensesOptions | None = None, /, *, page_size: int = _UNSET,
             sort: str = _UNSET) -> Iterator[Lens]:
        """Yield every lens of the project, requesting pages lazily."""
        merged = _merge("lenses.each", options, page_size=page_size, sort=sort)
        return cast(Iterator[Lens], _iterate_pages(
            lambda index: self.list(cast(ListLensesOptions, {**merged, "cursor": index})), merged.get("cursor")))

    def create(self, options: LensDefinition | None = None, /, *, identifier: str = _UNSET, name: str = _UNSET,
               type: LensType = _UNSET, description: str | None = _UNSET, active: bool = _UNSET,
               transform: ImageTransformOptions | None = _UNSET) -> Lens:
        """Create a lens. Its identifier must be new to the project (``lens/identifier-taken``
        otherwise); use :meth:`CalmLensServerClient.ensure_lens` to create or change one by
        identifier."""
        merged = _merge("lenses.create", options, identifier=identifier, name=name, type=type, description=description,
                        active=active, transform=transform)
        lens = cast(Lens, self._c._request("POST", self._c._project("lenses"), body=merged))
        self._c._forget_lenses("identifier", lens.get("identifier") if isinstance(lens, Mapping) else None)
        return lens

    def retrieve(self, options: LensIdOptions | None = None, /, *, lens_id: str = _UNSET) -> Lens:
        """Fetch one of the project's lenses by ID."""
        merged = _merge("lenses.retrieve", options, lens_id=lens_id)
        return cast(Lens, self._c._request("GET", self._path(merged.get("lensId"))))

    def update(self, options: UpdateLensOptions | None = None, /, *, lens_id: str = _UNSET, name: str = _UNSET,
               description: str | None = _UNSET, type: LensType = _UNSET, active: bool = _UNSET,
               transform: ImageTransformOptions | None = _UNSET) -> Lens:
        """Change a lens's name, description, type, transform or whether the CDN serves it
        (``active``). ``description=None`` and ``transform=None`` clear them. The CDN serves the new
        transform from then on."""
        merged = _merge("lenses.update", options, lens_id=lens_id, name=name, description=description, type=type,
                        active=active, transform=transform)
        lens = cast(Lens, self._c._request("PATCH", self._path(merged.get("lensId")),
                                           body={k: v for k, v in merged.items() if k != "lensId"}))
        self._c._forget_lenses("id", lens.get("id") if isinstance(lens, Mapping) else None)
        return lens

    def delete(self, options: LensIdOptions | None = None, /, *, lens_id: str = _UNSET) -> None:
        """Delete a lens. URLs that select it stop being served; files the CDN already delivered
        may stay in caches until they expire."""
        merged = _merge("lenses.delete", options, lens_id=lens_id)
        self._c._request("DELETE", self._path(merged.get("lensId")))
        self._c._forget_lenses("id", merged["lensId"])


class Events:
    """``client.events``: poll the project's event feed (the events webhooks deliver)."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def list(self, options: ListEventsOptions | None = None, /, *, cursor: str = _UNSET,
             page_size: int = _UNSET, types: List[EventType] = _UNSET, asset_id: str = _UNSET) -> EventsPage:
        """Events created after ``cursor`` (a previous response's ``nextCursor``), oldest first.
        Without ``cursor`` it returns no events and a ``nextCursor`` for now. ``types`` and
        ``asset_id`` narrow the feed to some event types or one asset's events; a cursor belongs to
        the filters it was issued with, so pass the same ones with each ``cursor``."""
        merged = _merge("events.list", options, cursor=cursor, page_size=page_size, types=types, asset_id=asset_id)
        types_given = merged.pop("types", None)
        if types_given is not None:
            if isinstance(types_given, str) or not isinstance(types_given, (list, tuple)) \
                    or not all(isinstance(t, str) for t in types_given):
                raise _invalid("types must be a list of event types")
            # The API takes the types as one comma-separated value.
            if types_given:
                merged["types"] = ",".join(types_given)
        return cast(EventsPage, self._c._request("GET", self._c._project("events"), query=merged))

    def iter_pages(self, options: ListEventsOptions | None = None, /, *, cursor: str = _UNSET,
                   page_size: int = _UNSET, types: List[EventType] = _UNSET,
                   asset_id: str = _UNSET) -> Iterator[EventsPage]:
        """Yield pages from ``cursor`` until one reports ``hasMore=False``. Persist the last
        page's ``nextCursor`` to resume later. Without ``cursor`` it yields one empty page whose
        ``nextCursor`` is now. Raises ``sdk/invalid-response`` (``details.cursor``) instead of looping
        when a page with more to follow returns a cursor already sent."""
        merged = _merge("events.eachPage", options, cursor=cursor, page_size=page_size, types=types,
                        asset_id=asset_id)
        sent = {merged["cursor"]} if merged.get("cursor") is not None else set()
        while True:
            page = self.list(cast(ListEventsOptions, merged))
            if page.get("hasMore"):
                _new_cursor(sent, page["nextCursor"])
            yield page
            if not page.get("hasMore"):
                return
            merged["cursor"] = page["nextCursor"]

    def iter(self, options: ListEventsOptions | None = None, /, *, cursor: str = _UNSET,
             page_size: int = _UNSET, types: List[EventType] = _UNSET, asset_id: str = _UNSET) -> Iterator[Event]:
        """Yield every event currently waiting after ``cursor`` (see :meth:`iter_pages`)."""
        for page in self.iter_pages(options, cursor=cursor, page_size=page_size, types=types, asset_id=asset_id):
            yield from page["items"]


class CDN:
    """``client.cdn``: build CDN URLs and download content."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def get_asset_url(self, options: AssetUrlOptions | None = None, /, *, project_id: str = _UNSET,
                      asset_id: str = _UNSET, external_id: str = _UNSET, resource: CdnResource = _UNSET,
                      lens: str = _UNSET, transform: CdnTransform = _UNSET,
                      viewer_claims: ViewerClaims = _UNSET) -> str:
        """An asset's CDN URL, built without a request: the asset URL, which every resource is a
        path beneath, or a resource's URL when ``resource`` is given, with its lens or transform and
        the viewer claims.

        Name the asset by exactly one of ``asset_id`` and ``external_id``; ``project_id`` defaults
        to the client's. Use it for public assets: private ones need :meth:`sign_asset_url`.
        ``preview``, and ``rendered`` when it is an image, optionally go through a named ``lens``, a
        ``transform``, or both (the lens runs first); the other resources take neither.

        ``viewer_claims`` are your app's unsigned assertions about the viewer, such as
        ``{"ageConfirmed": True}``, which the CDN requires before it serves an age-restricted
        asset. CalmLens does not verify them, and anyone holding the URL can add them: set
        ``ageConfirmed`` only where your app has already decided the viewer may see age-restricted
        content."""
        merged = _merge("cdn.getAssetUrl", options, project_id=project_id, asset_id=asset_id,
                        external_id=external_id, resource=resource, lens=lens, transform=transform,
                        viewer_claims=viewer_claims)
        return self._asset_url(merged)

    def _asset_url(self, options: Mapping[str, Any]) -> str:
        project = _id(options.get("projectId", self._c.project_id), "projectId")
        return _append_asset_location(f"{self._c.cdn_base_url}/assets/{project}/{_asset_segment(options)}", options)

    def sign_asset_url(self, options: SignAssetUrlOptions | None = None, /, *, project_id: str = _UNSET,
                       asset_id: str = _UNSET, external_id: str = _UNSET, expires_in: int = _UNSET,
                       original: bool = _UNSET, resource: CdnResource = _UNSET, lens: str = _UNSET,
                       transform: CdnTransform = _UNSET, viewer_claims: ViewerClaims = _UNSET) -> SignedAssetUrl:
        """Sign a private asset's URL, so browsers and apps can load it without an API key until it
        expires (``expires_in`` seconds, 1 to 86400, default 900).

        Every resource is a path beneath the signed URL, as beneath a public asset URL;
        ``original`` only when signed with ``original=True``. With ``resource``, returns that
        resource's URL beneath the grant; the lens, transform and viewer claims are appended as
        :meth:`get_asset_url` appends them and are not part of the signature."""
        merged = _merge("cdn.signAssetUrl", options, project_id=project_id, asset_id=asset_id,
                        external_id=external_id, expires_in=expires_in, original=original, resource=resource,
                        lens=lens, transform=transform, viewer_claims=viewer_claims)
        expires = merged.get("expiresIn", DEFAULT_SIGNED_URL_EXPIRES_IN)
        if isinstance(expires, bool) or not isinstance(expires, (int, float)) or not math.isfinite(expires) \
                or not float(expires).is_integer() or not 1 <= expires <= MAX_SIGNED_URL_EXPIRES_IN:
            raise _invalid(f"expires_in must be a whole number of seconds from 1 to {MAX_SIGNED_URL_EXPIRES_IN}")
        grants_original = merged.get("original", False)
        if not isinstance(grants_original, bool):
            raise _invalid("original must be a boolean")
        _asset_segment(merged)
        # The location is appended to the signed URL: check it before signing.
        _append_asset_location("", merged)
        project = _id(merged.get("projectId", self._c.project_id), "projectId")
        asset = {"assetId": merged["assetId"]} if "assetId" in merged else {"externalId": merged["externalId"]}
        signed = self._c._request("POST", f"/projects/{project}/signed-asset-urls",
                                  body={**asset, "expiresIn": int(expires), "original": grants_original})
        if not isinstance(signed, dict) or not isinstance(signed.get("url"), str) or not signed["url"] \
                or isinstance(signed.get("expiresAt"), bool) or not isinstance(signed.get("expiresAt"), int):
            raise CalmLensError(error_codes.SDK_INVALID_RESPONSE, "The API returned no signed asset URL")
        return {"url": _append_asset_location(signed["url"], merged), "expiresAt": signed["expiresAt"]}

    def get_asset_info(self, url: str, options: GetAssetInfoOptions | None = None, /, *,
                       viewer_claims: ViewerClaims = _UNSET) -> AssetInfo:
        """The display info of an asset URL, public or signed (its ``info`` resource): the asset's
        type, size, rendered file, preview and stream, and whether the viewer its claims describe
        can see it now (``availability``).

        The viewer claims are ``viewer_claims``, else those the URL carries. The request is sent
        without the API key, as a browser would send it. A refusal raises
        :class:`CalmLensAPIError` with the CDN's code, such as ``signed-url/expired`` or
        ``asset/not-available``."""
        merged = _merge("cdn.getAssetInfo", options, viewer_claims=viewer_claims)
        parts = urlsplit(url) if isinstance(url, str) else None
        if parts is None or parts.scheme not in ("http", "https") or not parts.netloc:
            raise _invalid("url must be an absolute http(s) asset URL")
        path, _, query = url.split("#", 1)[0].partition("?")
        claims = merged.get("viewerClaims")
        if claims is None and query:
            raw = parse_qs(query, keep_blank_values=True).get("viewerClaims")
            if raw:
                try:
                    claims = json.loads(raw[0])
                except ValueError as error:
                    raise _invalid("The asset URL's viewerClaims are not JSON") from error
        request = Request(path.rstrip("/") + "/info" + _viewer_claims_query(claims), method="GET",
                          headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        limit = self._c.max_response_bytes
        try:
            with self._c.transport(request, self._c.timeout) as response:
                status, headers = response.status, _response_headers(response)
                if _is_redirect(status, headers):
                    raise _redirect_error(status, headers)
                content = _read_body(response, headers, limit)
        except _TRANSPORT_ERRORS as error:
            raise _transport_error(error) from error
        if content is None:
            raise _too_large(status, headers, limit)
        if not 200 <= status < 300:
            raise self._c._api_error(status, headers, content)
        try:
            data = json.loads(content)
        except (ValueError, UnicodeDecodeError):
            data = None
        if not _is_asset_info(data):
            raise CalmLensError(error_codes.SDK_INVALID_RESPONSE, "The CDN returned no asset info", status=status,
                                headers=headers)
        return cast(AssetInfo, data)

    def serve(self, options: ServeOptions | None = None, /, *, project_id: str = _UNSET, asset_id: str = _UNSET,
              external_id: str = _UNSET, resource: CdnResource = _UNSET, lens: str = _UNSET,
              transform: CdnTransform = _UNSET, viewer_claims: ViewerClaims = _UNSET,
              init: ServeInit = _UNSET) -> CDNResponse:
        """Request an asset's resource (default ``rendered``) from the CDN with the client's API key.

        Returns a streaming :class:`CDNResponse`, including for non-2xx responses (check
        ``status``); close it, or use it as a context manager. Transport failures, timeouts, 429,
        500, 502, 503 and 504 are retried like API reads (``Retry-After`` replaces the backoff), and the
        last response is returned once retries run out. A redirect is not followed: it raises
        ``sdk/http-error``. The timeout is an inactivity limit, so large downloads are not cut off.
        """
        merged = _merge("cdn.serve", options, project_id=project_id, asset_id=asset_id, external_id=external_id,
                        resource=resource, lens=lens, transform=transform, viewer_claims=viewer_claims, init=init)
        settings = merged.get("init") or {}
        method = settings.get("method", "GET")
        if method not in ("GET", "HEAD"):
            raise _invalid("init.method must be GET or HEAD")
        extra = {k: _header_value(k, v) for k, v in (settings.get("headers") or {}).items() if k.lower() != "x-api-key"}
        url = self._asset_url({"resource": "rendered", **{k: v for k, v in merged.items() if k != "init"}})
        headers = self._c._headers(extra, api=False)
        attempt = 0
        while True:
            can_retry = attempt < self._c.max_retries
            try:
                response = CDNResponse(self._c.transport(Request(url, headers=headers, method=method),
                                                         self._c.timeout))
            except _TRANSPORT_ERRORS as error:
                if not can_retry:
                    raise _transport_error(error) from error
                self._c._sleep(_retry_delay(attempt))
                attempt += 1
                continue
            if _is_redirect(response.status, response.headers):
                response.close()
                raise _redirect_error(response.status, response.headers)
            if response.ok or not can_retry or response.status not in _RETRY_STATUSES:
                return response
            retry_after = _parse_retry_after(response.headers.get("retry-after"))
            delay = retry_after if retry_after is not None else _retry_delay(attempt)
            if delay > MAX_RETRY_AFTER_SECONDS:
                return response
            response.close()
            self._c._sleep(delay)
            attempt += 1


class CDNResponse:
    """A streamed CDN response. ``read()`` and iteration raise ``CalmLensTransportError``
    (``sdk/transport-error`` or ``sdk/timeout``, with the native ``__cause__``) when the
    body cannot be read."""

    def __init__(self, response: TransportResponse):
        self._response = response
        self.status: int = response.status
        #: Response headers with lower-case names.
        self.headers: dict[str, str] = _response_headers(response)

    def __repr__(self) -> str:
        return f"CDNResponse(status={self.status}, content_type={self.content_type!r})"

    @property
    def ok(self) -> bool:
        """True for 2xx responses."""
        return 200 <= self.status < 300

    @property
    def content_type(self) -> str | None:
        return self.headers.get("content-type")

    @property
    def request_id(self) -> str | None:
        return self.headers.get("x-request-id")

    def read(self, amount: int | None = None) -> bytes:
        """Read the rest of the body, or at most ``amount`` bytes."""
        try:
            return self._response.read() if amount is None else self._response.read(amount)
        except _TRANSPORT_ERRORS as error:
            self.close()
            raise _transport_error(error) from error

    def iter_bytes(self, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
        """Yield the body in chunks without holding it all in memory."""
        while True:
            chunk = self.read(chunk_size)
            if not chunk:
                return
            yield chunk

    def __iter__(self) -> Iterator[bytes]:
        return self.iter_bytes()

    def close(self) -> None:
        self._response.close()

    def __enter__(self) -> CDNResponse:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


class Text:
    """``client.text``: classify plain text."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def classify(self, options: ClassifyTextOptions | None = None, /, *, text: str = _UNSET, name: str = _UNSET,
                 description: str = _UNSET, processing_options: ProcessingOptions = _UNSET,
                 metadata: List[MetadataItem] = _UNSET, tags: List[str] = _UNSET, author_id: str = _UNSET,
                 context: ModerationContext = _UNSET, external_id: str = _UNSET, external_url: str = _UNSET,
                 folder_id: str | None = _UNSET, idempotency_key: str | None = None) -> Asset:
        """Classify UTF-8 text and wait for the decision (asset name defaults to ``text``).
        ``author_id`` and ``context`` work as in :meth:`Assets.create`."""
        merged = _merge("text.classify", options, text=text, name=name, description=description, processing_options=processing_options,
                        metadata=metadata, tags=tags, author_id=author_id, context=context, external_id=external_id,
                        external_url=external_url, folder_id=folder_id)
        value = merged.pop("text", None)
        if not isinstance(value, str) or not value.strip():
            raise _invalid("Text to classify must be a non-empty string")
        merged.setdefault("name", "text")
        merged["content"] = {"plainText": value, "type": "text/plain"}
        return self._c.assets.classify(cast(SubmitAssetOptions, merged), idempotency_key=idempotency_key)
