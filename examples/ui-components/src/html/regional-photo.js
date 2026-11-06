import "calmlens/elements";

// Your app supplies optional viewer context to the CDN. src is the asset URL: public, or signed by
// your server for a private asset.
export function renderRegionalPhoto(container, { src, region, ageConfirmed }) {
  const photo = document.createElement("calmlens-asset");
  photo.setAttribute("src", src);
  photo.setAttribute("viewer-claims", JSON.stringify({ region, ageConfirmed }));
  photo.setAttribute("alt", "Uploaded photo");
  container.replaceChildren(photo);
}
