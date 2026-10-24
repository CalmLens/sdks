import { getAssetUrl } from "@calmlens/sdk/app";

// contentUrl is, for an age-restricted image, the URL your server signed once this viewer may see
// it. aspectRatio is width divided by height, which you store when the image is uploaded.
export function renderSensitiveImage(
  container,
  { projectId, assetId, status, contentUrl, alt, aspectRatio, onReveal },
) {
  const asset = { projectId, assetIdentifier: assetId };
  const src = status === "allowed" ? getAssetUrl(asset) : contentUrl;
  const figure = document.createElement("figure");
  figure.style.cssText = `aspect-ratio: ${aspectRatio}; margin: 0; position: relative`;
  const img = document.createElement("img");
  img.style.cssText = "width: 100%; height: 100%; object-fit: cover";
  figure.append(img);

  if (src) {
    img.src = src;
    img.alt = alt;
  } else {
    img.src = getAssetUrl({ ...asset, resource: "placeholder" });
    img.alt = "";
    const button = Object.assign(document.createElement("button"), {
      type: "button",
      textContent: "View",
    });
    button.addEventListener("click", onReveal);
    const caption = document.createElement("figcaption");
    caption.style.cssText = "position: absolute; inset: 0; display: grid; place-content: center";
    caption.append("Sensitive content ", button);
    figure.append(caption);
  }
  container.replaceChildren(figure);
}
