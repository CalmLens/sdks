import "calmlens/elements";

// src is the asset URL your server sent with the post: public, or signed for a private asset.
// aspectRatio is width divided by height, which you store when the image is uploaded.
export function renderPostPhoto(
  container,
  { assetId, src, alt, aspectRatio, ageConfirmed, onReveal },
) {
  const photo = document.createElement("calmlens-asset");
  photo.setAttribute("src", src);
  photo.setAttribute("alt", alt);
  photo.setAttribute("aspect-ratio", String(aspectRatio));
  photo.setAttribute("widths", "400,800");
  photo.setAttribute("sizes", "(min-width: 768px) 50vw, 100vw");
  photo.setAttribute("viewer-claims", JSON.stringify({ ageConfirmed }));
  // Your server signs a private asset's URL again with cdn.signAssetUrl once it expires.
  photo.onExpired = async () => {
    const response = await fetch(`/api/photos/${assetId}/url`);
    if (!response.ok) throw new Error(`Couldn't refresh the photo (${response.status})`);
    return (await response.json()).url;
  };
  photo.addEventListener("calmlens-age-confirm-request", onReveal);
  container.replaceChildren(photo);
}
