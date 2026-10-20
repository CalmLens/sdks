// Uploads the New post photo straight from the browser to CalmLens through an upload preset, so
// the photo never passes through the Worker. Bundled to public/upload.js by `bun run build:client`.
//
// 1. Ask the Worker for an upload token. It checks who is asking and signs a single-use token.
// 2. Upload the photo to CalmLens with that token. No API key is ever sent to the browser.
// 3. Submit the form with the asset ID instead of the photo. The Worker fetches the asset from
//    CalmLens to check it's the upload it signed for, and publishes it only once CalmLens approves.
//
// Without JavaScript the form posts the photo to the Worker, which forwards it to CalmLens.

import { CalmLensAppClient, CalmLensError } from "@calmlens/sdk/app";

const form = document.querySelector<HTMLFormElement>("#new-post");
const input = document.querySelector<HTMLInputElement>("#image");
const button = document.querySelector<HTMLButtonElement>("#share");
const errorMessage = document.querySelector<HTMLElement>("#upload-error");
const uploadPresetId = form?.dataset.uploadPresetId;

// CalmLens error codes the visitor can do something about.
const UPLOAD_ERRORS: Record<string, string> = {
  "upload-preset/too-large": "Images must be smaller than 10MB.",
  "upload-preset/content-type-not-allowed": "Use a JPEG, PNG, WebP, GIF or HEIC image.",
  "upload-preset/daily-limit-reached": "Uploads are paused for today. Please try again tomorrow.",
  "upload-token/expired": "That took too long. Please try again.",
};

/** The Worker's answer to a token request it refused, shown to the visitor as-is. */
class TokenRefused extends Error {}

const requestUploadToken = async () => {
  const response = await fetch("/api/uploads", { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as {
    postId?: string;
    token?: string;
    error?: string;
  };
  if (!response.ok || !body.postId || !body.token) {
    throw new TokenRefused(body.error ?? "We couldn't upload that photo. Please try again.");
  }
  return { postId: body.postId, token: body.token };
};

const describe = (error: unknown) => {
  if (error instanceof TokenRefused) return error.message;
  if (CalmLensError.isCalmLensError(error) && UPLOAD_ERRORS[error.code]) {
    return UPLOAD_ERRORS[error.code];
  }
  console.error("[calmgram] upload failed", error);
  return "We couldn't upload that photo. Please try again.";
};

const addHiddenField = (target: HTMLFormElement, name: string, value: string) => {
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = name;
  field.value = value;
  target.append(field);
};

if (form && input && button && errorMessage && uploadPresetId) {
  form.addEventListener("submit", async (event) => {
    const file = input.files?.[0];
    if (!file) return;
    event.preventDefault();
    errorMessage.hidden = true;
    try {
      const { postId, token } = await requestUploadToken();
      const client = new CalmLensAppClient({
        uploadPresetId,
        token,
        ...(form.dataset.calmlensApiUrl ? { baseUrl: form.dataset.calmlensApiUrl } : {}),
      });
      // `create` returns as soon as the photo is stored; CalmLens checks it in the background.
      const asset = await client.assets.create({
        name: file.name,
        content: { data: file, type: file.type },
      });
      addHiddenField(form, "postId", postId);
      addHiddenField(form, "assetId", asset.id);
      // The photo is already on CalmLens; a disabled field isn't sent again.
      input.disabled = true;
      form.submit();
    } catch (error) {
      errorMessage.textContent = describe(error);
      errorMessage.hidden = false;
      button.disabled = false;
      button.textContent = "Share";
    }
  });
}
