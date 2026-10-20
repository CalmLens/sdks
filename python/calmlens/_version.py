"""The SDK version, read from the installed package metadata (``pyproject.toml``)."""
from __future__ import annotations

import re
from importlib import metadata
from pathlib import Path


def _read_version() -> str:
    # A source checkout (PYTHONPATH=python) has no installed metadata, or may
    # have an older install's; its pyproject.toml is the source of truth there.
    manifest = Path(__file__).resolve().parent.parent / "pyproject.toml"
    if manifest.is_file():
        found = re.search(r'^\[project\][^[]*?^version\s*=\s*"([^"]+)"', manifest.read_text("utf-8"), re.M | re.S)
        if found:
            return found.group(1)
    try:
        return metadata.version("calmlens")
    except metadata.PackageNotFoundError:
        return "0.0.0"


__version__ = _read_version()
