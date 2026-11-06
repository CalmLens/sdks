<script lang="ts">
  import { CalmLensAppClient } from "calmlens/app";

  // Builds public CDN URLs without a request or an API key.
  const calmlens = new CalmLensAppClient({ uploadPresetId: "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P" });

  let { projectId, assetId, status, name }: { projectId: string; assetId?: string; status?: string; name: string } = $props();
  let failed = $state(false);
  const src = $derived(
    assetId ? calmlens.cdn.getAssetUrl({ projectId, assetId, resource: "rendered", lens: "avatar" }) : undefined,
  );
</script>

{#if src && (status === "allowed" || status === "limited") && !failed}
  <img class="avatar" {src} alt={name} onerror={() => (failed = true)} />
{:else}
  <span class="avatar" role="img" aria-label={name}>{name.charAt(0).toUpperCase()}</span>
{/if}
