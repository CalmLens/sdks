"""In-memory integration fake for tests. It does not classify content or apply transforms.

``MockCalmLensServerClient`` is the real :class:`~calmlens.CalmLensServerClient` with an in-memory
transport: every call goes through the real client's validation, encoding, response
handling, errors and retries, and the fake API answers with the real routes' status codes,
JSON error bodies and headers (``X-Request-Id``, ``Retry-After``, ``Idempotent-Replayed``).
Keep this module out of production code paths.

It also generates signed test inputs (``generate_test_text_code``, ``paint_test_image`` and
``generate_media_test_code``): content that CalmLens, given the project's test input key, answers
with the scenario it describes instead of classifying it.
"""
from __future__ import annotations

import base64
import builtins
import copy
import dataclasses
import email.utils
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
from typing import Any, Literal, Optional, TypedDict, Union, cast
from urllib.parse import parse_qsl, quote, unquote, urlsplit
from urllib.request import Request

from . import error_codes
from ._asset_filters import ASSET_FILTER_FIELDS
from ._mock_classification import CATEGORIES, QUALIFIERS
from .client import (DEFAULT_CONNECT_TIMEOUT, DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_PART_SIZE_BYTES, DEFAULT_TIMEOUT,
                     CalmLensServerClient,
                     _HEX_COLOUR, _UNSET, _check_transform_options, _invalid, _invalid_upload_mime_type,
                     _is_accepted_upload_mime_type, _json, _merge, _normalize_upload_mime_type,
                     _sign_upload_token, SIGNED_CDN_RESOURCES)
from ._signed_test_inputs import (MEDIA_TEST_SIGNALS, TEST_INPUT_PRESETS, TEXT_TEST_SIGNALS, ClassificationTestSignal,
                                  PaintedTestImage, SignedTestAction, SignedTestDetectedFace,
                                  SignedTestDetectedPerson, SignedTestDetections, SignedTestFaceAge,
                                  SignedTestFaceAgePreset, SignedTestFaceAgeRange, SignedTestInput, SignedTestInstance,
                                  SignedTestRegion, SignedTestRegionalAction, SignedTestRegionalActionName,
                                  generate_media_test_code, generate_test_text_code, paint_test_image,
                                  signal_test_input)
from .errors import CalmLensError
from .moderation_context import select_moderation_context_items
from .types import (IMAGE_TRANSFORM_COLOUR_KEYS, Asset, Event, EventAsset, EventFact, EventSeverity, EventType, Folder,
                    HashList, HashListEntry, SignedUploadToken, SignUploadTokenOptions)

__all__ = ["MockCalmLensServerClient", "MOCK_PROJECT_ID", "MockRequest", "MockOptions", "MockAssetOutcome",
           "MockDecision", "MockModerationContent", "MockModerationInput", "MockModerationTrigger", "MockModerate",
           "MockApiKeyGrant", "MockFailure", "StoredContent",
           "InMemoryMockDatabaseStorage", "InMemoryMockImageStorage", "create_mock_api_key", "default_moderate",
           "mock_decision", "sign_upload_token",
           "ClassificationTestSignal", "SignedTestInput", "SignedTestInstance", "SignedTestAction",
           "SignedTestRegionalAction", "SignedTestRegion", "SignedTestRegionalActionName",
           "SignedTestDetections", "SignedTestDetectedPerson", "SignedTestDetectedFace", "SignedTestFaceAge",
           "SignedTestFaceAgePreset", "SignedTestFaceAgeRange", "TEST_INPUT_PRESETS", "TEXT_TEST_SIGNALS", "MEDIA_TEST_SIGNALS", "generate_test_text_code",
           "generate_media_test_code", "signal_test_input", "paint_test_image", "PaintedTestImage"]

_MOCK_OPTIONS = {"database_storage", "image_storage", "create_id", "now", "moderate", "signed_url_base_url"}
_MOCK_OUTCOMES = ("pending", "failed", "allowed", "limited", "age-restricted", "blocked", "purged")

#: Where the mock's moderation leaves an upload: ``pending`` (still processing), ``failed``
#: (processing failed, retryable), or a decision with that moderation status (``purged`` also
#: removes the content).
MockAssetOutcome = Literal["pending", "failed", "allowed", "limited", "age-restricted", "blocked", "purged"]
#: Why the mock is moderating an asset: ``upload`` (``assets.create``, ``assets.classify``,
#: ``text.classify`` or a final multipart part), ``retry`` (``assets.retry``), ``rerun``
#: (``assets.explain`` with ``rerun=True``) or ``complete`` (``complete_processing`` without a
#: decision of its own).
MockModerationTrigger = Literal["upload", "retry", "rerun", "complete"]

#: The policy action that gives each decided status.
_STATUS_ACTION = {"allowed": "allow", "limited": "limit", "age-restricted": "age-restrict", "blocked": "block",
                  "purged": "purge"}


def _score_to_likelihood(score: float) -> str:
    """The likelihood the API reports for a score."""
    if score >= 0.8:
        return "very-likely"
    if score >= 0.6:
        return "likely"
    if score >= 0.4:
        return "possible"
    if score >= 0.2:
        return "unlikely"
    return "very-unlikely"


def _is_score(score: object) -> bool:
    return isinstance(score, (int, float)) and not isinstance(score, bool) and math.isfinite(score) \
        and 0 <= score <= 1


class MockDecision:
    """A moderation decision for ``mock_options["moderate"]`` or ``complete_processing``, built
    with ``mock_decision(status)``: flag the categories it found, with their scores and
    qualifiers, and mark the categories it couldn't assess. Each call checks its names and scores
    and raises ``sdk/invalid-argument`` for one CalmLens doesn't have."""

    def __init__(self, status: MockAssetOutcome):
        if status not in _MOCK_OUTCOMES:
            raise _invalid(f"status must be one of {', '.join(_MOCK_OUTCOMES)}")
        self.status: MockAssetOutcome = status
        self._flags: dict[str, tuple[float, list[tuple[str, float]]]] = {}
        self._not_evaluated: set[str] = set()

    def flag(self, category: str, score: float, qualifiers: Mapping[str, float] | None = None) -> MockDecision:
        """Record findings in ``category`` with its ``score`` (0 to 1) and, optionally, scores for
        its qualifiers, such as ``{"violence-threat": 0.9}``. The policy acts on a category at 0.5
        and above, so ``flaggedCategories`` lists it there unless the status is ``allowed``."""
        self._check_finding(category)
        if not _is_score(score):
            raise _invalid(f"{category}'s score must be from 0 to 1")
        known = QUALIFIERS[category]
        for qualifier, qualifier_score in (qualifiers or {}).items():
            if qualifier not in known:
                raise _invalid(f"{qualifier} is not a qualifier of {category}")
            if not _is_score(qualifier_score):
                raise _invalid(f"{qualifier}'s score must be from 0 to 1")
        self._flags[category] = (score, list((qualifiers or {}).items()))
        return self

    def not_evaluated(self, category: str) -> MockDecision:
        """Mark ``category`` as not assessed (``not-evaluated`` for reason ``not-supported``)."""
        self._check_finding(category)
        self._not_evaluated.add(category)
        return self

    def _check_finding(self, category: str) -> None:
        if category not in CATEGORIES:
            raise _invalid(f"{category} is not a CalmLens category")
        if self.status in ("pending", "failed"):
            raise _invalid(f"a {self.status} decision has no findings")
        if category in self._flags or category in self._not_evaluated:
            raise _invalid(f"{category} is already in this decision")

    def report(self) -> dict[str, Any] | None:
        """The report a decided asset gets, as the API sends it: every category (unflagged ones
        evaluated with score 0), the policy's actions and
        ``flaggedCategories``. ``None`` for ``pending`` and ``failed``."""
        status = self.status
        if status in ("pending", "failed"):
            return None

        def action(score: float) -> str:
            return _STATUS_ACTION[status] if status != "allowed" and score >= 0.5 else "allow"
        evaluated = [(category, self._flags[category][0] if category in self._flags else 0)
                     for category in CATEGORIES if category not in self._not_evaluated]
        categories: dict[str, Any] = {}
        for category in CATEGORIES:
            if category in self._not_evaluated:
                categories[category] = {"status": "not-evaluated", "reason": "not-supported"}
                continue
            value, qualifiers = self._flags.get(category, (0, []))
            categories[category] = {"status": "evaluated", "likelihood": _score_to_likelihood(value), "score": value}
            if qualifiers:
                categories[category]["qualifiers"] = {
                    qualifier: {"status": "evaluated", "someScore": some, "likelihood": _score_to_likelihood(some)}
                    for qualifier, some in qualifiers}
        return {"raw": {"categories": categories},
            "categories": {category: {"score": value, "action": action(value)} for category, value in evaluated},
            "explanationComplete": True, "source": "policy", "automatedAction": _STATUS_ACTION[status],
            # The mock analyses no audio or video, so a decision has no findings timeline.
            "regions": [], "timeline": None, "flaggedCategories": [category for category, value in evaluated if action(value) != "allow"]}



def mock_decision(status: MockAssetOutcome) -> MockDecision:
    """Start a moderation decision with this status; see :class:`MockDecision`."""
    return MockDecision(status)


@dataclass(frozen=True)
class MockModerationContent:
    """An asset's content as ``moderate`` receives it: the uploaded ``bytes`` (multipart parts
    joined in order; ``None`` without stored content, such as a website or removed content) and
    the ``text`` of a ``plaintext-document`` (``None`` otherwise)."""
    bytes: builtins.bytes | None
    text: str | None


