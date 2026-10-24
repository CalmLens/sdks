<script lang="ts">
  import { getAssetUrl } from "@calmlens/sdk/app";

  type Props = {
    projectId: string;
    assetId: string;
    status: "allowed" | "age-restricted";
    /** For an age-restricted image, the URL your server signed once this viewer may see it. */
    contentUrl?: string;
    alt: string;
    /** Width divided by height, which you store when the image is uploaded. */
    aspectRatio: number;
    onReveal: () => void;
  };
  let { projectId, assetId, status, contentUrl, alt, aspectRatio, onReveal }: Props = $props();

  const asset = $derived({ projectId, assetIdentifier: assetId });
  const src = $derived(status === "allowed" ? getAssetUrl(asset) : contentUrl);
</script>

<figure class="sensitive" style:aspect-ratio={aspectRatio}>
  {#if src}
    <img {src} {alt} />
  {:else}
    <img src={getAssetUrl({ ...asset, resource: "placeholder" })} alt="" />
    <figcaption>Sensitive content <button type="button" onclick={onReveal}>View</button></figcaption>
  {/if}
</figure>

<style>
  .sensitive { margin: 0; position: relative; }
  img { width: 100%; height: 100%; object-fit: cover; }
  figcaption { position: absolute; inset: 0; display: grid; place-content: center; }
</style>
