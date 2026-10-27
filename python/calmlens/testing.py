"""In-memory integration fake for tests. It does not classify content or apply transforms.

``MockCalmLensServerClient`` is the real :class:`~calmlens.CalmLensServerClient` with an in-memory
transport: every call goes through the real client's validation, encoding, response
handling, errors and retries, and the fake API answers with the real routes' status codes,
JSON error bodies and headers (``X-Request-Id``, ``Retry-After``, ``Idempotent-Replayed``).
Keep this module out of production code paths.
"""
from __future__ import annotations

import base64
import copy
import email.utils
import fnmatch
import hashlib
import io
import json
import math
import re
import secrets
import threading
import time
import uuid
import zlib
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict, Union, cast
from urllib.parse import parse_qsl, quote, unquote, urlsplit
from urllib.request import Request

from . import error_codes
from .client import (DEFAULT_CONNECT_TIMEOUT, DEFAULT_TIMEOUT, CalmLensServerClient, _invalid, _json, _merge,
                     _sign_upload_token)
from .errors import CalmLensError
from .moderation_context import select_moderation_context_items
from .types import (Asset, Event, EventAsset, EventFact, EventSeverity, EventType, Folder, HashList, HashListEntry,
                    SignedUploadToken, SignUploadTokenOptions)

__all__ = ["MockCalmLensServerClient", "MockRequest", "MockOptions", "MockAssetOutcome", "MockAssetOutcomeOption",
           "MockApiKeyGrant",
           "MockFailure", "StoredContent",
           "InMemoryMockDatabaseStorage", "InMemoryMockImageStorage", "create_mock_api_key", "sign_upload_token"]

_MOCK_OPTIONS = {"database_storage", "image_storage", "create_id", "now", "queued_outcome",
                 "analyzed_outcome", "signed_url_base_url"}
_MOCK_OUTCOMES = ("pending", "allowed", "limited", "age-restricted", "blocked", "purged", "failed")

#: Where a mock upload ends up: ``pending`` (still processing), ``allowed``, ``limited``, ``age-restricted``,
#: ``blocked`` or ``purged`` (processing done with that moderation status; ``purged`` also removes
#: the content) or ``failed`` (processing failed, retryable).
MockAssetOutcome = Literal["pending", "allowed", "limited", "age-restricted", "blocked", "purged", "failed"]
#: A mock outcome, or a function choosing one from the uploaded asset.
MockAssetOutcomeOption = Union[MockAssetOutcome, Callable[[Asset], MockAssetOutcome]]
_INT_QUERY = {"pageSize", "pageIndex", "limit", "partNumber", "sizeInBytes", "totalSizeInBytes"}
_BOOL_QUERY = {"queue", "isFinal", "searchAll", "resolveOnly"}
_JSON_QUERY = {"metadata", "processingOptions", "context"}
_MIB = 1024 * 1024


class MockApiKeyGrant(TypedDict):
    """A CDN download grant carried by a fake API key."""
    #: Granted actions, such as ``"assets:download"``.
    actions: list[str]
    #: Folder the grant covers; ``None`` covers the whole project.
    folderId: Union[str, None]
    includeSubfolders: bool


def sign_upload_token(api_key: str, options: SignUploadTokenOptions | None = None, /, *, now: int, nonce: str,
                      **keywords: Any) -> SignedUploadToken:
    """Sign an upload token like ``client.upload_tokens.sign``, with the same validation, at a
    fixed ``now`` (milliseconds since the epoch) with a fixed ``nonce``, so the token is the
    same every time, for comparing with known tokens in tests. Options are an options dict or
    the same keyword arguments as ``upload_tokens.sign``."""
    return _sign_upload_token(api_key, _merge(options, **keywords), now, nonce)


def create_mock_api_key(grants: list[MockApiKeyGrant] | None = None) -> str:
    """A fake API key carrying CDN download ``grants`` such as
    ``[{"actions": ["assets:download"], "folderId": None, "includeSubfolders": True}]``."""
    return "sk_test_" + base64.urlsafe_b64encode(_json(grants or []).encode()).decode().rstrip("=")


class InMemoryMockDatabaseStorage:
    """Assets, folders, hash lists, hash list entries and events by ID; inspect or seed them
    between calls."""

    def __init__(self) -> None:
        self.assets: dict[str, Asset] = {}
        self.folders: dict[str, Folder] = {}
        self.hash_lists: dict[str, HashList] = {}
        self.hash_list_entries: dict[str, HashListEntry] = {}
        self.events: list[Event] = []


class StoredContent(TypedDict):
    """Upload bytes of one asset: its MIME ``type`` and ``parts`` by part number."""
    type: str
    parts: dict[int, bytes]


class InMemoryMockImageStorage:
    """Stored upload bytes by asset ID: ``{"type": mime, "parts": {part_number: bytes}}``."""

    def __init__(self) -> None:
        self.content: dict[str, StoredContent] = {}


class _Response(io.BytesIO):
    def __init__(self, body: bytes, status: int = 200, headers: Mapping[str, str] | None = None):
        super().__init__(body)
        self.status = status
        self.headers = dict(headers or {})


class _Answer:
    """A fake API result with a success status other than the operation's usual one."""

    def __init__(self, status: int, body: Any):
        self.status, self.body = status, body


class _Failure(Exception):
    """An API error the fake answers with."""

    def __init__(self, code: str, message: str | None = None, status: int | None = None,
                 details: Mapping[str, Any] | None = None):
        super().__init__(code)
        self.code, self.message = code, message
        self.status = status or error_codes.STATUS_BY_CODE.get(code, 400)
        self.details = dict(details or {})


@dataclass(frozen=True)
class MockRequest:
    """A request received by ``MockCalmLensServerClient``.

    ``path`` is relative to ``base_url`` for API calls (``/projects/<id>/assets``) and to
    ``cdn_base_url`` for ``cdn.serve``. ``query`` holds the decoded query values (numbers,
    booleans and JSON values decoded); ``body`` is the JSON body as Python objects, the raw
    bytes of an upload, or None. ``headers`` has the API key redacted from ``repr``.
    """
    method: str
    url: str
    path: str
    # Recorded for every route, so the shapes vary: decoded JSON values or upload bytes.
    query: dict[str, Any] = field(default_factory=dict)
    body: Any = None
    headers: dict[str, str] = field(default_factory=dict, repr=False)


def _decode_query(pairs: Iterable[tuple[str, str]]) -> dict[str, Any]:
    query: dict[str, Any] = {}
    ordering: dict[int, dict[str, str]] = {}
    ids: dict[int, str] = {}
    for key, value in pairs:
        found = re.fullmatch(r"ordering\[(\d+)\]\[(\w+)\]", key)
        selected_id = re.fullmatch(r"ids\[(\d+)\]", key)
        if selected_id:
            ids[int(selected_id.group(1))] = value
        elif found:
            ordering.setdefault(int(found.group(1)), {})[found.group(2)] = value
        elif key in _INT_QUERY and re.fullmatch(r"-?[0-9]+", value):
            query[key] = int(value)
        elif key in _BOOL_QUERY and value in ("true", "false"):
            query[key] = value == "true"
        elif key in _JSON_QUERY:
            try:
                query[key] = json.loads(value)
            except ValueError:
                query[key] = value
        else:
            query[key] = value
    if ids:
        query["ids"] = [ids[index] for index in sorted(ids)]
    if ordering:
        query["ordering"] = [ordering[index] for index in sorted(ordering)]
    return query


def _split_top_level(text: str, separator: str) -> list[str]:
    """Split on ``separator`` outside quotes and parentheses."""
    parts: list[str] = []
    depth, quote, current = 0, "", ""
    for char in text:
        if quote:
            if char == quote:
                quote = ""
        elif char in "\"'":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == separator and depth == 0:
            parts.append(current)
            current = ""
            continue
        current += char
    parts.append(current)
    return parts


def _unwrap_group(text: str) -> str | None:
    """The expression inside ``( … )`` when the parentheses enclose all of ``text``."""
    if not (text.startswith("(") and text.endswith(")")):
        return None
    depth, quote = 0, ""
    for index, char in enumerate(text):
        if quote:
            if char == quote:
                quote = ""
        elif char in "\"'":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return text[1:-1] if index == len(text) - 1 else None
    return None


