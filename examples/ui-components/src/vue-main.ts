import "@calmlens/sdk/styles.css";
import { createApp, h, ref } from "vue";
import { posts, projectId, show } from "./demo";
import Avatar from "./vue/Avatar.vue";
import CommentForm from "./vue/CommentForm.vue";
import Feed from "./vue/Feed.vue";
import PhotoUpload from "./vue/PhotoUpload.vue";

const ageConfirmed = ref(false);
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
        ageConfirmed: ageConfirmed.value,
        onReveal: () => {
          ageConfirmed.value = true;
        },
      }),
    ]),
}).mount("#app");
