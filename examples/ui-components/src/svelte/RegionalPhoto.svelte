<script lang="ts">
  import type { Asset } from "@calmlens/sdk/app";
  import { CalmLensMedia } from "@calmlens/sdk/svelte";

  // The backend retrieves the asset with this region; your app confirms age.
  let { asset, region, ageConfirmed }: { asset: Asset; region: string; ageConfirmed: boolean } = $props();
  const delivery = $derived(asset.classification.moderation.delivery);
  const regionalBlock = $derived(delivery?.region === region && delivery.action === "block" && delivery.jurisdiction);
</script>

{#if regionalBlock}
  <p role="status">This photo is unavailable in your region.</p>
{:else}
  <CalmLensMedia {asset} {region} ageConfirmed={ageConfirmed} alt="Uploaded photo" />
{/if}