@dataclass(frozen=True)
class MockModerationInput:
    """What ``mock_options["moderate"]`` receives for each asset the mock moderates."""
    #: A copy of the asset as stored, still processing.
    asset: Asset
    content: MockModerationContent
    trigger: MockModerationTrigger
    #: True when the API would queue the work rather than answer with the decision: queued
    #: uploads, retries, reruns and ``complete_processing``.
    queued: bool


#: Decides an asset the mock moderates: a status or a ``mock_decision(...)``.
MockModerate = Callable[[MockModerationInput], Union[MockAssetOutcome, MockDecision]]


def default_moderate(moderation: MockModerationInput) -> MockAssetOutcome:
    """The default ``moderate``: queued work stays ``pending`` until ``complete_processing``,
    which allows it, and everything else is ``allowed``."""
    return "pending" if moderation.queued and moderation.trigger != "complete" else "allowed"


def _to_decision(value: object) -> MockDecision:
    """A ``moderate`` answer or ``complete_processing`` decision as a checked ``MockDecision``."""
    if isinstance(value, MockDecision):
        return value
    if isinstance(value, str):
        return MockDecision(cast(MockAssetOutcome, value))
    raise _invalid("a decision must be a status or a mock_decision(...)")


#: Like the API: an upload has at most this many parts.
_MAX_UPLOAD_PARTS = 10_000
_INT_QUERY = {"pageSize", "limit", "partNumber", "sizeInBytes", "totalSizeInBytes"}
_BOOL_QUERY = {"queue", "isFinal"}
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
                      upload_preset_id: str = _UNSET, external_id: str = _UNSET,
                      expires_in_seconds: int = _UNSET) -> SignedUploadToken:
    """Sign an upload token like ``client.upload_tokens.sign``, with the same validation, at a
    fixed ``now`` (milliseconds since the epoch) with a fixed ``nonce``, so the token is the
    same every time, for comparing with known tokens in tests. Options are an options dict or
    the same keyword arguments as ``upload_tokens.sign``."""
    merged = _merge("uploadTokens.sign", options, upload_preset_id=upload_preset_id, external_id=external_id,
                    expires_in_seconds=expires_in_seconds)
    return _sign_upload_token(api_key, merged, now, nonce)


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

    ``path`` is relative to ``base_url`` for API calls and to ``cdn_base_url`` for
    ``cdn.serve``, with each segment decoded, such as ``/projects/<id>/assets`` or
    ``/assets/<id>``. ``query`` holds the decoded query values (numbers, booleans and JSON values
    decoded); ``body`` is the JSON body as Python objects, the raw bytes of an upload, or None.
    ``headers`` has the API key redacted from ``repr``. ``status`` is the HTTP status the mock
    answered with, or None when the request failed without a response.
    """
    method: str
    url: str
    path: str
    # Recorded for every route, so the shapes vary: decoded JSON values or upload bytes.
    query: dict[str, Any] = field(default_factory=dict)
    body: Any = None
    headers: dict[str, str] = field(default_factory=dict, repr=False)
    status: int | None = None


@dataclass(frozen=True)
class _PendingFailure:
    """A failure queued with ``fail_next_request``."""
    failure: MockFailure
    operation: str | None
    details: dict[str, Any]
    retry_after: int | None


def _decode_query(pairs: Iterable[tuple[str, str]]) -> dict[str, Any]:
    query: dict[str, Any] = {}
    ordering: dict[int, dict[str, str]] = {}
    for key, value in pairs:
        found = re.fullmatch(r"ordering\[(\d+)\]\[(\w+)\]", key)
        if found:
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


class _InvalidFilter(Exception):
    """A filter the API refuses with ``validation/invalid-filter``."""


def _wildcard(pattern: str) -> re.Pattern[str]:
    """``*`` matches any run of characters, ignoring case; every other character matches itself."""
    return re.compile("".join(".*" if part == "*" else re.escape(part) for part in re.split(r"(\*)", pattern)),
                      re.S | re.I)


def _rsql(expression: str) -> Callable[[Mapping[str, Any]], bool]:
    """An asset list filter like the API's: ``;`` (and), which binds tighter than ``,`` (or),
    ``( … )`` groups and quoted values, naming only the fields in ``ASSET_FILTER_FIELDS``, each with
    its own operators. A number field's value must be a number, and ``null`` is a
    missing value only on a nullable field. ``*`` in an ``==`` or ``!=`` value matches any run of
    characters, ignoring case; without it ``==`` is exact. As in SQL, a comparison never matches a
    missing value. Anything else raises ``_InvalidFilter``."""

    def comparison(text: str) -> Callable[[Mapping[str, Any]], bool]:
        found = re.fullmatch(r"\s*([\w.]+)\s*(==|!=|<=|>=|<|>|=[a-z]*=)\s*(.*?)\s*", text, re.S)
        if not found:
            raise _InvalidFilter(text)
        name, operator, raw = found.groups()
        if name not in ASSET_FILTER_FIELDS or operator not in ASSET_FILTER_FIELDS[name][2]:
            raise _InvalidFilter(text)
        kind, nullable, _ = ASSET_FILTER_FIELDS[name]
        listed = operator in ("=in=", "=out=")
        if listed:
            if not (raw.startswith("(") and raw.endswith(")")):
                raise _InvalidFilter(text)
            raws = _split_top_level(raw[1:-1], ",")
        else:
            raws = [raw]

        def read(value: str) -> Any:
            value = value.strip()
            if value[:1] in "\"'":
                if len(value) < 2 or value[-1] != value[0]:
                    raise _InvalidFilter(text)
                value = re.sub(r"\\(.)", r"\1", value[1:-1], flags=re.S)
            elif not value or re.search(r"[\s\"'();,=!~<>]", value):
                raise _InvalidFilter(text)
            if value == "null" and nullable:
                return None
            if kind == "number":
                try:
                    number = float(value)
                except ValueError:
                    raise _InvalidFilter(text) from None
                if not math.isfinite(number):
                    raise _InvalidFilter(text)
                return number
            return value

        values = [read(value) for value in raws]
        first = values[0]
        pattern = _wildcard(first) if not listed and isinstance(first, str) and "*" in first else None

        def same(actual: Any, value: Any) -> bool:
            if isinstance(actual, list):
                return value in actual
            if isinstance(actual, bool) or isinstance(value, bool):
                return False
            return bool(actual == value)

        def matches(asset: Mapping[str, Any]) -> bool:
            actual: Any = asset
            for key in name.split("."):
                actual = actual.get(key) if isinstance(actual, Mapping) else None
            if kind == "list":
                # A list holds any of the values (=in=) or none of them (=out=); a missing list
                # holds none.
                held = any(value in (actual or []) for value in values)
                return held == (operator == "=in=")
            if pattern is not None:
                texts = [item for item in actual if isinstance(item, str)] if isinstance(actual, list) else [actual]
                if not texts or not all(isinstance(item, str) for item in texts):
                    return False
                return any(pattern.fullmatch(item) for item in texts) == (operator == "==")
            if operator == "==":
                return actual is None if first is None else actual is not None and same(actual, first)
            if actual is None:
                return False
            if operator == "!=":
                return first is None or not same(actual, first)
            if operator == "=in=":
                return any(value is not None and same(actual, value) for value in values)
            if operator == "=out=":
                return all(value is not None and not same(actual, value) for value in values)
            if first is None or isinstance(actual, (list, bool)):
                return False
            if kind == "number":
                if not isinstance(actual, (int, float)):
                    return False
                order = (float(actual) > float(first)) - (float(actual) < float(first))
            else:
                order = (str(actual) > str(first)) - (str(actual) < str(first))
            return {">": order > 0, ">=": order >= 0, "<": order < 0, "<=": order <= 0}[operator]
        return matches

    def parse(text: str) -> Callable[[Mapping[str, Any]], bool]:
        alternatives: list[list[Callable[[Mapping[str, Any]], bool]]] = []
        for alternative in _split_top_level(text, ","):
            terms = []
            for term in _split_top_level(alternative, ";"):
                term = term.strip()
                if not term:
                    raise _InvalidFilter(expression)
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
    #: Decides each asset the mock moderates, given a :class:`MockModerationInput`: return a
    #: status or a ``mock_decision(...)``. Called when an upload completes (trigger ``upload``),
    #: on ``assets.retry`` (``retry``), ``assets.explain`` with ``rerun=True`` (``rerun``) and
    #: ``complete_processing`` without a decision (``complete``). Defaults to
    #: :func:`default_moderate`: queued work stays ``pending`` and everything else is ``allowed``.
    moderate: MockModerate
    signed_url_base_url: str


#: The ThumbHash the mock gives every processed asset's preview, standing in for one computed from
#: its pixels. The ``placeholder`` resource serves it as a PNG, like the CDN.
_MOCK_THUMBHASH = "1QcSHQRnh493V4dIh4eXh1h4kJUI"
_MAX_SEARCH_LIMIT = 20
_MAX_SEARCH_QUERY_LENGTH = 200
_REVIEW_DECISIONS = ("allowed", "limited", "age-restricted", "blocked", "purged")
_MAX_DECISION_NOTE_LENGTH = 1499
#: Every API cursor list returns this many items unless ``pageSize`` says otherwise.
_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 100
#: Like the API: 1 to 255 printable ASCII characters, once HTTP has trimmed the header value.
_IDEMPOTENCY_KEY = re.compile(r"[\x21-\x7e](?:[\x20-\x7e]{0,253}[\x21-\x7e])?")
#: A PDQ hash, as the API accepts it once trimmed and lowercased.
_PDQ_HASH = re.compile(r"[0-9a-f]{64}")
_HASH_LIST_ACTIONS = ("flag", "block")
#: Content a browser could run as a document, which the CDN serves as a download.
_ACTIVE_CONTENT_TYPES = {"image/svg+xml", "application/xhtml+xml", "text/html", "application/xml", "text/xml"}

#: The project ID a :class:`MockCalmLensServerClient` uses without ``project_id``.
MOCK_PROJECT_ID = "project-1"

#: What :meth:`MockCalmLensServerClient.fail_next_request` makes a request fail with:
#: ``transport-error`` (``sdk/transport-error``), ``timeout`` (``sdk/timeout``), an API error code
#: such as ``upload/limit-exceeded`` (that error with its HTTP status) or an exception to raise.
MockFailure = Union[str, BaseException]

#: The client methods ``fail_next_request`` can target, as JavaScript-style method paths.
_OPERATIONS = frozenset({
    "assets.list", "assets.iterate", "assets.search", "assets.retrieve", "assets.waitForDecision", "assets.update",
    "assets.listChildren", "assets.iterateChildren", "assets.listTimeline", "assets.create", "assets.classify", "assets.uploadPart",
    "assets.createSignedUrl", "assets.move", "assets.retry", "assets.explain", "assets.decide",
    "assets.deleteContent", "assets.delete", "assets.batch", "text.classify", "cdn.serve", "events.list",
    "events.pages", "folders.list", "folders.retrieve", "folders.create", "folders.update", "folders.delete",
    "folders.move", "hashLists.list", "hashLists.retrieve", "hashLists.create", "hashLists.update",
    "hashLists.delete", "hashLists.listEntries", "hashLists.addEntry", "hashLists.removeEntry", "policies.list",
    "policies.retrieve", "policies.create", "policies.update", "policies.applyPreset", "policies.setAutomaticUpdates",
    "policies.delete", "policies.assign", "ensureLens", "ensureLenses"})

#: The built-in presets the mock knows, by display name.
_MOCK_PRESET_NAMES = {"general-community": "General", "children-platform": "Kids",
                      "education-support": "Learning and support", "wholesome-community": "Teen-safe"}


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


#: Paths beneath ``/rendered/`` the CDN reserves for streaming and an embeddable player.
_RESERVED_RENDERED_PATHS = ("stream", "player")
#: Removing or withholding content removes its rendered file and preview, as the API does.
_NO_RENDERING: dict[str, Any] = {"rendered": None, "preview": None}
#: The size of the waveform the API makes as an audio asset's preview.
_WAVEFORM_SIZE = {"width": 1200, "height": 300}
#: Audio and video formats browsers play as uploaded, so the API serves them as stored.
_BROWSER_SAFE_MEDIA_FORMATS = ("video/mp4", "audio/mpeg", "audio/aac", "audio/mp4", "audio/x-m4a", "audio/ogg")
#: Spreadsheets, which have no rendered file or preview.
_SPREADSHEET_MIME_TYPES = ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                           "application/vnd.ms-excel.sheet.macroenabled.12", "application/vnd.ms-excel",
                           "application/vnd.oasis.opendocument.spreadsheet")


def _mock_rendering(asset: Mapping[str, Any], processed: bool) -> dict[str, Any]:
    """The rendered file and preview the API reports for an asset with its content held. Once
    uploaded, an image renders as itself with a preview that has no ThumbHash yet, and a PDF and
    browser-safe audio and video render as uploaded. Once processed, a website renders as its
    screenshot; a document or presentation as a PDF, with its first page as the preview; video and
    audio as a browser-safe file (MP4 or M4A unless browsers play the upload), audio with a waveform
    preview and video with no poster; and every preview has its ThumbHash. Text, spreadsheets and
    other files have neither. The mock decodes nothing, so sizes are unknown and audio has no peaks."""
    fmt = asset["content"].get("format")
    mime = _normalize_upload_mime_type(fmt or "")
    browser_safe = mime in _BROWSER_SAFE_MEDIA_FORMATS
    kind = asset["type"]
    unsized: dict[str, Any] = {"width": None, "height": None}

    def preview(size: Mapping[str, Any]) -> dict[str, Any]:
        return {**size, "thumbhash": _MOCK_THUMBHASH if processed else None,
                "averageColor": "#7f7f7f" if processed else None}
    renders_on_upload = (kind == "image" or mime == "application/pdf"
                         or (kind in ("video", "audio") and browser_safe))
    if not processed and not renders_on_upload:
        return dict(_NO_RENDERING)
    if kind == "image":
        return {"rendered": {"kind": "image", "format": fmt or "image/png", **unsized}, "preview": preview(unsized)}
    if kind == "website":
        return {"rendered": {"kind": "image", "format": "image/png", **unsized}, "preview": preview(unsized)}
    if kind == "multimedia-document":
        if mime in _SPREADSHEET_MIME_TYPES:
            return dict(_NO_RENDERING)
        return {"rendered": {"kind": "pdf", "format": "application/pdf", **unsized},
                "preview": preview(unsized) if processed else None}
    if kind == "video":
        return {"rendered": {"kind": "video", "format": fmt if browser_safe else "video/mp4", **unsized},
                "preview": None}
    if kind == "audio":
        rendered: dict[str, Any] = {"kind": "audio", "format": fmt if browser_safe else "audio/mp4", **unsized}
        if processed:
            rendered["peaks"] = []
        return {"rendered": rendered, "preview": preview(_WAVEFORM_SIZE) if processed else None}
    return dict(_NO_RENDERING)


#: The ``asset.<status>`` events, whose asset snapshot carries the moderation status they announce.
_ANNOUNCED_STATUSES = frozenset({"asset.allowed", "asset.limited", "asset.age-restricted", "asset.blocked",
                                 "asset.purged"})


def _event_asset(asset: Mapping[str, Any]) -> EventAsset:
    """The asset snapshot events carry (getEventAsset in the API)."""
    return {"id": asset["id"], "externalId": asset.get("externalId"), "uploadPresetId": asset.get("uploadPresetId"),
            "upload": {"status": asset["upload"]["status"]},
            "classification": {"status": asset["classification"]["status"],
                               "testInput": asset["classification"]["testInput"],
                               "moderation": {"status": asset["classification"]["moderation"]["status"]}},
            "content": {"status": asset["content"]["status"]}}


def _asset_name_fact(asset: Mapping[str, Any]) -> dict[str, Any]:
    """An asset's portal link, as event facts carry it."""
    return {"key": "asset-name", "value": asset["name"], "url": f"https://calmlens.com/go/asset/{asset['id']}"}


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


