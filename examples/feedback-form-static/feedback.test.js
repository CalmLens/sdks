import { describe, expect, test } from "bun:test";
import { CATEGORIES, composeDescription, getSubmissionState } from "./feedback.js";

describe("composeDescription", () => {
  test("carries the category, the trimmed message and the reply address", () => {
    const description = composeDescription({
      category: "idea",
      message: "  Dark mode for the dashboard  ",
      email: " sam@example.com ",
    });
    expect(description.startsWith(CATEGORIES.idea)).toBe(true);
    expect(description).toContain("Dark mode for the dashboard");
    expect(description).not.toContain("  Dark mode");
    expect(description).toContain("sam@example.com");
    expect(description).not.toContain(" sam@example.com ");
  });

  test("leaves the reply address out when none was given", () => {
    const withEmail = composeDescription({ category: "bug", message: "Broken", email: "a@b.co" });
    const withoutEmail = composeDescription({ category: "bug", message: "Broken", email: "  " });
    expect(withoutEmail).not.toContain("a@b.co");
    expect(withEmail.startsWith(withoutEmail)).toBe(true);
    expect(withoutEmail.length).toBeLessThan(withEmail.length);
  });

  test("files an unknown category as other", () => {
    expect(
      composeDescription({ category: "spam", message: "Hi" }).startsWith(CATEGORIES.other),
    ).toBe(true);
  });
});

describe("getSubmissionState", () => {
  const complete = (status) => ({ stage: "complete", status, assetId: "asset-1" });

  test("is a draft with no screenshot or one waiting to be sent", () => {
    expect(getSubmissionState(undefined).state).toBe("draft");
    expect(getSubmissionState({ stage: "selected" }).state).toBe("draft");
  });

  test.each(["queued", "uploading", "checking"])("is sending while %s", (stage) => {
    expect(getSubmissionState({ stage }).state).toBe("sending");
  });

  test.each(["allowed", "limited", "age-restricted", "pending", undefined])(
    "accepts a screenshot whose status is %s",
    (status) => {
      expect(getSubmissionState(complete(status))).toEqual({
        state: "sent",
        status,
        assetId: "asset-1",
      });
    },
  );

  test.each(["blocked", "purged"])("refuses a %s screenshot", (status) => {
    expect(getSubmissionState(complete(status))).toEqual({ state: "refused", status });
  });

  test("lets an upload error be retried", () => {
    expect(
      getSubmissionState({ stage: "failed", errorCode: "upload-preset/daily-limit-reached" }),
    ).toEqual({ state: "failed", errorCode: "upload-preset/daily-limit-reached", retryable: true });
  });

  test("needs a different file when the uploader refused it before sending", () => {
    expect(getSubmissionState({ stage: "failed", errorCode: "file/too-large" })).toEqual({
      state: "failed",
      errorCode: "file/too-large",
      retryable: false,
    });
  });
});
