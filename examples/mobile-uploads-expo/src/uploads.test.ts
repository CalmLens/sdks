import { describe, expect, test } from "bun:test";
import type { UploadedAsset } from "@calmlens/sdk/app";
import {
  getOutcome,
  getRetryKind,
  isBusy,
  type PickedPhoto,
  type Upload,
  type UploadEvent,
  uploadsReducer,
} from "./uploads";

const photo = (name: string): PickedPhoto => ({
  uri: `file:///${name}`,
  name,
  type: "image/jpeg",
  width: 1000,
  height: 750,
});
const asset = (status?: UploadedAsset["status"]): UploadedAsset => ({
  id: "asset-1",
  name: "lake.jpg",
  createdAt: 1,
  status,
});
const run = (...events: UploadEvent[]) => events.reduce(uploadsReducer, [] as Upload[]);
const started = (key: string): UploadEvent => ({
  type: "started",
  key,
  photo: photo(`${key}.jpg`),
  at: 1,
});

describe("uploadsReducer", () => {
  test("lists the newest upload first", () => {
    const uploads = run(started("a"), started("b"));
    expect(uploads.map((upload) => upload.key)).toEqual(["b", "a"]);
  });

  test("keeps checking while the upload is pending and settles on the decision", () => {
    const pending = run(started("a"), { type: "checked", key: "a", asset: asset("pending") });
    expect(pending[0]?.stage).toBe("checking");
    expect(isBusy(pending[0]!)).toBe(true);
    const decided = uploadsReducer(pending, { type: "checked", key: "a", asset: asset("blocked") });
    expect(decided[0]?.stage).toBe("decided");
    expect(isBusy(decided[0]!)).toBe(false);
  });

  test("marks a pending upload stalled when polling stops, and checks it again on retry", () => {
    const [upload] = run(
      started("a"),
      { type: "checked", key: "a", asset: asset("pending") },
      {
        type: "stalled",
        key: "a",
      },
    );
    expect(upload?.stage).toBe("stalled");
    expect(getRetryKind(upload!)).toBe("check");
  });

  test("uploads again after a failed upload, but only checks again after a failed check", () => {
    const [failedUpload] = run(started("a"), { type: "failed", key: "a", message: "Offline" });
    expect(failedUpload).toMatchObject({ stage: "failed", message: "Offline" });
    expect(getRetryKind(failedUpload!)).toBe("upload");

    const [failedCheck] = run(
      started("a"),
      { type: "checked", key: "a", asset: asset("pending") },
      { type: "failed", key: "a", message: "Offline", code: "sdk/transport-error" },
    );
    expect(failedCheck).toMatchObject({ stage: "failed", code: "sdk/transport-error" });
    expect(getRetryKind(failedCheck!)).toBe("check");

    const [retried] = uploadsReducer([failedUpload!], { type: "retried", key: "a" });
    expect(retried?.stage).toBe("uploading");
    expect(retried).not.toHaveProperty("message");
  });
});

describe("getOutcome", () => {
  const decided = (status?: UploadedAsset["status"]) =>
    run(started("a"), { type: "checked", key: "a", asset: asset(status) })[0]!;

  test.each([
    ["allowed", "shared"],
    ["limited", "limited"],
    ["age-restricted", "age-restricted"],
    ["blocked", "refused"],
    ["purged", "refused"],
    [undefined, "unknown"],
  ] as const)("treats %s as %s", (status, outcome) => {
    expect(getOutcome(decided(status))).toBe(outcome);
  });

  test("is busy while uploading or checking", () => {
    expect(getOutcome(run(started("a"))[0]!)).toBe("busy");
    expect(getOutcome(decided("pending"))).toBe("busy");
  });
});
