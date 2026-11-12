"""The asynchronous client: :class:`AsyncCalmLensServerClient`.

It has the same resources, methods and options as :class:`~calmlens.CalmLensServerClient`, with
awaitable methods, ``async for`` iterators, ``async with`` CDN downloads and ``async with`` for
the client itself. It needs no extra packages: each call runs the thread-safe synchronous client
in a worker thread (``asyncio.to_thread``), so the event loop never blocks and both share one
connection pool, retries, errors and request options. Cancelling the awaiting task raises
``asyncio.CancelledError`` at once; a request already on the wire finishes in its thread.
"""
from __future__ import annotations

import asyncio
import contextvars
import logging
import threading
import ssl
from collections.abc import AsyncIterator, Callable, Iterator, Mapping
from typing import Any, List, Literal, TypeVar

from . import client as _client
from . import error_codes
from .errors import CalmLensCancelledError
from .client import (_UNSET, DEFAULT_CONNECT_TIMEOUT, DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_MAX_RETRIES,
                     DEFAULT_PART_SIZE_BYTES, DEFAULT_TIMEOUT, AppInfo, CalmLensServerClient, CDNResponse,
                     RequestAttempt, RequestOptions, ServedAssetInfo, Transport)
from .types import *  # noqa: F403  (the types the methods take and return)
from .webhooks import parse_webhook_event, verify_webhook_signature

__all__ = ["AsyncCalmLensServerClient", "AsyncCDNResponse"]

_Result = TypeVar("_Result")
_Item = TypeVar("_Item")
#: Marks an exhausted iterator without raising StopIteration through ``asyncio.to_thread``.
_DONE: Any = object()


async def _run(call: Callable[[], _Result]) -> _Result:
    """Run a blocking call in a worker thread, in the caller's context (its request options).
    Cancelling the awaiting task stops the call before its next request or retry and raises
    :class:`~calmlens.CalmLensCancelledError`; a request already sent finishes in its thread."""
    cancelled = threading.Event()
    context = contextvars.copy_context()
    context.run(_client._CANCELLED.set, cancelled)
    future = asyncio.get_running_loop().run_in_executor(None, context.run, call)
    try:
        return await future
    except asyncio.CancelledError as error:
        cancelled.set()
        raise CalmLensCancelledError(error_codes.SDK_CANCELLED, "The call was cancelled") from error


async def _aiter(start: Callable[[], Iterator[_Item]]) -> AsyncIterator[_Item]:
    """A blocking iterator as an async one: each item is fetched in a worker thread."""
    iterator = await _run(start)
    while True:
        item = await _run(lambda: next(iterator, _DONE))
        if item is _DONE:
            return
        yield item


class AsyncCDNResponse:
    """A streamed CDN response, as :meth:`AsyncCDN.serve` returns it: ``await response.read()``,
    ``async for chunk in response.aiter_bytes()`` and ``async with``."""

    def __init__(self, response: CDNResponse):
        self._response = response
        self.status = response.status
        #: Response headers with lower-case names.
        self.headers = response.headers

    def __repr__(self) -> str:
        return f"Async{self._response!r}"

    @property
    def ok(self) -> bool:
        return self._response.ok

    @property
    def content_type(self) -> str | None:
        return self._response.content_type

    @property
    def request_id(self) -> str | None:
        return self._response.request_id

    def get_asset_info(self) -> ServedAssetInfo | None:
        """Read served image dimensions from the headers without consuming the body."""
        return self._response.get_asset_info()

    async def read(self, amount: int | None = None) -> bytes:
        return await _run(lambda: self._response.read(amount))

    def aiter_bytes(self, chunk_size: int = 64 * 1024) -> AsyncIterator[bytes]:
        return _aiter(lambda: self._response.iter_bytes(chunk_size))

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self.aiter_bytes()

    async def close(self) -> None:
        await _run(self._response.close)

    async def __aenter__(self) -> AsyncCDNResponse:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()


