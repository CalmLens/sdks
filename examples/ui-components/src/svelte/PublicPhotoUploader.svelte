<script lang="ts">
  import { type CalmLensUpload, CalmLensUploader } from "@calmlens/sdk/svelte";

  let { onUploaded }: { onUploaded: (upload: CalmLensUpload) => void } = $props();
</script>

<CalmLensUploader
  uploadPresetId="preset_4Lk8Qw2Xm9Rt5Vb3Nc7P"
  accept="image/*"
  maxFileSize={10 * 1024 * 1024}
  {onUploaded}
/>