def _rsql(expression: str) -> Callable[[Mapping[str, Any]], bool]:
    """RSQL like the API: ``;`` (and), which binds tighter than ``,`` (or), ``( … )`` groups,
    ``==`` (``*`` wildcards), ``!=``, ``=in=``, ``=out=``, ``=gt=``, ``=ge=``, ``=lt=``, ``=le=``
    and quoted values. Anything else raises ``NotImplementedError`` instead of matching wrongly."""

    def unquote_value(value: str) -> str:
        value = value.strip()
        return value[1:-1].replace('\\"', '"').replace("\\'", "'") if value[:1] in "\"'" else value

    def comparison(text: str) -> Callable[[Mapping[str, Any]], bool]:
        found = re.fullmatch(r"\s*([\w.]+)\s*(==|!=|=in=|=out=|=gt=|=ge=|=lt=|=le=)(.*)", text, re.S)
        if not found:
            raise NotImplementedError(f"MockCalmLensServerClient cannot evaluate the filter {text!r}")
        name, operator, raw = found.groups()
        raw = raw.strip()
        if raw.startswith("("):
            if not raw.endswith(")") or operator not in ("=in=", "=out="):
                raise NotImplementedError(f"MockCalmLensServerClient cannot evaluate the filter {text!r}")
            values = [unquote_value(v) for v in _split_top_level(raw[1:-1], ",")]
        else:
            values = [unquote_value(raw)]

        def matches(asset: Mapping[str, Any]) -> bool:
            actual: Any = asset
            for key in name.split("."):
                actual = actual.get(key) if isinstance(actual, Mapping) else None
            items = actual if isinstance(actual, list) else [actual]
            texts = ["" if item is None else str(item).lower() if isinstance(item, bool) else str(item) for item in items]
            if operator == "==":
                return any(fnmatch.fnmatchcase(t, values[0]) for t in texts)
            if operator == "!=":
                return not any(fnmatch.fnmatchcase(t, values[0]) for t in texts)
            if operator == "=in=":
                return any(t in values for t in texts)
            if operator == "=out=":
                return not any(t in values for t in texts)
            try:
                left, right = float(actual), float(values[0])
            except (TypeError, ValueError):
                return False
            return {"=gt=": left > right, "=ge=": left >= right, "=lt=": left < right, "=le=": left <= right}[operator]
        return matches

    def parse(text: str) -> Callable[[Mapping[str, Any]], bool]:
        alternatives: list[list[Callable[[Mapping[str, Any]], bool]]] = []
        for alternative in _split_top_level(text, ","):
            terms = []
            for term in _split_top_level(alternative, ";"):
                term = term.strip()
                if not term:
                    raise NotImplementedError(f"MockCalmLensServerClient cannot parse the filter {expression!r}")
                group = _unwrap_group(term)
                terms.append(comparison(term) if group is None else parse(group))
            alternatives.append(terms)
        return lambda asset: any(all(test(asset) for test in terms) for terms in alternatives)

    return parse(expression)


_MAX_SEARCH_TOKENS = 8


def _keyword_score(values: Mapping[str, str], query: str) -> int:
    """The API's keyword score for the whole lowercased query."""
    identifier, external_id, name = values["id"], values["externalId"], values["name"]
    if identifier == query:
        return 1000
    if external_id == query:
        return 950
    if name == query:
        return 900
    if identifier.startswith(query):
        return 800
    if external_id.startswith(query):
        return 750
    if name.startswith(query):
        return 700
    if query in name:
        return 600
    if query in values["tags"]:
        return 500
    return 100


def _monotonic_clock() -> Callable[[], int]:
    """The system clock in epoch milliseconds, moved on by at least 1 ms per reading."""
    last = 0
    lock = threading.Lock()

    def now() -> int:
        nonlocal last
        with lock:
            last = max(int(time.time() * 1000), last + 1)
            return last
    return now


class MockOptions(TypedDict, total=False):
    """``mock_options`` for :class:`MockCalmLensServerClient`."""
    database_storage: InMemoryMockDatabaseStorage
    image_storage: InMemoryMockImageStorage
    #: Returns a new ID for an object of the kind its prefix names: ``asset``, ``fldr``, ``hl``,
    #: ``hle``, ``lens``, ``evt`` or ``rev``. The default is like the API's: the prefix, ``_`` and
    #: 20 random base62 characters, such as ``asset_5Gm2Rk8XqT3wLp9VbN4c``.
    create_id: Callable[[str], str]
    #: Returns the current time in milliseconds since the Unix epoch. The default is the
    #: system clock, moved on by at least a millisecond per reading, so assets created in a row
    #: have increasing ``createdAt`` values and orderings by ``createdAt`` don't depend on IDs.
    #: A clock you pass is used as is.
    now: Callable[[], int]
    #: Outcome of assets submitted with ``create`` (and queued multipart uploads). Defaults to
    #: ``pending``. Pass a function of the asset to choose per upload, for example from its name.
    queued_outcome: MockAssetOutcomeOption
    #: Outcome of assets submitted with ``classify`` and ``text.classify``. Defaults to
    #: ``allowed``. Also accepts a function of the asset.
    analyzed_outcome: MockAssetOutcomeOption
    signed_url_base_url: str


#: The ThumbHash the mock gives every classified image, standing in for one computed from its
#: pixels. The ``placeholder`` resource serves it as a PNG, like the CDN.
_MOCK_THUMBHASH = "1QcSHQRnh493V4dIh4eXh1h4kJUI"
_DEFAULT_EVENTS_LIMIT = 50
_MAX_EVENTS_LIMIT = 100
_MAX_SEARCH_LIMIT = 20
_MAX_SEARCH_QUERY_LENGTH = 200
_MAX_FOLDER_PAGE_SIZE = 100
_REVIEW_DECISIONS = ("allowed", "limited", "age-restricted", "blocked", "purged")
#: Like the API: 1 to 255 printable ASCII characters, once HTTP has trimmed the header value.
_IDEMPOTENCY_KEY = re.compile(r"[\x21-\x7e](?:[\x20-\x7e]{0,253}[\x21-\x7e])?")
#: A PDQ hash, as the API accepts it once trimmed and lowercased.
_PDQ_HASH = re.compile(r"[0-9a-f]{64}")
_HASH_LIST_ACTIONS = ("flag", "block")
#: Content a browser could run as a document, which the CDN serves as a download.
_ACTIVE_CONTENT_TYPES = {"image/svg+xml", "application/xhtml+xml", "text/html", "application/xml", "text/xml"}

#: What :meth:`MockCalmLensServerClient.fail_next_request` makes a request fail with:
#: ``transport-error`` (``sdk/transport-error``), ``timeout`` (``sdk/timeout``), an API error code
#: such as ``upload/limit-exceeded`` (that error with its HTTP status) or an exception to raise.
MockFailure = Union[str, BaseException]


def _thumbhash_png(hash_base64: str) -> bytes:
    """The PNG the CDN renders from a ThumbHash for the ``placeholder`` resource
    (``packages/shared/src/PlaceholderHashDecode.ts``)."""
    data = base64.b64decode(hash_base64)

    def at(index: int) -> int:
        return data[index] if index < len(data) else 0
    header24 = at(0) | at(1) << 8 | at(2) << 16
    header16 = at(3) | at(4) << 8
    l_dc, p_dc, q_dc = (header24 & 63) / 63, (header24 >> 6 & 63) / 31.5 - 1, (header24 >> 12 & 63) / 31.5 - 1
    l_scale, has_alpha = (header24 >> 18 & 31) / 31, bool(header24 >> 23)
    p_scale, q_scale, landscape = (header16 >> 3 & 63) / 63, (header16 >> 9 & 63) / 63, bool(header16 >> 15)
    lx = max(3, (5 if has_alpha else 7) if landscape else header16 & 7)
    ly = max(3, header16 & 7 if landscape else (5 if has_alpha else 7))
    a_dc = (at(5) & 15) / 15 if has_alpha else 1.0
    a_scale = (at(5) >> 4) / 15
    ac_start = 6 if has_alpha else 5
    ac_index = 0

    def channel(nx: int, ny: int, scale: float) -> list[float]:
        nonlocal ac_index
        ac = []
        for cy in range(ny):
            cx = 0 if cy else 1
            while cx * ny < nx * (ny - cy):
                ac.append(((at(ac_start + (ac_index >> 1)) >> ((ac_index & 1) << 2) & 15) / 7.5 - 1) * scale)
                ac_index += 1
                cx += 1
        return ac
    l_ac, p_ac, q_ac = channel(lx, ly, l_scale), channel(3, 3, p_scale * 1.25), channel(3, 3, q_scale * 1.25)
    a_ac = channel(5, 5, a_scale) if has_alpha else []
    ratio = ((5 if has_alpha else 7) if landscape else at(3) & 7) / (at(3) & 7 if landscape else (5 if has_alpha else 7))
    width, height = round(32 if ratio > 1 else 32 * ratio), round(32 / ratio if ratio > 1 else 32)

    def terms(n: int) -> list[tuple[int, int]]:
        return [(cx, cy) for cy in range(n) for cx in range(0 if cy else 1, n - cy)]
    rows = []
    for y in range(height):
        row = bytearray([0])  # PNG filter: none
        fy = [math.cos(math.pi / height * (y + 0.5) * cy) for cy in range(max(ly, 5 if has_alpha else 3))]
        for x in range(width):
            fx = [math.cos(math.pi / width * (x + 0.5) * cx) for cx in range(max(lx, 5 if has_alpha else 3))]
            lum, p, q, a = l_dc, p_dc, q_dc, a_dc
            j = 0
            for cy in range(ly):
                cx = 0 if cy else 1
                while cx * ly < lx * (ly - cy):
                    lum += l_ac[j] * fx[cx] * fy[cy] * 2
                    cx, j = cx + 1, j + 1
            for j, (cx, cy) in enumerate(terms(3)):
                f = fx[cx] * fy[cy] * 2
                p, q = p + p_ac[j] * f, q + q_ac[j] * f
            if has_alpha:
                for j, (cx, cy) in enumerate(terms(5)):
                    a += a_ac[j] * fx[cx] * fy[cy] * 2
            b = lum - 2 / 3 * p
            r = (3 * lum - b + q) / 2
            row += bytes(int(max(0.0, 255 * min(1.0, v))) for v in (r, r - q, b, a))
        rows.append(bytes(row))

    def chunk(kind: bytes, body: bytes) -> bytes:
        return len(body).to_bytes(4, "big") + kind + body + zlib.crc32(kind + body).to_bytes(4, "big")
    header = width.to_bytes(4, "big") + height.to_bytes(4, "big") + bytes([8, 6, 0, 0, 0])
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"".join(rows)))
            + chunk(b"IEND", b""))


