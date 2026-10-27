// Defines <calmlens-uploader> and <calmlens-media>. In plain HTML, write the element in your
// markup instead: <calmlens-uploader upload-preset-id="…" token-url="/api/upload-token">.
import "@calmlens/sdk/elements";

export function mountPhotoUploader(container, { onUploaded }) {
  const uploader = document.createElement("calmlens-uploader");
  uploader.setAttribute("upload-preset-id", "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P");
  uploader.setAttribute("token-url", "/api/upload-token");
  uploader.setAttribute("accept", "image/*");
  uploader.setAttribute("max-file-size", String(10 * 1024 * 1024));
  uploader.addEventListener("calmlens-uploaded", (event) => onUploaded(event.detail));
  container.replaceChildren(uploader);
}
