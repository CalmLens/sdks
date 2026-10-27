import { describe, expect, test } from "bun:test";
import type { UploadItem } from "@calmlens/sdk/react-native";
import { getOutcome, isBusy } from "./uploads";

const item = (changes: Partial<UploadItem>): UploadItem => ({
  key: "upload-1",
  file: {
    name: "lake.jpg",
    type: "image/jpeg",
    size: 3,
    arrayBuffer: async () => new ArrayBuffer(3),
  },
  stage: "complete",
  progress: null,
  ...changes,
});

describe("getOutcome", () => {
  test("is busy until the queue has an answer", () => {
    for (const stage of ["queued", "uploading", "checking"] as const) {
      expect(getOutcome(item({ stage }))).toBe("busy");
      expect(isBusy(item({ stage }))).toBe(true);
    }
  });

  test("treats each decision as the app shows it", () => {
    expect(
      (["allowed", "limited", "age-restricted", "blocked", "purged"] as const).map((status) =>
        getOutcome(item({ status })),
      ),
    ).toEqual(["shared", "limited", "age-restricted", "refused", "refused"]);
  });

  test("is stalled when the queue stopped checking a pending photo", () => {
    expect(getOutcome(item({ status: "pending" }))).toBe("stalled");
    expect(isBusy(item({ status: "pending" }))).toBe(false);
  });

  test("is unknown when the preset doesn't show decisions", () => {
    expect(getOutcome(item({ status: undefined }))).toBe("unknown");
  });

  test("is failed when the upload or a check failed", () => {
    expect(getOutcome(item({ stage: "failed", errorCode: "sdk/transport-error" }))).toBe("failed");
  });
});
