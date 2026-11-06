<script lang="ts">
  import { CalmLensAsset } from "calmlens/svelte";

  // Your app supplies optional viewer context to the CDN. src is the asset URL: public, or signed
  // by your server for a private asset.
  let { src, region, ageConfirmed }: { src: string; region: string; ageConfirmed: boolean } = $props();
</script>

<CalmLensAsset {src} viewerClaims={{ region, ageConfirmed }} alt="Uploaded photo" />
