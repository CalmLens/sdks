<script lang="ts">
  import { posts, projectId, revealedUrls, show } from "../demo";
  import Avatar from "./Avatar.svelte";
  import CommentForm from "./CommentForm.svelte";
  import Feed from "./Feed.svelte";
  import PhotoUpload from "./PhotoUpload.svelte";

  let urls = $state<Record<string, string>>({});
</script>

<main style="max-width: 480px">
  <PhotoUpload onUploaded={(upload: unknown) => show("Uploaded", upload)} />
  <CommentForm postId="1" onPosted={(comment: unknown) => show("Posted", comment)} />
  <Avatar {projectId} assetId={posts[0].assetId} status="allowed" name="Sam" />
  <Feed {projectId} {posts} revealedUrls={urls} onReveal={() => (urls = revealedUrls())} />
</main>
