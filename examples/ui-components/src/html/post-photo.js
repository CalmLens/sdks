import "@calmlens/sdk/elements";

// aspectRatio is width divided by height, which you store when the image is uploaded.
export function renderPostPhoto(
  container,
  { projectId, assetId, status, alt, aspectRatio, ageConfirmed, onReveal },
) {
  const media = document.createElement("calmlens-media");
  media.setAttribute("project-id", projectId);
  media.setAttribute("asset-id", assetId);
  media.setAttribute("status", status);
  media.setAttribute("alt", alt);
  media.setAttribute("aspect-ratio", String(aspectRatio));
  media.setAttribute("widths", "400,800");
  media.setAttribute("sizes", "(min-width: 768px) 50vw, 100vw");
  media.setAttribute("viewer-claims", JSON.stringify({ ageConfirmed }));
  media.addEventListener("calmlens-reveal", onReveal);
  container.replaceChildren(media);
}