class AsyncAssets:
    """``client.assets`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.Assets`, awaitable."""

    def __init__(self, sync: _client.Assets):
        self._sync = sync

    async def search(self, *, query: str, page_size: int = _UNSET, mode: SearchMode = _UNSET, options: RequestOptions | None = None) -> AssetSearchResponse:
        """Like :meth:`calmlens.client.Assets.search`, awaitable."""
        return await _run(lambda: self._sync.search(query=query, page_size=page_size, mode=mode, options=options))

    async def list(self, *, cursor: str = _UNSET, page_size: int = _UNSET, sort: str = _UNSET, filter: str = _UNSET, options: RequestOptions | None = None) -> AssetPage:
        """Like :meth:`calmlens.client.Assets.list`, awaitable."""
        return await _run(lambda: self._sync.list(cursor=cursor, page_size=page_size, sort=sort, filter=filter, options=options))

    def iter(self, *, page_size: int = _UNSET, sort: str = _UNSET, filter: str = _UNSET, options: RequestOptions | None = None) -> AsyncIterator[Asset]:
        """Like :meth:`calmlens.client.Assets.iter`, for ``async for``."""
        return _aiter(lambda: self._sync.iter(page_size=page_size, sort=sort, filter=filter, options=options))

    async def retrieve(self, *, asset_id: str, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Assets.retrieve`, awaitable."""
        return await _run(lambda: self._sync.retrieve(asset_id=asset_id, options=options))

    async def wait_for_decision(self, *, asset_id: str = _UNSET, timeout: float = _UNSET, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Assets.wait_for_decision`, awaitable."""
        return await _run(lambda: self._sync.wait_for_decision(asset_id=asset_id, timeout=timeout, options=options))

    async def update(self, *, asset_id: str, name: str = _UNSET, description: str | None = _UNSET, tags: List[str] | None = _UNSET, metadata: List[MetadataItemParams] | None = _UNSET, external_id: str | None = _UNSET, external_url: str | None = _UNSET, visibility: Visibility | None = _UNSET, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Assets.update`, awaitable."""
        return await _run(lambda: self._sync.update(asset_id=asset_id, name=name, description=description, tags=tags, metadata=metadata, external_id=external_id, external_url=external_url, visibility=visibility, options=options))

    async def list_children(self, *, asset_id: str, cursor: str = _UNSET, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> AssetPage:
        """Like :meth:`calmlens.client.Assets.list_children`, awaitable."""
        return await _run(lambda: self._sync.list_children(asset_id=asset_id, cursor=cursor, page_size=page_size, sort=sort, options=options))

    def iter_children(self, *, asset_id: str, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> AsyncIterator[Asset]:
        """Like :meth:`calmlens.client.Assets.iter_children`, for ``async for``."""
        return _aiter(lambda: self._sync.iter_children(asset_id=asset_id, page_size=page_size, sort=sort, options=options))

    async def list_timeline(self, *, asset_id: str, cursor: str = _UNSET, page_size: int = _UNSET, options: RequestOptions | None = None) -> AssetTimelinePage:
        """Like :meth:`calmlens.client.Assets.list_timeline`, awaitable."""
        return await _run(lambda: self._sync.list_timeline(asset_id=asset_id, cursor=cursor, page_size=page_size, options=options))

    def iter_timeline(self, *, asset_id: str, page_size: int = _UNSET, options: RequestOptions | None = None) -> AsyncIterator[AssetTimelineSegment]:
        """Like :meth:`calmlens.client.Assets.iter_timeline`, for ``async for``."""
        return _aiter(lambda: self._sync.iter_timeline(asset_id=asset_id, page_size=page_size, options=options))

    async def create(self, *, name: str, content: Content = _UNSET, part: Content = _UNSET, url: str = _UNSET, description: str = _UNSET, processing_options: ProcessingParams = _UNSET, visibility: Visibility = _UNSET, metadata: List[MetadataItemParams] = _UNSET, tags: List[str] = _UNSET, author_id: str = _UNSET, context: ModerationContextParams = _UNSET, external_id: str = _UNSET, external_url: str = _UNSET, folder_id: str | None = _UNSET, upload_preset_id: str = _UNSET, total_size_in_bytes: int = _UNSET, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Assets.create`, awaitable."""
        return await _run(lambda: self._sync.create(name=name, content=content, part=part, url=url, description=description, processing_options=processing_options, visibility=visibility, metadata=metadata, tags=tags, author_id=author_id, context=context, external_id=external_id, external_url=external_url, folder_id=folder_id, upload_preset_id=upload_preset_id, total_size_in_bytes=total_size_in_bytes, options=options))

    async def classify(self, *, name: str = _UNSET, content: Content = _UNSET, part: Content = _UNSET, url: str = _UNSET, description: str = _UNSET, processing_options: ProcessingParams = _UNSET, visibility: Visibility = _UNSET, metadata: List[MetadataItemParams] = _UNSET, tags: List[str] = _UNSET, author_id: str = _UNSET, context: ModerationContextParams = _UNSET, external_id: str = _UNSET, external_url: str = _UNSET, folder_id: str | None = _UNSET, upload_preset_id: str = _UNSET, total_size_in_bytes: int = _UNSET, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Assets.classify`, awaitable."""
        return await _run(lambda: self._sync.classify(name=name, content=content, part=part, url=url, description=description, processing_options=processing_options, visibility=visibility, metadata=metadata, tags=tags, author_id=author_id, context=context, external_id=external_id, external_url=external_url, folder_id=folder_id, upload_preset_id=upload_preset_id, total_size_in_bytes=total_size_in_bytes, options=options))

    async def upload_part(self, *, asset_id: str, part: PartContent = _UNSET, wait: bool = _UNSET, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Assets.upload_part`, awaitable."""
        return await _run(lambda: self._sync.upload_part(asset_id=asset_id, part=part, wait=wait, options=options))

    async def move(self, *, asset_id: str, folder_id: str | None, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Assets.move`, awaitable."""
        return await _run(lambda: self._sync.move(asset_id=asset_id, folder_id=folder_id, options=options))

    async def retry(self, *, asset_id: str, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Assets.retry`, awaitable."""
        return await _run(lambda: self._sync.retry(asset_id=asset_id, options=options))

    async def decide(self, *, asset_id: str, decision: Literal["allowed", "limited", "age-restricted", "blocked", "purged"], note: str, confirm_purge: Literal[True] = _UNSET, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Assets.decide`, awaitable."""
        return await _run(lambda: self._sync.decide(asset_id=asset_id, decision=decision, note=note, confirm_purge=confirm_purge, options=options))

    async def explain(self, *, asset_id: str, rerun: bool = _UNSET, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Assets.explain`, awaitable."""
        return await _run(lambda: self._sync.explain(asset_id=asset_id, rerun=rerun, options=options))

    async def remove_content(self, *, asset_id: str, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Assets.remove_content`, awaitable."""
        return await _run(lambda: self._sync.remove_content(asset_id=asset_id, options=options))

    async def delete(self, *, asset_id: str, options: RequestOptions | None = None) -> None:
        """Like :meth:`calmlens.client.Assets.delete`, awaitable."""
        return await _run(lambda: self._sync.delete(asset_id=asset_id, options=options))

    async def batch(self, *, asset_ids: List[str], operation: AssetBatchOperation, options: RequestOptions | None = None) -> BatchAssetsResponse:
        """Like :meth:`calmlens.client.Assets.batch`, awaitable."""
        return await _run(lambda: self._sync.batch(asset_ids=asset_ids, operation=operation, options=options))


class AsyncFolders:
    """``client.folders`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.Folders`, awaitable."""

    def __init__(self, sync: _client.Folders):
        self._sync = sync

    async def list(self, *, parent_id: str = _UNSET, cursor: str = _UNSET, page_size: int = _UNSET, sort: str = _UNSET, search: str = _UNSET, options: RequestOptions | None = None) -> FolderPage:
        """Like :meth:`calmlens.client.Folders.list`, awaitable."""
        return await _run(lambda: self._sync.list(parent_id=parent_id, cursor=cursor, page_size=page_size, sort=sort, search=search, options=options))

    def iter(self, *, parent_id: str = _UNSET, page_size: int = _UNSET, sort: str = _UNSET, search: str = _UNSET, options: RequestOptions | None = None) -> AsyncIterator[Folder]:
        """Like :meth:`calmlens.client.Folders.iter`, for ``async for``."""
        return _aiter(lambda: self._sync.iter(parent_id=parent_id, page_size=page_size, sort=sort, search=search, options=options))

    async def retrieve(self, *, folder_id: str, options: RequestOptions | None = None) -> Folder:
        """Like :meth:`calmlens.client.Folders.retrieve`, awaitable."""
        return await _run(lambda: self._sync.retrieve(folder_id=folder_id, options=options))

    async def create(self, *, name: str, parent_id: str | None = _UNSET, options: RequestOptions | None = None) -> Folder:
        """Like :meth:`calmlens.client.Folders.create`, awaitable."""
        return await _run(lambda: self._sync.create(name=name, parent_id=parent_id, options=options))

    async def update(self, *, folder_id: str, name: str = _UNSET, options: RequestOptions | None = None) -> Folder:
        """Like :meth:`calmlens.client.Folders.update`, awaitable."""
        return await _run(lambda: self._sync.update(folder_id=folder_id, name=name, options=options))

    async def move(self, *, folder_id: str, parent_id: str | None, options: RequestOptions | None = None) -> Folder:
        """Like :meth:`calmlens.client.Folders.move`, awaitable."""
        return await _run(lambda: self._sync.move(folder_id=folder_id, parent_id=parent_id, options=options))

    async def delete(self, *, folder_id: str, options: RequestOptions | None = None) -> None:
        """Like :meth:`calmlens.client.Folders.delete`, awaitable."""
        return await _run(lambda: self._sync.delete(folder_id=folder_id, options=options))


class AsyncHashLists:
    """``client.hash_lists`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.HashLists`, awaitable."""

    def __init__(self, sync: _client.HashLists):
        self._sync = sync

    async def list(self, *, cursor: str = _UNSET, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> HashListPage:
        """Like :meth:`calmlens.client.HashLists.list`, awaitable."""
        return await _run(lambda: self._sync.list(cursor=cursor, page_size=page_size, sort=sort, options=options))

    def iter(self, *, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> AsyncIterator[HashList]:
        """Like :meth:`calmlens.client.HashLists.iter`, for ``async for``."""
        return _aiter(lambda: self._sync.iter(page_size=page_size, sort=sort, options=options))

    async def retrieve(self, *, hash_list_id: str, options: RequestOptions | None = None) -> HashList:
        """Like :meth:`calmlens.client.HashLists.retrieve`, awaitable."""
        return await _run(lambda: self._sync.retrieve(hash_list_id=hash_list_id, options=options))

    async def create(self, *, name: str, action: HashListAction, description: str | None = _UNSET, options: RequestOptions | None = None) -> HashList:
        """Like :meth:`calmlens.client.HashLists.create`, awaitable."""
        return await _run(lambda: self._sync.create(name=name, action=action, description=description, options=options))

    async def update(self, *, hash_list_id: str, name: str = _UNSET, description: str | None = _UNSET, action: HashListAction = _UNSET, options: RequestOptions | None = None) -> HashList:
        """Like :meth:`calmlens.client.HashLists.update`, awaitable."""
        return await _run(lambda: self._sync.update(hash_list_id=hash_list_id, name=name, description=description, action=action, options=options))

    async def delete(self, *, hash_list_id: str, options: RequestOptions | None = None) -> None:
        """Like :meth:`calmlens.client.HashLists.delete`, awaitable."""
        return await _run(lambda: self._sync.delete(hash_list_id=hash_list_id, options=options))

    async def list_entries(self, *, hash_list_id: str, cursor: str = _UNSET, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> HashListEntryPage:
        """Like :meth:`calmlens.client.HashLists.list_entries`, awaitable."""
        return await _run(lambda: self._sync.list_entries(hash_list_id=hash_list_id, cursor=cursor, page_size=page_size, sort=sort, options=options))

    def iter_entries(self, *, hash_list_id: str, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> AsyncIterator[HashListEntry]:
        """Like :meth:`calmlens.client.HashLists.iter_entries`, for ``async for``."""
        return _aiter(lambda: self._sync.iter_entries(hash_list_id=hash_list_id, page_size=page_size, sort=sort, options=options))

    async def add_entry(self, *, hash_list_id: str, hash: str = _UNSET, quality: int | None = _UNSET, asset_id: str = _UNSET, label: str | None = _UNSET, options: RequestOptions | None = None) -> HashListEntry:
        """Like :meth:`calmlens.client.HashLists.add_entry`, awaitable."""
        return await _run(lambda: self._sync.add_entry(hash_list_id=hash_list_id, hash=hash, quality=quality, asset_id=asset_id, label=label, options=options))

    async def remove_entry(self, *, entry_id: str, options: RequestOptions | None = None) -> None:
        """Like :meth:`calmlens.client.HashLists.remove_entry`, awaitable."""
        return await _run(lambda: self._sync.remove_entry(entry_id=entry_id, options=options))


class AsyncUploadTokens:
    """``client.upload_tokens`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.UploadTokens`, awaitable."""

    def __init__(self, sync: _client.UploadTokens):
        self._sync = sync

    def sign(self, *, upload_preset_id: str = _UNSET, external_id: str = _UNSET, expires_in: int = _UNSET, options: RequestOptions | None = None) -> SignedUploadToken:
        """:meth:`calmlens.client.UploadTokens.sign`; it sends nothing, so it isn't awaited."""
        return self._sync.sign(upload_preset_id=upload_preset_id, external_id=external_id, expires_in=expires_in, options=options)


class AsyncPolicies:
    """``client.policies`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.Policies`, awaitable."""

    def __init__(self, sync: _client.Policies):
        self._sync = sync

    async def list(self, *, cursor: str = _UNSET, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> PolicyPage:
        """Like :meth:`calmlens.client.Policies.list`, awaitable."""
        return await _run(lambda: self._sync.list(cursor=cursor, page_size=page_size, sort=sort, options=options))

    def iter(self, *, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> AsyncIterator[Policy]:
        """Like :meth:`calmlens.client.Policies.iter`, for ``async for``."""
        return _aiter(lambda: self._sync.iter(page_size=page_size, sort=sort, options=options))

    async def retrieve(self, *, policy_id: str, options: RequestOptions | None = None) -> Policy:
        """Like :meth:`calmlens.client.Policies.retrieve`, awaitable."""
        return await _run(lambda: self._sync.retrieve(policy_id=policy_id, options=options))

    async def create(self, *, name: str = _UNSET, description: str = _UNSET, settings: PolicySettingsParams = _UNSET, preset_id: KnownPolicyPresetId = _UNSET, options: RequestOptions | None = None) -> Policy:
        """Like :meth:`calmlens.client.Policies.create`, awaitable."""
        return await _run(lambda: self._sync.create(name=name, description=description, settings=settings, preset_id=preset_id, options=options))

    async def update(self, *, policy_id: str, revision: int, name: str = _UNSET, description: str = _UNSET, settings: PolicySettingsParams = _UNSET, options: RequestOptions | None = None) -> Policy:
        """Like :meth:`calmlens.client.Policies.update`, awaitable."""
        return await _run(lambda: self._sync.update(policy_id=policy_id, revision=revision, name=name, description=description, settings=settings, options=options))

    async def reset(self, *, policy_id: str, revision: int, preset_version: int, options: RequestOptions | None = None) -> Policy:
        """Like :meth:`calmlens.client.Policies.reset`, awaitable."""
        return await _run(lambda: self._sync.reset(policy_id=policy_id, revision=revision, preset_version=preset_version, options=options))

    async def upgrade(self, *, policy_id: str, revision: int, preset_version: int, options: RequestOptions | None = None) -> Policy:
        """Like :meth:`calmlens.client.Policies.upgrade`, awaitable."""
        return await _run(lambda: self._sync.upgrade(policy_id=policy_id, revision=revision, preset_version=preset_version, options=options))

    async def set_automatic_updates(self, *, policy_id: str, enabled: bool, revision: int, preset_version: int, options: RequestOptions | None = None) -> Policy:
        """Like :meth:`calmlens.client.Policies.set_automatic_updates`, awaitable."""
        return await _run(lambda: self._sync.set_automatic_updates(policy_id=policy_id, enabled=enabled, revision=revision, preset_version=preset_version, options=options))

    async def delete(self, *, policy_id: str, options: RequestOptions | None = None) -> None:
        """Like :meth:`calmlens.client.Policies.delete`, awaitable."""
        return await _run(lambda: self._sync.delete(policy_id=policy_id, options=options))

    async def retrieve_assigned(self, *, options: RequestOptions | None = None) -> Policy:
        """Like :meth:`calmlens.client.Policies.retrieve_assigned`, awaitable."""
        return await _run(lambda: self._sync.retrieve_assigned(options=options))

    async def assign(self, *, policy_id: str, options: RequestOptions | None = None) -> Policy:
        """Like :meth:`calmlens.client.Policies.assign`, awaitable."""
        return await _run(lambda: self._sync.assign(policy_id=policy_id, options=options))


class AsyncLenses:
    """``client.lenses`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.Lenses`, awaitable."""

    def __init__(self, sync: _client.Lenses):
        self._sync = sync

    async def list(self, *, cursor: str = _UNSET, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> LensPage:
        """Like :meth:`calmlens.client.Lenses.list`, awaitable."""
        return await _run(lambda: self._sync.list(cursor=cursor, page_size=page_size, sort=sort, options=options))

    def iter(self, *, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> AsyncIterator[Lens]:
        """Like :meth:`calmlens.client.Lenses.iter`, for ``async for``."""
        return _aiter(lambda: self._sync.iter(page_size=page_size, sort=sort, options=options))

    async def create(self, *, identifier: str, name: str, type: LensType, description: str | None = _UNSET, active: bool = _UNSET, transform: ImageTransformOptions | None = _UNSET, options: RequestOptions | None = None) -> Lens:
        """Like :meth:`calmlens.client.Lenses.create`, awaitable."""
        return await _run(lambda: self._sync.create(identifier=identifier, name=name, type=type, description=description, active=active, transform=transform, options=options))

    async def retrieve(self, *, lens_id: str, options: RequestOptions | None = None) -> Lens:
        """Like :meth:`calmlens.client.Lenses.retrieve`, awaitable."""
        return await _run(lambda: self._sync.retrieve(lens_id=lens_id, options=options))

    async def update(self, *, lens_id: str, name: str = _UNSET, description: str | None = _UNSET, type: LensType = _UNSET, active: bool = _UNSET, transform: ImageTransformOptions | None = _UNSET, options: RequestOptions | None = None) -> Lens:
        """Like :meth:`calmlens.client.Lenses.update`, awaitable."""
        return await _run(lambda: self._sync.update(lens_id=lens_id, name=name, description=description, type=type, active=active, transform=transform, options=options))

    async def delete(self, *, lens_id: str, options: RequestOptions | None = None) -> None:
        """Like :meth:`calmlens.client.Lenses.delete`, awaitable."""
        return await _run(lambda: self._sync.delete(lens_id=lens_id, options=options))


class AsyncUploadPresets:
    """``client.upload_presets`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.UploadPresets`, awaitable."""

    def __init__(self, sync: _client.UploadPresets):
        self._sync = sync

    async def list(self, *, cursor: str = _UNSET, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> UploadPresetPage:
        """Like :meth:`calmlens.client.UploadPresets.list`, awaitable."""
        return await _run(lambda: self._sync.list(cursor=cursor, page_size=page_size, sort=sort, options=options))

    def iter(self, *, page_size: int = _UNSET, sort: str = _UNSET, options: RequestOptions | None = None) -> AsyncIterator[UploadPreset]:
        """Like :meth:`calmlens.client.UploadPresets.iter`, for ``async for``."""
        return _aiter(lambda: self._sync.iter(page_size=page_size, sort=sort, options=options))

    async def ensure(self, *, upload_presets: List[UploadPresetDefinition], options: RequestOptions | None = None) -> EnsureUploadPresetsResponse:
        """Like :meth:`calmlens.client.UploadPresets.ensure`, awaitable."""
        return await _run(lambda: self._sync.ensure(upload_presets=upload_presets, options=options))

    async def delete(self, *, upload_preset_id: str, options: RequestOptions | None = None) -> None:
        """Like :meth:`calmlens.client.UploadPresets.delete`, awaitable."""
        return await _run(lambda: self._sync.delete(upload_preset_id=upload_preset_id, options=options))


class AsyncProjectSettings:
    """``client.project_settings`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.ProjectSettings`, awaitable."""

    def __init__(self, sync: _client.ProjectSettings):
        self._sync = sync

    async def get(self, *, options: RequestOptions | None = None) -> ProjectSettingsResource:
        """Like :meth:`calmlens.client.ProjectSettings.get`, awaitable."""
        return await _run(lambda: self._sync.get(options=options))

    async def update(self, *, settings: PublicProjectSettingsInput, revision: int = _UNSET, search_indexing_budget_units: float = _UNSET, options: RequestOptions | None = None) -> ProjectSettingsResource:
        """Like :meth:`calmlens.client.ProjectSettings.update`, awaitable."""
        return await _run(lambda: self._sync.update(settings=settings, revision=revision, search_indexing_budget_units=search_indexing_budget_units, options=options))


class AsyncMetadataFields:
    """``client.metadata_fields`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.MetadataFields`, awaitable."""

    def __init__(self, sync: _client.MetadataFields):
        self._sync = sync

    async def list(self, *, options: RequestOptions | None = None) -> MetadataFieldsResource:
        """Like :meth:`calmlens.client.MetadataFields.list`, awaitable."""
        return await _run(lambda: self._sync.list(options=options))

    async def ensure(self, *, fields: List[MetadataFieldDefinition], revision: int = _UNSET, options: RequestOptions | None = None) -> MetadataFieldsResource:
        """Like :meth:`calmlens.client.MetadataFields.ensure`, awaitable."""
        return await _run(lambda: self._sync.ensure(fields=fields, revision=revision, options=options))

    async def delete(self, *, field_id: str, revision: int = _UNSET, options: RequestOptions | None = None) -> None:
        """Like :meth:`calmlens.client.MetadataFields.delete`, awaitable."""
        return await _run(lambda: self._sync.delete(field_id=field_id, revision=revision, options=options))


class AsyncText:
    """``client.text`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.Text`, awaitable."""

    def __init__(self, sync: _client.Text):
        self._sync = sync

    async def classify(self, *, text: str = _UNSET, name: str = _UNSET, description: str = _UNSET, processing_options: ProcessingParams = _UNSET, visibility: Visibility = _UNSET, metadata: List[MetadataItemParams] = _UNSET, tags: List[str] = _UNSET, author_id: str = _UNSET, context: ModerationContextParams = _UNSET, external_id: str = _UNSET, external_url: str = _UNSET, folder_id: str | None = _UNSET, upload_preset_id: str = _UNSET, options: RequestOptions | None = None) -> Asset:
        """Like :meth:`calmlens.client.Text.classify`, awaitable."""
        return await _run(lambda: self._sync.classify(text=text, name=name, description=description, processing_options=processing_options, visibility=visibility, metadata=metadata, tags=tags, author_id=author_id, context=context, external_id=external_id, external_url=external_url, folder_id=folder_id, upload_preset_id=upload_preset_id, options=options))


class AsyncEvents:
    """``client.events`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.Events`, awaitable."""

    def __init__(self, sync: _client.Events):
        self._sync = sync

    async def list(self, *, cursor: str = _UNSET, page_size: int = _UNSET, types: List[KnownEventType] = _UNSET, asset_id: str = _UNSET, options: RequestOptions | None = None) -> EventsPage:
        """Like :meth:`calmlens.client.Events.list`, awaitable."""
        return await _run(lambda: self._sync.list(cursor=cursor, page_size=page_size, types=types, asset_id=asset_id, options=options))

    def iter_pages(self, *, cursor: str = _UNSET, page_size: int = _UNSET, types: List[KnownEventType] = _UNSET, asset_id: str = _UNSET, options: RequestOptions | None = None) -> AsyncIterator[EventsPage]:
        """Like :meth:`calmlens.client.Events.iter_pages`, for ``async for``."""
        return _aiter(lambda: self._sync.iter_pages(cursor=cursor, page_size=page_size, types=types, asset_id=asset_id, options=options))

    def iter(self, *, cursor: str = _UNSET, page_size: int = _UNSET, types: List[KnownEventType] = _UNSET, asset_id: str = _UNSET, options: RequestOptions | None = None) -> AsyncIterator[Event]:
        """Like :meth:`calmlens.client.Events.iter`, for ``async for``."""
        return _aiter(lambda: self._sync.iter(cursor=cursor, page_size=page_size, types=types, asset_id=asset_id, options=options))


class AsyncCDN:
    """``client.cdn`` of :class:`AsyncCalmLensServerClient`: :class:`calmlens.client.CDN`, awaitable."""

    def __init__(self, sync: _client.CDN):
        self._sync = sync

    def get_asset_url(self, *, project_id: str = _UNSET, asset_id: str = _UNSET, external_id: str = _UNSET, resource: CdnResource = _UNSET, lens: str = _UNSET, transform: CdnTransform = _UNSET, viewer_claims: ViewerClaims = _UNSET, options: RequestOptions | None = None) -> str:
        """:meth:`calmlens.client.CDN.get_asset_url`; it sends nothing, so it isn't awaited."""
        return self._sync.get_asset_url(project_id=project_id, asset_id=asset_id, external_id=external_id, resource=resource, lens=lens, transform=transform, viewer_claims=viewer_claims, options=options)

    async def sign_asset_url(self, *, project_id: str = _UNSET, asset_id: str = _UNSET, external_id: str = _UNSET, expires_in: int = _UNSET, original: bool = _UNSET, resource: CdnResource = _UNSET, lens: str = _UNSET, transform: CdnTransform = _UNSET, viewer_claims: ViewerClaims = _UNSET, options: RequestOptions | None = None) -> SignedAssetUrl:
        """Like :meth:`calmlens.client.CDN.sign_asset_url`, awaitable."""
        return await _run(lambda: self._sync.sign_asset_url(project_id=project_id, asset_id=asset_id, external_id=external_id, expires_in=expires_in, original=original, resource=resource, lens=lens, transform=transform, viewer_claims=viewer_claims, options=options))

    async def get_asset_info(self, url: str, *, viewer_claims: ViewerClaims = _UNSET, options: RequestOptions | None = None) -> AssetInfo:
        """Like :meth:`calmlens.client.CDN.get_asset_info`, awaitable."""
        return await _run(lambda: self._sync.get_asset_info(url, viewer_claims=viewer_claims, options=options))

    async def serve(self, *, project_id: str = _UNSET, asset_id: str = _UNSET, external_id: str = _UNSET, resource: CdnResource = _UNSET, lens: str = _UNSET, transform: CdnTransform = _UNSET, viewer_claims: ViewerClaims = _UNSET, init: ServeInit = _UNSET, options: RequestOptions | None = None) -> AsyncCDNResponse:
        """Like :meth:`calmlens.client.CDN.serve`, awaitable."""
        return AsyncCDNResponse(await _run(lambda: self._sync.serve(project_id=project_id, asset_id=asset_id, external_id=external_id, resource=resource, lens=lens, transform=transform, viewer_claims=viewer_claims, init=init, options=options)))


class AsyncCalmLensServerClient:
    """Asynchronous CalmLens API client, with the arguments of
    :class:`~calmlens.CalmLensServerClient`::

        async with AsyncCalmLensServerClient() as client:
            asset = await client.assets.retrieve(asset_id="asset_...")
            async for event in client.events.iter(cursor=cursor):
                ...
    """

    verify_webhook_signature = staticmethod(verify_webhook_signature)
    parse_webhook_event = staticmethod(parse_webhook_event)

    def __init__(self, *, api_key: str | None = None, project_id: str | None = None,
                 base_url: str | None = None,
                 cdn_base_url: str = "https://cdn.calmlens.com/v1",
                 timeout: float = DEFAULT_TIMEOUT, upload_timeout: float | None = None,
                 connect_timeout: float = DEFAULT_CONNECT_TIMEOUT,
                 max_retries: int = DEFAULT_MAX_RETRIES, max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
                 part_size_bytes: int = DEFAULT_PART_SIZE_BYTES, transport: Transport | None = None,
                 app_info: AppInfo | None = None, logger: logging.Logger | None = None,
                 on_attempt: Callable[[RequestAttempt], None] | None = None,
                 default_headers: Mapping[str, str] | None = None, ssl_context: ssl.SSLContext | None = None,
                 proxy: str | None = None):
        self._bind(CalmLensServerClient(
            api_key=api_key, project_id=project_id, base_url=base_url, cdn_base_url=cdn_base_url, timeout=timeout,
            upload_timeout=upload_timeout, connect_timeout=connect_timeout, max_retries=max_retries,
            max_response_bytes=max_response_bytes, part_size_bytes=part_size_bytes, transport=transport,
            app_info=app_info, logger=logger, on_attempt=on_attempt, default_headers=default_headers,
            ssl_context=ssl_context, proxy=proxy))

    @classmethod
    def from_client(cls, client: CalmLensServerClient) -> AsyncCalmLensServerClient:
        """An async client for an existing client (such as a
        :class:`~calmlens.testing.MockCalmLensServerClient`), sharing its connections and settings."""
        instance = cls.__new__(cls)
        instance._bind(client)
        return instance

    def _bind(self, sync: CalmLensServerClient) -> None:
        self._sync = sync
        self.assets, self.folders = AsyncAssets(sync.assets), AsyncFolders(sync.folders)
        self.hash_lists, self.upload_tokens = AsyncHashLists(sync.hash_lists), AsyncUploadTokens(sync.upload_tokens)
        self.policies, self.lenses = AsyncPolicies(sync.policies), AsyncLenses(sync.lenses)
        self.upload_presets = AsyncUploadPresets(sync.upload_presets)
        self.project_settings = AsyncProjectSettings(sync.project_settings)
        self.metadata_fields = AsyncMetadataFields(sync.metadata_fields)
        self.text, self.events, self.cdn = AsyncText(sync.text), AsyncEvents(sync.events), AsyncCDN(sync.cdn)

    @property
    def sync_client(self) -> CalmLensServerClient:
        """The synchronous client this one runs."""
        return self._sync

    @property
    def project_id(self) -> str:
        return self._sync.project_id

    @property
    def base_url(self) -> str:
        return self._sync.base_url

    @property
    def cdn_base_url(self) -> str:
        return self._sync.cdn_base_url

    def __repr__(self) -> str:
        # Never include the API key.
        return f"{type(self).__name__}(project_id={self.project_id!r}, base_url={self.base_url!r})"

    def with_options(self, *, timeout: float | None = None, upload_timeout: float | None = None,
                     max_retries: int | None = None, max_response_bytes: int | None = None) -> AsyncCalmLensServerClient:
        """Like :meth:`calmlens.CalmLensServerClient.with_options`."""
        return AsyncCalmLensServerClient.from_client(self._sync.with_options(
            timeout=timeout, upload_timeout=upload_timeout, max_retries=max_retries,
            max_response_bytes=max_response_bytes))

    async def close(self) -> None:
        """Close the owned connection pool."""
        await _run(self._sync.close)

    async def __aenter__(self) -> AsyncCalmLensServerClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    async def request(self, method: str, path: str, *, query: Mapping[str, Any] | None = None, body: Any = None, headers: Mapping[str, str] | None = None, options: RequestOptions | None = None) -> Any:
        """Like :meth:`calmlens.client.CalmLensServerClient.request`, awaitable."""
        return await _run(lambda: self._sync.request(method, path, query=query, body=body, headers=headers, options=options))

    async def ensure_lens(self, *, identifier: str, name: str, type: LensType, description: str | None = _UNSET, active: bool = _UNSET, transform: ImageTransformOptions | None = _UNSET, options: RequestOptions | None = None) -> Lens:
        """Like :meth:`calmlens.client.CalmLensServerClient.ensure_lens`, awaitable."""
        return await _run(lambda: self._sync.ensure_lens(identifier=identifier, name=name, type=type, description=description, active=active, transform=transform, options=options))

    async def ensure_lenses(self, *, lenses: list[LensDefinition], options: RequestOptions | None = None) -> list[Lens]:
        """Like :meth:`calmlens.client.CalmLensServerClient.ensure_lenses`, awaitable."""
        return await _run(lambda: self._sync.ensure_lenses(lenses=lenses, options=options))
