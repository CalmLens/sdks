"""Which earlier posts in a conversation CalmLens uses when it moderates a reply."""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from . import error_codes
from .errors import CalmLensValidationError
from .types import ModerationContextItem

#: The most recent earlier posts CalmLens uses.
MODERATION_CONTEXT_USED_ITEMS = 5
#: The most characters (Unicode code points) of earlier posts CalmLens uses.
MODERATION_CONTEXT_USED_CHARACTERS = 2_000


def _item(value: Any) -> ModerationContextItem:
    if not isinstance(value, Mapping) or not isinstance(value.get("text"), str):
        raise CalmLensValidationError(error_codes.SDK_INVALID_ARGUMENT,
                                      "Every context item must be a dict with a text string")
    item: ModerationContextItem = {"text": value["text"]}
    if value.get("authorId") is not None:
        item["authorId"] = value["authorId"]
    return item


def select_moderation_context_items(items: Sequence[Mapping[str, Any]]) -> list[ModerationContextItem]:
    """The earlier posts CalmLens uses, oldest first: the most recent ones, newest first, while
    at most :data:`MODERATION_CONTEXT_USED_ITEMS` posts and
    :data:`MODERATION_CONTEXT_USED_CHARACTERS` characters allow. The newest post is always kept,
    so an over-long one is left for the API to reject."""
    selected: list[ModerationContextItem] = []
    characters = 0
    for value in reversed(items):
        if len(selected) == MODERATION_CONTEXT_USED_ITEMS:
            break
        item = _item(value)
        length = len(item["text"])
        if selected and characters + length > MODERATION_CONTEXT_USED_CHARACTERS:
            break
        selected.append(item)
        characters += length
    selected.reverse()
    return selected
