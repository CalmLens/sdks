// The form's own logic, kept free of the DOM and the network so it can be tested on its own.

/** The kinds of feedback the form offers, by the value each radio button sends. */
export const CATEGORIES = {
  bug: "Bug",
  idea: "Idea",
  question: "Question",
  other: "Other",
};

/**
 * The upload's description, which is where the feedback travels: the page has no backend, so the
 * screenshot's description carries the category, message and reply address to your project.
 */
export function composeDescription({ category, message, email }) {
  const lines = [`${CATEGORIES[category] ?? CATEGORIES.other}: ${message.trim()}`];
  if (email?.trim()) lines.push(`Reply to: ${email.trim()}`);
  return lines.join("\n\n");
}

/**
 * Where the feedback stands, from the screenshot's upload:
 *
 * - `draft`: nothing sent yet, or a new screenshot waiting to be sent.
 * - `sending`: uploading or waiting for the moderation decision.
 * - `sent`: CalmLens accepted the screenshot. `age-restricted` and `limited` ones are accepted too,
 *   because feedback screenshots are only seen by your team, and so is one still `pending` when
 *   the uploader stops waiting: your team sees it once it's checked.
 * - `refused`: the screenshot breaks the policy (`blocked` or `purged`), so the feedback wasn't
 *   accepted. The visitor keeps their message and attaches a different screenshot.
 * - `failed`: the upload didn't go through; `retryable` says whether sending again can help.
 */
export function getSubmissionState(item) {
  if (!item) return { state: "draft" };
  switch (item.stage) {
    case "selected":
      return { state: "draft" };
    case "queued":
    case "uploading":
    case "checking":
      return { state: "sending" };
    case "failed":
      return {
        state: "failed",
        errorCode: item.errorCode,
        // Files refused before upload (wrong type, too large) need a different file instead.
        retryable: !item.errorCode?.startsWith("file/"),
      };
    case "complete":
      return item.status === "blocked" || item.status === "purged"
        ? { state: "refused", status: item.status }
        : { state: "sent", status: item.status, assetId: item.assetId };
    default:
      return { state: "draft" };
  }
}
