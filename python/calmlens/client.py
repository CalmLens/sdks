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
from typing import Any, BinaryIO, Callable, List, Literal, Protocol, cast
from urllib.parse import quote, unquote, urlencode, urlsplit
from urllib.request import Request, getproxies, proxy_bypass

from . import error_codes
from ._version import __version__
from .errors import (CalmLensAPIError, CalmLensError, CalmLensTimeoutError, CalmLensTransportError,
                     CalmLensValidationError, _parse_retry_after)
from .moderation_context import select_moderation_context_items
from .types import (IMAGE_TRANSFORM_COLOUR_KEYS, Asset, AssetBatchOperation, AssetIdOptions, AssetPage, AssetSearchResponse, AssetUrlOptions, CdnResource, CdnTransform,
                    Content, CreateFolderOptions, EnsureLensesOptions, Event, EventsPage, Folder, FolderPage, ListFoldersOptions, FolderIdOptions, Lens,
                    LensDefinition, LensTransform, LensType, ListAssetsOptions, ListChildrenOptions, ListEventsOptions,
                    BatchAssetsOptions, BatchAssetsResponse,
                    MetadataItem, ModerationContext, ClassifyTextOptions, ExplainAssetOptions, MoveAssetOptions, MoveFolderOptions, Ordering, PartContent,
                    ProcessingOptions, SearchAssetsOptions, SearchMode, ServeInit, ServeOptions, SignedUrl,
                    SignedUploadToken, SignedUrlOptions, SignUploadTokenOptions, SubmitAssetOptions,
                    UpdateAssetOptions, UpdateFolderOptions, UploadPartOptions,
                    AddHashListEntryOptions, CreateHashListOptions, HashList, HashListAction, HashListEntry,
                    HashListEntryIdOptions, HashListEntryPage, HashListIdOptions, HashListList,
                    ListHashListEntriesOptions, UpdateHashListOptions,
                    Visibility, WaitForDecisionOptions)
from .webhooks import parse_webhook_event, verify_webhook_signature

__all__ = ["CalmLensServerClient", "CDNResponse", "Transport", "TransportResponse", "DEFAULT_TIMEOUT",
           "DEFAULT_CONNECT_TIMEOUT", "DEFAULT_MAX_RETRIES", "DEFAULT_MAX_RESPONSE_BYTES", "USER_AGENT"]


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
#: Seconds before the first retry; each later retry waits twice as long, up to ``RETRY_MAX_DELAY``.
#: Half of each wait is fixed and half random.
RETRY_BASE_DELAY = 0.5
RETRY_MAX_DELAY = 8.0
#: ``Retry-After`` values above this are not waited for; the error is raised instead.
MAX_RETRY_AFTER_SECONDS = 60.0
USER_AGENT = f"calmlens-python/{__version__} ({platform.python_implementation().lower()}/{platform.python_version()})"

_RETRY_STATUSES = frozenset({429, 502, 503, 504})
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


def _serialize_transform(transform: Any) -> str:
    """Serialize structured transforms as a CDN selector, one path segment per step, such as
    ``fit=cover,width=640/format=webp``.

    Option keys are sorted so equal transforms share a URL, nested keys are dotted
    (``border.color``), hex colours are written without ``#`` and values are percent-encoded, so
    the result is already path-safe.
    """
    steps = list(transform) if isinstance(transform, (list, tuple)) else [transform]
    if not steps:
        raise _invalid("Transform needs at least one step")
    selectors = []
    for step in steps:
        if not isinstance(step, Mapping):
            raise _invalid("Transform steps must be mappings")
        if step.get("type") != "imageTransform":
            raise _invalid('Transform type must be "imageTransform"')
        options = step.get("options")
        if options is None:
            options = {}
        if not isinstance(options, Mapping):
            raise _invalid("Transform options must be a mapping")
        pairs: list[str] = []
        for key in _sorted_keys(options):
            _transform_options(pairs, key, options[key])
        if not pairs:
            raise _invalid("Transform steps need at least one option")
        selectors.append(",".join(pairs))
    return "/".join(selectors)


def _transform_selector(transform: Any) -> Any:
    """The selector string the API and CDN accept for a string or structured transform."""
    return transform if transform is None or isinstance(transform, str) else _serialize_transform(transform)


def _has_transform(transform: Any) -> bool:
    return transform is not None and transform != ""


def _transform_path(value: Any) -> str:
    """A transform as a URL path: structured steps serialized, strings encoded like JavaScript's
    encodeURI."""
    if not isinstance(value, str):
        return _serialize_transform(value)
    value = value.lstrip("/")
    if ".." in value or "?" in value or "#" in value:
        raise _invalid('Transform cannot contain "..", "?" or "#"')
    try:
        return quote(value, safe=";/:@&=+$,~!*'()-._")
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

    def open(self) -> bytes | BinaryIO:
        if self.stream is None:
            return cast(bytes, self.data)
        if self.start is not None:
            self.stream.seek(self.start)
        return cast(BinaryIO, _LimitedReader(self.stream, self.size))


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


def _image_size(size: int | None, final: bool) -> None:
    if size is not None and size > 20 * 1024 * 1024:
        raise CalmLensValidationError(error_codes.MULTIPART_IMAGE_TOO_LARGE)
    if final and size is not None and size < 10 * 1024 * 1024:
        raise CalmLensValidationError(error_codes.MULTIPART_IMAGE_TOO_SMALL)


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


