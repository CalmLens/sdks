import "@calmlens/sdk/elements";

// Your app supplies optional viewer context to the CDN.
export function renderRegionalPhoto(container, { asset, region, ageConfirmed }) {
  const media = document.createElement("calmlens-media");
  media.asset = asset;
  media.setAttribute("viewer-claims", JSON.stringify({ region, ageConfirmed }));
  media.setAttribute("alt", "Uploaded photo");
  container.replaceChildren(media);
}
