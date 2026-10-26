// Calmclips browser upload (live mode), through the CalmLens upload widget. The clip goes
// straight from this page to CalmLens through the upload preset, using a single-use token the Go
// server signed for it. The server then retrieves the asset itself before it shows a decision or
// allows playback.
//
// The widget's `upload` hook runs this page's own flow (the server handshake and multipart
// parts) while the widget shows the file, its progress and any error.
//
// /sdk/ is the workspace build of @calmlens/sdk. Once a published release includes the widget,
// import `@calmlens/sdk/app` and `@calmlens/sdk/elements` from your bundler or CDN instead.
import { CalmLensAppClient, CalmLensError } from "/sdk/app.js";
import { createProgressFetch } from "/sdk/elements.js";

const form = document.getElementById("upload-form");
const uploader = form.querySelector("calmlens-uploader");
uploader.setAttribute("max-file-size", String(Number(form.dataset.maxMib) * 1024 * 1024));
uploader.messages = {
  dropzoneTitle: "Drop voice notes or videos",
  maxFileSizeHint: "Audio or video · up to {size} · 2 minutes",
  "clip/refused": "This clip can't be uploaded. Check its format, size and length.",
};

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

// Adds an "Uploading" row to the top of the clip list. The widget's own queue only shows
// failures (see the page's styles), so progress lives with the clips.
const addRow = (file, parts) => {
  const row = document.getElementById("uploading-clip").content.firstElementChild.cloneNode(true);
  row.setAttribute("aria-label", file.name);
  row.querySelector('[data-field="name"]').textContent = file.name;
  row.querySelector('[data-field="meta"]').textContent =
    `${formatSize(file.size)}${parts > 1 ? ` · ${parts} parts` : ""}`;
  document.querySelector("#clips .empty")?.remove();
  document.getElementById("clips").prepend(row);
  const bar = row.querySelector(".progress");
  return {
    row,
    update: (sent, part) => {
      const percent = Math.round((Math.min(sent, file.size) / file.size) * 100);
      bar.setAttribute("aria-valuenow", String(percent));
      bar.firstElementChild.style.width = `${percent}%`;
      row.querySelector('[data-field="sent"]').textContent =
        `${formatSize(Math.min(sent, file.size))} of ${formatSize(file.size)}`;
      if (parts > 1) row.querySelector('[data-field="part"]').textContent = `Part ${part} of ${parts}`;
    },
  };
};

// Posts a small form to this server, with the page's form token.
const post = async (path, fields) => {
  const body = new URLSearchParams({ csrf: form.elements.csrf.value, ...fields });
  const response = await fetch(path, { method: "POST", body });
  if (!response.ok) {
    // The server's refusal reasons are for its own log; the widget shows a fixed message.
    throw new CalmLensError("clip/refused", { message: (await response.text()).trim() });
  }
  const json = response.headers.get("Content-Type")?.startsWith("application/json");
  return json ? response.json() : null;
};

// Small clips go in one request. Larger ones are a multipart upload: every part except the
// last is exactly partSize (5 MiB, the minimum CalmLens accepts) and is a slice of the file,
// so the clip is never copied into memory.
// `onPart` gets the part number and the bytes sent in earlier parts, so the progress bar covers
// the whole clip.
const send = async (client, file, { type, parts, partSize }, onPart) => {
  if (parts === 1) {
    return client.assets.create({ name: file.name, content: { data: file, type } });
  }
  const slice = (n) => file.slice((n - 1) * partSize, Math.min(n * partSize, file.size));
  let asset = await client.assets.create({
    name: file.name,
    totalSizeInBytes: file.size,
    part: { data: slice(1), type, partNumber: 1, isFinal: false },
  });
  for (let n = 2; n <= parts; n++) {
    onPart(n, (n - 1) * partSize);
    asset = await client.assets.uploadPart({
      assetId: asset.id,
      part: { data: slice(n), partNumber: n, isFinal: n === parts },
    });
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

uploader.upload = async (file, { signal, onProgress }) => {
  // The server checks the format and size, and signs a token for this clip only.
  const started = await post("/uploads/start", {
    name: file.name,
    type: file.type,
    size: String(file.size),
  });
  const progress = addRow(file, started.parts);
  try {
    let sentBefore = 0;
    let part = 1;
    progress.update(0, part);
    const client = new CalmLensAppClient({
      uploadPresetId: form.dataset.preset,
      token: started.token,
      baseUrl: form.dataset.api,
      signal,
      uploadFetch: createProgressFetch((sent) => {
        onProgress(sentBefore + sent, file.size);
        progress.update(sentBefore + sent, part);
      }),
    });
    const asset = await send(client, file, started, (n, bytes) => {
      part = n;
      sentBefore = bytes;
    });
    await finish(started.clip, asset.id);
    // The server reads the decision from CalmLens and shows it after the reload.
    return { assetId: asset.id, status: "pending" };
  } catch (error) {
    // Free the clip's slot. An asset whose upload was never confirmed stays in the project. The
    // widget shows the failure with a retry.
    progress.row.remove();
    await post("/delete", { clip: started.clip }).catch(() => {});
    throw error;
  }
};
// Reload to show the server's view of finished uploads, but never while another file uploads.
const reloadWhenIdle = () =>
  uploader.controller.getSnapshot().busy ? setTimeout(reloadWhenIdle, 1000) : window.location.reload();
uploader.addEventListener("calmlens-uploaded", () => setTimeout(reloadWhenIdle, 0));

// While a clip is being checked, reload every three seconds, but never during an upload.
if (form.dataset.pending === "true") {
  const reload = () =>
    uploader.controller.getSnapshot().busy ? setTimeout(reload, 3000) : window.location.reload();
  setTimeout(reload, 3000);
}