def _merge(options: Mapping[str, Any] | None, **keywords: Any) -> dict[str, Any]:
    """One options dict (camelCase, as in the API) or snake_case keyword arguments."""
    given = {k: v for k, v in keywords.items() if v is not _UNSET}
    if options is not None:
        if given:
            raise _invalid("Use keyword arguments or one options dict, not both")
        if not isinstance(options, Mapping):
            raise _invalid(f"options must be a dict, not {type(options).__name__}")
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
            with an ``Idempotency-Key``) after network failures, timeouts, 429, 502, 503, 504 and
            ``idempotency/request-in-progress``; 0 disables retries.
        max_response_bytes: The largest API response body the client reads; a larger one fails
            with ``sdk/response-too-large``. CDN downloads are not limited.
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
                 transport: Transport | None = None):
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
        if transport is not None and not callable(transport):
            raise _invalid("transport must be callable", error_codes.SDK_INVALID_CONFIG)
        self.api_key, self.project_id = api_key, project_id
        self.base_url, self.cdn_base_url = base_url.rstrip("/"), cdn_base_url.rstrip("/")
        self.timeout, self.upload_timeout, self.connect_timeout = timeout, upload, connect_timeout
        self.max_retries, self.max_response_bytes = max_retries, max_response_bytes
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
        params = {k: v if isinstance(v, str) else _json(v)
                  for k, v in (query or {}).items() if v is not None and k not in ("ordering", "ids")}
        for index, folder_id in enumerate((query or {}).get("ids") or []):
            params[f"ids[{index}]"] = folder_id
        for index, order in enumerate((query or {}).get("ordering") or []):
            for key, value in order.items():
                params[f"ordering[{index}][{key}]"] = value
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
                 raw: _Body | None = None, headers: Mapping[str, str] | None = None,
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
            details = dict(data["details"]) if isinstance(data.get("details"), dict) else {}
            if "traceId" in data:
                details["traceId"] = data["traceId"]
            message = data.get("message") if isinstance(data.get("message"), str) else None
            return CalmLensAPIError(data["code"], message, details, status, headers=headers)
        return CalmLensAPIError(error_codes.SDK_HTTP_ERROR, f"HTTP {status}", status=status, headers=headers)

    def ensure_lens(self, options: LensDefinition | None = None, /, *, identifier: str = _UNSET, name: str = _UNSET,
                    type: LensType = _UNSET, version: int = _UNSET, description: str | None = _UNSET,
                    active: bool = _UNSET, transforms: List[LensTransform] | None = _UNSET) -> Lens:
        """Create or update one named lens (see :meth:`ensure_lenses`)."""
        lens = _merge(options, identifier=identifier, name=name, type=type, version=version,
                      description=description, active=active, transforms=transforms)
        return self.ensure_lenses({"lenses": [cast(LensDefinition, lens)]})[0]

    def ensure_lenses(self, options: EnsureLensesOptions | None = None, /, *,
                      lenses: list[LensDefinition] = _UNSET) -> list[Lens]:
        """Create or update named lenses, cached per definition and version.

        Identical concurrent calls share one request; a changed version replaces the cached
        definition for that identifier. More than ``ENSURE_LENSES_MAX_PER_REQUEST`` new definitions
        are sent in consecutive requests, in order. Version conflicts raise ``lens/version-conflict``.
        """
        merged = _merge(options, lenses=lenses)
        definitions = merged.get("lenses")
        if not isinstance(definitions, list) or not definitions or any(
                not isinstance(lens, Mapping) or not lens.get("identifier") for lens in definitions):
            raise _invalid("At least one lens with an identifier is required")

        def cache_key(lens: Mapping[str, Any]) -> str:
            return json.dumps({k: lens.get(k) for k in (
                "identifier", "name", "description", "type", "active", "transforms", "version"
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
                    self._lenses = {k: v for k, v in self._lenses.items() if v["identifier"] != lens["identifier"]}
                    self._lenses[key] = copy.deepcopy(lens)
            return copy.deepcopy([resolved[key] for key in keys])


#: The most lens definitions :meth:`CalmLensServerClient.ensure_lenses` sends in one request.
ENSURE_LENSES_MAX_PER_REQUEST = 100

_UPLOAD_TOKEN_CONTEXT = "calmlens-upload-token:v1:"
#: ``upload_tokens.sign``'s lifetime when ``expires_in_seconds`` is omitted.
UPLOAD_TOKEN_DEFAULT_EXPIRES_IN_SECONDS = 600
_UPLOAD_TOKEN_MAX_TTL_SECONDS = 3600


def _sign_upload_token(api_key: str, options: Mapping[str, Any], now: int, nonce: str) -> SignedUploadToken:
    """Sign an upload token at ``now`` (milliseconds since the epoch) with ``nonce``."""
    preset_id = options.get("uploadPresetId")
    _id(preset_id, "Upload preset ID")
    ttl = options.get("expiresInSeconds", UPLOAD_TOKEN_DEFAULT_EXPIRES_IN_SECONDS)
    if isinstance(ttl, bool) or not isinstance(ttl, int) or not 1 <= ttl <= _UPLOAD_TOKEN_MAX_TTL_SECONDS:
        raise _invalid(f"expiresInSeconds must be a whole number from 1 to {_UPLOAD_TOKEN_MAX_TTL_SECONDS}")
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
             external_id: str = _UNSET, expires_in_seconds: int = _UNSET) -> SignedUploadToken:
        """Sign an upload token with the client's API key. Makes no request.

        The token lets one browser upload through ``upload_preset_id`` until it expires
        (``expires_in_seconds``, 1 to 3600, default 600). ``external_id`` becomes the external
        ID of the uploaded asset. Returns ``{"token": ..., "expiresAt": <ms since epoch>}``.
        """
        merged = _merge(options, upload_preset_id=upload_preset_id, external_id=external_id,
                        expires_in_seconds=expires_in_seconds)
        return _sign_upload_token(self._c.api_key, merged, int(time.time() * 1000), str(uuid.uuid4()))


#: ``wait_for_decision`` checks again after this many seconds, then waits
#: ``DECISION_POLL_DELAY_FACTOR`` times longer each time, up to ``DECISION_POLL_MAX_DELAY``.
DECISION_POLL_FIRST_DELAY = 0.5
DECISION_POLL_DELAY_FACTOR = 1.5
DECISION_POLL_MAX_DELAY = 5.0
#: Seconds ``wait_for_decision`` polls before ``sdk/timeout`` when ``timeout`` is omitted.
DEFAULT_DECISION_TIMEOUT = 60.0
#: ``assets.create_signed_url``'s lifetime when ``expires_in_seconds`` is omitted.
DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS = 900

_SUBMIT_QUERY_KEYS = ("name", "description", "processingOptions", "visibility", "metadata", "authorId", "context",
                      "externalId", "externalUrl", "folderId", "uploadPresetId")


class Assets:
    """``client.assets``: upload, classify, list and manage assets."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def search(self, options: SearchAssetsOptions | None = None, /, *, query: str = _UNSET,
               limit: int = _UNSET, mode: SearchMode = _UNSET) -> AssetSearchResponse:
        """Search the project's assets by keyword and/or meaning (``mode``: ``keyword``,
        ``semantic`` or ``hybrid``)."""
        merged = _merge(options, query=query, limit=limit, mode=mode)
        _require(merged, "query")
        return cast(AssetSearchResponse, self._c._request("GET", self._c._project("assets/search"), query=merged))

    def list(self, options: ListAssetsOptions | None = None, /, *, cursor: str = _UNSET,
             page_size: int = _UNSET, ordering: List[Ordering] = _UNSET, filter: str = _UNSET,
             folder_id: str = _UNSET) -> AssetPage:
        """One page of the project's assets (``cursor`` resumes a previous page; ``filter`` is RSQL,
        e.g. ``classification.moderation.status==allowed``). Use :meth:`iter` to walk every page."""
        merged = _merge(options, cursor=cursor, page_size=page_size, ordering=ordering, filter=filter,
                        folder_id=folder_id)
        return cast(AssetPage, self._c._request("GET", self._c._project("assets/page"), query=merged))

    def iter(self, options: ListAssetsOptions | None = None, /, *, page_size: int = _UNSET,
             ordering: List[Ordering] = _UNSET, filter: str = _UNSET, folder_id: str = _UNSET) -> Iterator[Asset]:
        """Yield every matching asset, requesting pages lazily as you iterate."""
        merged = _merge(options, page_size=page_size, ordering=ordering, filter=filter, folder_id=folder_id)
        return self._iterate(lambda index: self.list(cast(ListAssetsOptions, {**merged, "cursor": index})),
                             merged.get("cursor"))

    @staticmethod
    def _iterate(fetch: Callable[[str | None], AssetPage], index: str | None) -> Iterator[Asset]:
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

    def retrieve(self, options: AssetIdOptions | None = None, /, *, asset_id: str = _UNSET, region: str = _UNSET) -> Asset:
        """Fetch an asset by ID."""
        merged = _merge(options, asset_id=asset_id, region=region)
        return cast(Asset, self._c._request("GET", "/assets/" + _id(merged.get("assetId"), "assetId"), query={"region": merged["region"]} if "region" in merged else None))

    def wait_for_decision(self, options: WaitForDecisionOptions | None = None, /, *, asset_id: str = _UNSET,
                          timeout: float = _UNSET) -> Asset:
        """Retrieve an asset until ``classification.moderation.status`` is no longer ``pending``
        (``allowed``, ``limited``, ``age-restricted``, ``blocked`` or ``purged``), or ``classification.status`` is
        ``failed``, and return that asset.

        Checks again after 0.5 seconds, then waits 1.5 times longer each time, up to 5
        seconds between checks. Raises :class:`CalmLensError` with ``sdk/timeout`` and
        ``details`` ``{"assetId", "classificationStatus", "moderationStatus"}`` (the last statuses
        seen) when there is no decision within ``timeout`` seconds (default 60). Webhooks
        report decisions without polling.
        """
        merged = _merge(options, asset_id=asset_id, timeout=timeout)
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
            if moderation_status != "pending" or classification_status == "failed":
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
               external_url: str | None = _UNSET, visibility: Visibility = _UNSET) -> Asset:
        """Change asset fields. Omitted fields are unchanged; ``None`` clears a nullable field."""
        merged = _merge(options, asset_id=asset_id, name=name, description=description, tags=tags,
                        metadata=metadata, external_id=external_id, external_url=external_url, visibility=visibility)
        return cast(Asset, self._c._request("PATCH", "/assets/" + _id(merged.get("assetId"), "assetId"),
                                            body={k: v for k, v in merged.items() if k != "assetId"}))

    def list_children(self, options: ListChildrenOptions | None = None, /, *, asset_id: str = _UNSET,
                      cursor: str = _UNSET, page_size: int = _UNSET, ordering: List[Ordering] = _UNSET,
                      filter: str = _UNSET) -> AssetPage:
        """One page of the assets extracted from an asset (pages of a document, a website's
        text and images, ...). Use :meth:`iter_children` to walk every page."""
        merged = _merge(options, asset_id=asset_id, cursor=cursor, page_size=page_size, ordering=ordering,
                        filter=filter)
        return cast(AssetPage, self._c._request(
            "GET", "/assets/" + _id(merged.get("assetId"), "assetId") + "/children",
            query={k: v for k, v in merged.items() if k != "assetId"}))

    def iter_children(self, options: ListChildrenOptions | None = None, /, *, asset_id: str = _UNSET,
                      page_size: int = _UNSET, ordering: List[Ordering] = _UNSET,
                      filter: str = _UNSET) -> Iterator[Asset]:
        """Yield every child of an asset, requesting pages lazily."""
        merged = _merge(options, asset_id=asset_id, page_size=page_size, ordering=ordering, filter=filter)
        _id(merged.get("assetId"), "assetId")
        return self._iterate(lambda index: self.list_children(cast(ListChildrenOptions, {**merged, "cursor": index})),
                             merged.get("cursor"))

    def create(self, options: SubmitAssetOptions | None = None, /, *, name: str = _UNSET, content: Content = _UNSET,
               part: Content = _UNSET, url: str = _UNSET, description: str = _UNSET,
               processing_options: ProcessingOptions = _UNSET, visibility: Visibility = _UNSET,
               metadata: List[MetadataItem] = _UNSET, author_id: str = _UNSET, context: ModerationContext = _UNSET,
               external_id: str = _UNSET, external_url: str = _UNSET,
               folder_id: str | None = _UNSET, upload_preset_id: str = _UNSET,
               total_size_in_bytes: int = _UNSET, idempotency_key: str | None = None) -> Asset:
        """Upload content (or submit a ``url``) and queue classification; returns at once
        with a ``pending`` asset.

        Supply exactly one of ``content``, ``part`` (first part of a multipart upload) or
        ``url``. ``idempotency_key`` makes retries safe; one is generated per call when
        omitted, and reused for the client's own retries.

        ``author_id`` is your label for who wrote the content. ``context`` holds earlier posts in
        the conversation, oldest first (``{"items": [{"text": ..., "authorId": ...}]}``); CalmLens
        moderates only the content and uses them to read it in context. Only the posts CalmLens
        uses are sent: the most recent 5 that fit in 2,000 characters.
        """
        merged = _merge(options, name=name, content=content, part=part, url=url, description=description,
                        processing_options=processing_options, visibility=visibility, metadata=metadata,
                        author_id=author_id, context=context, external_id=external_id, external_url=external_url, folder_id=folder_id,
                        upload_preset_id=upload_preset_id, total_size_in_bytes=total_size_in_bytes)
        return self._submit(merged, True, idempotency_key)

    def classify(self, options: SubmitAssetOptions | None = None, /, *, name: str = _UNSET, content: Content = _UNSET,
                 part: Content = _UNSET, url: str = _UNSET, description: str = _UNSET,
                 processing_options: ProcessingOptions = _UNSET, visibility: Visibility = _UNSET,
                 metadata: List[MetadataItem] = _UNSET, author_id: str = _UNSET, context: ModerationContext = _UNSET,
                 external_id: str = _UNSET, external_url: str = _UNSET,
                 folder_id: str | None = _UNSET, upload_preset_id: str = _UNSET,
                 total_size_in_bytes: int = _UNSET, idempotency_key: str | None = None) -> Asset:
        """Like :meth:`create`, but waits for the decision where supported (audio and video
        are always asynchronous and return ``pending``)."""
        merged = _merge(options, name=name, content=content, part=part, url=url, description=description,
                        processing_options=processing_options, visibility=visibility, metadata=metadata,
                        author_id=author_id, context=context, external_id=external_id, external_url=external_url, folder_id=folder_id,
                        upload_preset_id=upload_preset_id, total_size_in_bytes=total_size_in_bytes)
        payload = merged.get("content")
        if isinstance(payload, Mapping) and "plainText" in payload and (
                not isinstance(payload["plainText"], str) or not payload["plainText"].strip()):
            raise _invalid("Text to classify must be a non-empty string", error_codes.INVALID_UPLOAD_PAYLOAD)
        return self._submit(merged, False, idempotency_key)

    def _submit(self, options: dict[str, Any], queue: bool, idempotency_key: str | None) -> Asset:
        if not options.get("name"):
            raise _invalid("Asset name is required", error_codes.INVALID_UPLOAD_PAYLOAD)
        if "context" in options:
            context = options["context"]
            if not isinstance(context, Mapping) or not isinstance(context.get("items"), list):
                raise _invalid("context.items must be a list of earlier posts")
            # Only the posts CalmLens uses are sent, which keeps a raw upload's query short.
            options["context"] = {"items": select_moderation_context_items(context["items"])}
        if sum(k in options for k in ("content", "part", "url")) != 1 or "isFinal" in options:
            raise _invalid("Supply exactly one of content, part, or url; isFinal belongs in part",
                           error_codes.INVALID_UPLOAD_PAYLOAD)
        key = idempotency_key if idempotency_key is not None else str(uuid.uuid4())
        if "url" in options:
            return _expect_asset(self._c._request("POST", self._c._project("assets"), query={"queue": queue},
                                                  body=options, idempotency_key=key))
        multipart = "part" in options
        payload = options["part" if multipart else "content"]
        if not isinstance(payload, Mapping):
            raise _invalid("content must be a dict")
        mime = payload.get("type", "")
        normalized = mime.lower().split(";", 1)[0].strip() if isinstance(mime, str) else ""
        if not normalized or normalized == "application/octet-stream" or normalized.startswith("multipart/"):
            raise CalmLensValidationError(
                error_codes.INVALID_UPLOAD_MIME_TYPE,
                f"{normalized or 'A missing type'} is not a valid upload file type. Uploads must use a concrete file "
                "MIME type that CalmLens can store and process, such as image/png, image/jpeg, application/pdf, or "
                "text/plain.", {"mimeType": mime})
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
            _image_size(total, True)
        body = _payload(payload, multipart, checked)
        if checked and multipart and normalized.startswith("image/"):
            _image_size(body.size, payload.get("isFinal", False))
        query = {k: options[k] for k in _SUBMIT_QUERY_KEYS if k in options}
        query.update(queue=queue, contentType=mime, sizeInBytes=body.size)
        if multipart:
            query.update(partNumber=1, isFinal=payload.get("isFinal", False), totalSizeInBytes=total)
        headers = {"Content-Type": _header_value("type", mime), "X-CalmLens-Upload": "part" if multipart else "content"}
        if body.size is not None:
            headers["Content-Length"] = str(body.size)
        # Text is sent with the API timeout; binary content with the upload timeout when one is set.
        binary = "plainText" not in payload and self._c.upload_timeout is not None
        return _expect_asset(self._c._request(
            "POST", self._c._project("assets"), query=query, raw=body, headers=headers, idempotency_key=key,
            timeout=self._c.upload_timeout if binary else None))

    def upload_part(self, options: UploadPartOptions | None = None, /, *, asset_id: str = _UNSET,
                    part: PartContent = _UNSET, queue: bool = _UNSET, idempotency_key: str | None = None) -> Asset:
        """Send the next part of a multipart upload (``partNumber`` 2, 3, ...; parts are
        sequential and all but the final one are at least 5 MiB).

        The final part is classified with the ``create``/``classify`` choice saved when the
        upload started; pass ``queue`` only to override it.
        """
        merged = _merge(options, asset_id=asset_id, part=part, queue=queue)
        path = "/assets/" + _id(merged.get("assetId"), "assetId") + "/part"
        payload = merged.get("part")
        if not isinstance(payload, Mapping):
            raise _invalid("part must be a dict")
        if type(payload.get("partNumber")) is not int or payload["partNumber"] < 1:
            raise CalmLensValidationError(error_codes.INVALID_UPLOAD_PART_NUMBER)
        body = _payload(payload, True, not self._c._defer_upload_checks)
        query: dict[str, Any] = {"partNumber": payload["partNumber"], "isFinal": payload.get("isFinal", False),
                                 "sizeInBytes": body.size}
        if merged.get("queue") is not None:
            query["queue"] = bool(merged["queue"])
        headers = {"X-CalmLens-Upload": "part", "Content-Length": str(body.size)}
        return _expect_asset(self._c._request(
            "POST", path, raw=body, headers=headers, query=query,
            idempotency_key=idempotency_key if idempotency_key is not None else str(uuid.uuid4()),
            timeout=self._c.upload_timeout))

    def create_signed_url(self, options: SignedUrlOptions | None = None, /, *, asset_id: str = _UNSET,
                          resource: Literal["original", "rendered"] = _UNSET, expires_in_seconds: int = _UNSET, lens: str = _UNSET,
                          transform: CdnTransform = _UNSET, region: str = _UNSET) -> SignedUrl:
        """Sign a temporary CDN URL for private content (defaults: ``rendered``, applied by the API, and
        900 seconds)."""
        merged = _merge(options, asset_id=asset_id, resource=resource, expires_in_seconds=expires_in_seconds,
                        lens=lens, transform=transform, region=region)
        asset_path = "/assets/" + _id(merged.get("assetId"), "assetId") + "/signed-url"
        body = {"expiresInSeconds": DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS,
                **{k: v for k, v in merged.items() if k != "assetId"}}
        resource = body.get("resource", "rendered")
        if resource not in ("original", "rendered"):
            raise _invalid("A signed URL's resource must be original or rendered")
        if resource == "original" and ("lens" in body or "transform" in body):
            raise _invalid("Lenses and transforms apply only to the rendered resource")
        expires = body["expiresInSeconds"]
        if isinstance(expires, bool) or not isinstance(expires, int) or not 1 <= expires <= 86400:
            raise _invalid("expires_in_seconds must be a whole number from 1 to 86400")
        if "transform" in body:
            body["transform"] = _transform_selector(body["transform"])
        return cast(SignedUrl, self._c._request("POST", asset_path, body=body))

    def move(self, options: MoveAssetOptions | None = None, /, *, asset_id: str = _UNSET,
             folder_id: str | None = _UNSET) -> Asset:
        """Move an asset into a folder, or to the project root with ``folder_id=None``."""
        merged = _merge(options, asset_id=asset_id, folder_id=folder_id)
        if "folderId" not in merged:
            raise _invalid("folderId is required (None moves the asset to the project root)")
        return cast(Asset, self._c._request("POST", "/assets/" + _id(merged.get("assetId"), "assetId") + "/move",
                                            body={"folderId": merged["folderId"]}))

    def retry(self, options: AssetIdOptions | None = None, /, *, asset_id: str = _UNSET) -> Asset:
        """Reprocess an asset whose ``classification.status`` is ``failed`` and whose content is
        still held (``content.status`` is not ``removed``)."""
        merged = _merge(options, asset_id=asset_id)
        return cast(Asset, self._c._request("POST", "/assets/" + _id(merged.get("assetId"), "assetId") + "/retry"))

    def explain(self, options: ExplainAssetOptions | None = None, /, *, asset_id: str = _UNSET,
                rerun: bool = _UNSET) -> Asset:
        """Complete the policy evidence behind a decided asset's moderation decision: the report's
        ``classification.moderation.policy.evidence`` becomes ``full`` and every action stays as
        decided. With ``rerun=True`` the asset is moderated again with the project's current policy
        and returns in ``processing``; use it when the policy changed since the decision
        (``asset/policy-changed``)."""
        merged = _merge(options, asset_id=asset_id, rerun=rerun)
        body = {"rerun": True} if merged.get("rerun") else {}
        return cast(Asset, self._c._request(
            "POST", "/assets/" + _id(merged.get("assetId"), "assetId") + "/explain", body=body))

    def delete_content(self, options: AssetIdOptions | None = None, /, *, asset_id: str = _UNSET) -> Asset:
        """Remove stored content (source, preview and retained extracted text) but keep the
        asset record, metadata and classification results. The returned asset's ``content.status`` is
        ``removed`` and the CDN no longer serves its content."""
        merged = _merge(options, asset_id=asset_id)
        return cast(Asset, self._c._request("DELETE", "/assets/" + _id(merged.get("assetId"), "assetId") + "/content"))

    def delete(self, options: AssetIdOptions | None = None, /, *, asset_id: str = _UNSET) -> None:
        """Delete the asset record together with its stored content."""
        merged = _merge(options, asset_id=asset_id)
        self._c._request("DELETE", "/assets/" + _id(merged.get("assetId"), "assetId"))

    def batch(self, options: BatchAssetsOptions | None = None, /, *, asset_ids: List[str] = _UNSET,
              operation: AssetBatchOperation = _UNSET) -> BatchAssetsResponse:
        """Delete up to 500 assets (``operation="delete"``) or remove their stored content
        (``"remove-content"``) in one request. Every asset must exist in the project and the key needs
        ``assets:delete`` for its folder, or nothing is queued. Returns ``{"queued": True}`` once
        queued; the work runs in the background and records ``asset.deleted`` or
        ``asset.content-removed`` for each asset. Assets under a safety hold are skipped. Not
        retried: it carries no ``Idempotency-Key``."""
        merged = _merge(options, asset_ids=asset_ids, operation=operation)
        _validate_batch(merged)
        return cast(BatchAssetsResponse, self._c._request(
            "POST", self._c._project("assets/batch"),
            body={"assetIds": merged["assetIds"], "operation": merged["operation"]}))


class Folders:
    """``client.folders``: organise assets in nested folders."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def list(self, options: ListFoldersOptions | None = None, /, **kwargs: Any) -> FolderPage:
        """One page of child folders, with visible paths for selected folders."""
        return cast(FolderPage, self._c._request("GET", self._c._project("folders"), query=_merge(options, **kwargs)))

    def retrieve(self, options: FolderIdOptions | None = None, /, *, folder_id: str = _UNSET) -> Folder:
        """Fetch a folder by ID."""
        merged = _merge(options, folder_id=folder_id)
        return cast(Folder, self._c._request("GET", "/folders/" + _id(merged.get("folderId"), "folderId")))

    def create(self, options: CreateFolderOptions | None = None, /, *, name: str = _UNSET,
               parent_id: str | None = _UNSET) -> Folder:
        """Create a folder, at the project root or inside ``parent_id``."""
        merged = _merge(options, name=name, parent_id=parent_id)
        _require(merged, "name")
        return cast(Folder, self._c._request("POST", self._c._project("folders"), body=merged))

    def update(self, options: UpdateFolderOptions | None = None, /, *, folder_id: str = _UNSET,
               name: str = _UNSET) -> Folder:
        """Rename a folder."""
        merged = _merge(options, folder_id=folder_id, name=name)
        return cast(Folder, self._c._request("PATCH", "/folders/" + _id(merged.get("folderId"), "folderId"),
                                             body={k: v for k, v in merged.items() if k != "folderId"}))

    def move(self, options: MoveFolderOptions | None = None, /, *, folder_id: str = _UNSET,
             parent_id: str | None = _UNSET) -> Folder:
        """Move a folder inside another, or to the root with ``parent_id=None``."""
        merged = _merge(options, folder_id=folder_id, parent_id=parent_id)
        if "parentId" not in merged:
            raise _invalid("parentId is required (None moves the folder to the project root)")
        return cast(Folder, self._c._request("POST", "/folders/" + _id(merged.get("folderId"), "folderId") + "/move",
                                             body={"parentId": merged["parentId"]}))

    def delete(self, options: FolderIdOptions | None = None, /, *, folder_id: str = _UNSET) -> None:
        """Delete an empty folder."""
        merged = _merge(options, folder_id=folder_id)
        self._c._request("DELETE", "/folders/" + _id(merged.get("folderId"), "folderId"))