def _without_placeholder(image: Any) -> Any:
    """Removing content removes the ThumbHash and average colour with it."""
    return {**image, "thumbhash": None, "averageColor": None} if isinstance(image, dict) else image


def _event_asset(asset: Mapping[str, Any]) -> EventAsset:
    """The asset snapshot events carry (getEventAsset in the API)."""
    return {"id": asset["id"], "externalId": asset.get("externalId"), "uploadPresetId": asset.get("uploadPresetId"),
            "upload": {"status": asset["upload"]["status"]},
            "classification": {"status": asset["classification"]["status"],
                               "moderation": {"status": asset["classification"]["moderation"]["status"]}},
            "content": {"status": asset["content"]["status"]}}


def _grants_of(api_key: str) -> list[dict[str, Any]]:
    try:
        raw = api_key.removeprefix("sk_test_")
        grants = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        return grants if isinstance(grants, list) else []
    except (ValueError, TypeError):
        return []


#: An asset ID as the API's schema accepts it: ``asset_`` and 20 base62 characters.
_ASSET_ID_PATTERN = re.compile(r"asset_[0-9A-Za-z]{20}")

_BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def _new_id(prefix: str) -> str:
    """A new ID like the API's: ``prefix``, ``_`` and 20 base62 characters from a CSPRNG (bytes 248
    to 255 are drawn again, so every character is equally likely)."""
    body = ""
    while len(body) < 20:
        body += "".join(_BASE62[byte % 62] for byte in secrets.token_bytes(40) if byte < 248)
    return f"{prefix}_{body[:20]}"


def _invalid_field(code: str, path: str) -> _Failure:
    """A request the API's schema refuses: ``validation/<issue>`` with HTTP 400 and the field."""
    return _Failure(code, f"Invalid {path}", 400, {"path": path})


