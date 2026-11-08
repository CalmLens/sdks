"""Reads an upload form as the API does (packages/sdk-contract/README.md, "Scripted client cases"):
exactly an ``options`` part, then a ``file`` part, then the closing boundary."""
from __future__ import annotations

import json
import re
from typing import Any


def read_upload_form(body: bytes, content_type: str | None) -> dict[str, Any]:
    """An upload form read as the API reads it (packages/sdk-contract/README.md, "Scripted client
    cases"): with the boundary from its Content-Type, exactly an ``options`` part, then a ``file``
    part, then the closing boundary."""
    boundary = re.match(r'^multipart/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))', content_type or "", re.I)
    if boundary is None:
        raise AssertionError(f"not an upload form: {content_type}")
    framed = b"\r\n" + body
    delimiter = b"\r\n--" + (boundary.group(1) or boundary.group(2)).encode()
    if not framed.startswith(delimiter):
        raise AssertionError("the form doesn't start with its boundary")
    parts: list[tuple[str | None, str | None, bytes]] = []
    at = 0
    while not framed.startswith(b"--", at + len(delimiter)):
        header_end = framed.find(b"\r\n\r\n", at)
        following = -1 if header_end == -1 else framed.find(delimiter, header_end + 4)
        if following == -1:
            raise AssertionError("the form ends before its closing boundary")
        headers = framed[at + len(delimiter) + 2:header_end].decode()
        name = re.search(r'^content-disposition:\s*form-data;[^\r\n]*?\bname="([^"]*)"', headers, re.I | re.M)
        type_ = re.search(r"^content-type:\s*([^\r\n]*)", headers, re.I | re.M)
        parts.append((name.group(1) if name else None, type_.group(1) if type_ else None,
                      framed[header_end + 4:following]))
        at = following
    if framed[at + len(delimiter):] != b"--\r\n":
        raise AssertionError("the form has more after its closing boundary")
    names = [part[0] for part in parts]
    if names != ["options", "file"]:
        raise AssertionError(f"the form holds {names}, not options then file")
    return {"options": json.loads(parts[0][2]), "type": parts[1][1], "bytes": parts[1][2]}
