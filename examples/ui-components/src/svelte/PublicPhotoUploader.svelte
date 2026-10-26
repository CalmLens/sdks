<script lang="ts">
  import { type CalmLensUpload, CalmLensUploader } from "@calmlens/sdk/svelte";

  let { onUploaded }: { onUploaded: (upload: CalmLensUpload) => void } = $props();
</script>

<CalmLensUploader
  uploadPresetId="your-upload-preset-id"
  accept="image/*"
  maxFileSize={10 * 1024 * 1024}
  {onUploaded}
/>
