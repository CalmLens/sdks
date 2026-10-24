import { createApp, h, ref } from "vue";
import { posts, projectId, revealedUrls, show } from "./demo";
import Avatar from "./vue/Avatar.vue";
import CommentForm from "./vue/CommentForm.vue";
import Feed from "./vue/Feed.vue";
import PhotoUpload from "./vue/PhotoUpload.vue";

const urls = ref<Record<string, string>>({});
createApp({
  render: () =>
    h("main", { style: { maxWidth: "480px" } }, [
      h(PhotoUpload, { onUploaded: (upload: unknown) => show("Uploaded", upload) }),
      h(CommentForm, {
        postId: "1",
        onPosted: (comment: unknown) => show("Posted", comment),
      }),
      h(Avatar, { projectId, assetId: posts[0].assetId, status: "allowed", name: "Sam" }),
      h(Feed, {
        projectId,
        posts,
        revealedUrls: urls.value,
        onReveal: () => {
          urls.value = revealedUrls();
        },
      }),
    ]),
}).mount("#app");
