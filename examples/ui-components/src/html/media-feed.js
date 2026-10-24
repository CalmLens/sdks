import { renderSensitiveImage } from "./sensitive-image.js";

// revealedUrls holds signed URLs for the age-restricted images this viewer may see, by asset ID.
export function renderFeed(list, { projectId, posts, revealedUrls, onReveal }) {
  const items = posts
    .filter((post) => ["allowed", "age-restricted"].includes(post.status))
    .map((post) => {
      const item = document.createElement("li");
      renderSensitiveImage(item, {
        projectId,
        assetId: post.assetId,
        status: post.status,
        contentUrl: revealedUrls[post.assetId],
        alt: post.alt,
        aspectRatio: post.aspectRatio,
        onReveal,
      });
      return item;
    });
  list.replaceChildren(...items);
}
