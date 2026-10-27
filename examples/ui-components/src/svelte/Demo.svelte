<script lang="ts">
  import { posts, projectId, show } from "../demo";
  import Avatar from "./Avatar.svelte";
  import CommentForm from "./CommentForm.svelte";
  import Feed from "./Feed.svelte";
  import PhotoUpload from "./PhotoUpload.svelte";

  let ageConfirmed = $state(false);
</script>

<main style="max-width: 480px">
  <PhotoUpload onUploaded={(upload: unknown) => show("Uploaded", upload)} />
  <CommentForm postId="1" onPosted={(comment: unknown) => show("Posted", comment)} />
  <Avatar {projectId} assetId={posts[0].assetId} status="allowed" name="Sam" />
  <Feed {projectId} {posts} viewer={{ ageConfirmed }} onReveal={() => (ageConfirmed = true)} />
</main>
