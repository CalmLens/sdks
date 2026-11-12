"""Translate the API's camelCase JSON into the snake_case options Python callers write."""
from __future__ import annotations

import re
from typing import Any


def snake(name: str) -> str:
    return re.sub(r"(?<!^)(?<!\.)(?=[A-Z])", "_", name).lower()


def python_options(value: Any) -> Any:
    """camelCase option values as Python's snake_case ones, all the way down: the keys the SDK
    turns back into camelCase. Metadata values and transform options are sent as given, and keys
    that aren't identifiers (category names such as ``self-harm``) are data."""
    if isinstance(value, dict):
        return {(snake(key) if isinstance(key, str) and key.isidentifier() else key):
                (item if key in ("metadata", "transform") else python_options(item))
                for key, item in value.items()}
    if isinstance(value, list):
        return [python_options(item) for item in value]
    return value


def to_json(value: Any) -> Any:
    """Result objects (and lists, tuples or dicts of them) as the API's JSON, for comparing with
    fixtures and literals."""
    from calmlens import CalmLensObject
    if isinstance(value, CalmLensObject):
        return value.to_dict()
    if isinstance(value, (list, tuple)):
        return type(value)(to_json(item) for item in value)
    if isinstance(value, dict):
        return {key: to_json(item) for key, item in value.items()}
    return value