class HashLists:
    """``client.hash_lists``: perceptual hashes that image uploads are compared with. A ``flag``
    list reports matches; a ``block`` list also blocks close matches."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def list(self, options: Mapping[str, Any] | None = None, /) -> HashListList:
        """Every hash list in the project, newest first. Takes no options; an empty options dict
        is accepted like the other methods'."""
        if _merge(options):
            raise _invalid("hash_lists.list takes no options")
        return cast(HashListList, self._c._request("GET", self._c._project("hash-lists")))

    def retrieve(self, options: HashListIdOptions | None = None, /, *, hash_list_id: str = _UNSET) -> HashList:
        """Fetch a hash list by ID."""
        merged = _merge(options, hash_list_id=hash_list_id)
        return cast(HashList, self._c._request("GET", "/hash-lists/" + _id(merged.get("hashListId"), "hashListId")))

    def create(self, options: CreateHashListOptions | None = None, /, *, name: str = _UNSET,
               action: HashListAction = _UNSET, description: str | None = _UNSET) -> HashList:
        """Create a hash list. ``action`` is ``flag`` (report matches) or ``block`` (also block
        close matches)."""
        merged = _merge(options, name=name, action=action, description=description)
        _require(merged, "name")
        _require(merged, "action")
        return cast(HashList, self._c._request("POST", self._c._project("hash-lists"), body=merged))

    def update(self, options: UpdateHashListOptions | None = None, /, *, hash_list_id: str = _UNSET,
               name: str = _UNSET, description: str | None = _UNSET, action: HashListAction = _UNSET) -> HashList:
        """Rename a list or change what its matches do; the new action applies to later uploads.
        ``description=None`` clears the description."""
        merged = _merge(options, hash_list_id=hash_list_id, name=name, description=description, action=action)
        return cast(HashList, self._c._request("PATCH", "/hash-lists/" + _id(merged.get("hashListId"), "hashListId"),
                                               body={k: v for k, v in merged.items() if k != "hashListId"}))

    def delete(self, options: HashListIdOptions | None = None, /, *, hash_list_id: str = _UNSET) -> None:
        """Delete a hash list and every entry in it."""
        merged = _merge(options, hash_list_id=hash_list_id)
        self._c._request("DELETE", "/hash-lists/" + _id(merged.get("hashListId"), "hashListId"))

    def list_entries(self, options: ListHashListEntriesOptions | None = None, /, *, hash_list_id: str = _UNSET,
                     cursor: str = _UNSET, page_size: int = _UNSET) -> HashListEntryPage:
        """One page of a list's entries, newest first; pass the previous page's ``nextCursor``
        as ``cursor`` for the next."""
        merged = _merge(options, hash_list_id=hash_list_id, cursor=cursor, page_size=page_size)
        path = "/hash-lists/" + _id(merged.get("hashListId"), "hashListId") + "/entries"
        return cast(HashListEntryPage, self._c._request(
            "GET", path, query={k: v for k, v in merged.items() if k != "hashListId"}))

    def add_entry(self, options: AddHashListEntryOptions | None = None, /, *, hash_list_id: str = _UNSET,
                  hash: str = _UNSET, quality: int | None = _UNSET, asset_id: str = _UNSET,
                  label: str | None = _UNSET) -> HashListEntry:
        """Add a PDQ ``hash`` (with its ``quality`` when known), or the hash of the image asset
        ``asset_id``. A hash already in the list returns its existing entry."""
        merged = _merge(options, hash_list_id=hash_list_id, hash=hash, quality=quality, asset_id=asset_id,
                        label=label)
        path = "/hash-lists/" + _id(merged.get("hashListId"), "hashListId") + "/entries"
        return cast(HashListEntry, self._c._request(
            "POST", path, body={k: v for k, v in merged.items() if k != "hashListId"}))

    def remove_entry(self, options: HashListEntryIdOptions | None = None, /, *, entry_id: str = _UNSET) -> None:
        """Remove one entry from its list."""
        merged = _merge(options, entry_id=entry_id)
        self._c._request("DELETE", "/hash-list-entries/" + _id(merged.get("entryId"), "entryId"))


