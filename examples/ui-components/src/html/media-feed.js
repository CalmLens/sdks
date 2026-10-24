import { renderSensitiveImage } from "./sensitive-image.js";

export function renderFeed(list, { projectId, posts, viewer, onReveal }) {
  const items = posts
    .filter((post) => ["allowed", "age-restricted"].includes(post.status))
    .map((post) => {
      const item = document.createElement("li");
      renderSensitiveImage(item, {
        projectId,
        assetId: post.assetId,
        status: post.status,
        canView: viewer.canViewSensitiveMedia,
        alt: post.alt,
        aspectRatio: post.aspectRatio,
        onReveal,
      });
      return item;
    });
  list.replaceChildren(...items);
}
