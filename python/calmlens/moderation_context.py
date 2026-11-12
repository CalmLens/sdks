"""Which earlier posts in a conversation CalmLens uses when it moderates a reply."""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, cast

from . import error_codes
from .errors import CalmLensInvalidArgumentError
from .types import ModerationContextItemParams

#: The most recent earlier posts CalmLens uses.
MODERATION_CONTEXT_USED_ITEMS = 5
#: The most characters (Unicode code points) of earlier posts CalmLens uses.
MODERATION_CONTEXT_USED_CHARACTERS = 2_000


def _item(value: Any, author_key: str) -> dict[str, Any]:
    if not isinstance(value, Mapping) or not isinstance(value.get("text"), str):
        raise CalmLensInvalidArgumentError(error_codes.SDK_INVALID_ARGUMENT,
                                      "Every context item must be a dict with a text string")
    item: dict[str, Any] = {"text": value["text"]}
    if value.get(author_key) is not None:
        item[author_key] = value[author_key]
    return item


def select_moderation_context_items(
        items: Sequence[ModerationContextItemParams]) -> list[ModerationContextItemParams]:
    """The earlier posts CalmLens uses, oldest first: the most recent ones, newest first, while
    at most :data:`MODERATION_CONTEXT_USED_ITEMS` posts and
    :data:`MODERATION_CONTEXT_USED_CHARACTERS` characters allow. The newest post is always kept,
    so an over-long one is left for the API to reject. Items are ``{"text": ..., "author_id": ...}``."""
    return cast(list[ModerationContextItemParams], _select(items, "author_id"))


def _select(items: Sequence[Mapping[str, Any]], author_key: str = "authorId") -> list[dict[str, Any]]:
    """:func:`select_moderation_context_items` for items whose author is ``author_key`` (the API's
    ``authorId`` by default)."""
    selected: list[dict[str, Any]] = []
    characters = 0
    for value in reversed(items):
        if len(selected) == MODERATION_CONTEXT_USED_ITEMS:
            break
        item = _item(value, author_key)
        length = len(item["text"])
        if selected and characters + length > MODERATION_CONTEXT_USED_CHARACTERS:
            break
        selected.append(item)
        characters += length
    selected.reverse()
    return selected