class Events:
    """``client.events``: poll the project's event feed (the events webhooks deliver)."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def list(self, options: ListEventsOptions | None = None, /, *, after: str = _UNSET,
             limit: int = _UNSET) -> EventsPage:
        """Events created after the ``after`` cursor, oldest first. Without ``after`` it
        returns no events and a cursor for now."""
        merged = _merge(options, after=after, limit=limit)
        return cast(EventsPage, self._c._request("GET", self._c._project("events"), query=merged))

    def iter_pages(self, options: ListEventsOptions | None = None, /, *, after: str = _UNSET,
                   limit: int = _UNSET) -> Iterator[EventsPage]:
        """Yield pages from ``after`` until one reports ``hasMore=False``. Persist the last
        page's ``cursor`` to resume later. Without ``after`` it yields one empty page whose cursor
        is now. Raises ``sdk/invalid-response`` (``details.cursor``) instead of looping when a page
        with more to follow returns a cursor already sent."""
        merged = _merge(options, after=after, limit=limit)
        sent = {merged["after"]} if merged.get("after") is not None else set()
        while True:
            page = self.list(cast(ListEventsOptions, merged))
            if page.get("hasMore"):
                _new_cursor(sent, page["cursor"])
            yield page
            if not page.get("hasMore"):
                return
            merged["after"] = page["cursor"]

    def iter(self, options: ListEventsOptions | None = None, /, *, after: str = _UNSET,
             limit: int = _UNSET) -> Iterator[Event]:
        """Yield every event currently waiting after ``after`` (see :meth:`iter_pages`)."""
        for page in self.iter_pages(options, after=after, limit=limit):
            yield from page["events"]


class CDN:
    """``client.cdn``: build CDN URLs and download content."""

    def __init__(self, client: CalmLensServerClient):
        self._c = client

    def get_asset_url(self, options: AssetUrlOptions | None = None, /, *, asset_identifier: str = _UNSET,
                      resource: CdnResource = _UNSET, lens: str = _UNSET, transform: CdnTransform = _UNSET,
                      allow_age_restricted: bool = _UNSET, region: str = _UNSET) -> str:
        """The CDN URL of an asset's ``rendered`` (default), ``original`` or ``placeholder`` resource. The
        rendered resource optionally goes through a named ``lens``, a ``transform``, or both (the lens runs
        first); ``original`` takes neither. Private assets need an API key or a signed URL.

        ``placeholder`` is a small blurred PNG that the CDN serves for public assets whatever their
        moderation status. It takes no ``lens``, ``transform`` or ``allow_age_restricted``.

        ``allow_age_restricted=True`` appends ``?allowAgeRestricted=true``, which lets the public URL serve a
        public asset whose moderation status is ``age-restricted``. Set it only where your app has
        already decided the viewer may see age-restricted content."""
        merged = _merge(options, asset_identifier=asset_identifier, resource=resource, lens=lens, transform=transform,
                        allow_age_restricted=allow_age_restricted, region=region)
        age = merged.get("allowAgeRestricted", False)
        if not isinstance(age, bool):
            raise _invalid("allowAgeRestricted must be a boolean")
        selected = merged.get("resource", "rendered")
        if selected not in ("original", "rendered", "placeholder"):
            raise _invalid("Resource must be original, rendered or placeholder")
        transformed = merged.get("lens") is not None or merged.get("transform") is not None
        if selected == "original" and transformed:
            raise _invalid("Lenses and transforms apply only to the rendered resource")
        if selected == "placeholder" and (transformed or age):
            raise _invalid("A placeholder takes no lens, transform or allowAgeRestricted")
        url = (f"{self._c.cdn_base_url}/assets/{_id(self._c.project_id)}/"
               f"{_id(merged.get('assetIdentifier'), 'assetIdentifier')}/{selected}")
        if merged.get("lens"):
            url += "/@" + _id(merged["lens"], "lens")
        if _has_transform(merged.get("transform")):
            url += "/" + _transform_path(merged["transform"])
        params = (["allowAgeRestricted=true"] if age else [])
        if merged.get("region") is not None: params.append("region=" + quote(str(merged["region"]), safe=""))
        return url + ("?" + "&".join(params) if params else "")

    def serve(self, options: ServeOptions | None = None, /, *, asset_identifier: str = _UNSET,
              resource: CdnResource = _UNSET, lens: str = _UNSET, transform: CdnTransform = _UNSET,
              allow_age_restricted: bool = _UNSET, region: str = _UNSET, init: ServeInit = _UNSET) -> CDNResponse:
        """Request an asset from the CDN with the client's API key.

        Returns a streaming :class:`CDNResponse`, including for non-2xx responses (check
        ``status``); close it, or use it as a context manager. Transport failures, timeouts, 429,
        502, 503 and 504 are retried like API reads (``Retry-After`` replaces the backoff), and the
        last response is returned once retries run out. A redirect is not followed: it raises
        ``sdk/http-error``. The timeout is an inactivity limit, so large downloads are not cut off.
        """
        merged = _merge(options, asset_identifier=asset_identifier, resource=resource, lens=lens,
                        transform=transform, allow_age_restricted=allow_age_restricted, region=region, init=init)
        settings = merged.get("init") or {}
        method = settings.get("method", "GET")
        if method not in ("GET", "HEAD"):
            raise _invalid("init.method must be GET or HEAD")
        extra = {k: _header_value(k, v) for k, v in (settings.get("headers") or {}).items() if k.lower() != "x-api-key"}
        url = self.get_asset_url(cast(AssetUrlOptions, {k: v for k, v in merged.items() if k != "init"}))
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
                 metadata: List[MetadataItem] = _UNSET, author_id: str = _UNSET, context: ModerationContext = _UNSET,
                 external_id: str = _UNSET, external_url: str = _UNSET,
                 folder_id: str | None = _UNSET, idempotency_key: str | None = None) -> Asset:
        """Classify UTF-8 text and wait for the decision (asset name defaults to ``text``).
        ``author_id`` and ``context`` work as in :meth:`Assets.create`."""
        merged = _merge(options, text=text, name=name, description=description, processing_options=processing_options,
                        metadata=metadata, author_id=author_id, context=context, external_id=external_id, external_url=external_url, folder_id=folder_id)
        value = merged.pop("text", None)
        if not isinstance(value, str) or not value.strip():
            raise _invalid("Text to classify must be a non-empty string", error_codes.INVALID_UPLOAD_PAYLOAD)
        merged.setdefault("name", "text")
        merged["content"] = {"plainText": value, "type": "text/plain"}
        return self._c.assets.classify(cast(SubmitAssetOptions, merged), idempotency_key=idempotency_key)
