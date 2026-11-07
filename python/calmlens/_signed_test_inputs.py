"""Signed test inputs: text codes, test images and media phrases that a project's test input key
authenticates, so CalmLens returns the scenario they describe instead of classifying them. The
formats match the JavaScript SDK's ``calmlens/test-inputs`` byte for byte."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import struct
import time
import zlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, TypedDict, Union, cast

from ._mock_classification import (CATEGORIES, INPUT_QUALIFIERS, QUALIFIERS, TEST_DETECTION_BOX_MAX,
                                  TEST_DETECTIONS_MAX, TEST_FACE_AGE_MAX, TEST_FACE_AGE_PRESETS)
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


#: A test face's age preset.
SignedTestFaceAgePreset = Literal["adult", "minor"]


class SignedTestFaceAgeRange(TypedDict):
    """A test face's estimated age range in years: integers from 0 to 120, ``low`` at most
    ``high``."""
    low: int
    high: int


#: A test face's age: a preset or a range.
SignedTestFaceAge = Union[SignedTestFaceAgePreset, SignedTestFaceAgeRange]


class _SignedTestDetectedPersonRequired(TypedDict):
    box: list[int]


class SignedTestDetectedPerson(_SignedTestDetectedPersonRequired, total=False):
    """A detected person: ``box`` is ``[left, top, width, height]`` in integer basis points of the
    image (0 to 10000, inside the image), and ``confidence`` an integer percentage (0 to 100)."""
    confidence: int


class SignedTestDetectedFace(SignedTestDetectedPerson, total=False):
    """A detected face, like a person, optionally with its estimated age."""
    age: SignedTestFaceAge


class SignedTestDetections(TypedDict, total=False):
    """The person and face detection results a test input reports instead of running detection:
    each a list of at most 32 entries, or ``"unavailable"`` to report the feature as not
    evaluated."""
    people: list[SignedTestDetectedPerson] | Literal["unavailable"]
    faces: list[SignedTestDetectedFace] | Literal["unavailable"]


class _SignedTestInputRequired(TypedDict):
    instances: list[SignedTestInstance]


class SignedTestInput(_SignedTestInputRequired, total=False):
    """A test scenario: up to 128 instances, the categories CalmLens reports as not assessed
    (none may have instances), up to one action per region, and the person and face detections
    to report."""
    regionalActions: list[SignedTestRegionalAction]
    unassessedCategories: list[ClassificationCategory]
    detections: SignedTestDetections


@dataclass(frozen=True)
class PaintedTestImage:
    """A painted test image: ``width`` by ``height`` pixels of 8-bit RGBA in ``rgba``, row by row,
    and the same image as ``png`` bytes to upload."""
    width: int
    height: int
    rgba: bytes
    png: bytes


_ACTIONS = ("allow", "limit", "age-restrict", "block")
_REGIONS = ("DE", "AT", "FR", "GB", "EU", "AU", "BR")
_REGIONAL_ACTIONS = ("limit", "age-restrict", "block")
_KEY = re.compile(r"[a-f0-9]{32}")
_HEX_WORDS = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
              "alpha", "bravo", "charlie", "delta", "echo", "foxtrot")

#: Ready-made scenarios: a clean input, a limited one, adult images and text, regional delivery,
#: content restricted in Germany, mixed instances in one category, and person and face
#: detections: one person and face, nobody, an adult face, a minor's face and a group of three.
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
    "one_face": {"instances": [], "detections": {"people": [{"box": [2500, 1500, 5000, 8500]}],
                                                 "faces": [{"box": [3500, 2000, 3000, 3500]}]}},
    "no_face": {"instances": [], "detections": {"people": [], "faces": []}},
    "adult_face": {"instances": [], "detections": {"people": [{"box": [2500, 1500, 5000, 8500]}],
                                                   "faces": [{"box": [3500, 2000, 3000, 3500], "age": "adult"}]}},
    "minor_face": {"instances": [], "detections": {"people": [{"box": [2500, 1500, 5000, 8500]}],
                                                   "faces": [{"box": [3500, 2000, 3000, 3500], "age": "minor"}]}},
    "group": {"instances": [], "detections": {
        "people": [{"box": [left, 2000, 2800, 8000]} for left in (500, 3600, 6700)],
        "faces": [{"box": [left, 2500, 1400, 2000]} for left in (1200, 4300, 7400)]}},
}

#: The signals ``generate_test_text_code`` and ``paint_test_image`` accept.
TEXT_TEST_SIGNALS: tuple[str, ...] = (*CATEGORIES, "sexual.involving-minors", "harassment.insult", "sexual.adult",
                                      "hate.regional-symbol", "violence.graphic")
#: The signals ``generate_media_test_code`` accepts.
MEDIA_TEST_SIGNALS: tuple[str, ...] = (*CATEGORIES, "violence.graphic")


#: A code or test image expires this many seconds after it is made unless ``expires_at`` says
#: otherwise: one day.
TEST_INPUT_DEFAULT_LIFETIME_SECONDS = 24 * 60 * 60
#: CalmLens ignores a code or test image that is more than this many seconds from expiring when it
#: arrives: seven days.
TEST_INPUT_MAX_LIFETIME_SECONDS = 7 * 24 * 60 * 60


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
        preset = {"instances": [{"category": "violence", "qualifiers": ["violence-injury", "violence-graphic"]}]}
    elif signal in CATEGORIES:
        preset = {"instances": [{"category": signal, "qualifiers": []}]}
    else:
        raise _invalid(f"Unknown test signal: {signal!r}")
    return cast(SignedTestInput, _validate(preset))


def generate_test_text_code(scenario: SignedTestInput | ClassificationTestSignal, test_input_key: str, *,
                            expires_at: int | None = None) -> str:
    """A text code for a scenario or signal, signed with ``test_input_key``: the project's secret
    test input key from the portal settings. Submit the code as the whole text: CalmLens moderates
    text with anything else around it as ordinary content. The code expires at ``expires_at``
    (Unix seconds, an integer from 0 to 4294967295), by default one day from now; CalmLens ignores
    an expired code, and one more than seven days from expiring, so generate codes when tests run
    rather than storing them. Raises ``sdk/invalid-argument`` for an invalid key, scenario or
    expiry."""
    _check_key(test_input_key)
    return _text_code(_validate(signal_test_input(scenario) if isinstance(scenario, str) else scenario),
                      test_input_key, _expiry(expires_at))


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


def paint_test_image(scenario: SignedTestInput | ClassificationTestSignal, test_input_key: str, *,
                     expires_at: int | None = None) -> PaintedTestImage:
    """The test image for a scenario or signal, signed with ``test_input_key``: the project's
    secret test input key from the portal settings. Upload its ``png`` bytes (or encode ``rgba``
    in any format: the image survives lossy formats and resizing) as the whole image, optionally
    on a plain single-colour border; CalmLens moderates an image with anything else in it as
    ordinary content. The image expires like a text code: at ``expires_at`` (Unix seconds), by
    default one day from now. Raises ``sdk/invalid-argument`` for an invalid key, scenario or
    expiry, or a scenario too large for a test image."""
    _check_key(test_input_key)
    checked = _validate(signal_test_input(scenario, "image") if isinstance(scenario, str) else scenario)
    _, tag, payload = _text_code(checked, test_input_key, _expiry(expires_at))[:-1].split(" ")
    signed = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
    data = bytes([len(signed) >> 8, len(signed) & 255]) + bytes.fromhex(tag) + signed
    categories = dict.fromkeys(instance["category"] for instance in checked["instances"])
    palette = [_CATEGORY_COLOURS[category] for category in categories] or [(144, 152, 160)]
    width, rgba = _paint_grid(data, palette)
    return PaintedTestImage(width, width, rgba, _png(width, width, rgba))


#: Category colours, carried in test images' chroma only.
_CATEGORY_COLOURS = {"sexual": (232, 80, 160), "violence": (224, 56, 64), "self-harm": (24, 168, 152),
                     "harassment": (240, 128, 48), "hate": (144, 80, 216), "criminal-activity": (224, 184, 40),
                     "personal-information": (48, 128, 224), "profanity": (136, 192, 48)}
#: The four data levels' target luma, in Gray-code order for symbols 0 to 3.
_GRID_LEVELS = (72, 128, 184, 240)
_SYMBOL_LEVEL = (0, 1, 3, 2)
_GRID_PARITY = 32
_GRID_EXP = [0] * 512
_GRID_LOG = [0] * 256


def _init_gf() -> None:
    x = 1
    for i in range(255):
        _GRID_EXP[i] = x
        _GRID_LOG[x] = i
        x <<= 1
        if x & 256:
            x ^= 0x11D
    for i in range(255, 512):
        _GRID_EXP[i] = _GRID_EXP[i - 255]


_init_gf()


def _gf_mul(a: int, b: int) -> int:
    return _GRID_EXP[_GRID_LOG[a] + _GRID_LOG[b]] if a and b else 0


def _generator() -> list[int]:
    g = [1]
    for i in range(_GRID_PARITY):
        following = [0] * (len(g) + 1)
        for j, coefficient in enumerate(g):
            following[j] ^= coefficient
            following[j + 1] ^= _gf_mul(coefficient, _GRID_EXP[i])
        g = following
    return g


_GRID_GENERATOR = _generator()


def _rs_parity(block: bytes) -> bytes:
    parity = [0] * _GRID_PARITY
    for byte in block:
        factor = byte ^ parity[0]
        parity = parity[1:] + [0]
        if factor:
            for j in range(_GRID_PARITY):
                parity[j] ^= _gf_mul(_GRID_GENERATOR[j + 1], factor)
    return bytes(parity)


def _grid_layout(cells: int) -> tuple[int, list[int], int]:
    capacity = (cells - 2) * (cells - 2) // 4
    blocks = -(-capacity // 255)
    lengths = [capacity // blocks + (1 if index < capacity % blocks else 0) for index in range(blocks)]
    return capacity, lengths, capacity - blocks * _GRID_PARITY


def _grid_pixel(colour: Sequence[int], level: int) -> tuple[int, ...]:
    target = _GRID_LEVELS[level]
    own = (77 * colour[0] + 150 * colour[1] + 29 * colour[2]) >> 8
    differences = [channel - own for channel in colour]
    for scale in range(16, -1, -1):
        # Truncate each scaled difference toward zero, as JavaScript's sign × (|d| × s >> 4).
        pixel = tuple(target + (abs(d) * scale >> 4 if d >= 0 else -(abs(d) * scale >> 4)) for d in differences)
        if all(0 <= channel <= 255 for channel in pixel):
            return pixel
    raise AssertionError("unreachable: scale 0 is the level's grey")


def _paint_grid(data: bytes, palette: Sequence[Sequence[int]]) -> tuple[int, bytes]:
    """The grid of packages/shared/src/TestImageGrid.ts: width and RGBA bytes."""
    cells = next((cells for cells in range(15, 128, 2) if _grid_layout(cells)[2] >= len(data)), None)
    if cells is None:
        raise _invalid("The test scenario is too large for a test image")
    capacity, lengths, data_bytes = _grid_layout(cells)
    padded = data + bytes(0x11 if i % 2 else 0xEC for i in range(data_bytes - len(data)))
    codewords = []
    offset = 0
    for length in lengths:
        block = padded[offset:offset + length - _GRID_PARITY]
        offset += len(block)
        codewords.append(block + _rs_parity(block))
    interleaved = (codeword[i] for i in range(max(lengths)) for codeword in codewords if i < len(codeword))
    # Whitening: a uniform area never reads as the all-zero codeword.
    stream = bytes(byte ^ ((i * 151 + 77) & 255) for i, byte in enumerate(interleaved))
    span = cells - 1
    denominator = span * span
    pixels = []
    for y in range(cells):
        for x in range(cells):
            if x in (0, span) or y in (0, span):
                grey = 255 if (x + y) % 2 else 0
                pixels.append(bytes((grey, grey, grey, 255)))
                continue
            symbol = (y - 1) * (cells - 2) + x - 1
            index = symbol >> 2
            level = _SYMBOL_LEVEL[(stream[index] >> (6 - 2 * (symbol & 3))) & 3] if index < capacity else 0
            position = (x * (span - y) + (span - x) * y) * (len(palette) - 1)
            start = position // denominator
            remainder = position - start * denominator
            end = palette[min(start + 1, len(palette) - 1)]
            colour = [(channel * (denominator - remainder) + end[c] * remainder) // denominator
                      for c, channel in enumerate(palette[start])]
            pixels.append(bytes((*_grid_pixel(colour, level), 255)))
    cell_size = 2 * (512 // 2 // cells)
    width = cells * cell_size
    rows = []
    for y in range(cells):
        row = b"".join(pixel * cell_size for pixel in pixels[y * cells:(y + 1) * cells])
        rows.append(row * cell_size)
    return width, b"".join(rows)


def _png(width: int, height: int, rgba: bytes) -> bytes:
    """8-bit RGBA rows without filtering in stored deflate blocks, so every SDK writes the same
    bytes."""
    stride = width * 4
    raw = b"".join(b"\0" + rgba[row * stride:(row + 1) * stride] for row in range(height))
    stream = bytearray(b"\x78\x01")
    for offset in range(0, len(raw), 65535):
        block = raw[offset:offset + 65535]
        stream += struct.pack("<BHH", offset + len(block) == len(raw), len(block), ~len(block) & 0xFFFF) + block
    stream += struct.pack(">I", zlib.adler32(raw))

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", bytes(stream)) + chunk(b"IEND", b""))


def _check_key(key: object) -> None:
    if not isinstance(key, str) or not _KEY.fullmatch(key):
        raise _invalid("The test input key must be 32 lowercase hexadecimal characters")


def _hmac(key: str, message: str) -> str:
    return hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()[:32]


def _expiry(expires_at: object) -> int:
    if expires_at is None:
        return int(time.time()) + TEST_INPUT_DEFAULT_LIFETIME_SECONDS
    if not _whole(expires_at, 0, 0xFFFFFFFF):
        raise _invalid("expires_at must be an integer number of Unix seconds from 0 to 4294967295")
    return cast(int, expires_at)


def _text_code(scenario: dict[str, Any], key: str, expires_at: int) -> str:
    """The signed payload is the expiry (four bytes, big-endian Unix seconds) followed by the
    scenario's canonical JSON."""
    signed = struct.pack(">I", expires_at) + _canonical(scenario).encode()
    payload = base64.urlsafe_b64encode(signed).decode().rstrip("=")
    if len(payload) > 8000:
        raise _invalid("The test scenario is too large")
    return f"<!calmlens-test {_hmac(key, f'calmlens-test:v2:{payload}')} {payload}>"


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
    fields = _fields(scenario, "The test scenario", ("instances",),
                     ("regionalActions", "unassessedCategories", "detections"))
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
    if "detections" in fields:
        result["detections"] = _validate_detections(fields["detections"])
    return result


