"""Signed test inputs: text codes and media phrases that a project's test input key
authenticates, so CalmLens returns the scenario they describe instead of classifying them. The
formats match the JavaScript SDK's ``calmlens/test-inputs`` byte for byte."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from collections.abc import Mapping, Sequence
from typing import Any, Literal, TypedDict, Union, cast

from ._mock_classification import CATEGORIES, INPUT_QUALIFIERS, QUALIFIERS
from .client import _invalid
from .types import ClassificationCategory

#: A scenario instance's policy action.
SignedTestAction = Literal["allow", "limit", "age-restrict", "block"]
#: A regional action's region.
SignedTestRegion = Literal["DE", "AT", "FR", "GB", "EU", "AU", "BR"]
#: A regional action's action.
SignedTestRegionalActionName = Literal["limit", "age-restrict", "block"]
#: A shortcut for a common scenario: a category or one of the named signals.
ClassificationTestSignal = Union[ClassificationCategory, Literal[
    "sexual.involving-minors", "violence.graphic", "harassment.insult", "sexual.adult", "hate.regional-symbol"]]


class SignedTestRegionalAction(TypedDict):
    """The action a region applies to the input, on top of its instances."""
    region: SignedTestRegion
    action: SignedTestRegionalActionName


class _SignedTestInstanceRequired(TypedDict):
    category: ClassificationCategory
    qualifiers: list[str]


class SignedTestInstance(_SignedTestInstanceRequired, total=False):
    """One qualifying instance: its category, the category's content qualifiers that apply
    (input-type qualifiers such as ``sexual-text`` are automatic), and optionally its score (0 to
    1) and the action it takes. Set an action on every instance or on none."""
    score: float
    action: SignedTestAction


class _SignedTestInputRequired(TypedDict):
    instances: list[SignedTestInstance]


class SignedTestInput(_SignedTestInputRequired, total=False):
    """A test scenario: up to 128 instances, the categories CalmLens reports as not assessed
    (none may have instances), and up to one action per region."""
    regionalActions: list[SignedTestRegionalAction]
    unassessedCategories: list[ClassificationCategory]



_ACTIONS = ("allow", "limit", "age-restrict", "block")
_REGIONS = ("DE", "AT", "FR", "GB", "EU", "AU", "BR")
_REGIONAL_ACTIONS = ("limit", "age-restrict", "block")
_KEY = re.compile(r"[a-f0-9]{32}")
_HEX_WORDS = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
              "alpha", "bravo", "charlie", "delta", "echo", "foxtrot")

#: Ready-made scenarios: a clean input, a limited one, adult images and text, regional delivery,
#: content restricted in Germany, and mixed instances in one category.
TEST_INPUT_PRESETS: dict[str, SignedTestInput] = {
    "clean": {"instances": []},
    "limited": {"instances": [{"category": "harassment", "qualifiers": ["harassment-abuse"]}]},
    "adult_image": {"instances": [{"category": "sexual", "qualifiers": ["sexual-pornographic-media"]}]},
    "adult_text": {"instances": [{"category": "sexual", "qualifiers": ["sexual-explicit-language"]}]},
    "regional_delivery": {"instances": [], "regionalActions": [
        {"region": "DE", "action": "block"}, {"region": "GB", "action": "age-restrict"},
        {"region": "FR", "action": "limit"}]},
    "germany": {"instances": [{"category": "hate", "qualifiers": ["hate-symbol", "hate-nazi-symbols-public-display"]}]},
    "mixed": {"instances": [
        {"category": "harassment", "qualifiers": ["harassment-abuse", "harassment-documentary"]},
        {"category": "harassment", "qualifiers": ["harassment-threat"]}]},
}

#: The signals ``generate_test_text_code`` accepts.
TEXT_TEST_SIGNALS: tuple[str, ...] = (*CATEGORIES, "sexual.involving-minors", "harassment.insult", "sexual.adult",
                                      "hate.regional-symbol", "violence.graphic")
#: The signals ``generate_media_test_code`` accepts.
MEDIA_TEST_SIGNALS: tuple[str, ...] = (*CATEGORIES, "violence.graphic")


def signal_test_input(signal: ClassificationTestSignal, kind: Literal["text", "image"] = "text") -> SignedTestInput:
    """The scenario a signal stands for in text (``kind="text"``) or in an image
    (``kind="image"``). Raises ``sdk/invalid-argument`` for an unknown signal."""
    preset: Mapping[str, Any]
    if signal == "harassment.insult":
        preset = TEST_INPUT_PRESETS["limited"]
    elif signal == "sexual.adult":
        preset = TEST_INPUT_PRESETS["adult_image" if kind == "image" else "adult_text"]
    elif signal == "hate.regional-symbol":
        preset = TEST_INPUT_PRESETS["germany"]
    elif signal == "sexual.involving-minors":
        preset = {"instances": [{"category": "sexual", "qualifiers": ["sexual-minors"]}]}
    elif signal == "violence.graphic":
        preset = {"instances": [{"category": "violence", "qualifiers": ["violence-graphic"]}]}
    elif signal in CATEGORIES:
        preset = {"instances": [{"category": signal, "qualifiers": []}]}
    else:
        raise _invalid(f"Unknown test signal: {signal!r}")
    return cast(SignedTestInput, _validate(preset))


def generate_test_text_code(scenario: SignedTestInput | ClassificationTestSignal, test_input_key: str) -> str:
    """A text code for a scenario or signal, signed with ``test_input_key``: the project's secret
    test input key from the portal. Put it anywhere in text content. Raises
    ``sdk/invalid-argument`` for an invalid key or scenario."""
    _check_key(test_input_key)
    return _text_code(_validate(signal_test_input(scenario) if isinstance(scenario, str) else scenario),
                      test_input_key)


def generate_media_test_code(signal: ClassificationTestSignal, test_input_key: str) -> str:
    """A phrase to read aloud in audio, or show as large, high-contrast text in a video frame, for
    one of ``MEDIA_TEST_SIGNALS``, signed with ``test_input_key``: the project's secret test input
    key from the portal. Raises ``sdk/invalid-argument`` for an invalid key or signal."""
    if signal not in MEDIA_TEST_SIGNALS:
        raise _invalid(f"Unsupported media test signal: {signal!r}")
    _check_key(test_input_key)
    tag = _hmac(test_input_key, f"calmlens-test:media:{signal}")
    words = " ".join(_HEX_WORDS[int(digit, 16)] for digit in tag)
    return f"Calm Lens test {words} {re.sub(r'[.-]', ' ', signal)} end test"


def _check_key(key: object) -> None:
    if not isinstance(key, str) or not _KEY.fullmatch(key):
        raise _invalid("The test input key must be 32 lowercase hexadecimal characters")


def _hmac(key: str, message: str) -> str:
    return hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()[:32]


def _text_code(scenario: dict[str, Any], key: str) -> str:
    payload = base64.urlsafe_b64encode(_canonical(scenario).encode()).decode().rstrip("=")
    if len(payload) > 8000:
        raise _invalid("The test scenario is too large")
    return f"<!calmlens-test {_hmac(key, f'calmlens-test:v1:{payload}')} {payload}>"


def _canonical(value: Any) -> str:
    """JSON without whitespace, with numbers as JavaScript prints them; validated dicts are
    already in the canonical key order and hold only ASCII tokens."""
    if isinstance(value, dict):
        return "{" + ",".join(f'"{key}":{_canonical(item)}' for key, item in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_canonical(item) for item in value) + "]"
    if isinstance(value, str):
        return json.dumps(value)
    return _js_number(float(value))


def _js_number(value: float) -> str:
    """A score (0 to 1) as JavaScript's ``JSON.stringify`` prints it."""
    if value == int(value):
        return str(int(value))
    text = next(text for text in (f"{value:.{precision}e}" for precision in range(17)) if float(text) == value)
    mantissa, exponent = text.split("e")
    digits, power = mantissa.replace(".", "").rstrip("0"), int(exponent)
    if value < 1e-6:
        return f"{digits[0]}{'.' + digits[1:] if len(digits) > 1 else ''}e{power}"
    return f"0.{'0' * (-power - 1)}{digits}"


