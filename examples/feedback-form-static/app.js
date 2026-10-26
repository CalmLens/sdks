import { CalmLensAppClient } from "@calmlens/sdk/app";
// Defines <calmlens-uploader>, the SDK's upload widget, and exports its upload queue.
import { createProgressFetch, createUploadController } from "@calmlens/sdk/elements";
import { API_BASE_URL, UPLOAD_PRESET_ID } from "./config.js";
import { CATEGORIES, composeDescription, getSubmissionState } from "./feedback.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const demo = UPLOAD_PRESET_ID === "your-upload-preset-id";

/** Messages for the upload errors a visitor can run into, by error code. */
const ERROR_MESSAGES = {
  "upload-preset/daily-limit-reached":
    "We've received a lot of feedback today. Please try again tomorrow.",
  "upload-preset/content-type-not-allowed":
    "Please attach an image, such as a PNG or JPEG screenshot.",
  "upload-preset/too-large": "That image is too large. Please attach a smaller screenshot.",
  "upload-preset/origin-not-allowed":
    "Uploads aren't allowed from this site. Add it to the preset's allowed sites.",
  "upload-preset/disabled": "Feedback uploads are paused right now. Please try again later.",
  "upload-preset/not-found":
    "This form isn't set up yet. Check the upload preset ID and its access setting.",
  "upload-preset/token-required":
    "This form isn't set up yet. Check the upload preset ID and its access setting.",
  "sdk/transport-error": "We couldn't reach the server. Please try again.",
  "sdk/timeout": "The upload took too long. Please try again.",
};

/**
 * Creates the client that uploads through the preset. It holds no API key: the preset ID is all
 * the browser has. In demo mode, an in-memory mock answers instead of CalmLens.
 */
const createClient = demo
  ? await createDemoClient()
  : (options = {}) =>
      new CalmLensAppClient({
        uploadPresetId: UPLOAD_PRESET_ID,
        baseUrl: API_BASE_URL,
        ...options,
      });

// The client that checks uploads for their decision. Presets open to anyone need no token, so
// any client for the preset can check them.
const statusClient = createClient();

/** The description of the feedback being sent, set when the form is submitted. */
let description = "";

// The widget's upload queue. Uploads wait until the form is submitted (`autoUpload: false`),
// so the message can travel with the screenshot as its description.
const controller = createUploadController({
  accept: "image/*",
  maxFileSize: MAX_FILE_SIZE,
  autoUpload: false,
  // Uploads straight to CalmLens with the feedback as the description, reporting the bytes sent
  // for the widget's progress bar. The browser can only set the name and description; the
  // preset decides the folder, visibility and everything else.
  upload: async (file, { signal, onProgress }) => {
    const client = createClient({ signal, uploadFetch: createProgressFetch(onProgress) });
    const asset = await client.assets.create({
      name: file.name,
      description,
      content: { data: file, type: file.type },
    });
    // `status` is only returned when the preset shows decisions to the uploader.
    return { assetId: asset.id, status: asset.status };
  },
  // Checks a pending upload until CalmLens decides, for up to 15 seconds.
  checkStatus: async (assetId) => (await statusClient.assets.retrieve({ assetId })).status,
});

const form = document.querySelector("#feedback-form");
const uploader = form.querySelector("calmlens-uploader");
const submit = form.querySelector('button[type="submit"]');
const formStatus = document.querySelector("#form-status");
const sent = document.querySelector("#sent");

uploader.controller = controller;
uploader.messages = {
  dropzoneTitle: "Drop a screenshot here, or click to choose one",
  chooseFile: "Choose image",
  maxFileSizeHint: "PNG, JPEG or GIF, up to {size}",
  uploading: "Uploading…",
  checking: "Checking the image…",
  allowed: "Attached.",
  limited: "Attached.",
  "age-restricted": "Attached.",
  pending: "Attached.",
  blocked: "This image breaks our content rules, so we can't accept it. Choose a different one.",
  purged: "This image breaks our content rules, so we can't accept it. Choose a different one.",
  "file/not-accepted": "Attach an image, such as a PNG or JPEG screenshot.",
  "file/too-large": "This image is larger than 10 MB. Attach a smaller one.",
  ...ERROR_MESSAGES,
};

if (demo) document.querySelector("#demo-note").hidden = false;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const item = controller.getSnapshot().items[0];
  const { state, retryable } = getSubmissionState(item);
  if (!item) {
    showStatus("Attach a screenshot so we can see what you see.", "error");
    uploader.querySelector("button")?.focus();
    return;
  }
  if (state === "refused" || (state === "failed" && !retryable)) {
    showStatus("Choose a different screenshot, then send again.", "error");
    return;
  }
  description = composeDescription({
    category: form.elements.category.value,
    message: form.elements.message.value,
    email: form.elements.email.value,
  });
  if (state === "failed") controller.retry(item.key);
  else controller.start();
});

controller.subscribe(({ items }) => {
  const item = items[0];
  const submission = getSubmissionState(item);
  const sending = submission.state === "sending";
  for (const field of form.querySelectorAll("input, textarea")) field.disabled = sending;
  uploader.toggleAttribute("disabled", sending);
  submit.disabled = sending;
  submit.textContent = sending ? "Sending…" : "Send feedback";
  switch (submission.state) {
    case "sending":
      showStatus(item.stage === "checking" ? "Checking your screenshot…" : "Sending…");
      break;
    case "refused":
      showStatus("Not sent. Choose a different screenshot.", "error");
      break;
    case "failed":
      showStatus(
        submission.retryable
          ? "Your feedback wasn't sent. Try again."
          : "Your feedback wasn't sent. Choose a different screenshot.",
        "error",
      );
      break;
    case "sent":
      showSent(item);
      break;
    default:
      showStatus("");
  }
});

/** Swaps the form for a summary of the feedback that was sent. */
function showSent(item) {
  const email = form.elements.email.value.trim();
  sent.querySelector("[data-category]").textContent = CATEGORIES[form.elements.category.value];
  sent.querySelector("[data-message]").textContent = form.elements.message.value.trim();
  sent.querySelector("[data-file]").textContent = item.file.name;
  const thumbnail = sent.querySelector("[data-thumbnail]");
  thumbnail.src = item.previewUrl ?? "";
  thumbnail.hidden = !item.previewUrl;
  sent.querySelector("[data-reply]").textContent = email
    ? `We'll reply to ${email}.`
    : "You didn't leave an email, so we won't reply.";
  showStatus("");
  form.hidden = true;
  sent.hidden = false;
  sent.querySelector("h2").focus();
}

document.querySelector("#send-another").addEventListener("click", () => {
  controller.clear();
  form.reset();
  showStatus("");
  sent.hidden = true;
  form.hidden = false;
  form.elements.message.focus();
});

function showStatus(message, tone) {
  formStatus.textContent = message;
  formStatus.dataset.tone = tone ?? "";
}

/**
 * Demo mode: one in-memory mock stands in for CalmLens, so uploads and their checks share it.
 * Screenshots whose file name contains "blocked" break the policy; everything else is accepted.
 */
async function createDemoClient() {
  const { MockCalmLensAppClient } = await import("@calmlens/sdk/testing");
  const client = new MockCalmLensAppClient({
    uploadPresetId: "demo-preset",
    mockOptions: {
      preset: { allowedContentTypes: ["image/*"], maxFileSizeInBytes: MAX_FILE_SIZE },
      queuedOutcome: (asset) => (/blocked/i.test(asset.name) ? "blocked" : "allowed"),
    },
  });
  return () => client;
}
