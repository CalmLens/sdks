import { createProgressFetch } from "@calmlens/sdk/elements";

// Your server stores the file with CalmLensServerClient and answers with the asset.
async function uploadPhoto(file, { signal, onProgress }) {
  const send = createProgressFetch(onProgress);
  const response = await send("/api/photos", {
    method: "POST",
    headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
    body: file,
    signal,
  });
  if (!response.ok) throw new Error(`Upload failed (${response.status})`);
  const { assetId, status } = await response.json();
  return { assetId, status };
}

async function checkPhoto(assetId, { signal }) {
  const response = await fetch(`/api/photos/${assetId}`, { signal });
  return (await response.json()).status;
}

export function mountOwnApiUploader(container, { onUploaded }) {
  const uploader = document.createElement("calmlens-uploader");
  uploader.setAttribute("accept", "image/*");
  uploader.upload = uploadPhoto;
  uploader.checkStatus = checkPhoto;
  uploader.addEventListener("calmlens-uploaded", (event) => onUploaded(event.detail));
  container.replaceChildren(uploader);
}