def _whole(value: object, low: int, high: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def _validate_detections(value: object) -> dict[str, Any]:
    """Checks a scenario's detections and copies them in canonical key order."""
    fields = _fields(value, "detections", (), ("people", "faces"))
    result: dict[str, Any] = {}
    for name in ("people", "faces"):
        if name not in fields:
            continue
        if fields[name] == "unavailable":
            result[name] = "unavailable"
            continue
        entries = []
        for item in _list(fields[name], name, TEST_DETECTIONS_MAX):
            entry = _fields(item, "A detection", ("box",), ("confidence", "age") if name == "faces" else ("confidence",))
            box = entry["box"]
            if not isinstance(box, (list, tuple)) or len(box) != 4 \
                    or not all(_whole(side, 0, TEST_DETECTION_BOX_MAX) for side in box) \
                    or box[0] + box[2] > TEST_DETECTION_BOX_MAX or box[1] + box[3] > TEST_DETECTION_BOX_MAX:
                raise _invalid(f"A box is four integers [left, top, width, height] from 0 to {TEST_DETECTION_BOX_MAX} "
                               f"inside the image: left + width and top + height are at most {TEST_DETECTION_BOX_MAX}")
            detection: dict[str, Any] = {"box": list(box)}
            if "confidence" in entry:
                if not _whole(entry["confidence"], 0, 100):
                    raise _invalid("A detection's confidence must be an integer from 0 to 100")
                detection["confidence"] = entry["confidence"]
            if "age" in entry:
                detection["age"] = _validate_age(entry["age"])
            entries.append(detection)
        result[name] = entries
    return result


def _validate_age(value: object) -> str | dict[str, int]:
    if isinstance(value, str):
        if value not in TEST_FACE_AGE_PRESETS:
            raise _invalid(f"A face's age preset must be one of {', '.join(TEST_FACE_AGE_PRESETS)}")
        return value
    age = _fields(value, "A face's age", ("low", "high"), ())
    low, high = age["low"], age["high"]
    if not _whole(low, 0, TEST_FACE_AGE_MAX) or not _whole(high, 0, TEST_FACE_AGE_MAX) or low > high:
        raise _invalid(f"A face's age range is two integers from 0 to {TEST_FACE_AGE_MAX}, low at most high")
    return {"low": low, "high": high}
