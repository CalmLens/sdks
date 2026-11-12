"""Result objects: what every method returns instead of the API's JSON.

A :class:`CalmLensObject` keeps the JSON it was made from and reads it through typed, snake_case
attributes (``asset.classification.moderation.decision``). Nested objects, lists of objects and
maps of objects are decoded from the class's annotations; a union of objects becomes the variant
whose literal tag (``status``, ``kind``, ``type``) the value carries. Fields this SDK version does
not declare stay readable, by their snake_case name or their API name. A declared field the API
left out reads as ``None``; ``"field" in obj`` tells it apart from ``null``.

Objects are read-only. ``to_dict()`` returns the API's JSON (camelCase keys), a fresh copy.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
import json
import re

import types
import typing
from collections.abc import AsyncIterator, Callable, Iterator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, ClassVar, Generic, Literal, TypeVar, Union, cast

__all__ = ["CalmLensObject", "CalmLensResponse", "ListObject"]

_T = TypeVar("_T")
_UNION_TYPES: tuple[Any, ...] = (Union, types.UnionType)
_HINTS: dict[type, dict[str, Any]] = {}


def _snake(name: str) -> str:
    """A JSON field name as a Python attribute: ``nextCursor`` -> ``next_cursor``,
    ``self-harm`` -> ``self_harm``."""
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower().replace("-", "_")


def _hints(cls: type) -> dict[str, Any]:
    """The declared fields of a model class, by attribute name."""
    hints = _HINTS.get(cls)
    if hints is None:
        hints = {name: hint for name, hint in typing.get_type_hints(cls).items()
                 if not name.startswith("_") and typing.get_origin(hint) is not ClassVar}
        _HINTS[cls] = hints
    return hints


def _members(annotation: Any) -> list[Any]:
    if typing.get_origin(annotation) in _UNION_TYPES:
        return [member for arg in typing.get_args(annotation) for member in _members(arg)]
    return [annotation]


def _is_model(annotation: Any) -> bool:
    return isinstance(annotation, type) and issubclass(annotation, CalmLensObject)


def _variant(models: list[type[CalmLensObject]], value: Mapping[str, Any]) -> type[CalmLensObject]:
    """The model whose literal tags the value carries, such as ``{"status": "evaluated"}``. An
    unknown variant (one a newer API version added) becomes a plain :class:`CalmLensObject`."""
    if len(models) == 1:
        return models[0]
    for model in models:
        tags = {name: typing.get_args(hint) for name, hint in _hints(model).items()
                if typing.get_origin(hint) is Literal}
        if tags and all(_wire_value(value, name) in allowed for name, allowed in tags.items()):
            return model
    return CalmLensObject


def _wire_value(value: Mapping[str, Any], name: str) -> Any:
    for key, item in value.items():
        if _snake(key) == name:
            return item
    return None


@dataclass(frozen=True)
class CalmLensResponse:
    """The HTTP response a result came from, as its ``last_response``."""
    status: int
    #: Response headers, with lower-case names.
    headers: Mapping[str, str]
    #: The ``X-Request-Id`` header; quote it to support.
    request_id: str | None
    #: The ``Idempotency-Key`` the request was sent with, or ``None``.
    idempotency_key: str | None = None


class _Undeclared:
    pass


#: A field the class does not declare: a nested JSON object still becomes a CalmLensObject.
_UNDECLARED: Any = _Undeclared


def _decode(value: Any, annotation: Any) -> Any:
    if value is None:
        return None
    if annotation is _UNDECLARED:
        if isinstance(value, dict):
            return CalmLensObject(value)
        if isinstance(value, list):
            return [_decode(item, _UNDECLARED) for item in value]
        return value
    members = [member for member in _members(annotation) if member is not type(None)]
    models = [member for member in members if _is_model(member)]
    if models and isinstance(value, dict):
        return _variant(models, value)(value)
    for member in members:
        origin = typing.get_origin(member)
        if origin in (list, Sequence) and isinstance(value, list):
            (item,) = typing.get_args(member) or (Any,)
            return [_decode(entry, item) for entry in value]
        if origin in (dict, Mapping) and isinstance(value, dict):
            _, item = typing.get_args(member) or (str, Any)
            return {key: _decode(entry, item) for key, entry in value.items()}
    # Strings, numbers, literals, Any (JSON values such as metadata) and TypedDicts (transform
    # options, which use the CDN's names) are returned as the API sent them.
    return copy.deepcopy(value)


class CalmLensObject:
    """A result from the CalmLens API, read through typed snake_case attributes.

    ``obj["nextCursor"]`` and ``obj["next_cursor"]`` read a field by its API or Python name, and
    ``"field" in obj`` tells whether the API sent it. ``to_dict()`` returns the API's JSON. It is
    not a ``dict``: use ``to_dict()`` for dict operations.
    """

    __slots__ = ("_data", "_names", "_cache", "_last_response")

    def __init__(self, values: Mapping[str, Any]) -> None:
        if not isinstance(values, Mapping):
            raise TypeError(f"{type(self).__name__} is made from a JSON object, not {type(values).__name__}")
        object.__setattr__(self, "_data", copy.deepcopy(dict(values)))
        names: dict[str, str] = {}
        for key in values:
            names.setdefault(_snake(key), key)
        object.__setattr__(self, "_names", names)
        object.__setattr__(self, "_cache", {})
        object.__setattr__(self, "_last_response", None)

    @property
    def last_response(self) -> CalmLensResponse | None:
        """The :class:`~calmlens.CalmLensResponse` (``status``, ``headers``, ``request_id``) of the
        request this object came from, or ``None`` for an object nested in another, built with
        :meth:`construct_from` or parsed from a webhook."""
        return cast("CalmLensResponse | None", self._last_response)  # type: ignore[attr-defined]

    @classmethod
    def construct_from(cls: type[_Self], values: Mapping[str, Any]) -> _Self:
        """An object from the API's JSON, such as a webhook body or a value saved with ``to_dict()``."""
        return cls(values)

    def _field(self, name: str) -> Any:
        cache: dict[str, Any] = self._cache  # type: ignore[attr-defined]
        if name in cache:
            return cache[name]
        hints = _hints(type(self))
        key = self._names.get(name)  # type: ignore[attr-defined]
        if key is None:
            if name in hints:
                return None
            raise AttributeError(f"{type(self).__name__!r} object has no field {name!r}")
        value = _decode(self._data[key], hints.get(name, _UNDECLARED))  # type: ignore[attr-defined]
        cache[name] = value
        return value

    if not TYPE_CHECKING:
        # Hidden from type checkers, so a misspelt field is a type error rather than ``Any``.
        def __getattr__(self, name: str) -> Any:
            if name.startswith("_"):
                raise AttributeError(name)
            return self._field(name)

    def _key(self, key: str) -> str | None:
        data: dict[str, Any] = self._data  # type: ignore[attr-defined]
        if key in data:
            return key
        return self._names.get(key)  # type: ignore[attr-defined, no-any-return]

    def __getitem__(self, key: str) -> Any:
        wire = self._key(key)
        if wire is None:
            raise KeyError(key)
        return self._field(_snake(wire))

    def __contains__(self, key: object) -> bool:
        return isinstance(key, str) and self._key(key) is not None

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError(f"{type(self).__name__} is read-only; to_dict() returns a copy you can change")

    def __delattr__(self, name: str) -> None:
        raise AttributeError(f"{type(self).__name__} is read-only; to_dict() returns a copy you can change")

    if not TYPE_CHECKING:
        def __iter__(self):
            raise TypeError(f"{type(self).__name__} is not a dict; call to_dict() for one")

    def to_dict(self) -> dict[str, Any]:
        """The API's JSON for this object (camelCase keys), as a fresh copy."""
        return copy.deepcopy(self._data)  # type: ignore[attr-defined]

    def __eq__(self, other: object) -> bool:
        if isinstance(other, CalmLensObject):
            return type(self) is type(other) and self._data == other._data  # type: ignore[attr-defined]
        return NotImplemented

    __hash__ = None  # type: ignore[assignment]

    def __dir__(self) -> list[str]:
        return sorted(set(super().__dir__()) | set(self._names) | set(_hints(type(self))))  # type: ignore[attr-defined]

    def __repr__(self) -> str:
        return f"{type(self).__name__}({json.dumps(self._data, ensure_ascii=False, sort_keys=True)})"  # type: ignore[attr-defined]

    def __str__(self) -> str:
        return json.dumps(self._data, ensure_ascii=False, sort_keys=True, indent=2)  # type: ignore[attr-defined]

    def __reduce__(self) -> tuple[Any, ...]:
        return type(self), (self._data,)  # type: ignore[attr-defined]

    def __copy__(self) -> CalmLensObject:
        return type(self)(self._data)  # type: ignore[attr-defined]

    def __deepcopy__(self, memo: dict[int, Any]) -> CalmLensObject:
        return type(self)(self._data)  # type: ignore[attr-defined]


