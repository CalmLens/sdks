"""Demo mode for Calmboard: simulated decisions on the SDK's in-memory test client.

Loaded only with --demo or CALMLENS_DEMO=1. Every call still goes through the real client's
validation and encoding, but nothing is fetched or classified: the outcome a member picks
is written into the mock's stored asset after a short delay.
"""
from __future__ import annotations

import threading
import time
import uuid

from calmlens import Asset
from calmlens.testing import MockCalmLensServerClient

from app import Moderator

DEMO_DELAY_SECONDS = 2.0


def demo_report(result: str) -> dict:
    """Synthetic reports for the demo. Nothing is classified."""
    now = int(time.time() * 1000)
    if result == "approved":
        return {"processedAt": now, "score": 0.03, "categories": {
            "criminal-activity": {"status": "evaluated", "score": 0.03, "likelihood": "very-unlikely"},
            "hate": {"status": "evaluated", "score": 0.01, "likelihood": "very-unlikely"},
        }}
    score = 0.92 if result == "rejected" else 0.64
    return {"processedAt": now, "score": score, "categories": {
        "criminal-activity": {"status": "evaluated", "score": score, "likelihood": "likely"},
        "hate": {"status": "evaluated", "score": 0.02, "likelihood": "very-unlikely"},
        "sexual": {"status": "not-evaluated", "reason": "not-supported"},
    }}


def decide(asset: dict, result: str):
    """Finishes processing with a demo outcome: a flagged page is approved with the policy action
    ``alert``, a rejected one is hidden, a clean one matched nothing."""
    asset["classification"]["status"] = "completed"
    asset["classification"]["moderation"].update(decision="approved" if result == "flagged" else result,
                               action={"flagged": "flag", "rejected": "hide"}.get(result),
                               **{k: v for k, v in demo_report(result).items() if k != "processedAt"})
    asset["classification"]["completedAt"] = int(time.time() * 1000)


class DemoModerator(Moderator):
    demo = True

    def __init__(self, clock=time.monotonic):
        self.mock = MockCalmLensServerClient(mock_options={"queued_outcome": "pending"})
        super().__init__(self.mock)
        self.clock = clock
        self.plans: dict[str, tuple[str, float]] = {}
        self.plans_lock = threading.Lock()

    def check_note(self, link_id: str, note: str, demo_result: str) -> Asset:
        asset = super().check_note(link_id, note, demo_result)
        if demo_result == "note-rejected":
            for stored in (self.mock.database_storage.assets[asset["id"]], asset):
                stored["classification"]["moderation"].update(decision="rejected", action="hide")
        return asset

    def submit_link(self, link_id: str, url: str, demo_result: str) -> Asset:
        asset = super().submit_link(link_id, url, demo_result)
        with self.plans_lock:
            self.plans[asset["id"]] = (demo_result, self.clock() + DEMO_DELAY_SECONDS)
        return asset

    def _apply_plan(self, asset_id: str):
        with self.plans_lock:
            plan = self.plans.get(asset_id)
            if not plan or self.clock() < plan[1]:
                return
            del self.plans[asset_id]
        result = plan[0]
        assets = self.mock.database_storage.assets
        asset = assets[asset_id]
        if result == "error":
            asset["classification"]["status"] = "failed"
            return
        decide(asset, result)
        for name, kind, child_result in (("Page text", "plaintext-document", result), ("Header image", "image", "approved")):
            child_id = str(uuid.uuid4())
            assets[child_id] = {"id": child_id, "projectId": asset["projectId"], "parentId": asset_id, "name": name,
                                "type": kind, "createdAt": asset["createdAt"],
                                "upload": {"status": "completed"}, "classification": {"status": "processing", "moderation": {}}, "content": {"status": "stored"}}
            decide(assets[child_id], child_result)

    def retrieve(self, asset_id: str) -> Asset:
        self._apply_plan(asset_id)
        return super().retrieve(asset_id)

    def delete(self, asset_id: str):
        super().delete(asset_id)
        with self.plans_lock:
            self.plans.pop(asset_id, None)
