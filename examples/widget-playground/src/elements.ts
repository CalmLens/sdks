// The web components, as plain HTML would use them (and Angular, Solid or Lit, which use
// custom elements the same way).
import "@calmlens/sdk/elements";
import { ACCEPT, GALLERY_SIZES, GALLERY_WIDTHS, MAX_FILE_SIZE, playground } from "./playground";

export const mount = (target: HTMLElement) => {
  const { config } = playground.get();
  target.innerHTML = `
    <section class="panel">
      <h2>Upload</h2>
      <calmlens-uploader token-url="/api/upload-token" accept="${ACCEPT}" max-file-size="${MAX_FILE_SIZE}"></calmlens-uploader>
    </section>
    <section class="panel">
      <h2>Gallery</h2>
      <p class="empty">Uploads that aren't blocked appear here.</p>
      <ul class="gallery"></ul>
    </section>`;
  const uploader = target.querySelector("calmlens-uploader");
  const gallery = target.querySelector(".gallery");
  const empty = target.querySelector<HTMLElement>(".empty");
  if (!uploader || !gallery || !empty) throw new Error("The playground markup is missing");
  uploader.setAttribute("upload-preset-id", config.uploadPresetId);
  if (config.baseUrl) uploader.setAttribute("base-url", config.baseUrl);
  uploader.addEventListener("calmlens-uploaded", (event) =>
    playground.addUpload(event.detail, "Web components"),
  );

  const unsubscribe = playground.subscribe(({ items, ageConfirmed, multiple }) => {
    uploader.toggleAttribute("multiple", multiple);
    empty.hidden = items.length > 0;
    gallery.replaceChildren(
      ...items.map((item) => {
        const media = document.createElement("calmlens-media");
        const attributes: Record<string, string | undefined> = {
          "project-id": config.projectId,
          "asset-id": item.assetId,
          status: item.status,
          type: item.type,
          alt: item.name,
          "aspect-ratio": item.aspectRatio?.toString(),
          widths: GALLERY_WIDTHS.join(","),
          sizes: GALLERY_SIZES,
          "cdn-base-url": config.cdnBaseUrl,
        };
        for (const [name, value] of Object.entries(attributes)) {
          if (value !== undefined) media.setAttribute(name, value);
        }
        media.setAttribute("viewer-claims", JSON.stringify({ ageConfirmed }));
        media.addEventListener("calmlens-reveal", playground.reveal);
        const caption = document.createElement("p");
        caption.className = "caption";
        const chip = Object.assign(document.createElement("span"), {
          className: "chip",
          textContent: item.status ?? "submitted",
        });
        if (item.status) chip.dataset.status = item.status;
        caption.append(`${item.name} `, chip);
        const row = document.createElement("li");
        row.append(media, caption);
        return row;
      }),
    );
  });
  return () => {
    unsubscribe();
    target.replaceChildren();
  };
};