def _bounded_int(value: Any, path: str, maximum: int) -> int:
    """A query integer from 1 to ``maximum``, refused like the API's schema."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise _invalid_field("validation/invalid-type", path) from None
    if not math.isfinite(number) or number < 1:
        raise _invalid_field("validation/too-small", path)
    if number > maximum:
        raise _invalid_field("validation/too-big", path)
    if not isinstance(value, int):
        raise _invalid_field("validation/invalid-type", path)
    return value


def _code_points(value: str) -> list[int]:
    # Like the database: names compare by code point (UTF-16 code units in JavaScript), so case matters.
    return [ord(char) for char in value]


class MockCalmLensServerClient(CalmLensServerClient):
    """Stateful offline client accepting the real client's configuration (without
    ``transport``). Retries are off by default (``max_retries=0``) so enqueued failures
    surface; pass ``max_retries`` to exercise retry handling. Waits take no real time:
    ``assets.wait_for_decision`` checks ``database_storage`` and returns a decided asset, or
    raises ``sdk/timeout`` at once for one whose moderation stays ``pending``.

    ``assets.search`` is the API's keyword search: every whitespace-separated word (at most 8,
    case-insensitive) must appear in a searchable field, and results carry the API's keyword
    ``score`` and ``matchedFields``, ranked by score and then newest first. List filters support
    ``( … )`` groups, with ``;`` binding tighter than ``,``, and list cursors resume after the last
    item returned and only continue the query they came from."""

    def __init__(self, *, api_key: str | None = None, project_id: str = "mock-project",
                 base_url: str = "https://api.calmlens.invalid/v1",
                 cdn_base_url: str = "https://mock.calmlens.invalid/v1",
                 timeout: float = DEFAULT_TIMEOUT, connect_timeout: float = DEFAULT_CONNECT_TIMEOUT,
                 max_retries: int = 0, mock_options: MockOptions | None = None):
        options: MockOptions = mock_options if mock_options is not None else {}
        unknown = set(options) - _MOCK_OPTIONS
        if unknown:
            raise _invalid("Unknown mock options: " + ", ".join(sorted(unknown)), error_codes.SDK_INVALID_CONFIG)
        super().__init__(api_key=api_key or create_mock_api_key(), project_id=project_id, base_url=base_url,
                         cdn_base_url=cdn_base_url, timeout=timeout, connect_timeout=connect_timeout,
                         max_retries=max_retries, transport=self._serve)
        # The fake API answers multipart size checks in the API's order.
        self._defer_upload_checks = True
        self._state_lock = threading.RLock()
        self._requests: list[MockRequest] = []
        self._errors: list[BaseException] = []
        self._pending_failures: list[tuple[MockFailure, str | None]] = []
        self._grants = _grants_of(self.api_key)
        self._idempotent: dict[str, tuple[str, int, bytes]] = {}
        self._uploads: dict[str, dict[str, Any]] = {}
        self._mock_lenses: dict[str, dict[str, Any]] = {}
        self.database_storage = options.get("database_storage") or InMemoryMockDatabaseStorage()
        if not hasattr(self.database_storage, "events"):
            self.database_storage.events = []
        self.image_storage = options.get("image_storage") or InMemoryMockImageStorage()
        self.create_id: Callable[[str], str] = options.get("create_id", _new_id)
        self.now: Callable[[], int] = options.get("now") or _monotonic_clock()
        self.queued_outcome: MockAssetOutcomeOption = options.get("queued_outcome", "pending")
        self.analyzed_outcome: MockAssetOutcomeOption = options.get("analyzed_outcome", "allowed")
        for outcome in (self.queued_outcome, self.analyzed_outcome):
            if not callable(outcome) and outcome not in _MOCK_OUTCOMES:
                raise _invalid(f"Unknown mock outcome {outcome!r}", error_codes.SDK_INVALID_CONFIG)
        self.signed_url_base_url: str = options.get("signed_url_base_url", "https://mock.calmlens.invalid")
        # Waits (retry backoff, ``assets.wait_for_decision``) take no real time: sleeping only
        # advances this client's clock, so a pending asset times out at once.
        self._elapsed = 0.0
        self._sleep = self._advance
        self._clock = lambda: self._elapsed

    def _advance(self, seconds: float) -> None:
        with self._state_lock:
            self._elapsed += seconds

    @property
    def requests(self) -> list[MockRequest]:
        """Copies of every request received so far, oldest first."""
        with self._state_lock:
            return copy.deepcopy(self._requests)

    def enqueue_error(self, error: BaseException) -> MockCalmLensServerClient:
        """Fail the next request (API call or ``cdn.serve``) with ``error``. Queued errors are
        used in order and leave storage unchanged.

        * A ``CalmLensError`` becomes an HTTP error response: its ``status`` (or the API's
          status for its ``code``), a JSON ``{code, message, details}`` body and a
          ``Retry-After`` header when it has ``retry_after``. The client raises it as the
          real API error would be (``CalmLensAPIError`` with ``request_id`` and headers).
        * Network exceptions are raised by the transport: ``TimeoutError()`` surfaces as
          ``sdk/timeout``; ``ConnectionResetError()``, ``ssl.SSLError()`` or
          ``http.client.IncompleteRead(b"")`` as ``sdk/transport-error``, each with the
          exception as ``__cause__``. Other exceptions propagate unchanged.
        """
        with self._state_lock:
            self._errors.append(error)
        return self

    def fail_next_request(self, failure: MockFailure = "transport-error", *,
                          operation: str | None = None) -> MockCalmLensServerClient:
        """Make the next request (or the next one to ``operation``, a JavaScript-style method path
        such as ``assets.create`` or ``cdn.serve``) fail without running, as if it never
        completed. ``failure`` is ``transport-error`` (``sdk/transport-error``), ``timeout``
        (``sdk/timeout``), an API error code (that error with its HTTP status) or an exception
        to raise. Each queued failure is used once.

        Operations are told apart by their requests, so ``text.classify`` counts as
        ``assets.classify`` and ``ensureLens`` as ``ensureLenses``."""
        if isinstance(failure, str) and failure not in ("transport-error", "timeout") \
                and failure not in error_codes.STATUS_BY_CODE:
            raise _invalid(f"Unknown failure {failure!r}: use transport-error, timeout or an API error code")
        with self._state_lock:
            self._pending_failures.append((failure, operation))
        return self

    def set_api_key_grants(self, grants: list[MockApiKeyGrant]) -> None:
        """Change the grants of the mock's API key, as editing the key in the portal would: later
        requests, such as ``cdn.serve``, use them. The key itself stays the same, so idempotency
        keys it used still replay."""
        with self._state_lock:
            self._grants = copy.deepcopy([dict(grant) for grant in grants])

    def enqueue_event(self, type: EventType, *, facts: list[EventFact] | None = None, severity: EventSeverity = "low",
                      title: str | None = None, description: str | None = None,
                      asset_id: str | None = None) -> Event:
        """Add an event to the feed returned by ``events.list`` (and ``events.iter``).
        ``facts`` are ``{"key", "value", "url"?}`` entries registered for ``type``. When
        ``asset_id`` names a stored asset, the event carries a snapshot of its status, as
        the API's events do."""
        with self._state_lock:
            stored = self.database_storage.assets.get(asset_id) if asset_id else None
            asset = _event_asset(stored) if stored is not None else None
            now = self.now()
            event: Event = {"id": self.create_id("evt"), "projectId": self.project_id, "userId": None, "type": type,
                            "severity": severity, "title": title or type, "description": description,
                            "assetId": asset_id, "asset": asset, "facts": copy.deepcopy(facts or []),
                            "notify": False, "createdAt": now, "updatedAt": now, "readAt": None}
            self.database_storage.events.append(event)
            return copy.deepcopy(event)

    def decide(self, asset_id: str, decision: Literal["allowed", "limited", "age-restricted", "blocked", "purged"]) -> Asset:
        """Apply a reviewer's decision to a stored asset, as the portal or API would: the
        moderation status changes (``purged`` also removes the content, with reason
        ``requested`` and an ``asset.content-removed`` event), the review joins
        ``manualReviews``, and an ``asset.<decision>`` event with a ``decided-by: reviewer`` fact
        joins the events feed. Raises ``asset/not-found`` for an unknown asset."""
        if decision not in _REVIEW_DECISIONS:
            raise _invalid(f"Unknown review decision {decision!r}")
        with self._state_lock:
            asset = self.database_storage.assets.get(asset_id)
            if not asset or asset["projectId"] != self.project_id:
                raise CalmLensError(error_codes.ASSET_NOT_FOUND, "Asset not found",
                                    status=error_codes.STATUS_BY_CODE[error_codes.ASSET_NOT_FOUND])
            record = cast(dict[str, Any], asset)
            self._apply_outcome(record, decision, "requested")
            now = self.now()
            record["classification"]["moderation"].setdefault("manualReviews", []).append(
                {"id": self.create_id("rev"), "decision": decision, "note": None, "reviewerUserId": None,
                 "reviewedAt": now, "appliedToAsset": True})
            if decision == "purged":
                self._lifecycle_event("asset.content-removed", record)
            # Like the event catalog: only allowing and limiting are low severity.
            self.enqueue_event("asset." + decision, asset_id=asset_id,
                               severity="low" if decision in ("allowed", "limited") else "high",
                               facts=[{"key": "decided-by", "value": "reviewer"},
                                      {"key": "asset-type", "value": record["type"]},
                                      {"key": "asset-name", "value": record["name"],
                                       "url": f"https://calmlens.com/go/asset/{record['id']}"},
                                      {"key": "note", "value": None}])
            return copy.deepcopy(asset)

    def _lifecycle_event(self, type: str, asset: Mapping[str, Any]) -> None:
        """An ``asset.deleted``, ``asset.content-removed`` or ``asset.retried`` event, like the API."""
        name: dict[str, Any] = {"key": "asset-name", "value": asset["name"]}
        if type != "asset.deleted":  # A deleted asset has no portal page to link to.
            name["url"] = f"https://calmlens.com/go/asset/{asset['id']}"
        self.enqueue_event(type, asset_id=asset["id"],
                           facts=cast(list[EventFact], [name, {"key": "asset-type", "value": asset["type"]}]))
        if type == "asset.deleted":
            # The asset is gone, so the snapshot comes from the record just deleted.
            self.database_storage.events[-1]["asset"] = _event_asset(asset)

    # Transport -------------------------------------------------------------------------

    def _respond(self, status: int, payload: Any = None, headers: Mapping[str, str] | None = None,
                 body: bytes | None = None) -> _Response:
        sent = {"X-Request-Id": "req_mock_" + uuid.uuid4().hex[:16], **(headers or {})}
        if body is None:
            body = b"" if payload is None else _json(payload).encode("utf-8")
            if payload is not None:
                sent.setdefault("Content-Type", "application/json")
        sent.setdefault("Content-Length", str(len(body)))
        return _Response(body, status, sent)

    def _failure_response(self, failure: _Failure | CalmLensError, retry_after: float | None = None) -> _Response:
        status = failure.status or error_codes.STATUS_BY_CODE.get(failure.code, 400)
        headers = {"Retry-After": str(int(retry_after))} if retry_after is not None else {}
        body: dict[str, Any] = {"code": failure.code, "message": failure.message or failure.code}
        if failure.details:
            body["details"] = failure.details
        return self._respond(status, body, headers)

    @staticmethod
    def _operation(method: str, parts: list[str], query: Mapping[str, Any], upload: str, cdn: bool) -> str:
        """The JavaScript client method a request comes from, for ``fail_next_request``."""
        if cdn:
            return "cdn.serve"
        if parts[0] == "projects":
            resource = parts[2] if len(parts) > 2 else ""
            suffix = parts[3] if len(parts) > 3 else ""
            if resource == "assets":
                if suffix:
                    return {"search": "assets.search", "page": "assets.list"}.get(suffix, "assets." + suffix)
                return "assets.create" if query.get("queue") else "assets.classify"
            if resource == "folders":
                return "folders.list" if method == "GET" else "folders.create"
            if resource == "hash-lists":
                return "hashLists.list" if method == "GET" else "hashLists.create"
            return {"events": "events.list", "lenses": "ensureLenses"}.get(resource, resource)
        resource = parts[0]
        suffix = parts[2] if len(parts) > 2 else ""
        if resource == "hash-list-entries":
            return "hashLists.removeEntry"
        if resource == "hash-lists":
            if suffix == "entries":
                return "hashLists.listEntries" if method == "GET" else "hashLists.addEntry"
            return "hashLists." + {"GET": "retrieve", "PATCH": "update", "DELETE": "delete"}.get(method, method.lower())
        if suffix:
            return {"children": "assets.listChildren", "part": "assets.uploadPart", "signed-url": "assets.createSignedUrl",
                    "content": "assets.deleteContent"}.get(suffix, f"{resource}.{suffix}")
        return f"{resource}." + {"GET": "retrieve", "PATCH": "update", "DELETE": "delete"}.get(method, method.lower())

    def _serve(self, request: Request, timeout: float) -> _Response:
        data: Any = request.data
        raw: bytes | None = data.read() if hasattr(data, "read") else data
        headers = dict(request.header_items())
        cdn = request.full_url.startswith(self.cdn_base_url + "/")
        relative = request.full_url.removeprefix(self.cdn_base_url if cdn else self.base_url)
        url = urlsplit(relative)
        query = _decode_query(parse_qsl(url.query, keep_blank_values=True))
        content_type = next((v for k, v in headers.items() if k.lower() == "content-type"), "")
        upload = next((v for k, v in headers.items() if k.lower() == "x-calmlens-upload"), "")
        body: Any = raw
        if raw is not None and content_type == "application/json":
            body = json.loads(raw)
        parts = [unquote(p) for p in url.path.strip("/").split("/")]
        operation = self._operation(request.get_method(), parts, query, upload, cdn)
        with self._state_lock:
            self._requests.append(MockRequest(method=request.get_method(), url=request.full_url, path=url.path,
                                              query=copy.deepcopy(query), body=copy.deepcopy(body),
                                              headers=copy.deepcopy(headers)))
            error = self._errors.pop(0) if self._errors else None
            failure: MockFailure | None = None
            if error is None:
                index = next((i for i, (_, target) in enumerate(self._pending_failures)
                              if target is None or target == operation), None)
                if index is not None:
                    failure = self._pending_failures.pop(index)[0]
        if isinstance(error, CalmLensError):
            return self._failure_response(error, error.retry_after)
        if error is not None:
            raise error
        if failure == "transport-error":
            raise ConnectionResetError("Simulated network failure")
        if failure == "timeout":
            raise TimeoutError("The operation timed out.")
        if isinstance(failure, str):
            return self._failure_response(_Failure(failure))
        if failure is not None:
            raise failure
        if cdn:
            return self._serve_cdn(request.get_method(), url.path, query)
        key = next((v for k, v in headers.items() if k.lower() == "idempotency-key"), None)
        if key is not None:
            # HTTP stacks trim header values, so the API sees the key without surrounding whitespace.
            key = key.strip(" \t\r\n")
        # Like the API: raw uploads are told apart by their query, type and length, not their bytes.
        fingerprint = _json([request.get_method(), url.path, sorted(([k, v] for k, v in query.items()), key=str),
                             content_type, upload, len(raw or b"") if upload else body])
        with self._state_lock:
            if key is not None:
                if not _IDEMPOTENCY_KEY.fullmatch(key):
                    return self._failure_response(_Failure(error_codes.INVALID_IDEMPOTENCY_KEY))
                saved = self._idempotent.get(key)
                if saved is not None:
                    if saved[0] != fingerprint:
                        return self._failure_response(_Failure(error_codes.IDEMPOTENCY_KEY_REUSED))
                    return self._respond(saved[1], body=saved[2], headers={
                        "Idempotent-Replayed": "true", "Content-Type": "application/json"})
            try:
                result = copy.deepcopy(self._dispatch(request.get_method(), parts, query,
                                                      body if isinstance(body, dict) else {}, raw, upload))
            except _Failure as failure_response:
                # A failed request frees its idempotency key.
                return self._failure_response(failure_response)
            # Like the API: a new folder or hash list is 201 Created, a queued batch 202 Accepted,
            # and deletes answer 200 with an empty object.
            status = {"folders.create": 201, "hashLists.create": 201, "assets.batch": 202}.get(operation, 200)
            if isinstance(result, _Answer):
                status, result = result.status, result.body
            response = self._respond(status, {} if result is None else result)
            if key is not None:
                self._idempotent[key] = (fingerprint, response.status, response.getvalue())
            return response

    # Fake API ----------------------------------------------------------------------------

    # The fake edits stored records as plain dicts.
    def _folder(self, folder_id: str) -> dict[str, Any]:
        folder = self.database_storage.folders.get(folder_id)
        if not folder or folder["projectId"] != self.project_id:
            raise _Failure(error_codes.FOLDER_NOT_FOUND)
        return cast(dict[str, Any], folder)

    def _asset(self, asset_id: str) -> dict[str, Any]:
        asset = self.database_storage.assets.get(asset_id)
        if not asset or asset["projectId"] != self.project_id:
            raise _Failure(error_codes.ASSET_NOT_FOUND)
        return cast(dict[str, Any], asset)

    def _unique(self, name: str, parent_id: str | None, exclude: str | None = None) -> None:
        for folder in self.database_storage.folders.values():
            if folder["projectId"] == self.project_id and folder["id"] != exclude and folder["name"] == name \
                    and folder.get("parentId") == parent_id:
                raise _Failure(error_codes.DUPLICATE_FOLDER_NAME,
                               f'A folder named "{name}" already exists in this location.')

    def _project_assets(self) -> list[dict[str, Any]]:
        return [cast(dict[str, Any], a) for a in self.database_storage.assets.values()
                if a["projectId"] == self.project_id]

    def _project_folders(self) -> list[dict[str, Any]]:
        return [cast(dict[str, Any], f) for f in self.database_storage.folders.values()
                if f["projectId"] == self.project_id]

    def _dispatch(self, method: str, parts: list[str], query: dict[str, Any], body: dict[str, Any],
                  raw: bytes | None, upload: str) -> Any:
        if parts[0] == "projects":
            if parts[1] != self.project_id:
                raise _Failure(error_codes.PROJECT_NOT_FOUND)
            return self._dispatch_project(method, parts[2:], query, body, raw, upload)
        resource, identifier = parts[0], parts[1]
        suffix = parts[2] if len(parts) > 2 else ""
        if resource == "assets":
            return self._dispatch_asset(method, identifier, suffix, query, body, raw)
        if resource == "hash-lists":
            return self._dispatch_hash_list(method, identifier, suffix, query, body)
        if resource == "hash-list-entries":
            if method != "DELETE" or suffix:
                raise _Failure("not-found", f"No route for {method} /{'/'.join(parts)}", 404)
            entry = self.database_storage.hash_list_entries.get(identifier)
            if not entry or entry["projectId"] != self.project_id:
                raise _Failure(error_codes.HASH_LIST_ENTRY_NOT_FOUND)
            del self.database_storage.hash_list_entries[identifier]
            return None
        return self._dispatch_folder(method, identifier, suffix, body)

    def _dispatch_project(self, method: str, parts: list[str], query: dict[str, Any], body: dict[str, Any],
                          raw: bytes | None, upload: str) -> Any:
        now = self.now()
        resource = parts[0]
        if resource == "events":
            return self._events(query)
        if resource == "lenses":
            return self._lenses_put(body, now)
        if resource == "folders":
            if method == "GET":
                return self._folders_list(query)
            if body.get("parentId"):
                self._folder(body["parentId"])
            self._unique(body["name"], body.get("parentId"))
            folder = {"id": self.create_id("fldr"), "projectId": self.project_id, "parentId": body.get("parentId"),
                      "name": body["name"], "createdAt": now, "updatedAt": now}
            self.database_storage.folders[folder["id"]] = cast(Folder, folder)
            return folder
        if resource == "hash-lists":
            if method == "GET":
                lists = [h for h in self.database_storage.hash_lists.values() if h["projectId"] == self.project_id]
                return {"items": sorted(lists, key=lambda h: (h["createdAt"], _code_points(h["id"])), reverse=True)}
            return self._create_hash_list(body, now)
        suffix = parts[1] if len(parts) > 1 else ""
        if suffix == "batch":
            return self._batch(body, now)
        if suffix == "search":
            return self._search(query)
        if suffix == "page":
            items = self._project_assets()
            if "folderId" in query:
                items = [a for a in items if a.get("folderId") == query["folderId"]]
            return self._page(items, query, [self.project_id, query.get("filter"), query.get("folderId")])
        return self._create_asset(upload, query, body, raw, now)

    def _folders_list(self, query: dict[str, Any]) -> dict[str, Any]:
        everything = self._project_folders()
        size = _bounded_int(query.get("pageSize", _MAX_FOLDER_PAGE_SIZE), "pageSize", _MAX_FOLDER_PAGE_SIZE)
        search = query.get("search")
        found = [f for f in everything
                 if ((query.get("searchAll") and search) or f.get("parentId") == query.get("parentId"))
                 and (not search or str(search).lower() in f["name"].lower())]
        by_created = query.get("sort") == "createdAt"
        found.sort(key=lambda f: (f["createdAt"] if by_created else _code_points(f["name"]), _code_points(f["id"])),
                   reverse=query.get("direction") == "DESC")
        start = query.get("pageIndex", 0) * size
        page = [] if query.get("resolveOnly") else found[start:start + size]
        ids = list(dict.fromkeys([*(query.get("ids") or []), *([query["parentId"]] if query.get("parentId") else []),
                                  *(f["id"] for f in page)]))
        by_id = {f["id"]: f for f in everything}
        for identifier in ids:  # Grows while it runs, adding each ancestor.
            parent = by_id.get(identifier, {}).get("parentId")
            if parent and parent not in ids:
                ids.append(parent)
        page_ids = {f["id"] for f in page}
        return {"folders": page, "ancestors": [f for f in everything if f["id"] in ids and f["id"] not in page_ids],
                "hasMore": not query.get("resolveOnly", False) and len(found) > start + size}

    def _create_asset(self, upload: str, query: dict[str, Any], body: dict[str, Any], raw: bytes | None,
                      now: int) -> dict[str, Any]:
        # The X-CalmLens-Upload header picks the mode: absent is a JSON body, "content" raw
        # file content and "part" the raw first part of a multipart upload.
        raw_upload = upload in ("content", "part")
        multipart = upload == "part"
        options = query if raw_upload else body
        mime = options.get("contentType", "")
        kind = "website" if "url" in options else next(
            (k for k in ("image", "video", "audio") if mime.startswith(k + "/")),
            "plaintext-document" if mime.startswith("text/") else
            "multimedia-document" if "pdf" in mime or "document" in mime else "file")
        total = query.get("totalSizeInBytes")
        size = len(raw or b"") if raw_upload else None
        final = not multipart or bool(query.get("isFinal"))
        if multipart:
            # Like the API, a declared total is checked before anything is stored, then a single
            # final part is checked as the whole upload.
            failure = (self._image_size_error(kind, total, True) if total is not None else None) or (
                (self._total_size_error(total, cast(int, size), True) or self._image_size_error(kind, cast(int, size), True))
                if final else self._total_size_error(total, cast(int, size), False))
            if failure:
                raise _Failure(failure)
        if options.get("folderId"):
            self._folder(options["folderId"])
        external_id = options.get("externalId")
        if external_id and any(a.get("externalId") == external_id for a in self._project_assets()):
            raise _Failure(error_codes.DUPLICATE_EXTERNAL_ID)
        queue = bool(query.get("queue"))
        processing_options = options.get("processingOptions")
        if not isinstance(processing_options, dict):
            processing_options = {"keepContentAfterProcessing": False}
        keep = processing_options.get("keepContentAfterProcessing") is True
        context = options.get("context")
        context_items = select_moderation_context_items(
            context["items"] if isinstance(context, dict) and isinstance(context.get("items"), list) else [])
        # Fields the API returns as null when they are not set.
        asset: dict[str, Any] = {
            "id": self.create_id("asset"), "projectId": self.project_id, "userId": None, "parentId": None,
            "folderId": options.get("folderId"), "uploadPresetId": options.get("uploadPresetId"),
            "createdAt": now, "updatedAt": now, "name": options.get("name"), "description": options.get("description"),
            "externalId": external_id, "externalUrl": options.get("url", options.get("externalUrl")), "type": kind,
            "metadata": options.get("metadata"), "authorId": options.get("authorId"),
            # Like the API, only the posts CalmLens uses are kept, and only while the content is held.
            "context": {"items": context_items} if context_items else None,
            "tags": None, "processingOptions": processing_options,
            "visibility": options.get("visibility", "private"),
            "content": {"status": "stored" if keep else "temporary", "removalReason": None, "updatedAt": now,
                        "safetyHold": None, "format": mime or None, "extension": None, "sizeInBytes": size,
                        "checksums": None, "image": None, "extractedText": None},
            "upload": {"status": "completed" if final else "uploading", "updatedAt": now,
                       "partsReceived": None if final else 1},
            "classification": {"status": "processing" if final else "pending", "updatedAt": now, "completedAt": None,
                               "moderation": {"status": "pending", "manualReviews": []}},
        }
        if not final:
            self._uploads[asset["id"]] = {"queue": queue, "total": total}
        self.database_storage.assets[asset["id"]] = cast(Asset, asset)
        if raw_upload and raw is not None:
            self.image_storage.content[asset["id"]] = {"type": mime, "parts": {1: raw}}
        if final:
            self._apply_outcome(asset, self._outcome_for(asset, queue))
        return asset

    @staticmethod
    def _image_size_error(kind: str, size: int, final: bool) -> str | None:
        """Like the API: image uploads in parts total 10 MiB (checked at the last part) to 20 MiB."""
        if kind != "image":
            return None
        if size > 20 * _MIB:
            return error_codes.MULTIPART_IMAGE_TOO_LARGE
        return error_codes.MULTIPART_IMAGE_TOO_SMALL if final and size < 10 * _MIB else None

    @staticmethod
    def _total_size_error(total: int | None, received: int, final: bool) -> str | None:
        """Like the API: the parts may not overshoot a declared total, and must reach it at the end."""
        if total is None:
            return None
        return error_codes.UPLOAD_SIZE_MISMATCH if received > total or (final and received != total) else None

    def _outcome_for(self, asset: dict[str, Any], queue: bool) -> str:
        outcome: Any = self.queued_outcome if queue else self.analyzed_outcome
        return str(outcome(cast(Asset, copy.deepcopy(asset))) if callable(outcome) else outcome)

    def _apply_outcome(self, asset: dict[str, Any], outcome: str, purge_reason: str = "policy") -> None:
        """Move ``asset`` to ``outcome`` like the pipeline would: a decision finishes processing,
        ``purged`` deletes the content (``purge_reason``: ``policy`` for the pipeline, ``requested``
        for a reviewer), and finished processing removes content kept only temporarily. A classified
        image gets a ThumbHash for its placeholder, which goes with removed content."""
        now = self.now()
        decided = outcome not in ("pending", "failed")
        status = "completed" if decided else "failed" if outcome == "failed" else "processing"
        content = asset["content"]
        purge = outcome == "purged" and content["status"] != "removed"
        remove = purge or (status == "completed" and content["status"] == "temporary")
        if decided and asset["type"] == "image" and content["status"] != "removed" and not purge:
            content["image"] = {"width": None, "height": None, "perceptualHash": None,
                                "perceptualHashQuality": None, **(content.get("image") or {}),
                                "thumbhash": _MOCK_THUMBHASH,
                                "averageColor": (content.get("image") or {}).get("averageColor") or "#7f7f7f"}
        elif outcome == "purged":
            content["image"] = _without_placeholder(content.get("image"))
        if remove:
            self.image_storage.content.pop(asset["id"], None)
            content.update(status="removed", removalReason=purge_reason if purge else "retention", updatedAt=now,
                           extractedText=None, image=_without_placeholder(content.get("image")))
            asset["context"] = None
        asset["classification"].update(status=status, updatedAt=now, completedAt=now if decided else None)
        asset["classification"]["moderation"].update(status=outcome if decided else "pending")
        asset["upload"].update(status="completed", updatedAt=now)
        asset["updatedAt"] = now

    def _upload_part(self, asset: dict[str, Any], query: dict[str, Any], raw: bytes | None, now: int) -> None:
        # In the API's order: the upload must be open, parts arrive in order, image totals and the
        # declared total are checked, then the part itself.
        upload = self._uploads.get(asset["id"])
        if upload is None or asset["upload"]["status"] != "uploading":
            raise _Failure(error_codes.UPLOAD_NOT_OPEN)
        expected = (asset["upload"].get("partsReceived") or 0) + 1
        number = query.get("partNumber")
        if number != expected:
            raise _Failure(error_codes.INVALID_UPLOAD_PART_NUMBER, f"Expected part {expected}",
                           details={"expectedPartNumber": expected, "receivedPartNumber": number})
        final = bool(query.get("isFinal"))
        received = (asset["content"].get("sizeInBytes") or 0) + len(raw or b"")
        failure = (self._image_size_error(asset["type"], received, final)
                   or self._total_size_error(upload["total"], received, final))
        if failure:
            raise _Failure(failure)
        if not final and len(raw or b"") < 5 * _MIB:
            raise _Failure(error_codes.INVALID_UPLOAD_PAYLOAD, "Multipart upload parts must be at least 5MiB except "
                                                               "the final part.")
        self.image_storage.content[asset["id"]]["parts"][number] = raw or b""
        asset["content"]["sizeInBytes"] = received
        # Like the API, a completed upload no longer counts parts.
        asset["upload"].update(updatedAt=now, partsReceived=None if final else number)
        asset["updatedAt"] = now
        if final:
            queue = query["queue"] if "queue" in query else upload["queue"]
            del self._uploads[asset["id"]]
            self._apply_outcome(asset, self._outcome_for(asset, queue))

    def _dispatch_asset(self, method: str, identifier: str, suffix: str, query: dict[str, Any],
                        body: dict[str, Any], raw: bytes | None) -> Any:
        assets = self.database_storage.assets
        now = self.now()
        asset = self._asset(identifier)
        if method == "DELETE":
            if suffix == "content":
                return self._delete_content(asset, now)
            self.image_storage.content.pop(identifier, None)
            del assets[identifier]
            self._uploads.pop(identifier, None)
            self._lifecycle_event("asset.deleted", asset)
            return None
        if method == "GET":
            if suffix == "children":
                return self._page([a for a in self._project_assets() if a.get("parentId") == identifier], query,
                                  identifier)
            return asset
        if suffix == "signed-url":
            expires = body["expiresInSeconds"]
            selector = "".join(f"&{k}={quote(str(body[k]), safe='')}" for k in ("lens", "transform") if body.get(k))
            return {"url": f"{self.signed_url_base_url}/assets/{identifier}/{body.get('resource', 'rendered')}"
                           f"?expiresInSeconds={expires}{selector}",
                    "expiresAt": now + expires * 1000}
        if suffix == "retry":
            if asset["classification"]["status"] != "failed" or \
                    asset["classification"]["moderation"]["status"] != "pending":
                raise _Failure(error_codes.ASSET_NOT_RETRYABLE)
            if asset["content"]["status"] == "removed":
                raise _Failure(error_codes.ASSET_CONTENT_UNAVAILABLE)
            # Like the API: back to processing, to be moderated again, with an asset.retried event.
            self._apply_outcome(asset, "pending")
            self._lifecycle_event("asset.retried", asset)
            return asset
        if suffix == "explain":
            if asset["classification"]["status"] != "completed":
                raise _Failure(error_codes.ASSET_NOT_DECIDED)
            moderation = asset["classification"]["moderation"]
            if not body.get("rerun"):
                # Like the API: the evidence is completed and every action stays as decided.
                policy = moderation.get("policy")
                if policy and policy.get("evidence") == "decision":
                    policy["evidence"] = "full"
                    asset["updatedAt"] = now
                return asset
            if moderation.get("manualReviews"):
                raise _Failure(error_codes.ASSET_REVIEWED)
            if asset["content"]["status"] == "removed":
                raise _Failure(error_codes.ASSET_CONTENT_UNAVAILABLE)
            # Like the API: back to processing, to be moderated again under the current policy.
            self._apply_outcome(asset, "pending")
            return asset
        if suffix == "move":
            if body["folderId"]:
                self._folder(body["folderId"])
            asset["folderId"] = body["folderId"]
        elif suffix == "part":
            self._upload_part(asset, query, raw, now)
            return asset
        elif method == "PATCH":
            # Like the API: an externalId stays unique in the project; null clears a field.
            if body.get("externalId") and any(other["id"] != identifier and other.get("externalId") == body["externalId"]
                                              for other in self._project_assets()):
                raise _Failure(error_codes.DUPLICATE_EXTERNAL_ID)
            asset.update(body)
        asset["updatedAt"] = now
        return asset

    def _batch(self, body: dict[str, Any], now: int) -> dict[str, Any]:
        """``POST /projects/:id/assets/batch``: the schema needs 1 to 500 asset IDs and a known operation, and
        every asset must exist before anything changes. The mock then applies the operation at once, in
        request order, instead of in the background: ``delete`` deletes each asset with its stored child
        assets and records ``asset.deleted`` with the asset as it was; ``remove-content`` removes the
        content like ``delete_content``. Mock assets carry no safety holds, so none is skipped."""
        asset_ids = body.get("assetIds")
        if not isinstance(asset_ids, list):
            raise _invalid_field("validation/invalid-type", "assetIds")
        if not asset_ids:
            raise _invalid_field("validation/too-small", "assetIds")
        if len(asset_ids) > 500:
            raise _invalid_field("validation/too-big", "assetIds")
        for index, asset_id in enumerate(asset_ids):
            if not isinstance(asset_id, str) or not _ASSET_ID_PATTERN.fullmatch(asset_id):
                raise _invalid_field("validation/invalid-format", f"assetIds.{index}")
        operation = body.get("operation")
        if operation not in ("delete", "remove-content"):
            raise _invalid_field("validation/invalid-value", "operation")
        assets = [self._asset(asset_id) for asset_id in dict.fromkeys(asset_ids)]
        for asset in assets:
            if operation == "remove-content":
                self._delete_content(asset, now)
                continue
            deleting = {asset["id"]}
            added = True
            while added:
                added = False
                for other in self._project_assets():
                    if other.get("parentId") in deleting and other["id"] not in deleting:
                        deleting.add(other["id"])
                        added = True
            for asset_id in deleting:
                self.image_storage.content.pop(asset_id, None)
                self.database_storage.assets.pop(asset_id, None)
                self._uploads.pop(asset_id, None)
            self._lifecycle_event("asset.deleted", asset)
        return {"queued": True}

    def _delete_content(self, asset: dict[str, Any], now: int) -> dict[str, Any]:
        # Like the API: the record and report stay; stored content, extracted text and the
        # placeholder go. Content already removed keeps its reason, and an asset.content-removed
        # event is recorded either way.
        self.image_storage.content.pop(asset["id"], None)
        content = asset["content"]
        if content["status"] == "removed":
            content["image"] = _without_placeholder(content.get("image"))
        else:
            content.update(status="removed", removalReason="requested", updatedAt=now, extractedText=None,
                           image=_without_placeholder(content.get("image")))
            asset["context"] = None
            asset["updatedAt"] = now
        self._lifecycle_event("asset.content-removed", asset)
        return asset

    def _dispatch_folder(self, method: str, identifier: str, suffix: str, body: dict[str, Any]) -> Any:
        folders = self.database_storage.folders
        folder = self._folder(identifier)
        if method == "GET":
            return folder
        if method == "DELETE":
            has_assets = any(a.get("folderId") == identifier for a in self._project_assets())
            has_children = any(f.get("parentId") == identifier for f in self._project_folders())
            if has_assets or has_children:
                raise _Failure(error_codes.FOLDER_NOT_EMPTY,
                               details={"hasAssets": has_assets, "hasChildren": has_children})
            del folders[identifier]
            return None
        if suffix == "move":
            parent = body["parentId"]
            current, visited = parent, set()
            while current:
                if current == identifier or current in visited:
                    raise _Failure(error_codes.FOLDER_PARENT_CYCLE)
                visited.add(current)
                current = self._folder(current).get("parentId")
            if parent != folder.get("parentId"):
                self._unique(folder["name"], parent, identifier)
            folder["parentId"] = parent
        elif "name" in body and body["name"] != folder["name"]:
            self._unique(body["name"], folder.get("parentId"), identifier)
            folder["name"] = body["name"]
        folder["updatedAt"] = self.now()
        return folder

    # Hash lists: kept in memory for the mock's lifetime. Uploads aren't matched against them.

    def _hash_list(self, hash_list_id: str) -> dict[str, Any]:
        hash_list = self.database_storage.hash_lists.get(hash_list_id)
        if not hash_list or hash_list["projectId"] != self.project_id:
            raise _Failure(error_codes.HASH_LIST_NOT_FOUND)
        return cast(dict[str, Any], hash_list)

    def _create_hash_list(self, body: dict[str, Any], now: int) -> dict[str, Any]:
        name, description, action = body.get("name"), body.get("description"), body.get("action")
        if not isinstance(name, str) or not name.strip() or action not in _HASH_LIST_ACTIONS:
            raise _Failure(error_codes.INVALID_UPLOAD_PAYLOAD, "A hash list needs a name and an action of flag or block")
        hash_list = {"id": self.create_id("hl"), "projectId": self.project_id, "name": name.strip(),
                     "description": description if isinstance(description, str) else None, "action": action,
                     "createdByUserId": None, "createdAt": now, "updatedAt": now}
        self.database_storage.hash_lists[hash_list["id"]] = cast(HashList, hash_list)
        return hash_list

    def _dispatch_hash_list(self, method: str, identifier: str, suffix: str, query: dict[str, Any],
                            body: dict[str, Any]) -> Any:
        hash_list = self._hash_list(identifier)
        entries = self.database_storage.hash_list_entries
        if suffix == "entries":
            if method == "GET":
                items = [cast(dict[str, Any], e) for e in entries.values() if e["hashListId"] == identifier]
                return self._page(items, query, [identifier])
            return self._add_hash_list_entry(hash_list, body)
        if method == "GET":
            return hash_list
        if method == "DELETE":
            del self.database_storage.hash_lists[identifier]
            for entry_id in [i for i, e in entries.items() if e["hashListId"] == identifier]:
                del entries[entry_id]
            return None
        if isinstance(body.get("name"), str):
            hash_list["name"] = body["name"].strip()
        if "description" in body:
            hash_list["description"] = body["description"]
        if body.get("action") in _HASH_LIST_ACTIONS:
            hash_list["action"] = body["action"]
        hash_list["updatedAt"] = self.now()
        return hash_list

    def _add_hash_list_entry(self, hash_list: dict[str, Any], body: dict[str, Any]) -> Any:
        """Like the API: a new entry is 201 Created; a hash already in the list answers 200 with
        its entry. ``assetId`` takes the asset's perceptual hash and its quality."""
        hash_value = body["hash"].strip().lower() if isinstance(body.get("hash"), str) else None
        quality = body.get("quality")
        quality = quality if isinstance(quality, int) and not isinstance(quality, bool) else None
        asset_id = body.get("assetId") if isinstance(body.get("assetId"), str) else None
        if (hash_value is None) == (asset_id is None):
            raise _Failure(error_codes.INVALID_UPLOAD_PAYLOAD, "Send either hash or assetId")
        if asset_id is not None:
            image = self._asset(asset_id)["content"].get("image") or {}
            if not image.get("perceptualHash"):
                raise _Failure(error_codes.HASH_LIST_ASSET_NOT_HASHED)
            hash_value, quality = image["perceptualHash"], image.get("perceptualHashQuality")
        if not _PDQ_HASH.fullmatch(cast(str, hash_value)):
            raise _Failure(error_codes.INVALID_UPLOAD_PAYLOAD, "Use a PDQ hash of 64 hexadecimal characters")
        entries = self.database_storage.hash_list_entries
        existing = next((e for e in entries.values() if e["hashListId"] == hash_list["id"] and e["hash"] == hash_value),
                        None)
        if existing is not None:
            return existing
        entry = {"id": self.create_id("hle"), "projectId": self.project_id, "hashListId": hash_list["id"],
                 "hash": hash_value, "quality": quality,
                 "label": body["label"] if isinstance(body.get("label"), str) else None,
                 "sourceAssetId": asset_id, "createdByUserId": None, "createdAt": self.now()}
        entries[entry["id"]] = cast(HashListEntry, entry)
        return _Answer(201, entry)

    def _lenses_put(self, body: dict[str, Any], now: int) -> dict[str, Any]:
        # Each definition is saved in turn, so earlier ones stay saved when a later one conflicts.
        result = []
        for definition in body["lenses"]:
            old = self._mock_lenses.get(definition["identifier"])
            if old is None:
                lens = {"id": self.create_id("lens"), "projectId": self.project_id, "userId": None, **definition,
                        "createdAt": now, "updatedAt": now}
            elif all(old.get(k) == definition.get(k) for k in ("name", "description", "type", "active",
                                                                  "transforms", "version")):
                lens = old
            elif definition["version"] > old["version"]:
                lens = {**old, **definition, "updatedAt": now}
            else:
                raise _Failure(error_codes.LENS_VERSION_CONFLICT, details={
                    "currentVersion": old["version"], "minimumVersion": old["version"] + 1,
                    "requestedVersion": definition["version"]})
            self._mock_lenses[lens["identifier"]] = lens
            result.append(copy.deepcopy(lens))
        return {"lenses": result}

    def _events(self, query: dict[str, Any]) -> dict[str, Any]:
        # Cursors are positions in the feed (``mock_<n>``), so events added later reach cursors
        # taken before them.
        limit = _bounded_int(query.get("limit", _DEFAULT_EVENTS_LIMIT), "limit", _MAX_EVENTS_LIMIT)
        events = [e for e in self.database_storage.events if e["projectId"] == self.project_id]
        after = query.get("after")
        if not after:
            return {"events": [], "cursor": f"mock_{len(events)}", "hasMore": False}
        found = re.fullmatch(r"mock_([0-9]+)", str(after))
        if not found or int(found.group(1)) > len(events):
            raise _Failure(error_codes.INVALID_EVENT_CURSOR, details={"after": after})
        position = int(found.group(1))
        page = events[position:position + limit]
        following = position + len(page)
        return {"events": page, "cursor": f"mock_{following}", "hasMore": following < len(events)}

    def _search(self, query: dict[str, Any]) -> dict[str, Any]:
        # Keyword search like the API's; the mock has no semantic index, so every mode is
        # keyword matching. Like the API's query schema: a trimmed query of 1 to 200 characters
        # and a limit of 1 to 20.
        text = str(query.get("query", "")).strip()
        if not text:
            raise _invalid_field("validation/too-small", "query")
        if len(text) > _MAX_SEARCH_QUERY_LENGTH:
            raise _invalid_field("validation/too-big", "query")
        limit = _bounded_int(query.get("limit", 10), "limit", _MAX_SEARCH_LIMIT)
        normalized = text.lower()
        tokens = list(dict.fromkeys(normalized.split()))[:_MAX_SEARCH_TOKENS]
        items: list[dict[str, Any]] = []
        for asset in self._project_assets():
            content = asset.get("content") or {}
            fields = {
                "name": asset.get("name"), "id": asset.get("id"), "externalId": asset.get("externalId"),
                "description": asset.get("description"), "tags": " ".join(asset.get("tags") or []),
                "type": asset.get("type"), "content.format": content.get("format"),
                "content.extension": content.get("extension"),
                "classification.moderation.status": asset["classification"]["moderation"].get("status"),
            }
            values = {name: str(value or "").lower() for name, value in fields.items()}
            if not all(any(token in value for value in values.values()) for token in tokens):
                continue
            matched = [name for name, value in values.items() if any(token in value for token in tokens)]
            items.append({"asset": asset, "score": _keyword_score(values, normalized), "matchedFields": matched})
        items.sort(key=lambda item: (-item["score"], -item["asset"]["createdAt"]))
        return {"query": text, "items": items[:limit], "semanticStatus": "disabled"}

    @staticmethod
    def _page(items: list[dict[str, Any]], query: dict[str, Any], scope: Any) -> dict[str, Any]:
        """One keyset page like the API's: ordered by ``createdAt`` and ``id`` (an ``id``
        tie-breaker is added), after the cursor's values. The cursor is tied to ``scope`` (the
        filter, folder or parent) and the ordering, so it only continues the query it came from."""
        size = _bounded_int(query.get("pageSize", 10), "pageSize", 100)
        if query.get("filter"):
            matches = _rsql(query["filter"])
            items = [item for item in items if matches(item)]
        ordering = [dict(order) for order in query.get("ordering") or [{"field": "createdAt", "direction": "DESC"}]]
        if any(o.get("field") not in ("createdAt", "id") for o in ordering):
            raise _Failure(error_codes.INVALID_UPLOAD_PAYLOAD, "Invalid ordering")
        if not any(o["field"] == "id" for o in ordering):
            ordering.append({"field": "id", "direction": ordering[0]["direction"]})
        signature = _json([scope, ordering])
        for order in reversed(ordering):
            field_name = str(order["field"])
            items = sorted(items, key=lambda item: cast(Any, item[field_name]),
                           reverse=str(order.get("direction", "ASC")).upper() == "DESC")
        if query.get("cursor"):
            try:
                decoded = json.loads(base64.b64decode(query["cursor"], validate=True).decode("utf-8"))
                values = decoded.get("values") if isinstance(decoded, dict) else None
                if decoded.get("scope") != signature or not isinstance(values, list) or len(values) != len(ordering) \
                        or any(not isinstance(value, str) if o["field"] == "id" else
                               isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                               for o, value in zip(ordering, values)):
                    raise ValueError("Invalid cursor")
            except (ValueError, TypeError, AttributeError):
                raise _Failure(error_codes.INVALID_CURSOR) from None

            def follows(item: dict[str, Any]) -> bool:
                for order, boundary in zip(ordering, values):
                    if item[order["field"]] != boundary:
                        return bool(item[order["field"]] < boundary) if order["direction"] == "DESC" \
                            else bool(item[order["field"]] > boundary)
                return False
            items = [item for item in items if follows(item)]
        selected = items[:size]
        more = len(items) > size
        cursor = base64.b64encode(_json({"scope": signature, "values": [selected[-1][o["field"]] for o in ordering]})
                                  .encode("utf-8")).decode() if more else None
        return {"items": selected, "nextCursor": cursor, "pageSize": size, "ordering": ordering, "hasMore": more}

    # CDN ---------------------------------------------------------------------------------

    def _serve_cdn(self, method: str, path: str, query: Mapping[str, Any]) -> _Response:
        segments = path.strip("/").split("/")
        if len(segments) < 4 or segments[0] != "assets":
            return self._failure_response(_Failure(error_codes.ASSET_NOT_FOUND, "Asset not found", 404))
        project, identifier, resource = unquote(segments[1]), unquote(segments[2]), segments[3]
        not_available = _Failure("asset/not-available", "Asset is not available", 403)
        with self._state_lock:
            asset = next((a for a in self.database_storage.assets.values()
                          if a["projectId"] == project == self.project_id
                          and (a["id"] == identifier or a.get("externalId") == identifier)), None)
            if asset is None:
                return self._failure_response(_Failure(error_codes.ASSET_NOT_FOUND, "Asset not found", 404))
            status = asset["classification"]["moderation"].get("status")
            if resource == "placeholder":
                # Like the CDN's placeholder handler: an image's ThumbHash, public for public assets
                # whatever their moderation status; refused for purged assets, assets without one
                # (not yet classified, or content removed) and, for private assets, keys without
                # assets:download.
                thumbhash = cast(dict[str, Any], asset["content"].get("image") or {}).get("thumbhash")
                public = asset["visibility"] == "public"
                if not thumbhash or status == "purged" or (not public and not self._can_download(asset.get("folderId"))):
                    return self._failure_response(not_available)
                return self._cdn_response(method, _thumbhash_png(thumbhash), {
                    "Content-Type": "image/png", "Cache-Control": f"{'public' if public else 'private'}, max-age=3600",
                    "Cache-Tag": f"asset-{asset['id']}", "ETag": f'"{thumbhash}"'})
            # Like the CDN, delivery checks come first and refuse everyone: content still uploading,
            # blocked or purged, failed processing or removed content.
            stored = self.image_storage.content.get(asset["id"])
            if (asset["upload"]["status"] == "uploading" or status in ("blocked", "purged")
                    or asset["classification"]["status"] == "failed"
                    or asset["content"]["status"] == "removed" or stored is None):
                return self._failure_response(not_available)
            # Then access: private assets, and public age-restricted ones requested without
            # ``ageConfirmed=true``, need the download permission for the asset's folder.
            private = asset["visibility"] != "public" or (
                status == "age-restricted" and query.get("ageConfirmed") not in (True, "true"))
            if private and not self._can_download(asset.get("folderId")):
                return self._failure_response(_Failure(
                    "asset/api-key-missing-permission",
                    "This API key needs assets:download permission for this asset’s folder.", 403))
            content = b"".join(v for _, v in sorted(stored["parts"].items()))
            content_type = stored["type"] or "application/octet-stream"
            image = asset["type"] == "image"
            # Like the CDN: an image's bytes are immutable for a year, other content is kept for an
            # hour, by shared caches only when delivery is public.
            headers = {"Content-Type": content_type,
                       "Cache-Control": f"{'private' if private else 'public'}, "
                                        f"{'max-age=31536000, immutable' if image else 'max-age=3600'}",
                       "Cache-Tag": f"asset-{asset['id']}"}
            if image:
                headers["ETag"] = f'"{asset["id"]}"'
                headers["Expires"] = email.utils.formatdate(self.now() / 1000 + 31536000, usegmt=True)
            headers.update({"X-Content-Type-Options": "nosniff",
                            "Content-Security-Policy": "sandbox; default-src 'none'"})
            normalized = content_type.lower().split(";", 1)[0].strip()
            if normalized in _ACTIVE_CONTENT_TYPES or normalized.endswith("+xml"):
                headers["Content-Disposition"] = "attachment"
        return self._cdn_response(method, content, headers)

    def _cdn_response(self, method: str, content: bytes, headers: dict[str, str]) -> _Response:
        return self._respond(200, headers={**headers, "Content-Length": str(len(content))},
                             body=b"" if method == "HEAD" else content)

    def _can_download(self, folder_id: str | None) -> bool:
        try:
            for grant in self._grants:
                if "assets:download" not in grant["actions"]:
                    continue
                if grant["folderId"] is None:
                    return True
                current, seen = folder_id, set()
                while current and current not in seen:
                    if current == grant["folderId"]:
                        return True
                    if not grant["includeSubfolders"]:
                        break
                    seen.add(current)
                    current = self._folder(current).get("parentId")
        except (KeyError, TypeError, _Failure):
            return False
        return False