def _check_metadata(metadata: Any) -> None:
    """Refuse ``metadata`` the API's schema refuses: it is ``None`` or a list of ``{id, value}``
    objects with a string ``id`` and any JSON ``value``."""
    if metadata is None:
        return
    if not isinstance(metadata, list):
        raise _invalid_field("validation/invalid-type", "metadata")
    for index, item in enumerate(metadata):
        if not isinstance(item, dict):
            raise _invalid_field("validation/invalid-type", f"metadata.{index}")
        if not isinstance(item.get("id"), str):
            raise _invalid_field("validation/invalid-type", f"metadata.{index}.id")
        if "value" not in item:
            raise _invalid_field("validation/invalid-value", f"metadata.{index}.value")


_SELECTOR_LENS = re.compile(r"[a-z0-9-]{1,50}")
_SELECTOR_NAME = re.compile(r"[a-z][a-zA-Z0-9]*")
_SELECTOR_NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?")


class _InvalidSelector(Exception):
    """A CDN selector the CDN refuses as ``asset/invalid-transform``."""


def _decode_selector_text(text: str) -> str:
    # Like decodeURIComponent: a malformed escape or invalid UTF-8 is refused.
    if re.search(r"%(?![0-9a-fA-F]{2})", text):
        raise _InvalidSelector(text)
    try:
        return unquote(text, errors="strict")
    except UnicodeDecodeError:
        raise _InvalidSelector(text) from None


