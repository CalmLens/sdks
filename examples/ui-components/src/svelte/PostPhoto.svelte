<script lang="ts">
  import { CalmLensAsset } from "calmlens/svelte";

  type Props = {
    assetId: string;
    /** The asset URL your server sent with the post: public, or signed for a private asset. */
    src: string;
    alt: string;
    /** Width divided by height, which you store when the image is uploaded. */
    aspectRatio: number;
    ageConfirmed: boolean;
    onReveal: () => void;
  };
  let { assetId, src, alt, aspectRatio, ageConfirmed, onReveal }: Props = $props();

  // Your server signs a private asset's URL again with cdn.signAssetUrl once it expires.
  async function refreshUrl(): Promise<string> {
    const response = await fetch(`/api/photos/${assetId}/url`);
    if (!response.ok) throw new Error(`Couldn't refresh the photo (${response.status})`);
    return (await response.json()).url;
  }
</script>

<CalmLensAsset
  {src}
  onExpired={refreshUrl}
  viewerClaims={{ ageConfirmed }}
  onAgeConfirmRequest={onReveal}
  {alt}
  {aspectRatio}
  image={{ widths: [400, 800], sizes: "(min-width: 768px) 50vw, 100vw" }}
/>
