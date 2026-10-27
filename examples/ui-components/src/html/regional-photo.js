import "@calmlens/sdk/elements";

// Your backend retrieves asset with region. Your app completes the age check.
export function renderRegionalPhoto(container, { asset, region, ageConfirmed }) {
  const media = document.createElement("calmlens-media");
  media.asset = asset;
  media.setAttribute("region", region);
  media.toggleAttribute("age-confirmed", ageConfirmed);
  media.setAttribute("alt", "Uploaded photo");
  container.replaceChildren(media);
}
