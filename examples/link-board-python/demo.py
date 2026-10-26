"""Demo mode for Calmboard: simulated decisions on the SDK's in-memory test client.

Loaded only with --demo or CALMLENS_DEMO=1. Every call still goes through the real client's
validation and encoding, but nothing is fetched or classified: the outcome a member picks
is written into the mock's stored asset after a short delay, shaped like a live website
decision (the page's parts carry the findings and decide the page).
"""
from __future__ import annotations

import threading
import time
import uuid
from urllib.parse import urlsplit

from calmlens import Asset
from calmlens.testing import MockCalmLensServerClient

from app import Moderator

DEMO_DELAY_SECONDS = 2.0
CATEGORIES = ("sexual", "violence", "self-harm", "harassment", "hate", "criminal-activity",
              "personal-information", "profanity")
# The category and score each demo outcome gives the part that caused it.
FINDINGS = {
    "limited": ("profanity", 0.62),
    "age-restricted": ("sexual", 0.88),
    "blocked": ("violence", 0.93),
    "image-blocked": ("violence", 0.91),
    "purged": ("criminal-activity", 0.97),
}
# Sample pages on reserved example domains: (title, description, image names).
PAGES = {
    "https://news.example.org/2026/street-trees-cool-cities": (
        "Street trees cool city blocks by up to 4°C",
        "A two-year study of 40 neighbourhoods finds which species shade pavements best.",
        ["canopy-map.png", "figure-2.png"]),
    "https://recipes.example.net/one-pan-lentil-dal": (
        "One-pan lentil dal in 25 minutes", "A weeknight dal with pantry spices and no special kit.",
        ["dal-bowl.jpg"]),
    "https://forum.example.com/threads/worst-referee-calls": (
        "The worst referee calls of the season", "", ["thread-banner.jpg"]),
    "https://blog.example.com/new-cycle-lanes": (
        "Riding the new cross-town cycle lanes", "What changed on the four main routes, and what's still missing.",
        ["route-map.png"]),
    "https://blog.example.com/fixing-a-bike-chain": (
        "Fixing a slipped bike chain at the roadside", "", ["chain-diagram.png", "hero.jpg"]),
    "https://video.example.net/watch/street-fight-compilation": (
        "Street fight compilation", "", ["thumbnail.jpg"]),
    "https://library.example.org/archive/darkroom-guide": (
        "A beginner's guide to the home darkroom", "", []),
    "https://gallery.example.com/collections/figure-studies": (
        "Figure studies: a life-drawing collection", "", ["study-01.jpg", "study-02.jpg"]),
}
# Seeded on start, oldest first: (url, note, outcome, minutes ago). The newest stays pending for
# SEED_PENDING_SECONDS, so the board shows a page being checked.
SAMPLE_LINKS = [
    ("https://news.example.org/2026/street-trees-cool-cities",
     "Good data on which species shade best. Worth sending to the council.", "allowed", 190),
    ("https://gallery.example.com/collections/figure-studies", "Lovely charcoal work from the spring class.", "age-restricted", 140),
    ("https://shop.example.com/deals/weekend", "Everyone here should see this.", "note-blocked", 120),
    ("https://blog.example.com/fixing-a-bike-chain", "Saved my commute this morning.", "blocked", 95),
    ("https://library.example.org/archive/darkroom-guide", "Old but still the clearest guide I've found.", "error", 60),
    ("https://forum.example.com/threads/worst-referee-calls", "Some strong language, but very funny.", "limited", 40),
    ("https://video.example.net/watch/street-fight-compilation", "Wild footage from last weekend", "image-blocked", 25),
    ("https://recipes.example.net/one-pan-lentil-dal", "Made this twice this week. Add lime at the end.", "allowed", 8),
    ("https://blog.example.com/new-cycle-lanes", "Has anyone ridden the new lanes yet?", "allowed", 0),
]
SEED_PENDING_SECONDS = 15.0


def page_details(url: str) -> tuple[str, str, list[str]]:
    host = (urlsplit(url).hostname or "").removeprefix("www.")
    return PAGES.get(url, (host or "Shared page", "", ["header.jpg"]))


def demo_report(category: str | None = None, score: float = 0.0) -> dict:
    """A synthetic part report: the selected category at its score, every other one low. Nothing is classified."""
    categories = {name: {"status": "evaluated", "score": 0.02, "likelihood": "very-unlikely"} for name in CATEGORIES}
    if category:
        categories[category] = {"status": "evaluated", "score": score, "likelihood": "very-likely"}
    return {"score": score if category else 0.02, "categories": categories,
            "policy": {"score": score if category else 0.02, "categories": {},
                       "decision": {"source": "policy", "action": None, "flaggedCategories": [category] if category else []}}}


