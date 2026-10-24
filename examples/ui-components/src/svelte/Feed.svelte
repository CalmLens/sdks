<script lang="ts">
  import type { AssetModerationStatus } from "@calmlens/sdk/app";
  import SensitiveImage from "./SensitiveImage.svelte";

  type Post = { id: string; assetId: string; status: AssetModerationStatus; alt: string; aspectRatio: number };
  type ShownPost = Post & { status: "allowed" | "age-restricted" };
  type Props = {
    projectId: string;
    posts: Post[];
    /** Signed URLs for the age-restricted images this viewer may see, by asset ID. */
    revealedUrls: Record<string, string>;
    onReveal: () => void;
  };
  let { projectId, posts, revealedUrls, onReveal }: Props = $props();
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
        contentUrl={revealedUrls[post.assetId]}
        alt={post.alt}
        aspectRatio={post.aspectRatio}
        {onReveal}
      />
    </li>
  {/each}
</ul>
