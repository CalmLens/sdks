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
import fnmatch
import hashlib
import io
import json
import math
import re
import threading
import time
import uuid
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict, Union, cast
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit
from urllib.request import Request

from . import error_codes
from .client import DEFAULT_CONNECT_TIMEOUT, DEFAULT_TIMEOUT, CalmLensServerClient, _invalid, _json
from .errors import CalmLensError
from .types import Asset, Event, EventAsset, EventFact, EventSeverity, EventType, Folder

__all__ = ["MockCalmLensServerClient", "MockRequest", "MockOptions", "MockAssetOutcome", "MockApiKeyGrant",
           "StoredContent",
           "InMemoryMockDatabaseStorage", "InMemoryMockImageStorage", "create_mock_api_key"]

_MOCK_OPTIONS = {"database_storage", "image_storage", "create_id", "now", "queued_outcome",
                 "analyzed_outcome", "signed_url_base_url"}
_MOCK_OUTCOMES = ("pending", "approved", "rejected", "failed")

#: Where a mock upload ends up: ``pending`` (still processing), ``approved`` or ``rejected``
#: (processing done with that decision) or ``failed`` (processing failed, retryable).
MockAssetOutcome = Literal["pending", "approved", "rejected", "failed"]
_INT_QUERY = {"pageSize", "pageIndex", "limit", "partNumber", "sizeInBytes", "totalSizeInBytes"}
_BOOL_QUERY = {"queue", "isFinal", "searchAll", "resolveOnly"}
_JSON_QUERY = {"metadata", "processingOptions"}
_MIB = 1024 * 1024


class MockApiKeyGrant(TypedDict):
    """A CDN download grant carried by a fake API key."""
    #: Granted actions, such as ``"assets:download"``.
    actions: list[str]
    #: Folder the grant covers; ``None`` covers the whole project.
    folderId: Union[str, None]
    includeSubfolders: bool


def create_mock_api_key(grants: list[MockApiKeyGrant] | None = None) -> str:
    """A fake API key carrying CDN download ``grants`` such as
    ``[{"actions": ["assets:download"], "folderId": None, "includeSubfolders": True}]``."""
    return "sk_test_" + base64.urlsafe_b64encode(_json(grants or []).encode()).decode().rstrip("=")


class InMemoryMockDatabaseStorage:
    """Assets, folders and events by ID; inspect or seed them between calls."""

    def __init__(self) -> None:
        self.assets: dict[str, Asset] = {}
        self.folders: dict[str, Folder] = {}
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


