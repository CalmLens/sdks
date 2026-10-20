import { CalmLensAppClient, CalmLensError } from "@calmlens/sdk/app";

// The ID of an upload preset open to "Anyone with the preset ID". It's safe to publish:
// it can only upload through that preset, within its daily limit and file rules.
const UPLOAD_PRESET_ID = "your-upload-preset-id";

const client = new CalmLensAppClient({ uploadPresetId: UPLOAD_PRESET_ID });

const form = document.querySelector("#feedback-form");
const result = document.querySelector("#result");
const button = form.querySelector("button");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = form.elements.message.value.trim();
  const file = form.elements.screenshot.files[0];
  if (!file) return;

  button.disabled = true;
  result.textContent = "Sending…";
  try {
    // Uploads straight to CalmLens and waits for the moderation decision.
    // The browser can only set the name and description; the preset controls the rest.
    const asset = await client.assets.moderate({
      name: file.name,
      description: message,
      content: { data: file, type: file.type },
    });

    // `status` is only returned when the preset shows decisions to the uploader.
    if (asset.status === "rejected") {
      result.textContent = "This image can't be posted. Please attach a different screenshot.";
    } else {
      result.textContent = "Thanks! We got your feedback.";
      form.reset();
    }
  } catch (error) {
    result.textContent = describeError(error);
  } finally {
    button.disabled = false;
  }
});

function describeError(error) {
  if (!(error instanceof CalmLensError)) {
    return "Something went wrong. Please try again.";
  }
  switch (error.code) {
    case "upload-preset/daily-limit-reached":
      return "We've received a lot of feedback today. Please try again tomorrow.";
    case "upload-preset/content-type-not-allowed":
      return "Please attach an image, such as a PNG or JPEG screenshot.";
    case "upload-preset/too-large":
      return "That file is too large. Please attach a smaller screenshot.";
    case "upload-preset/origin-not-allowed":
      return "Uploads aren't allowed from this site. Add it to the preset's allowed sites.";
    case "upload-preset/disabled":
      return "Feedback uploads are paused right now. Please try again later.";
    case "upload-preset/not-found":
    case "upload-preset/token-required":
      return "This form isn't set up yet. Check the upload preset ID and its access setting.";
    default:
      return error.isRetryable()
        ? "We couldn't reach the server. Please try again."
        : "Something went wrong. Please try again.";
  }
}
