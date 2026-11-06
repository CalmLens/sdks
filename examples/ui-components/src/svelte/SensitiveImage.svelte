<script lang="ts">
  import { CalmLensAppClient } from "calmlens/app";

  // Builds public CDN URLs without a request or an API key.
  const calmlens = new CalmLensAppClient({ uploadPresetId: "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P" });

  type Props = {
    projectId: string;
    assetId: string;
    status: "allowed" | "limited" | "age-restricted";
    ageConfirmed: boolean;
    alt: string;
    /** Width divided by height, which you store when the image is uploaded. */
    aspectRatio: number;
    onReveal: () => void;
  };
  let { projectId, assetId, status, ageConfirmed, alt, aspectRatio, onReveal }: Props = $props();

  const restricted = $derived(status === "age-restricted");
  const asset = $derived({ projectId, assetId });
  // Claims make the response private and uncacheable: send them only when needed.
  const contentUrl = $derived(
    calmlens.cdn.getAssetUrl({
      ...asset,
      resource: "rendered",
      ...(restricted ? { viewerClaims: { ageConfirmed } } : {}),
    }),
  );
  const placeholderUrl = $derived(calmlens.cdn.getAssetUrl({ ...asset, resource: "placeholder" }));
</script>

<figure class="sensitive" style:aspect-ratio={aspectRatio}>
  {#if !restricted || ageConfirmed}
    <img src={contentUrl} {alt} />
  {:else}
    <img src={placeholderUrl} alt="" />
    <figcaption>Sensitive content <button type="button" onclick={onReveal}>View</button></figcaption>
  {/if}
</figure>

<style>
  .sensitive { margin: 0; position: relative; }
  img { width: 100%; height: 100%; object-fit: cover; }
  figcaption { position: absolute; inset: 0; display: grid; place-content: center; }
</style>
