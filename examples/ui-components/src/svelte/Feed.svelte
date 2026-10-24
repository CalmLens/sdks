<script lang="ts">
  import type { AssetModerationStatus } from "@calmlens/sdk/app";
  import SensitiveImage from "./SensitiveImage.svelte";

  type Post = { id: string; assetId: string; status: AssetModerationStatus; alt: string; aspectRatio: number };
  type ShownPost = Post & { status: "allowed" | "age-restricted" };
  type Props = {
    projectId: string;
    posts: Post[];
    viewer: { canViewSensitiveMedia: boolean };
    onReveal: () => void;
  };
  let { projectId, posts, viewer, onReveal }: Props = $props();
  const shown = $derived(
    posts.filter((post): post is ShownPost => post.status === "allowed" || post.status === "age-restricted"),
  );
</script>

<ul class="feed">
  {#each shown as post (post.id)}
    <li>
      <SensitiveImage
        {projectId}
        assetId={post.assetId}
        status={post.status}
        canView={viewer.canViewSensitiveMedia}
        alt={post.alt}
        aspectRatio={post.aspectRatio}
        {onReveal}
      />
    </li>
  {/each}
</ul>
