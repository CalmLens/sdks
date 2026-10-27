import "@calmlens/sdk/elements";

// Your backend retrieves asset with region. Your app completes the age check.
export function renderRegionalPhoto(container, { asset, region, ageConfirmed }) {
  const delivery = asset.classification.moderation.delivery;
  if (delivery?.region === region && delivery.action === "block" && delivery.jurisdiction) {
    const notice = document.createElement("p");
    notice.setAttribute("role", "status");
    notice.textContent = "This photo is unavailable in your region.";
    container.replaceChildren(notice);
    return;
  }
  const media = document.createElement("calmlens-media");
  media.asset = asset;
  media.setAttribute("region", region);
  media.toggleAttribute("age-confirmed", ageConfirmed);
  media.setAttribute("alt", "Uploaded photo");
  container.replaceChildren(media);
}
