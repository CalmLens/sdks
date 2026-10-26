// Calmclips demo upload. The demo has no upload preset: the clip is posted to this server, which
// uploads it with the Go SDK (in 5 MiB parts above 8 MiB). This script only adds drag and drop
// and a progress row; without JavaScript the form posts normally.
const form = document.getElementById("upload-form");
const input = form.elements.clip;
const drop = form.querySelector(".drop");
const error = form.querySelector(".upload-error");
let uploading = false;

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.toggleAttribute("data-dragging", true);
});
drop.addEventListener("dragleave", () => drop.toggleAttribute("data-dragging", false));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.toggleAttribute("data-dragging", false);
  if (event.dataTransfer?.files.length) input.files = event.dataTransfer.files;
});

// Adds an "Uploading" row to the top of the clip list.
const addRow = (file) => {
  const row = document.getElementById("uploading-clip").content.firstElementChild.cloneNode(true);
  const parts =
    file.size > Number(form.dataset.threshold) ? Math.ceil(file.size / Number(form.dataset.partSize)) : 1;
  row.setAttribute("aria-label", file.name);
  row.querySelector('[data-field="name"]').textContent = file.name;
  row.querySelector('[data-field="meta"]').textContent =
    `${formatSize(file.size)}${parts > 1 ? ` · ${parts} parts` : ""}`;
  document.querySelector("#clips .empty")?.remove();
  document.getElementById("clips").prepend(row);
  const bar = row.querySelector(".progress");
  return (sent) => {
    const percent = Math.round((sent / file.size) * 100);
    bar.setAttribute("aria-valuenow", String(percent));
    bar.firstElementChild.style.width = `${percent}%`;
    row.querySelector('[data-field="sent"]').textContent = `${formatSize(sent)} of ${formatSize(file.size)}`;
  };
};

form.addEventListener("submit", (event) => {
  const file = input.files?.[0];
  if (!file) return;
  event.preventDefault();
  error.hidden = true;
  uploading = true;
  const progress = addRow(file);
  progress(0);
  const request = new XMLHttpRequest();
  request.open("POST", form.action);
  request.upload.addEventListener("progress", (e) => progress(e.loaded > file.size ? file.size : e.loaded));
  request.addEventListener("loadend", () => {
    uploading = false;
    // The server redirects to the page once the clip is stored; anything else is a refusal.
    if (request.status === 200) return window.location.reload();
    error.textContent = request.responseText.trim() || "The upload failed. Please try again.";
    error.hidden = false;
    document.querySelector(`#clips [aria-label="${CSS.escape(file.name)}"]`)?.remove();
  });
  request.send(new FormData(form));
  input.value = "";
});

// While a clip is being checked, reload every three seconds, but never during an upload.
if (form.dataset.pending === "true") {
  const reload = () => (uploading ? setTimeout(reload, 3000) : window.location.reload());
  setTimeout(reload, 3000);
}