def _parse_transform_selector(selector: str) -> tuple[str | None, dict[str, Any] | None]:
    """Read a CDN selector, the path after the resource as sent (still percent-encoded), as the CDN
    does: an optional first ``@lens``, then ``key=value`` options with dotted keys for nested ones
    (a bare key is ``True``). Values are numbers, ``true``, ``false``, hex colours (``#`` added)
    for colour options, or text. Raises ``_InvalidSelector`` on anything the CDN refuses as
    ``asset/invalid-transform``. Returns the lens and the options (each None when absent)."""
    if not selector:
        return None, None
    if "/" in selector:
        raise _InvalidSelector(selector)
    entries = selector.split(",")
    lens: str | None = None
    if entries[0].startswith("@"):
        lens = _decode_selector_text(entries.pop(0)[1:])
        if not _SELECTOR_LENS.fullmatch(lens):
            raise _InvalidSelector(selector)
    if not entries:
        return lens, None
    options: dict[str, Any] = {}
    for entry in entries:
        if not entry or entry.startswith("@"):
            raise _InvalidSelector(selector)
        key, separator, text = entry.partition("=")
        parts = key.split(".")
        if not all(_SELECTOR_NAME.fullmatch(part) for part in parts):
            raise _InvalidSelector(selector)
        value: Any = True
        if separator:
            text = _decode_selector_text(text)
            if text == "":
                raise _InvalidSelector(selector)
            if key in IMAGE_TRANSFORM_COLOUR_KEYS and _HEX_COLOUR.fullmatch("#" + text):
                value = "#" + text.lower()
            elif _SELECTOR_NUMBER.fullmatch(text):
                value = float(text) if "." in text else int(text)
            elif text in ("true", "false"):
                value = text == "true"
            else:
                value = text
        target = options
        for part in parts[:-1]:
            child = target.setdefault(part, {})
            if not isinstance(child, dict):
                raise _InvalidSelector(selector)
            target = child
        if parts[-1] in target:
            raise _InvalidSelector(selector)
        target[parts[-1]] = value
    return lens, options


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
    ``score`` and ``matchedFields``, ranked by score and then newest first. Asset list filters take
    the API's fields and operators, with ``( … )`` groups and ``;`` binding tighter than ``,``, and
    refuse others with ``validation/invalid-filter``; list cursors resume after the last
    item returned and only continue the query they came from."""

    def __init__(self, *, api_key: str | None = None, project_id: str = MOCK_PROJECT_ID,
                 base_url: str = "https://api.calmlens.invalid/v1",
                 cdn_base_url: str = "https://mock.calmlens.invalid/v1",
                 timeout: float = DEFAULT_TIMEOUT, upload_timeout: float | None = None,
                 connect_timeout: float = DEFAULT_CONNECT_TIMEOUT, max_retries: int = 0,
                 max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES, part_size_bytes: int = DEFAULT_PART_SIZE_BYTES,
                 mock_options: MockOptions | None = None):
        options: MockOptions = mock_options if mock_options is not None else {}
        unknown = set(options) - _MOCK_OPTIONS
        if unknown:
            raise _invalid("Unknown mock options: " + ", ".join(sorted(unknown)), error_codes.SDK_INVALID_CONFIG)
        super().__init__(api_key=api_key or create_mock_api_key(), project_id=project_id, base_url=base_url,
                         cdn_base_url=cdn_base_url, timeout=timeout, upload_timeout=upload_timeout,
                         connect_timeout=connect_timeout, max_retries=max_retries,
                         max_response_bytes=max_response_bytes, part_size_bytes=part_size_bytes,
                         transport=self._serve)
        # The fake API answers multipart size checks in the API's order.
        self._defer_upload_checks = True
        self._state_lock = threading.RLock()
        self._requests: list[MockRequest] = []
        self._errors: list[BaseException] = []
        self._pending_failures: list[_PendingFailure] = []
        self._grants = _grants_of(self.api_key)
        self._idempotent: dict[str, tuple[str, int, bytes]] = {}
        self._uploads: dict[str, dict[str, Any]] = {}
        # Each asset's latest ``assetSequence``, which the API keeps on the asset row.
        self._asset_event_sequences: dict[str, int] = {}
        self._mock_lenses: dict[str, dict[str, Any]] = {}
        # Stored policies (the API's shape without ``projectIds`` and ``preset.latestVersion``, plus
        # their reset ``baseline``) and the one the project moderates with.
        self._policies: dict[str, dict[str, Any]] = {}
        self._project_policy_id: str | None = None
        self.database_storage = options.get("database_storage") or InMemoryMockDatabaseStorage()
        if not hasattr(self.database_storage, "events"):
            self.database_storage.events = []
        self.image_storage = options.get("image_storage") or InMemoryMockImageStorage()
        self.create_id: Callable[[str], str] = options.get("create_id", _new_id)
        self.now: Callable[[], int] = options.get("now") or _monotonic_clock()
        self.moderate: MockModerate = options.get("moderate") or default_moderate
        if not callable(self.moderate):
            raise _invalid("mock_options['moderate'] must be a function", error_codes.SDK_INVALID_CONFIG)
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
        """Copies of every request received since the mock was created or last cleared, oldest
        first."""
        with self._state_lock:
            return copy.deepcopy(self._requests)

    def clear_requests(self) -> None:
        """Forget the requests recorded so far."""
        with self._state_lock:
            self._requests.clear()

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

    def fail_next_request(self, failure: MockFailure = "transport-error", *, operation: str | None = None,
                          details: Mapping[str, Any] | None = None,
                          retry_after: int | None = None) -> MockCalmLensServerClient:
        """Make the next request (or the next one to ``operation``, a JavaScript-style method path
        such as ``assets.create`` or ``cdn.serve``) fail without running, as if it never
        completed. ``failure`` is ``transport-error`` (``sdk/transport-error``), ``timeout``
        (``sdk/timeout``), an API error code (that error with its HTTP status, ``details`` as its
        details and ``retry_after`` whole seconds as its ``Retry-After`` header) or an exception
        to raise. Each queued failure fails one request, so a client retry takes the next queued
        failure or reaches the API.

        A request counts for every method that sends it: ``text.classify`` uploads also count as
        ``assets.classify``, ``ensureLens`` as ``ensureLenses``, ``assets.waitForDecision`` polls
        as ``assets.retrieve`` and ``assets.iterate`` pages as ``assets.list``. An unknown
        operation, or ``details`` or ``retry_after`` with a transport error, timeout or exception,
        raises ``sdk/invalid-argument``."""
        if isinstance(failure, str) and failure not in ("transport-error", "timeout") \
                and failure not in error_codes.STATUS_BY_CODE:
            raise _invalid(f"Unknown failure {failure!r}: use transport-error, timeout or an API error code")
        if operation is not None and operation not in _OPERATIONS:
            raise _invalid(f"Unknown operation {operation!r}: use a client method path such as assets.create")
        if not (isinstance(failure, str) and failure in error_codes.STATUS_BY_CODE) \
                and (details is not None or retry_after is not None):
            raise _invalid("details and retry_after apply only to an API error code")
        if retry_after is not None and (isinstance(retry_after, bool) or not isinstance(retry_after, int)
                                        or retry_after < 0):
            raise _invalid("retry_after must be a whole number of seconds")
        with self._state_lock:
            self._pending_failures.append(_PendingFailure(failure, operation, dict(details or {}), retry_after))
        return self

    def complete_processing(self, asset_id: str, decision: MockAssetOutcome | MockDecision | None = None) -> Asset:
        """Finish processing an asset as the pipeline would: with ``decision`` (a status or a
        ``mock_decision(...)``), or else what ``moderate`` returns for the ``complete`` trigger.
        A decided asset gets its report and the ``asset.classified`` and ``asset.<status>``
        events; ``failed`` records ``asset.failed``. No manual review is recorded. Raises
        ``asset/not-found`` for an unknown asset and ``sdk/invalid-argument`` for one that isn't
        processing."""
        with self._state_lock:
            asset = self.database_storage.assets.get(asset_id)
            if not asset or asset["projectId"] != self.project_id:
                raise CalmLensError(error_codes.ASSET_NOT_FOUND, "Asset not found",
                                    status=error_codes.STATUS_BY_CODE[error_codes.ASSET_NOT_FOUND])
            if asset["classification"]["status"] != "processing":
                raise _invalid(f"asset {asset_id} isn't processing")
            settled = None if decision is None else _to_decision(decision)
            self._moderate_stored(cast(dict[str, Any], asset), "complete", settled)
            return copy.deepcopy(asset)

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
        the API's events do; an ``asset.<status>`` event's snapshot has the moderation status
        it announces."""
        with self._state_lock:
            stored = self.database_storage.assets.get(asset_id) if asset_id else None
            asset = _event_asset(stored) if stored is not None else None
            if asset is not None and type in _ANNOUNCED_STATUSES:
                # An ``asset.<status>`` event carries the status it announces.
                asset["classification"]["moderation"]["status"] = type.removeprefix("asset.")  # type: ignore[typeddict-item]
            now = self.now()
            # Like the API: each event about an asset takes the asset's next number; others have none.
            sequence: int | None = None
            if asset_id:
                sequence = self._asset_event_sequences.get(asset_id, 0) + 1
                self._asset_event_sequences[asset_id] = sequence
            event: Event = {"id": self.create_id("evt"), "projectId": self.project_id, "type": type,
                            "severity": severity, "title": title or type, "description": description,
                            "assetId": asset_id, "assetSequence": sequence, "asset": asset, "facts": copy.deepcopy(facts or []),
                            "createdAt": now}
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
            self._record_decision(cast(dict[str, Any], asset), decision, None, None)
            return copy.deepcopy(asset)

    def _record_decision(self, record: dict[str, Any], decision: str, note: str | None,
                         reviewer_name: str | None) -> None:
        """Apply a reviewer's decision like ``decideAssetManually`` in the API: the status, the
        review, then (for ``purged``) the content removal and its event, then ``asset.<decision>``."""
        self._apply_outcome(record, decision, "requested")
        now = self.now()
        review: dict[str, Any] = {"id": self.create_id("rev"), "decision": decision, "note": note,
                                  "reviewedAt": now, "appliedToAsset": True}
        reviewer_facts: list[dict[str, Any]] = []
        if reviewer_name is not None:
            review.update(reviewerName=reviewer_name, reviewerEmail=None)
            reviewer_facts = [{"key": "reviewer-user-id", "value": None},
                              {"key": "reviewer-name", "value": reviewer_name}]
        record["classification"]["moderation"].setdefault("manualReviews", []).append(review)
        if decision == "purged":
            self._lifecycle_event("asset.content-removed", record)
        # Like the event catalog: only allowing and limiting are low severity.
        self.enqueue_event("asset." + decision, asset_id=record["id"],
                           severity="low" if decision in ("allowed", "limited") else "high",
                           facts=cast(list[EventFact], [
                               # A decision through the API is the API key's.
                               {"key": "decided-by",
                                "value": "reviewer" if reviewer_name is None else "api-key"},
                               {"key": "asset-type", "value": record["type"]},
                               {"key": "asset-name", "value": record["name"],
                                "url": f"https://calmlens.com/go/asset/{record['id']}"},
                               *reviewer_facts,
                               {"key": "note", "value": note}]))

    def _decide_request(self, asset: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
        """``POST /assets/:id/decision`` as the API validates and applies it. The mock's key is
        unnamed, so the review and its event name the reviewer ``An API key``. An asset still
        uploading or processing is refused with ``asset/processing``."""
        decision = body.get("decision")
        if decision not in _REVIEW_DECISIONS:
            raise _invalid_field("validation/invalid-union", "decision")
        note = body.get("note")
        if not isinstance(note, str):
            raise _invalid_field("validation/invalid-type", "note")
        note = note.strip()
        if not note:
            raise _invalid_field("validation/too-small", "note")
        if len(note) > _MAX_DECISION_NOTE_LENGTH:
            raise _invalid_field("validation/too-big", "note")
        if decision == "purged" and body.get("confirmPurge") is not True:
            raise _invalid_field("validation/invalid-value", "confirmPurge")
        if asset["upload"]["status"] == "uploading" or asset["classification"]["status"] == "processing":
            raise _Failure(error_codes.ASSET_PROCESSING)
        status = asset["classification"]["moderation"]["status"]
        if status == "pending" and decision not in ("blocked", "purged"):
            raise _Failure(error_codes.ASSET_DECISION_NOT_ALLOWED)
        if status == decision:
            raise _Failure(error_codes.ASSET_DECISION_UNCHANGED)
        if status == "purged" and decision != "blocked":
            raise _Failure(error_codes.ASSET_CONTENT_PURGED)
        self._record_decision(asset, decision, note, "An API key")
        return asset

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

    @staticmethod
    def _request_id() -> str:
        return "req_mock_" + uuid.uuid4().hex[:16]

    def _respond(self, status: int, payload: Any = None, headers: Mapping[str, str] | None = None,
                 body: bytes | None = None) -> _Response:
        sent = {"X-Request-Id": self._request_id(), **(headers or {})}
        if body is None:
            body = b"" if payload is None else _json(payload).encode("utf-8")
            if payload is not None:
                sent.setdefault("Content-Type", "application/json")
        sent.setdefault("Content-Length", str(len(body)))
        return _Response(body, status, sent)

    def _failure_response(self, failure: _Failure | CalmLensError, retry_after: float | None = None) -> _Response:
        status = failure.status or error_codes.STATUS_BY_CODE.get(failure.code, 400)
        # Like the API's error body: ``requestId`` is the ``X-Request-Id`` header, and ``details``
        # is always an object.
        request_id = self._request_id()
        headers = {"X-Request-Id": request_id}
        if retry_after is not None:
            headers["Retry-After"] = str(int(retry_after))
        body = {"code": failure.code, "message": failure.message or failure.code, "requestId": request_id,
                "details": failure.details or {}}
        return self._respond(status, body, headers)

    @staticmethod
    def _operations(method: str, parts: list[str], query: Mapping[str, Any], headers: Mapping[str, str],
                    cdn: bool) -> list[str]:
        """The JavaScript client methods that send a request, the one it is recorded under first,
        for ``fail_next_request``."""
        if cdn:
            return ["cdn.serve"]
        if parts[0] == "projects":
            route = "/".join(parts[2:])
            if route == "events":
                return ["events.list", "events.pages"]
            if route == "lenses":
                return ["ensureLenses", "ensureLens"]
            if route in ("folders", "hash-lists", "policies"):
                kind = {"folders": "folders", "hash-lists": "hashLists", "policies": "policies"}[route]
                return [f"{kind}.list" if method == "GET" else f"{kind}.create"]
            if route == "policy":
                return ["policies.assign"]
            if len(parts) > 3 and parts[2] == "policies":
                action = parts[4] if len(parts) > 4 else ""
                if action:
                    return {"preset": ["policies.applyPreset"],
                            "automatic-updates": ["policies.setAutomaticUpdates"]}.get(action, [])
                return ["policies." + {"GET": "retrieve", "PATCH": "update", "DELETE": "delete"}.get(method, "")]
            if route in ("assets/search", "assets/batch"):
                return ["assets." + parts[3]]
            if len(parts) == 5 and parts[2] == "assets" and parts[4] == "timeline":
                return ["assets.listTimeline"]
            if route == "assets":
                if method == "GET":
                    return ["assets.list", "assets.iterate"]
                if query.get("queue"):
                    return ["assets.create"]
                lower = {key.lower(): value for key, value in headers.items()}
                text = lower.get("x-calmlens-upload") == "content" and lower.get("content-type") == "text/plain"
                return ["assets.classify", "text.classify"] if text else ["assets.classify"]
            return []
        resource = parts[0]
        suffix = parts[2] if len(parts) > 2 else ""
        by_method = {"GET": "retrieve", "PATCH": "update", "DELETE": "delete"}
        if len(parts) < 2:
            return []
        if resource == "folders":
            return ["folders.move"] if suffix == "move" else ["folders." + by_method.get(method, "")]
        if resource == "hash-lists":
            if suffix == "entries":
                return ["hashLists.listEntries" if method == "GET" else "hashLists.addEntry"]
            return ["hashLists." + by_method.get(method, "")]
        if resource == "hash-list-entries":
            return ["hashLists.removeEntry"]
        if resource != "assets":
            return []
        if not suffix:
            return ["assets.retrieve", "assets.waitForDecision"] if method == "GET" \
                else ["assets." + by_method.get(method, "")]
        return {"content": ["assets.deleteContent"], "children": ["assets.listChildren", "assets.iterateChildren"],
                "signed-url": ["assets.createSignedUrl"], "part": ["assets.uploadPart"], "move": ["assets.move"],
                "retry": ["assets.retry"], "explain": ["assets.explain"],
                "decision": ["assets.decide"]}.get(suffix, [])

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
        if raw is not None and content_type == "application/json" and upload not in ("content", "part"):
            body = json.loads(raw)
        parts = [unquote(p) for p in url.path.strip("/").split("/")]
        operations = self._operations(request.get_method(), parts, query, headers, cdn)
        recorded = MockRequest(method=request.get_method(), url=request.full_url, path="/" + "/".join(parts),
                               query=copy.deepcopy(query), body=copy.deepcopy(body), headers=copy.deepcopy(headers))
        with self._state_lock:
            self._requests.append(recorded)
            error = self._errors.pop(0) if self._errors else None
            pending: _PendingFailure | None = None
            if error is None:
                index = next((i for i, queued in enumerate(self._pending_failures)
                              if queued.operation is None or queued.operation in operations), None)
                if index is not None:
                    pending = self._pending_failures.pop(index)
        if isinstance(error, CalmLensError):
            response = self._failure_response(error, error.retry_after)
        elif error is not None:
            raise error
        elif pending is not None:
            failure = pending.failure
            if failure == "transport-error":
                raise ConnectionResetError("Simulated network failure")
            if failure == "timeout":
                raise TimeoutError("The operation timed out.")
            if not isinstance(failure, str):
                raise failure
            response = self._failure_response(_Failure(failure, details=pending.details), pending.retry_after)
        elif cdn:
            response = self._serve_cdn(request.get_method(), url.path, query)
        else:
            response = self._answer(request, raw, headers, url.path, query, body, parts,
                                    operations[0] if operations else "")
        with self._state_lock:
            # The recorded request gets the status it was answered with, unless it was cleared.
            for index, sent in enumerate(self._requests):
                if sent is recorded:
                    self._requests[index] = dataclasses.replace(recorded, status=response.status)
        return response

    def _answer(self, request: Request, raw: bytes | None, headers: Mapping[str, str], path: str,
                query: dict[str, Any], body: Any, parts: list[str], operation: str) -> _Response:
        """Answer an API request: idempotency, then the route."""
        content_type = next((v for k, v in headers.items() if k.lower() == "content-type"), "")
        upload = next((v for k, v in headers.items() if k.lower() == "x-calmlens-upload"), "")
        key = next((v for k, v in headers.items() if k.lower() == "idempotency-key"), None)
        if key is not None:
            # HTTP stacks trim header values, so the API sees the key without surrounding whitespace.
            key = key.strip(" \t\r\n")
        # Like the API: raw uploads are told apart by their query, type and length, not their bytes.
        fingerprint = _json([request.get_method(), path, sorted(([k, v] for k, v in query.items()), key=str),
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
            status = {"folders.create": 201, "hashLists.create": 201, "policies.create": 201,
                      "assets.batch": 202}.get(operation, 200)
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
                raise _Failure(error_codes.ROUTE_NOT_FOUND, f"No route for {method} /{'/'.join(parts)}")
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
        if resource in ("policies", "policy"):
            return self._dispatch_policy(method, parts, body)
        if resource == "hash-lists":
            if method == "GET":
                lists = [cast(dict[str, Any], h) for h in self.database_storage.hash_lists.values()
                         if h["projectId"] == self.project_id]
                return self._page(lists, query, [self.project_id])
            return self._create_hash_list(body, now)
        suffix = parts[1] if len(parts) > 1 else ""
        if len(parts) == 3 and parts[2] == "timeline" and method == "GET":
            return self._timeline(self._asset(parts[1]), query)
        if suffix == "batch":
            return self._batch(body, now)
        if suffix == "search":
            return self._search(query)
        if not suffix and method == "GET":
            items = self._project_assets()
            if "folderId" in query:
                items = [a for a in items if a.get("folderId") == query["folderId"]]
            return self._page(items, query, [self.project_id, query.get("filter"), query.get("folderId")])
        return self._create_asset(upload, query, body, raw, now)

    def _folders_list(self, query: dict[str, Any]) -> dict[str, Any]:
        """Like the API: one keyset page of a parent's child folders, optionally matching ``search``,
        by ``name`` ascending unless ``ordering`` (one entry, ``name`` or ``createdAt``) says
        otherwise, with an ``id`` tie-breaker, and the ancestors of the listed folders."""
        everything = self._project_folders()
        search = query.get("search")
        found = [f for f in everything
                 if f.get("parentId") == query.get("parentId")
                 and (not search or str(search).lower() in f["name"].lower())]
        if len(query.get("ordering") or []) > 1:
            raise _invalid_field("validation/too-big", "ordering")
        result = self._page(found, query, [self.project_id, query.get("parentId"), search],
                            fields=("name", "createdAt"), default=[{"field": "name", "direction": "asc"}])
        page = result["items"]
        ids = list(dict.fromkeys([*([query["parentId"]] if query.get("parentId") else []),
                                  *(f["id"] for f in page)]))
        by_id = {f["id"]: f for f in everything}
        for identifier in ids:  # Grows while it runs, adding each ancestor.
            parent = by_id.get(identifier, {}).get("parentId")
            if parent and parent not in ids:
                ids.append(parent)
        page_ids = {f["id"] for f in page}
        result["ancestors"] = [f for f in everything if f["id"] in ids and f["id"] not in page_ids]
        return result

    def _create_asset(self, upload: str, query: dict[str, Any], body: dict[str, Any], raw: bytes | None,
                      now: int) -> dict[str, Any]:
        # The X-CalmLens-Upload header picks the mode: absent is a JSON body, "content" raw
        # file content and "part" the raw first part of a multipart upload.
        raw_upload = upload in ("content", "part")
        multipart = upload == "part"
        options = query if raw_upload else body
        _check_metadata(options.get("metadata"))
        mime = options.get("contentType", "")
        if raw_upload and not (isinstance(mime, str) and _is_accepted_upload_mime_type(mime)):
            # Like the API: an upload of a type CalmLens can't moderate is refused before it is stored.
            refused = _invalid_upload_mime_type(mime)
            raise _Failure(refused.code, refused.message, 400, refused.details)
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
            failure = (self._image_size_error(kind, total) if total is not None else None) or (
                (self._total_size_error(total, cast(int, size), True) or self._image_size_error(kind, cast(int, size)))
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
            "id": self.create_id("asset"), "projectId": self.project_id, "parentId": None,
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
                        "checksums": None,
                        # The mock decodes nothing, so the file's own details are unknown.
                        "width": None, "height": None, "durationSeconds": None, "pageCount": None,
                        "perceptualHash": None, "perceptualHashQuality": None, "metadata": None,
                        # Like the API, the rendered file and preview come with processing.
                        "extractedText": None, **_NO_RENDERING},
            "upload": {"status": "completed" if final else "uploading", "updatedAt": now,
                       "partsReceived": None if final else 1},
            "classification": {"status": "processing" if final else "pending", "failureReason": None, "updatedAt": now,
                               # The mock never reads test inputs.
                               "completedAt": None, "progress": None, "testInput": False,
                               "moderation": {"status": "pending", "manualReviews": [], "flaggedCategories": [], "regions": [],
                                              "timeline": None}},
        }
        if not final:
            self._uploads[asset["id"]] = {"queue": queue, "total": total}
            self.database_storage.assets[asset["id"]] = cast(Asset, asset)
            self.image_storage.content[asset["id"]] = {"type": mime, "parts": {1: raw or b""}}
            return asset
        if "url" not in options:
            asset["content"].update(_mock_rendering(asset, False))
        # Like the API: moderated as uploaded, then stored and recorded as uploaded and decided.
        decision = self._decision_for(asset, "upload", queue, (raw or b"") if raw_upload else None)
        uploaded = _event_asset(asset)
        self.database_storage.assets[asset["id"]] = cast(Asset, asset)
        if raw_upload and raw is not None:
            self.image_storage.content[asset["id"]] = {"type": mime, "parts": {1: raw}}
        if decision.status != "pending":
            self._decided(asset, decision)
        self._record_uploaded(asset, uploaded)
        self._record_processing_events(asset, decision)
        return asset

    @staticmethod
    def _image_size_error(kind: str, size: int) -> str | None:
        """Like the API: image uploads in parts total at most 20 MiB."""
        return error_codes.MULTIPART_IMAGE_TOO_LARGE if kind == "image" and size > 20 * _MIB else None

    @staticmethod
    def _total_size_error(total: int | None, received: int, final: bool) -> str | None:
        """Like the API: the parts may not overshoot a declared total, and must reach it at the end."""
        if total is None:
            return None
        return error_codes.UPLOAD_SIZE_MISMATCH if received > total or (final and received != total) else None

    def _decision_for(self, asset: dict[str, Any], trigger: MockModerationTrigger, queued: bool,
                      data: bytes | None | Literal[False] = False) -> MockDecision:
        """Ask ``moderate`` how to decide ``asset``, with its content: ``data`` when the caller has
        it, otherwise the stored parts in order (none once the content is removed)."""
        if data is False:
            stored = None if asset["content"]["status"] == "removed" else self.image_storage.content.get(asset["id"])
            data = b"".join(part for _, part in sorted(stored["parts"].items())) if stored else None
        text = data.decode("utf-8", "replace") if data is not None and asset["type"] == "plaintext-document" else None
        moderation = MockModerationInput(asset=cast(Asset, copy.deepcopy(asset)),
                                         content=MockModerationContent(bytes=data, text=text),
                                         trigger=trigger, queued=queued)
        return _to_decision(self.moderate(moderation))

    def _decided(self, asset: dict[str, Any], decision: MockDecision) -> None:
        """Decide ``asset`` as ``decision`` says, with its report. Like the API for an image with
        nobody in it, a decided image reports the person and face detection its upload turned on."""
        self._apply_outcome(asset, decision.status, "policy", decision.report())
        classification = asset["classification"]
        if classification["status"] != "completed" or asset["type"] != "image":
            return
        features = (asset.get("processingOptions") or {}).get("features") or {}
        if (features.get("personDetection") or {}).get("enabled") is True:
            classification["personDetection"] = {"status": "evaluated", "stage": "beta", "people": []}
        if (features.get("faceDetection") or {}).get("enabled") is True:
            classification["faceDetection"] = {"status": "evaluated", "stage": "beta", "faces": []}

    def _moderate_stored(self, asset: dict[str, Any], trigger: MockModerationTrigger,
                         decision: MockDecision | None = None) -> None:
        """Ask ``moderate`` (unless ``decision`` is given) and settle a processing asset: a decision
        gets its report and events, and ``pending`` leaves it processing."""
        settled = decision if decision is not None else self._decision_for(asset, trigger, True)
        if settled.status == "pending":
            return
        self._decided(asset, settled)
        self._record_processing_events(asset, settled)

    def _record_uploaded(self, asset: Mapping[str, Any], snapshot: EventAsset) -> None:
        """``asset.uploaded``, as the API records it when an upload completes, with the asset as
        it was before moderation."""
        self.enqueue_event("asset.uploaded", asset_id=asset["id"], facts=cast(list[EventFact], [
            {"key": "asset-type", "value": asset["type"]}, _asset_name_fact(asset),
            {"key": "file-format", "value": asset["content"].get("format")}]))
        self.database_storage.events[-1]["asset"] = snapshot

    def _record_processing_events(self, asset: Mapping[str, Any], decision: MockDecision) -> None:
        """The events the pipeline records when it settles an asset: ``asset.classified`` and the
        automated ``asset.<status>``, or ``asset.failed``."""
        status = decision.status
        if status == "pending":
            return
        if status == "failed":
            self.enqueue_event("asset.failed", asset_id=asset["id"], severity="high", facts=cast(list[EventFact], [
                _asset_name_fact(asset), {"key": "asset-type", "value": asset["type"]},
                {"key": "previous-status", "value": "processing"},
                {"key": "failure-reason", "value": asset["classification"].get("failureReason") or "processing-error"}]))
            return
        report = decision.report() or {}
        flagged = list(report["flaggedCategories"]) if report else []
        self.enqueue_event("asset.classified", asset_id=asset["id"], facts=cast(list[EventFact], [
            {"key": "flagged-categories", "value": flagged}, {"key": "moderation-status", "value": status},
            {"key": "asset-type", "value": asset["type"]}, _asset_name_fact(asset)]))
        # Like the event catalog: only allowing and limiting are low severity.
        self.enqueue_event("asset." + status, asset_id=asset["id"],
                           severity="low" if status in ("allowed", "limited") else "high",
                           facts=cast(list[EventFact], [
                               {"key": "decided-by", "value": "automated"},
                               {"key": "flagged-categories", "value": list(flagged)},
                               {"key": "asset-type", "value": asset["type"]}, _asset_name_fact(asset)]))

    def _apply_outcome(self, asset: dict[str, Any], outcome: str, purge_reason: str = "policy",
                       report: Mapping[str, Any] | None = None) -> None:
        """Move ``asset`` to ``outcome`` like the pipeline would: a decision finishes processing,
        ``purged`` deletes the content (``purge_reason``: ``policy`` for the pipeline, ``requested``
        for a reviewer), and finished processing removes content kept only temporarily. A decided
        asset gets its rendered file and preview (with a ThumbHash for its placeholder), which go
        with its content."""
        now = self.now()
        decided = outcome not in ("pending", "failed")
        status = "completed" if decided else "failed" if outcome == "failed" else "processing"
        content = asset["content"]
        purge = outcome == "purged" and content["status"] != "removed"
        remove = purge or (status == "completed" and content["status"] == "temporary")
        # Like the API, an asset whose content is held has its rendered file and preview, completed
        # by its decision, and removing content (when processing finishes or by purging) removes
        # them with it, so no placeholder outlives the content. A safety hold withholds them.
        content.update(_mock_rendering(asset, decided)
                       if content["status"] != "removed" and not purge and not content.get("safetyHold")
                       else _NO_RENDERING)
        if remove:
            self.image_storage.content.pop(asset["id"], None)
            content.update(status="removed", removalReason=purge_reason if purge else "retention", updatedAt=now,
                           extractedText=None, metadata=None, **_NO_RENDERING)
            asset["context"] = None
        asset["classification"].update(status=status, updatedAt=now, completedAt=now if decided else None,
                                       failureReason="processing-error" if outcome == "failed" else None)
        asset["classification"]["moderation"].update(status=outcome if decided else "pending", **(report or {}))
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
        if number != expected or cast(int, number) > _MAX_UPLOAD_PARTS:
            raise _Failure(error_codes.INVALID_UPLOAD_PART_NUMBER, f"Expected part {expected}",
                           details={"expectedPartNumber": expected, "receivedPartNumber": number})
        final = bool(query.get("isFinal"))
        received = (asset["content"].get("sizeInBytes") or 0) + len(raw or b"")
        failure = (self._image_size_error(asset["type"], received)
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
            self._apply_outcome(asset, "pending")
            uploaded = _event_asset(asset)
            decision = self._decision_for(asset, "upload", queue)
            if decision.status != "pending":
                self._decided(asset, decision)
            self._record_uploaded(asset, uploaded)
            self._record_processing_events(asset, decision)

    def _dispatch_asset(self, method: str, identifier: str, suffix: str, query: dict[str, Any],
                        body: dict[str, Any], raw: bytes | None) -> Any:
        assets = self.database_storage.assets
        now = self.now()
        # Like the API, the request schema is checked before the asset is looked up.
        if method == "PATCH" and not suffix:
            _check_metadata(body.get("metadata"))
            if "name" in body and body["name"] is None:
                raise _invalid_field("validation/invalid-type", "name")
        if suffix == "signed-url":
            # None of these fields takes null, and the resource must be one a signed URL serves.
            for key in ("viewerClaims", "resource", "lens", "transform", "expiresInSeconds"):
                if key in body and body[key] is None:
                    raise _invalid_field("validation/invalid-value" if key == "resource" else "validation/invalid-type",
                                         key)
            if body.get("resource", "rendered") not in SIGNED_CDN_RESOURCES:
                raise _invalid_field("validation/invalid-value", "resource")
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
            if isinstance(body.get("viewerClaims"), dict):
                # Like the API, the URL carries the viewer claims its signature covers.
                claims = json.dumps(body["viewerClaims"], separators=(",", ":"))
                selector += f"&viewerClaims={quote(claims, safe='')}"
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
            self._moderate_stored(asset, "retry")
            return asset
        if suffix == "decision":
            return self._decide_request(asset, body)
        if suffix == "explain":
            if asset["classification"]["status"] != "completed":
                raise _Failure(error_codes.ASSET_NOT_DECIDED)
            moderation = asset["classification"]["moderation"]
            if not body.get("rerun"):
                # Like the API: the evidence is completed and every action stays as decided.
                if moderation.get("explanationComplete") is False:
                    moderation["explanationComplete"] = True
                    asset["updatedAt"] = now
                return asset
            if moderation.get("manualReviews"):
                raise _Failure(error_codes.ASSET_REVIEWED)
            if asset["content"]["status"] == "removed":
                raise _Failure(error_codes.ASSET_CONTENT_UNAVAILABLE)
            # Like the API: back to processing, to be moderated again under the current policy.
            self._apply_outcome(asset, "pending")
            self._moderate_stored(asset, "rerun")
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
            content.update(_NO_RENDERING)
        else:
            content.update(status="removed", removalReason="requested", updatedAt=now, extractedText=None,
                           metadata=None, **_NO_RENDERING)
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
                     "createdAt": now, "updatedAt": now}
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
            content = self._asset(asset_id)["content"]
            if not content.get("perceptualHash"):
                raise _Failure(error_codes.HASH_LIST_ASSET_NOT_HASHED)
            hash_value, quality = content["perceptualHash"], content.get("perceptualHashQuality")
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
                 "sourceAssetId": asset_id, "createdAt": self.now()}
        entries[entry["id"]] = cast(HashListEntry, entry)
        return _Answer(201, entry)

    # Policies: the project starts on the organisation's own General preset policy, following
    # automatic updates. The mock holds no built-in preset settings: a preset's settings are
    # ``{"categorySettings": {}}`` at version 1, and uploads are never decided by a policy.

    def _new_policy(self, name: str, settings: dict[str, Any], *, description: str = "",
                    automatic_updates: bool = False, preset: dict[str, Any] | None = None) -> dict[str, Any]:
        now = self.now()
        policy: dict[str, Any] = {"id": self.create_id("pol"), "name": name, "description": description, "settings": settings,
                  "revision": 1, "automaticUpdates": automatic_updates, "preset": preset,
                  "baseline": copy.deepcopy(settings), "createdAt": now, "updatedAt": now}
        self._policies[policy["id"]] = policy
        return policy

    def _ensure_policies(self) -> None:
        if self._project_policy_id is None:
            general = self._new_policy(_MOCK_PRESET_NAMES["general-community"], {"categorySettings": {}},
                                       automatic_updates=True,
                                       preset={"id": "general-community", "version": 1, "own": True})
            self._project_policy_id = general["id"]

    def _policy_view(self, policy: dict[str, Any]) -> dict[str, Any]:
        """A stored policy as the API shows it."""
        shown = {key: value for key, value in policy.items() if key != "baseline"}
        if policy["preset"] is not None:
            shown["preset"] = {**policy["preset"], "latestVersion": 1}
        shown["projectIds"] = [self.project_id] if policy["id"] == self._project_policy_id else []
        return shown

    def _find_policy(self, policy_id: str) -> dict[str, Any]:
        self._ensure_policies()
        policy = self._policies.get(policy_id)
        if policy is None:
            raise _Failure(error_codes.POLICY_NOT_FOUND)
        return policy

    def _save_policy(self, policy: dict[str, Any], revision: Any, values: Mapping[str, Any]) -> dict[str, Any]:
        """Saves new values under the next revision, once ``revision`` is the current one."""
        if revision != policy["revision"] or isinstance(revision, bool):
            raise _Failure(error_codes.POLICY_REVISION_CONFLICT)
        policy.update(values, revision=policy["revision"] + 1, updatedAt=self.now())
        return self._policy_view(policy)

    def _dispatch_policy(self, method: str, parts: list[str], body: dict[str, Any]) -> Any:
        self._ensure_policies()
        if parts[0] == "policy":
            policy = self._find_policy(str(body.get("policyId")))
            self._project_policy_id = policy["id"]
            return self._policy_view(policy)
        if len(parts) == 1:
            if method == "GET":
                return {"policies": [self._policy_view(p) for p in self._policies.values()],
                        "projectPolicyId": self._project_policy_id}
            return self._create_policy(body)
        policy = self._find_policy(parts[1])
        action = parts[2] if len(parts) > 2 else ""
        if action == "preset":
            preset = policy["preset"]
            if preset is None or policy["automaticUpdates"]:
                raise _Failure(error_codes.POLICY_NO_PRESET)
            if body.get("presetVersion") != preset["version"]:
                raise _Failure(error_codes.POLICY_PRESET_VERSION_CONFLICT)
            # The mock's presets have one release, so an update never has a newer one to apply.
            if body.get("operation") == "update":
                raise _Failure(error_codes.POLICY_PRESET_UPDATE_UNAVAILABLE)
            return self._save_policy(policy, body.get("revision"), {"settings": copy.deepcopy(policy["baseline"])})
        if action == "automatic-updates":
            enabled = body.get("enabled") is True
            preset = policy["preset"]
            if preset is None or not preset["own"] or policy["automaticUpdates"] == enabled:
                raise _Failure(error_codes.POLICY_AUTOMATIC_UPDATES_UNAVAILABLE)
            if body.get("revision") != policy["revision"]:
                raise _Failure(error_codes.POLICY_REVISION_CONFLICT)
            if body.get("presetVersion") != 1:
                raise _Failure(error_codes.POLICY_PRESET_VERSION_CONFLICT)
            values: dict[str, Any] = {"automaticUpdates": enabled}
            if enabled:
                values.update(name=_MOCK_PRESET_NAMES[preset["id"]], description="",
                              settings=copy.deepcopy(policy["baseline"]))
            return self._save_policy(policy, body.get("revision"), values)
        if method == "GET":
            return self._policy_view(policy)
        if method == "DELETE":
            if policy["id"] == self._project_policy_id:
                raise _Failure(error_codes.POLICY_IN_USE)
            del self._policies[policy["id"]]
            return None
        values = {key: body[key].strip() if key == "name" else body[key]
                  for key in ("name", "description") if isinstance(body.get(key), str)}
        if "settings" in body:
            values["settings"] = body["settings"]
        # Saving a policy that follows its preset pins it as a copy.
        values["automaticUpdates"] = False
        return self._save_policy(policy, body.get("revision"), values)

    def _create_policy(self, body: dict[str, Any]) -> dict[str, Any]:
        name, preset_id, settings = body.get("name"), body.get("presetId"), body.get("settings")
        named = isinstance(name, str) and bool(name.strip())
        if (settings is None) == (preset_id is None) or (preset_id is not None and preset_id not in _MOCK_PRESET_NAMES) \
                or (preset_id is None and not named):
            raise _Failure(error_codes.INVALID_VALUE, "Send settings with a name, or presetId")
        description = body["description"] if isinstance(body.get("description"), str) else ""
        if preset_id is not None:
            policy = self._new_policy(cast(str, name).strip() if named else _MOCK_PRESET_NAMES[preset_id],
                                      {"categorySettings": {}}, description=description,
                                      preset={"id": preset_id, "version": 1, "own": False})
        else:
            policy = self._new_policy(cast(str, name).strip(), cast(dict[str, Any], settings), description=description)
        return self._policy_view(policy)

    def _lenses_put(self, body: dict[str, Any], now: int) -> dict[str, Any]:
        # Each definition is saved in turn, so earlier ones stay saved when a later one conflicts.
        result = []
        for definition in body["lenses"]:
            old = self._mock_lenses.get(definition["identifier"])
            if old is None:
                lens = {"id": self.create_id("lens"), "projectId": self.project_id, **definition,
                        "createdAt": now, "updatedAt": now}
            elif all(old.get(k) == definition.get(k) for k in ("name", "description", "type", "active",
                                                                  "transform", "version")):
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
        # taken before them. Like the API, ``nextCursor`` is never null. The mock's key holds every
        # permission, so no event type is excluded.
        size = _bounded_int(query.get("pageSize", _DEFAULT_PAGE_SIZE), "pageSize", _MAX_PAGE_SIZE)
        events = [e for e in self.database_storage.events if e["projectId"] == self.project_id]
        cursor = query.get("cursor")
        if not cursor:
            return {"items": [], "nextCursor": f"mock_{len(events)}", "hasMore": False, "excludedTypes": []}
        found = re.fullmatch(r"mock_([0-9]+)", str(cursor))
        if not found or int(found.group(1)) > len(events):
            raise _Failure(error_codes.INVALID_CURSOR)
        position = int(found.group(1))
        page = events[position:position + size]
        following = position + len(page)
        return {"items": page, "nextCursor": f"mock_{following}", "hasMore": following < len(events),
                "excludedTypes": []}

    @staticmethod
    def _timeline(asset: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
        # An asset's findings timeline, as the API lists it: refused while a safety hold is on.
        # The mock analyses no audio or video, so it keeps no segments: every timeline is empty,
        # and no cursor continues one.
        size = _bounded_int(query.get("pageSize", _DEFAULT_PAGE_SIZE), "pageSize", _MAX_PAGE_SIZE)
        if asset["content"].get("safetyHold"):
            raise _Failure(error_codes.ASSET_SAFETY_HELD)
        if query.get("cursor") is not None:
            raise _Failure(error_codes.INVALID_CURSOR)
        return {"items": [], "nextCursor": None, "pageSize": size, "hasMore": False, "ordering": []}

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
    def _page(items: list[dict[str, Any]], query: dict[str, Any], scope: Any,
              fields: tuple[str, ...] = ("createdAt", "id"),
              default: list[dict[str, str]] | None = None) -> dict[str, Any]:
        """One keyset page like the API's: ordered by ``fields`` (``createdAt`` descending by
        default; an ``id`` tie-breaker is added), after the cursor's values. The cursor is tied to
        ``scope`` (the filter, folder or parent) and the ordering, so it only continues the query
        it came from."""
        size = _bounded_int(query.get("pageSize", _DEFAULT_PAGE_SIZE), "pageSize", _MAX_PAGE_SIZE)
        ordering = [dict(order) for order in
                    query.get("ordering") or default or [{"field": "createdAt", "direction": "desc"}]]
        for index, order in enumerate(ordering):
            if order.get("field") not in fields:
                raise _invalid_field(error_codes.INVALID_VALUE, f"ordering.{index}.field")
            if order.get("direction") not in ("asc", "desc"):
                raise _invalid_field(error_codes.INVALID_VALUE, f"ordering.{index}.direction")
        if query.get("filter"):
            try:
                matches = _rsql(query["filter"])
            except _InvalidFilter:
                raise _Failure(error_codes.INVALID_FILTER, "Invalid filter") from None
            items = [item for item in items if matches(item)]
        if not any(o["field"] == "id" for o in ordering):
            ordering.append({"field": "id", "direction": ordering[0]["direction"]})
        signature = _json([scope, ordering])
        for order in reversed(ordering):
            field_name = str(order["field"])
            items = sorted(items, key=lambda item: cast(Any, item[field_name]),
                           reverse=order["direction"] == "desc")
        if query.get("cursor"):
            try:
                decoded = json.loads(base64.b64decode(query["cursor"], validate=True).decode("utf-8"))
                values = decoded.get("values") if isinstance(decoded, dict) else None
                if decoded.get("scope") != signature or not isinstance(values, list) or len(values) != len(ordering) \
                        or any(not isinstance(value, str) if o["field"] in ("id", "name") else
                               isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                               for o, value in zip(ordering, values)):
                    raise ValueError("Invalid cursor")
            except (ValueError, TypeError, AttributeError):
                raise _Failure(error_codes.INVALID_CURSOR) from None

            def follows(item: dict[str, Any]) -> bool:
                for order, boundary in zip(ordering, values):
                    if item[order["field"]] != boundary:
                        return bool(item[order["field"]] < boundary) if order["direction"] == "desc" \
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
        selector_path = segments[4:]
        no_rendered_version = _Failure("asset/no-rendered-version", "This asset has no such resource", 404)
        invalid_transform = _Failure("asset/invalid-transform", "Invalid transform selector", 400)
        # Like the CDN, ``/rendered/stream`` and ``/rendered/player`` are reserved, then the
        # selector after the resource is read; the original takes none.
        if resource == "rendered" and selector_path and selector_path[0] in _RESERVED_RENDERED_PATHS:
            return self._failure_response(no_rendered_version)
        try:
            lens, transform_options = _parse_transform_selector("/".join(selector_path))
        except _InvalidSelector:
            return self._failure_response(invalid_transform)
        has_selector = lens is not None or transform_options is not None
        if resource == "original" and has_selector:
            return self._failure_response(invalid_transform)
        not_available = _Failure("asset/not-available", "Asset is not available", 403)
        with self._state_lock:
            asset = next((a for a in self.database_storage.assets.values()
                          if a["projectId"] == project == self.project_id
                          and (a["id"] == identifier or a.get("externalId") == identifier)), None)
            if asset is None:
                return self._failure_response(_Failure(error_codes.ASSET_NOT_FOUND, "Asset not found", 404))
            status = asset["classification"]["moderation"].get("status")
            rendered = cast(Optional[dict[str, Any]], asset["content"].get("rendered"))
            preview = cast(Optional[dict[str, Any]], asset["content"].get("preview"))
            # Like the CDN, a safety hold refuses every resource.
            if asset["content"].get("safetyHold"):
                return self._failure_response(not_available)
            if resource == "placeholder":
                # Like the CDN's placeholder handler: the preview's ThumbHash, served publicly for
                # every asset whatever its visibility or moderation status; refused for purged
                # assets and assets without one (not yet processed, without a preview, or content
                # removed).
                thumbhash = (preview or {}).get("thumbhash")
                if not thumbhash or status == "purged":
                    return self._failure_response(not_available)
                return self._cdn_response(method, _thumbhash_png(thumbhash), {
                    "Content-Type": "image/png", "Cache-Control": "public, max-age=3600",
                    "Cache-Tag": f"asset-{asset['id']}", "ETag": f'"{thumbhash}"'})
            # Like the CDN, delivery checks come first and refuse everyone: content still uploading,
            # blocked or purged, failed processing or removed content.
            stored = self.image_storage.content.get(asset["id"])
            if (asset["upload"]["status"] == "uploading" or status in ("blocked", "purged")
                    or asset["classification"]["status"] == "failed"
                    or asset["content"]["status"] == "removed" or (resource == "original" and stored is None)):
                return self._failure_response(not_available)
            # Then access: age-restricted assets need ``viewerClaims.ageConfirmed=true`` whatever
            # the key, and private assets need the download permission for the asset's folder.
            claims = json.loads(query.get("viewerClaims", "{}"))
            if status == "age-restricted" and claims.get("ageConfirmed") is not True:
                return self._failure_response(_Failure("viewer/age-confirmation-required", "Age confirmation required", 403))
            private = asset["visibility"] != "public"
            if private and not self._can_download(asset.get("folderId")):
                return self._failure_response(_Failure(
                    "asset/api-key-missing-permission",
                    "This API key needs assets:download permission for this asset’s folder.", 403))
            # Then whether the asset has the resource, and whether it is a still image that takes a
            # lens or transform: the preview always is, the rendered file only when it is an image.
            if (resource == "rendered" and not rendered) or (resource == "preview" and not preview):
                return self._failure_response(no_rendered_version)
            still_image = resource == "preview" or (resource == "rendered" and (rendered or {}).get("kind") == "image")
            if not still_image and has_selector:
                return self._failure_response(invalid_transform)
            # Then the options, checked against the transform schema once the asset may be served.
            if transform_options is not None:
                unknown_keys, invalid_keys = _check_transform_options(transform_options)
                if unknown_keys or invalid_keys:
                    return self._failure_response(_Failure(
                        "asset/invalid-transform-options",
                        f"Invalid transform options: {', '.join([*unknown_keys, *invalid_keys])}", 400))
            # The bytes: the upload, which stands in for its own rendered file and an image's
            # preview, or the placeholder PNG for a still the mock doesn't make.
            serves_upload = (resource == "original" or (resource == "rendered" and (rendered or {}).get("kind") != "image")
                             or asset["type"] == "image")
            if serves_upload:
                if stored is None:
                    return self._failure_response(not_available)
                content = b"".join(v for _, v in sorted(stored["parts"].items()))
                content_type = (rendered["format"] if resource == "rendered" and rendered
                                else stored["type"] or "application/octet-stream")
            else:
                content = _thumbhash_png((preview or {}).get("thumbhash") or _MOCK_THUMBHASH)
                content_type = "image/png"
            immutable = still_image or (resource == "original" and asset["type"] == "image")
            # Like the CDN: a still image's bytes are immutable for a year, other content is kept
            # for an hour, by shared caches only when delivery is public.
            headers = {"Content-Type": content_type,
                       "Cache-Control": f"{'private' if private else 'public'}, "
                                        f"{'max-age=31536000, immutable' if immutable else 'max-age=3600'}",
                       "Cache-Tag": f"asset-{asset['id']}"}
            if immutable:
                headers["ETag"] = f'"{asset["id"]}"'
                headers["Expires"] = email.utils.formatdate(self.now() / 1000 + 31536000, usegmt=True)
            if claims:
                headers["Cache-Control"] = "private, no-store"
                headers.pop("Expires", None)
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