_Self = TypeVar("_Self", bound=CalmLensObject)


class ListObject(CalmLensObject, Generic[_T]):
    """One page of a list. Iterate it or ``len()`` it for this page's ``items``;
    :meth:`auto_paging_iter` yields every item of this page and the pages after it, requesting them
    as you iterate."""

    __slots__ = ("_fetch",)

    items: list[_T]
    has_more: bool
    #: Pass as ``cursor`` for the next page; ``None`` on the last page of most lists.
    next_cursor: str | None

    def __init__(self, values: Mapping[str, Any],
                 fetch: Callable[[str], ListObject[_T]] | None = None) -> None:
        super().__init__(values)
        object.__setattr__(self, "_fetch", fetch)

    def __iter__(self) -> Iterator[_T]:
        return iter(self.items)

    def __len__(self) -> int:
        return len(self.items)

    def auto_paging_iter(self) -> Iterator[_T]:
        """Yield this page's items, then each following page's, fetching pages lazily. Stops at the
        last page (``has_more`` false) or an empty one, and raises ``sdk/invalid-response`` rather
        than loop when the API hands back a cursor it already returned."""
        page: ListObject[_T] = self
        sent: set[str] = set()
        while True:
            cursor = page.next_cursor
            fetch = page._fetch  # type: ignore[attr-defined]
            more = bool(cursor and page.has_more and page.items) and fetch is not None
            if more and cursor in sent:
                from . import error_codes
                from .errors import _error
                raise _error(error_codes.SDK_INVALID_RESPONSE,
                                    "The API returned a cursor it had already returned, with more pages to follow",
                                    {"cursor": cursor})
            yield from page.items
            if not more:
                return
            sent.add(cast(str, cursor))
            page = fetch(cursor)

    async def auto_paging_iter_async(self) -> AsyncIterator[_T]:
        """:meth:`auto_paging_iter` for ``async for``, as an
        :class:`~calmlens.AsyncCalmLensServerClient` page offers it: each following page is fetched
        in a worker thread, so the event loop never blocks."""
        import asyncio
        iterator = self.auto_paging_iter()
        done = object()
        while True:
            item = await asyncio.to_thread(next, iterator, done)
            if item is done:
                return
            yield cast(_T, item)

    def __reduce__(self) -> tuple[Any, ...]:
        return type(self), (self._data,)  # type: ignore[attr-defined]