def _rsql(expression: str) -> Callable[[Mapping[str, Any]], bool]:
    """A subset of RSQL: ``;`` (and), ``,`` (or), ``==`` (``*`` wildcards), ``!=``,
    ``=in=``, ``=out=``, ``=gt=``, ``=ge=``, ``=lt=``, ``=le=`` and quoted values."""
    tokens = re.findall(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|[;,()]|[^;,()"\']+', expression)
    if "".join(tokens) != expression:
        raise NotImplementedError(f"MockCalmLensServerClient cannot parse the filter {expression!r}")

    def unquote_value(value: str) -> str:
        value = value.strip()
        return value[1:-1].replace('\\"', '"').replace("\\'", "'") if value[:1] in "\"'" else value

    def comparison(text: str) -> Callable[[Mapping[str, Any]], bool]:
        found = re.fullmatch(r"\s*([\w.]+)\s*(==|!=|=in=|=out=|=gt=|=ge=|=lt=|=le=)(.*)", text, re.S)
        if not found:
            raise NotImplementedError(f"MockCalmLensServerClient cannot evaluate the filter {text!r}")
        name, operator, raw = found.groups()
        raw = raw.strip()
        values = ([unquote_value(v) for v in re.findall(r'"(?:[^"\\]|\\.)*"|[^,()]+', raw[1:-1])]
                  if raw.startswith("(") else [unquote_value(raw)])

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

    # Group comparisons; a "(" that follows =in=/=out= belongs to the value list.
    groups: list[list[str]] = [[]]
    current = ""
    depth = 0
    for token in tokens:
        if token == "(":
            if not re.search(r"=(in|out)=\s*$", current):
                raise NotImplementedError("MockCalmLensServerClient filters do not support parentheses for grouping")
            depth += 1
        elif token == ")":
            depth -= 1
        if depth == 0 and token in (";", ","):
            groups[-1].append(current)
            current = ""
            if token == ",":
                groups.append([])
        else:
            current += token
    groups[-1].append(current)
    alternatives = [[comparison(text) for text in group] for group in groups]
    return lambda asset: any(all(test(asset) for test in group) for group in alternatives)


class MockOptions(TypedDict, total=False):
    """``mock_options`` for :class:`MockCalmLensServerClient`."""
    database_storage: InMemoryMockDatabaseStorage
    image_storage: InMemoryMockImageStorage
    #: Returns new asset, folder, lens and event IDs.
    create_id: Callable[[], str]
    #: Returns the current time in milliseconds since the Unix epoch.
    now: Callable[[], int]
    #: Outcome of assets submitted with ``create`` (and queued multipart uploads). Defaults to
    #: ``pending``.
    queued_outcome: MockAssetOutcome
    #: Outcome of assets submitted with ``classify`` and ``text.classify``. Defaults to
    #: ``approved``.
    analyzed_outcome: MockAssetOutcome
    signed_url_base_url: str


class MockCalmLensServerClient(CalmLensServerClient):
    """Stateful offline client accepting the real client's configuration (without
    ``transport``). Retries are off by default (``max_retries=0``) so enqueued failures
    surface; pass ``max_retries`` to exercise retry handling. Waits take no real time:
    ``assets.wait_for_decision`` checks ``database_storage`` and returns a decided asset, or
    raises ``sdk/timeout`` at once for one whose moderation stays ``pending``."""

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
        self._state_lock = threading.RLock()
        self._requests: list[MockRequest] = []
        self._errors: list[BaseException] = []
        self._idempotent: dict[str, tuple[str, int, bytes]] = {}
        self._uploads: dict[str, dict[str, Any]] = {}
        self._mock_lenses: dict[str, dict[str, Any]] = {}
        self.database_storage = options.get("database_storage") or InMemoryMockDatabaseStorage()
        if not hasattr(self.database_storage, "events"):
            self.database_storage.events = []
        self.image_storage = options.get("image_storage") or InMemoryMockImageStorage()
        self.create_id: Callable[[], str] = options.get("create_id", lambda: str(uuid.uuid4()))
        self.now: Callable[[], int] = options.get("now", lambda: int(time.time() * 1000))
        self.queued_outcome: MockAssetOutcome = options.get("queued_outcome", "pending")
        self.analyzed_outcome: MockAssetOutcome = options.get("analyzed_outcome", "approved")
        for outcome in (self.queued_outcome, self.analyzed_outcome):
            if outcome not in _MOCK_OUTCOMES:
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

    def enqueue_event(self, type: EventType, *, facts: list[EventFact] | None = None, severity: EventSeverity = "low",
                      title: str | None = None, description: str | None = None,
                      asset_id: str | None = None) -> Event:
        """Add an event to the feed returned by ``events.list`` (and ``events.iter``).
        ``facts`` are ``{"key", "value", "url"?}`` entries registered for ``type``. When
        ``asset_id`` names a stored asset, the event carries a snapshot of its decision, as
        the API's events do."""
        with self._state_lock:
            stored = self.database_storage.assets.get(asset_id) if asset_id else None
            asset: EventAsset | None = None
            if stored is not None:
                asset = {"id": stored["id"], "externalId": stored.get("externalId"),
                         "uploadPresetId": stored.get("uploadPresetId"),
                         "upload": {"status": stored["upload"]["status"]},
                         "classification": {'status': stored['classification']['status'], 'moderation': {'decision': stored['classification']['moderation']['decision'], 'action': stored['classification']['moderation']['action']}},
                         "content": {"status": stored["content"]["status"]}}
            now = self.now()
            event: Event = {"id": self.create_id(), "projectId": self.project_id, "userId": None, "type": type,
                     "severity": severity, "title": title or type, "description": description, "assetId": asset_id,
                     "asset": asset, "facts": copy.deepcopy(facts or []), "notify": False,
                     "createdAt": now, "updatedAt": now, "readAt": None}
            self.database_storage.events.append(event)
            return copy.deepcopy(event)

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

    def _serve(self, request: Request, timeout: float) -> _Response:
        data: Any = request.data
        raw: bytes | None = data.read() if hasattr(data, "read") else data
        headers = dict(request.header_items())
        cdn = request.full_url.startswith(self.cdn_base_url + "/")
        relative = request.full_url.removeprefix(self.cdn_base_url if cdn else self.base_url)
        url = urlsplit(relative)
        query = _decode_query(parse_qsl(url.query, keep_blank_values=True))
        content_type = next((v for k, v in headers.items() if k.lower() == "content-type"), "")
        body: Any = raw
        if raw is not None and content_type == "application/json":
            body = json.loads(raw)
        with self._state_lock:
            self._requests.append(MockRequest(method=request.get_method(), url=request.full_url, path=url.path,
                                              query=copy.deepcopy(query), body=copy.deepcopy(body),
                                              headers=copy.deepcopy(headers)))
            error = self._errors.pop(0) if self._errors else None
        if isinstance(error, CalmLensError):
            return self._failure_response(error, error.retry_after)
        if error is not None:
            raise error
        if cdn:
            return self._serve_cdn(request.get_method(), url.path)
        key = next((v for k, v in headers.items() if k.lower() == "idempotency-key"), None)
        upload = next((v for k, v in headers.items() if k.lower() == "x-calmlens-upload"), "")
        fingerprint = hashlib.sha256(_json([request.get_method(), url.path, sorted(query.items(), key=str),
                                            base64.b64encode(raw or b"").decode()]).encode()).hexdigest()
        with self._state_lock:
            if key is not None:
                saved = self._idempotent.get(key)
                if saved is not None:
                    if saved[0] != fingerprint:
                        return self._failure_response(_Failure(error_codes.IDEMPOTENCY_KEY_REUSED))
                    return self._respond(saved[1], body=saved[2], headers={
                        "Idempotent-Replayed": "true", "Content-Type": "application/json"})
            try:
                result = copy.deepcopy(self._dispatch(request.get_method(), url.path, query,
                                                      body if isinstance(body, dict) else {}, raw, upload))
            except _Failure as failure:
                return self._failure_response(failure)
            response = self._respond(200, result) if result is not None else self._respond(204)
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
                raise _Failure(error_codes.DUPLICATE_FOLDER_NAME)

    def _project_assets(self) -> list[dict[str, Any]]:
        return [cast(dict[str, Any], a) for a in self.database_storage.assets.values()
                if a["projectId"] == self.project_id]

    def _dispatch(self, method: str, path: str, query: dict[str, Any], body: dict[str, Any], raw: bytes | None,
                  upload: str) -> Any:
        parts = [unquote(p) for p in path.strip("/").split("/")]
        if parts[0] == "projects":
            if parts[1] != self.project_id:
                raise _Failure(error_codes.PROJECT_NOT_FOUND)
            return self._dispatch_project(method, parts[2:], query, body, raw, upload)
        resource, identifier = parts[0], parts[1]
        suffix = parts[2] if len(parts) > 2 else ""
        if resource == "assets":
            return self._dispatch_asset(method, identifier, suffix, query, body, raw)
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
            folders = self.database_storage.folders
            if method == "GET":
                all_folders = [f for f in folders.values() if f["projectId"] == self.project_id]
                found = [f for f in all_folders if ((query.get("searchAll") and query.get("search")) or f.get("parentId") == query.get("parentId")) and (not query.get("search") or query["search"].lower() in f["name"].lower())]
                found.sort(key=lambda f: (f.get("createdAt", 0) if query.get("sort") == "createdAt" else f["name"], f["id"]), reverse=query.get("direction") == "DESC")
                size = query.get("pageSize", 100)
                start = query.get("pageIndex", 0) * size
                page = [] if query.get("resolveOnly") else found[start:start + size]
                ids = set(query.get("ids") or []) | {f["id"] for f in page}
                if query.get("parentId"): ids.add(query["parentId"])
                queue = list(ids)
                while queue:
                    node = folders.get(queue.pop())
                    parent = node.get("parentId") if node else None
                    if parent and parent not in ids: ids.add(parent); queue.append(parent)
                return {"folders": page, "ancestors": [f for f in all_folders if f["id"] in ids and f not in page], "hasMore": not query.get("resolveOnly", False) and len(found) > start + size}
            if body.get("parentId"):
                self._folder(body["parentId"])
            self._unique(body["name"], body.get("parentId"))
            folder = {**body, "parentId": body.get("parentId"), "id": self.create_id(), "projectId": self.project_id,
                      "createdAt": now, "updatedAt": now}
            folders[folder["id"]] = cast(Folder, folder)
            return folder
        suffix = parts[1] if len(parts) > 1 else ""
        if suffix == "search":
            return self._search(query)
        if suffix == "page":
            items = self._project_assets()
            if query.get("folderId"):
                self._folder(query["folderId"])
                items = [a for a in items if a.get("folderId") == query["folderId"]]
            return self._page(items, query)
        return self._create_asset(upload, query, body, raw, now)

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
        external_id = options.get("externalId")
        if external_id and any(a.get("externalId") == external_id for a in self._project_assets()):
            raise _Failure(error_codes.DUPLICATE_EXTERNAL_ID)
        if options.get("folderId"):
            self._folder(options["folderId"])
        total = query.get("totalSizeInBytes")
        if multipart and kind == "image" and total is not None:
            if total > 20 * _MIB:
                raise _Failure(error_codes.MULTIPART_IMAGE_TOO_LARGE)
            if total < 10 * _MIB:
                raise _Failure(error_codes.MULTIPART_IMAGE_TOO_SMALL)
        queue = bool(query.get("queue"))
        final = not multipart or bool(query.get("isFinal"))
        processing_options = options.get("processingOptions")
        keep = isinstance(processing_options, dict) and processing_options.get("keepContentAfterProcessing") is True
        asset = {k: v for k, v in options.items()
                 if k in ("name", "description", "metadata", "externalId", "externalUrl", "processingOptions")}
        asset.update(
            id=self.create_id(), projectId=self.project_id, folderId=options.get("folderId"), type=kind,
            visibility=options.get("visibility", "private"), createdAt=now, updatedAt=now,
            upload={"status": "completed" if final else "uploading", "updatedAt": now, "partsReceived": 1 if multipart else None},
            classification={'status': 'processing' if final else 'pending', 'updatedAt': now, 'completedAt': None, 'moderation': {'decision': 'pending', 'action': None, 'reviewerAction': None, 'reviewerNote': None, 'reviewerUserId': None, 'reviewedAt': None}},
            content={"status": "stored" if keep else "temporary", "removalReason": None, "updatedAt": now,
                     "safetyHold": None, "format": mime or None,
                     "extension": None, "sizeInBytes": len(raw) if raw_upload and raw is not None else None,
                     "checksums": None, "image": None, "previewImage": None, "extractedText": None})
        if "url" in options:
            asset["externalUrl"] = options["url"]
        if multipart and not final:
            self._uploads[asset["id"]] = {"queue": queue, "total": total, "image": kind == "image"}
        self.database_storage.assets[asset["id"]] = cast(Asset, asset)
        if raw_upload and raw is not None:
            self.image_storage.content[asset["id"]] = {"type": mime, "parts": {1: raw}}
        if final:
            self._apply_outcome(asset, self.queued_outcome if queue else self.analyzed_outcome, now)
        return asset

    def _apply_outcome(self, asset: dict[str, Any], outcome: str, now: int) -> None:
        """Move ``asset`` to ``outcome`` like the pipeline would: a decision finishes processing,
        and finished processing removes content kept only temporarily."""
        decided = outcome in ("approved", "rejected")
        status = "completed" if decided else "failed" if outcome == "failed" else "processing"
        asset["classification"].update(status=status, updatedAt=now, completedAt=now if decided else None)
        asset["upload"].update(status="completed", updatedAt=now)
        asset["classification"]["moderation"].update(decision=outcome if decided else "pending")
        if status == "completed" and asset["content"]["status"] == "temporary":
            self._remove_content(asset, "retention", now)
        asset["updatedAt"] = now

    def _remove_content(self, asset: dict[str, Any], reason: str, now: int) -> None:
        self.image_storage.content.pop(asset["id"], None)
        if asset["content"]["status"] != "removed":
            asset["content"].update(status="removed", removalReason=reason, updatedAt=now, extractedText=None)

    def _upload_part(self, asset: dict[str, Any], query: dict[str, Any], raw: bytes | None, now: int) -> None:
        upload = self._uploads.get(asset["id"])
        if upload is None or asset["upload"]["status"] != "uploading":
            raise _Failure(error_codes.UPLOAD_NOT_OPEN)
        stored = self.image_storage.content[asset["id"]]
        number = query.get("partNumber")
        if number != max(stored["parts"]) + 1:
            raise _Failure(error_codes.INVALID_UPLOAD_PART_NUMBER)
        size = sum(len(p) for p in stored["parts"].values()) + len(raw or b"")
        final = bool(query.get("isFinal"))
        if upload["image"] and (size > 20 * _MIB or (final and size < 10 * _MIB)):
            raise _Failure(error_codes.MULTIPART_IMAGE_TOO_LARGE if size > 20 * _MIB
                           else error_codes.MULTIPART_IMAGE_TOO_SMALL)
        if upload["total"] is not None and (size > upload["total"] or (final and size != upload["total"])):
            raise _Failure(error_codes.UPLOAD_SIZE_MISMATCH)
        stored["parts"][number] = raw or b""
        asset["content"]["sizeInBytes"] = size
        asset["upload"]["partsReceived"] = number
        if final:
            queue = query["queue"] if "queue" in query else upload["queue"]
            del self._uploads[asset["id"]]
            self._apply_outcome(asset, self.queued_outcome if queue else self.analyzed_outcome, now)

    def _dispatch_asset(self, method: str, identifier: str, suffix: str, query: dict[str, Any],
                        body: dict[str, Any], raw: bytes | None) -> Any:
        assets = self.database_storage.assets
        now = self.now()
        asset = self._asset(identifier)
        if method == "DELETE":
            # Like the API: deleting content keeps the record and report; deleting the
            # asset removes both. Either way the CDN stops serving the stored bytes.
            if suffix == "content":
                self._remove_content(asset, "requested", now)
                asset["updatedAt"] = now
                return asset
            self.image_storage.content.pop(identifier, None)
            del assets[identifier]
            self._uploads.pop(identifier, None)
            return None
        if suffix == "children":
            return self._page([a for a in self._project_assets() if a.get("parentId") == identifier], query)
        if suffix == "signed-url":
            selector: dict[str, Any] = {k: body[k] for k in ("expiresInSeconds", "lens", "transform") if k in body}
            return {"url": f"{self.signed_url_base_url}/assets/{identifier}/{body['resource']}?{urlencode(selector)}",
                    "expiresAt": now + body["expiresInSeconds"] * 1000}
        if suffix == "retry":
            if asset["classification"]["status"] != "failed":
                raise _Failure(error_codes.ASSET_NOT_RETRYABLE)
            if asset["content"]["status"] == "removed":
                raise _Failure(error_codes.ASSET_CONTENT_UNAVAILABLE)
            # Like the API: back to processing, to be moderated again.
            self._apply_outcome(asset, "pending", now)
        elif suffix == "move":
            if body["folderId"]:
                self._folder(body["folderId"])
            asset["folderId"] = body["folderId"]
        elif suffix == "part":
            self._upload_part(asset, query, raw, now)
        elif method == "PATCH":
            asset.update(body)
        if method != "GET":
            asset["updatedAt"] = now
        return asset

    def _dispatch_folder(self, method: str, identifier: str, suffix: str, body: dict[str, Any]) -> Any:
        folders = self.database_storage.folders
        folder = self._folder(identifier)
        if method == "DELETE":
            if any(a.get("folderId") == identifier for a in self.database_storage.assets.values()) or any(
                    f.get("parentId") == identifier for f in folders.values()):
                raise _Failure(error_codes.FOLDER_NOT_EMPTY)
            del folders[identifier]
            return None
        if suffix == "move":
            parent = body["parentId"]
            visited = {identifier}
            current = parent
            while current:
                if current in visited:
                    raise _Failure(error_codes.FOLDER_PARENT_CYCLE)
                visited.add(current)
                current = self._folder(current).get("parentId")
            self._unique(folder["name"], parent, identifier)
            folder["parentId"] = parent
        elif method == "PATCH" and "name" in body:
            self._unique(body["name"], folder.get("parentId"), identifier)
            folder["name"] = body["name"]
        if method != "GET":
            folder["updatedAt"] = self.now()
        return folder

    def _lenses_put(self, body: dict[str, Any], now: int) -> dict[str, Any]:
        result = []
        pending = copy.deepcopy(self._mock_lenses)
        for definition in body["lenses"]:
            old = pending.get(definition["identifier"])
            same = old and all(old.get(k) == definition.get(k)
                               for k in ("name", "description", "type", "active", "transforms", "version"))
            if old and not same and definition["version"] <= old["version"]:
                raise _Failure(error_codes.LENS_VERSION_CONFLICT)
            lens: dict[str, Any] = old if old and same else {**definition, "id": old["id"] if old else self.create_id(),
                                     "projectId": self.project_id, "userId": None,
                                     "createdAt": old["createdAt"] if old else now, "updatedAt": now}
            pending[lens["identifier"]] = lens
            result.append(lens)
        self._mock_lenses = pending
        return {"lenses": result}

    @staticmethod
    def _cursor(event: Mapping[str, Any]) -> str:
        return f"{event['createdAt']}_{event['id']}"

    def _events(self, query: dict[str, Any]) -> dict[str, Any]:
        events = sorted((e for e in self.database_storage.events if e["projectId"] == self.project_id),
                        key=lambda e: (e["createdAt"], e["id"]))
        after = query.get("after")
        if after is None:
            # A cursor for now: no events, and later calls only return newer ones.
            latest = self._cursor(events[-1]) if events else ""
            now = f"{self.now()}_"
            return {"events": [], "cursor": max((latest, now), key=self._cursor_key), "hasMore": False}
        if not isinstance(after, str) or not re.fullmatch(r"[0-9]+_.*", after):
            raise _Failure(error_codes.INVALID_EVENT_CURSOR)
        limit = query.get("limit", 50)
        if not isinstance(limit, int) or not 1 <= limit <= 100:
            raise _Failure(error_codes.INVALID_UPLOAD_PAYLOAD, "limit must be from 1 to 100")
        newer = [e for e in events if self._cursor_key(self._cursor(e)) > self._cursor_key(after)]
        page = newer[:limit]
        return {"events": page, "cursor": self._cursor(page[-1]) if page else after, "hasMore": len(newer) > limit}

    @staticmethod
    def _cursor_key(cursor: str) -> tuple[int, str]:
        stamp, _, identifier = cursor.partition("_")
        return (int(stamp) if stamp.isdigit() else -1, identifier)

    def _search(self, query: dict[str, Any]) -> dict[str, Any]:
        text = str(query.get("query", "")).strip().lower()
        if not text:
            raise _Failure(error_codes.INVALID_UPLOAD_PAYLOAD, "query is required")
        limit = query.get("limit", 10)
        items: list[dict[str, Any]] = []
        for asset in self._project_assets():
            matched = [name for name in ("name", "id", "externalId", "description", "type")
                       if text in str(asset.get(name) or "").lower()]
            if any(text in str(tag).lower() for tag in asset.get("tags") or []):
                matched.append("tags")
            if matched:
                items.append({"asset": asset, "score": len(matched) / 7, "matchedFields": matched})
        items.sort(key=lambda item: -item["score"])
        # The mock has no semantic index, so every mode is keyword matching.
        return {"query": query.get("query"), "items": items[:limit], "semanticStatus": "disabled"}

    @staticmethod
    def _page(items: list[dict[str, Any]], query: dict[str, Any]) -> dict[str, Any]:
        if query.get("filter"):
            matches = _rsql(query["filter"])
            items = [item for item in items if matches(item)]
        ordering = query.get("ordering") or [{"field": "createdAt", "direction": "DESC"}]
        if any(o["field"] not in ("createdAt", "id") for o in ordering):
            raise _Failure(error_codes.INVALID_UPLOAD_PAYLOAD, "Invalid ordering")
        ordering = list(ordering)
        if not any(o["field"] == "id" for o in ordering):
            ordering.append({"field": "id", "direction": ordering[0]["direction"]})
        for order in reversed(ordering):
            def key(item: dict[str, Any], name: str = order["field"]) -> tuple[bool, Any]:
                value: Any = item
                for part in name.split("."):
                    value = value.get(part) if isinstance(value, Mapping) else None
                return (value is None, "" if value is None else value)
            items = sorted(items, key=key, reverse=str(order.get("direction", "ASC")).upper() == "DESC")
        size = query.get("pageSize", 10)
        if not isinstance(size, int) or not 1 <= size <= 100:
            raise _Failure(error_codes.INVALID_UPLOAD_PAYLOAD, "pageSize must be from 1 to 100")
        if query.get("cursor"):
            try:
                boundary = json.loads(base64.b64decode(query["cursor"], validate=True))
                if not isinstance(boundary, dict) or any(
                    not isinstance(boundary.get(o["field"]), str) if o["field"] == "id" else
                    not isinstance(boundary.get(o["field"]), (int, float)) or not math.isfinite(boundary[o["field"]])
                    for o in ordering
                ):
                    raise ValueError("Invalid cursor")
            except (ValueError, TypeError):
                raise _Failure(error_codes.INVALID_CURSOR, "Invalid cursor")
            def follows(item: dict[str, Any]) -> bool:
                for order in ordering:
                    a, b = item[order["field"]], boundary[order["field"]]
                    if a != b:
                        return bool(a < b) if order["direction"] == "DESC" else bool(a > b)
                return False
            items = [item for item in items if follows(item)]
        selected = items[:size]
        more = len(items) > size
        cursor = base64.b64encode(json.dumps({o["field"]: selected[-1][o["field"]] for o in ordering}).encode()).decode() if more else None
        return {"items": selected, "nextCursor": cursor, "pageSize": size, "ordering": ordering, "hasMore": more}

    # CDN ---------------------------------------------------------------------------------

    def _serve_cdn(self, method: str, path: str) -> _Response:
        segments = path.strip("/").split("/")
        if len(segments) < 4 or segments[0] != "assets":
            return self._failure_response(_Failure(error_codes.ASSET_NOT_FOUND, status=404))
        project, identifier = unquote(segments[1]), unquote(segments[2])
        with self._state_lock:
            asset = next((a for a in self.database_storage.assets.values()
                          if a["projectId"] == project == self.project_id
                          and (a["id"] == identifier or a.get("externalId") == identifier)), None)
            if asset is None:
                return self._failure_response(_Failure(error_codes.ASSET_NOT_FOUND, "Asset not found", 404))
            if asset["visibility"] != "public" and not self._can_download(asset.get("folderId")):
                return self._failure_response(_Failure("asset/api-key-missing-permission",
                                                       "The API key cannot download this asset", 403))
            stored = self.image_storage.content.get(asset["id"])
            if stored is None:
                return self._failure_response(_Failure(error_codes.ASSET_NOT_FOUND, "Asset content not found", 404))
            content = b"".join(v for _, v in sorted(stored["parts"].items()))
        headers = {"Content-Type": stored["type"], "Content-Length": str(len(content)),
                   "Cache-Control": "public, max-age=31536000" if asset["visibility"] == "public" else "private, no-store",
                   "ETag": '"' + hashlib.sha256(content).hexdigest()[:32] + '"'}
        return self._respond(200, headers=headers, body=b"" if method == "HEAD" else content)

    def _can_download(self, folder_id: str | None) -> bool:
        try:
            raw = self.api_key.removeprefix("sk_test_")
            grants = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
            for grant in grants:
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
        except (ValueError, KeyError, TypeError, _Failure):
            return False
        return False
