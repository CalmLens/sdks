// Calmclips browser upload (live mode). The clip goes straight from this page to CalmLens
// through the upload preset, using a single-use token the Go server signed for it. The server
// then retrieves the asset itself before it shows a decision or allows playback.
//
// /sdk/app.js is the workspace build of @calmlens/sdk/app. Once a published release includes
// CalmLensAppClient, import that instead (for example from your bundler).
import { CalmLensAppClient } from "/sdk/app.js";

const form = document.getElementById("upload-form");
const input = document.getElementById("clip");
const button = form.querySelector("button[type=submit]");
const progress = document.getElementById("upload-progress");
const status = document.getElementById("upload-status");
let uploading = false;

const say = (message) => {
  status.textContent = message;
};

// Posts a small form to this server, with the page's form token.
const post = async (path, fields) => {
  const body = new URLSearchParams({ csrf: form.elements.csrf.value, ...fields });
  const response = await fetch(path, { method: "POST", body });
  if (!response.ok) {
    throw new Error((await response.text()).trim() || `Request failed (${response.status})`);
  }
  const json = response.headers.get("Content-Type")?.startsWith("application/json");
  return json ? response.json() : null;
};

const report = (sent, total) => {
  progress.max = total;
  progress.value = sent;
  progress.hidden = false;
  say(total === 1 ? (sent ? "Uploaded." : "Uploading…") : `Uploaded part ${sent} of ${total}.`);
};

// Small clips go in one request. Larger ones are a multipart upload: every part except the
// last is exactly partSize (5 MiB, the minimum CalmLens accepts) and is a slice of the file,
// so the clip is never copied into memory.
const send = async (client, file, { type, parts, partSize }) => {
  report(0, parts);
  if (parts === 1) {
    const asset = await client.assets.create({ name: file.name, content: { data: file, type } });
    report(1, 1);
    return asset;
  }
  const slice = (n) => file.slice((n - 1) * partSize, Math.min(n * partSize, file.size));
  let asset = await client.assets.create({
    name: file.name,
    totalSizeInBytes: file.size,
    part: { data: slice(1), type, partNumber: 1, isFinal: false },
  });
  report(1, parts);
  for (let n = 2; n <= parts; n++) {
    asset = await client.assets.uploadPart({
      assetId: asset.id,
      part: { data: slice(n), partNumber: n, isFinal: n === parts },
    });
    report(n, parts);
  }
  return asset;
};

// Tells the server which asset the upload created. The server retrieves it before linking it,
// so a brief CalmLens hiccup is retried rather than abandoning a finished upload.
const finish = async (clip, assetId) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await post("/uploads/finish", { clip, assetId });
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = input.files[0];
  if (uploading || !file) return;
  uploading = true;
  button.disabled = true;
  let clip;
  try {
    say("Preparing the upload…");
    // The server checks the format and size, and signs a token for this clip only.
    const started = await post("/uploads/start", {
      name: file.name,
      type: file.type,
      size: String(file.size),
    });
    clip = started.clip;
    const client = new CalmLensAppClient({
      uploadPresetId: form.dataset.preset,
      token: started.token,
      baseUrl: form.dataset.api,
    });
    const asset = await send(client, file, started);
    say("Uploaded. Checking it with the server…");
    await finish(clip, asset.id);
    window.location.reload();
  } catch (error) {
    say(`The upload did not finish: ${error.message}`);
    progress.hidden = true;
    // Free the clip's slot. An asset whose upload was never confirmed stays in the project.
    if (clip) await post("/delete", { clip }).catch(() => {});
    uploading = false;
    button.disabled = false;
  }
});

// While a clip is being checked, reload every three seconds, but never during an upload.
if (form.dataset.pending === "true") {
  const reload = () => (uploading ? setTimeout(reload, 3000) : window.location.reload());
  setTimeout(reload, 3000);
}
