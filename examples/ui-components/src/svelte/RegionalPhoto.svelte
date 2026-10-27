<script lang="ts">
  import type { Asset } from "@calmlens/sdk/app";
  import { CalmLensMedia } from "@calmlens/sdk/svelte";

  // The backend retrieves the asset with this region; your app confirms age.
  let { asset, region, ageConfirmed }: { asset: Asset; region: string; ageConfirmed: boolean } = $props();
</script>

<CalmLensMedia {asset} {region} ageConfirmed={ageConfirmed} alt="Uploaded photo" />