def _list(value: object, name: str, limit: int) -> Sequence[Any]:
    if not isinstance(value, (list, tuple)):
        raise _invalid(f"{name} must be a list")
    if len(value) > limit:
        raise _invalid(f"{name} may have at most {limit} items")
    return value


def _fields(value: object, name: str, required: tuple[str, ...], optional: tuple[str, ...]) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise _invalid(f"{name} must be a dict")
    unknown = set(value) - {*required, *optional}
    if unknown:
        raise _invalid(f"{name} has unknown fields: {', '.join(sorted(map(str, unknown)))}")
    missing = [key for key in required if key not in value]
    if missing:
        raise _invalid(f"{name} is missing {', '.join(missing)}")
    return value


def _validate(scenario: object) -> dict[str, Any]:
    """Checks a scenario like the API and copies it in canonical key order."""
    fields = _fields(scenario, "The test scenario", ("instances",), ("regionalActions", "unassessedCategories"))
    result: dict[str, Any] = {}
    if "regionalActions" in fields:
        regional = []
        for item in _list(fields["regionalActions"], "regionalActions", len(_REGIONS)):
            entry = _fields(item, "A regional action", ("region", "action"), ())
            if entry["region"] not in _REGIONS or entry["action"] not in _REGIONAL_ACTIONS:
                raise _invalid(f"Regional actions need a region of {', '.join(_REGIONS)} and an action of "
                               f"{', '.join(_REGIONAL_ACTIONS)}")
            regional.append({"region": entry["region"], "action": entry["action"]})
        if len({entry["region"] for entry in regional}) != len(regional):
            raise _invalid("Each region may have one regional action")
        result["regionalActions"] = regional
    instances = []
    for item in _list(fields["instances"], "instances", 128):
        entry = _fields(item, "An instance", ("category", "qualifiers"), ("score", "action"))
        category = entry["category"]
        if category not in CATEGORIES:
            raise _invalid(f"Unknown category: {category!r}")
        instance: dict[str, Any] = {"category": category}
        if "score" in entry:
            score = entry["score"]
            if isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 1:
                raise _invalid("An instance's score must be a number from 0 to 1")
            instance["score"] = score
        if "action" in entry:
            if entry["action"] not in _ACTIONS:
                raise _invalid(f"An instance's action must be one of {', '.join(_ACTIONS)}")
            instance["action"] = entry["action"]
        qualifiers = list(_list(entry["qualifiers"], "qualifiers", 64))
        if any(qualifier not in QUALIFIERS[category] or qualifier in INPUT_QUALIFIERS for qualifier in qualifiers) \
                or len(set(qualifiers)) != len(qualifiers):
            raise _invalid(f"Choose unique content qualifiers of {category}; input-type qualifiers are automatic")
        instance["qualifiers"] = qualifiers
        instances.append(instance)
    if len({"action" in instance for instance in instances}) > 1:
        raise _invalid("Set an action on every instance or on none")
    if "unassessedCategories" in fields:
        unassessed = list(_list(fields["unassessedCategories"], "unassessedCategories", len(CATEGORIES)))
        if any(category not in CATEGORIES for category in unassessed) or len(set(unassessed)) != len(unassessed) \
                or any(instance["category"] in unassessed for instance in instances):
            raise _invalid("Unassessed categories must be unique categories without instances")
        result["unassessedCategories"] = unassessed
    result["instances"] = instances
    return result