def decide(asset: dict, status: str, report: dict):
    """Finishes processing with a demo moderation status; ``purged`` also removes the content."""
    now = int(time.time() * 1000)
    asset["classification"]["status"] = "completed"
    asset["classification"]["moderation"].update(status=status, **report)
    asset["classification"]["completedAt"] = now
    if status == "purged":
        asset["content"].update(status="removed", removalReason="policy", updatedAt=now)


def page_report() -> dict:
    """A website's own report when its parts decided it: its categories are not evaluated."""
    return {"score": 0, "categories": {name: {"status": "not-evaluated", "reason": "unavailable"} for name in CATEGORIES},
            "policy": {"score": 0, "categories": {}, "decision": {"source": "children", "action": None, "flaggedCategories": []}}}


class DemoModerator(Moderator):
    demo = True

    def __init__(self, clock=time.monotonic):
        self.mock = MockCalmLensServerClient(mock_options={"queued_outcome": "pending"})
        super().__init__(self.mock)
        self.clock = clock
        self.plans: dict[str, tuple[str, float, str]] = {}
        self.plans_lock = threading.Lock()

    def check_note(self, link_id: str, note: str, demo_result: str) -> Asset:
        asset = super().check_note(link_id, note, demo_result)
        if demo_result == "note-blocked":
            report = demo_report("harassment", 0.91)
            for stored in (self.mock.database_storage.assets[asset["id"]], asset):
                stored["classification"]["moderation"].update(status="blocked", **report)
        return asset

    def submit_link(self, link_id: str, url: str, demo_result: str) -> Asset:
        asset = super().submit_link(link_id, url, demo_result)
        with self.plans_lock:
            self.plans[asset["id"]] = (demo_result, self.clock() + DEMO_DELAY_SECONDS, url)
        return asset

    def make_due(self, asset_id: str, seconds: float = 0):
        """Moves a planned decision to ``seconds`` from now."""
        with self.plans_lock:
            result, _, url = self.plans[asset_id]
            self.plans[asset_id] = (result, self.clock() + seconds, url)

    def _apply_plan(self, asset_id: str):
        with self.plans_lock:
            plan = self.plans.get(asset_id)
            if not plan or self.clock() < plan[1]:
                return
            del self.plans[asset_id]
        result, _, url = plan
        assets = self.mock.database_storage.assets
        asset = assets[asset_id]
        if result == "error":
            asset["classification"]["status"] = "failed"
            return
        status = "blocked" if result == "image-blocked" else result
        title, description, images = page_details(url)
        finding = FINDINGS.get(result)
        parts = [("plaintext-document", f"{title} - Text Content", description or "Extracted text content from website",
                  finding if result != "image-blocked" else None)]
        # An image-blocked page has its finding on the first image; the others are clear.
        if result == "image-blocked" and not images:
            images = ["header.jpg"]
        parts += [("image", name, f"Extracted from website: {url}", finding if result == "image-blocked" and index == 0 else None)
                  for index, name in enumerate(images)]
        for kind, name, part_description, part_finding in parts:
            child_id = str(uuid.uuid4())
            assets[child_id] = {"id": child_id, "projectId": asset["projectId"], "parentId": asset_id, "name": name,
                                "description": part_description, "type": kind, "createdAt": asset["createdAt"],
                                "upload": {"status": "completed"}, "classification": {"status": "processing", "moderation": {}},
                                "content": {"status": "stored"}}
            decide(assets[child_id], status if part_finding else "allowed", demo_report(*(part_finding or (None,))))
        decide(asset, status, page_report())

    def retrieve(self, asset_id: str) -> Asset:
        self._apply_plan(asset_id)
        return super().retrieve(asset_id)

    def delete(self, asset_id: str):
        super().delete(asset_id)
        with self.plans_lock:
            self.plans.pop(asset_id, None)


def seed(board) -> None:
    """Puts the sample links on a new demo board, decided straight away except the newest."""
    now = board.wall_clock()
    for url, note, result, minutes in SAMPLE_LINKS:
        board.submit(url, note, result)
        link = board.links[0]
        link["shared_at"] = now - minutes * 60
        if link["asset_id"]:
            board.moderator.make_due(link["asset_id"], 0 if minutes else SEED_PENDING_SECONDS)
    board.refresh()
