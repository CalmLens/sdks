<script lang="ts">
  import type { AssetModerationStatus } from "@calmlens/sdk/app";
  import { CalmLensMedia } from "@calmlens/sdk/svelte";

  type Props = {
    projectId: string;
    assetId: string;
    status: AssetModerationStatus;
    alt: string;
    /** Width divided by height, which you store when the image is uploaded. */
    aspectRatio: number;
    canView: boolean;
    onReveal: () => void;
  };
  let { projectId, assetId, status, alt, aspectRatio, canView, onReveal }: Props = $props();
</script>

<CalmLensMedia
  {projectId}
  {assetId}
  {status}
  {canView}
  {onReveal}
  {alt}
  {aspectRatio}
  widths={[400, 800]}
  sizes="(min-width: 768px) 50vw, 100vw"
/>
