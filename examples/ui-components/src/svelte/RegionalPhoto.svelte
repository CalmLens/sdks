<script lang="ts">
  import type { Asset } from "calmlens/app";
  import { CalmLensMedia } from "calmlens/svelte";

  // Your app supplies optional viewer context to the CDN.
  let { asset, region, ageConfirmed }: { asset: Asset; region: string; ageConfirmed: boolean } = $props();
</script>

<CalmLensMedia {asset} viewerClaims={{ region, ageConfirmed }} alt="Uploaded photo" />
