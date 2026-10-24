<script lang="ts">
  import { getAssetUrl } from "@calmlens/sdk/app";

  let { projectId, assetId, status, name }: { projectId: string; assetId?: string; status?: string; name: string } = $props();
  let failed = $state(false);
  const src = $derived(
    assetId ? getAssetUrl({ projectId, assetIdentifier: assetId, resource: "rendered", lens: "avatar" }) : undefined,
  );
</script>

{#if src && (status === "allowed" || status === "limited") && !failed}
  <img class="avatar" {src} alt={name} onerror={() => (failed = true)} />
{:else}
  <span class="avatar" role="img" aria-label={name}>{name.charAt(0).toUpperCase()}</span>
{/if}
