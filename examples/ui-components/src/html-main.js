import "@calmlens/sdk/styles.css";
import { posts, projectId, show } from "./demo";
import { renderAvatar } from "./html/avatar.js";
import { attachCommentForm } from "./html/comment-form.js";
import { renderFeed } from "./html/media-feed.js";
import { mountPhotoUpload } from "./html/photo-upload.js";

const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

mountPhotoUpload(byId("upload"), { onUploaded: (upload) => show("Uploaded", upload) });
attachCommentForm(/** @type {HTMLFormElement} */ (byId("comment")), {
  postId: "1",
  onPosted: (comment) => show("Posted", comment),
});
renderAvatar(byId("avatar"), {
  projectId,
  assetId: posts[0].assetId,
  status: "allowed",
  name: "Sam",
});
const showFeed = (ageConfirmed) =>
  renderFeed(byId("feed"), {
    projectId,
    posts,
    viewer: { ageConfirmed },
    onReveal: () => showFeed(true),
  });
showFeed(false);
