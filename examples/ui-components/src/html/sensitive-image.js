import { CalmLensAppClient } from "calmlens/app";

// Builds public CDN URLs without a request or an API key.
const calmlens = new CalmLensAppClient({ uploadPresetId: "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P" });

// aspectRatio is width divided by height, which you store when the image is uploaded.
export function renderSensitiveImage(
  container,
  { projectId, assetId, status, ageConfirmed, alt, aspectRatio, onReveal },
) {
  const restricted = status === "age-restricted";
  const asset = { projectId, assetId };
  const figure = document.createElement("figure");
  figure.style.cssText = `aspect-ratio: ${aspectRatio}; margin: 0; position: relative`;
  const img = document.createElement("img");
  img.style.cssText = "width: 100%; height: 100%; object-fit: cover";
  figure.append(img);

  if (!restricted || ageConfirmed) {
    // Claims make the response private and uncacheable: send them only when needed.
    img.src = calmlens.cdn.getAssetUrl({
      ...asset,
      resource: "rendered",
      ...(restricted ? { viewerClaims: { ageConfirmed } } : {}),
    });
    img.alt = alt;
  } else {
    img.src = calmlens.cdn.getAssetUrl({ ...asset, resource: "placeholder" });
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
