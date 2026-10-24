<script setup lang="ts">
import {
  type CalmLensUpload,
  CalmLensUploader,
  type CustomUploadContext,
  createProgressFetch,
} from "@calmlens/sdk/vue";

const emit = defineEmits<{ uploaded: [upload: CalmLensUpload] }>();

// Your server stores the file with CalmLensServerClient and answers with the asset.
async function uploadPhoto(file: File, { signal, onProgress }: CustomUploadContext) {
  const send = createProgressFetch(onProgress);
  const response = await send("/api/photos", {
    method: "POST",
    headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
    body: file,
    signal,
  });
  if (!response.ok) throw new Error(`Upload failed (${response.status})`);
  const { assetId, status } = await response.json();
  return { assetId, status };
}

async function checkPhoto(assetId: string, { signal }: { signal: AbortSignal }) {
  const response = await fetch(`/api/photos/${assetId}`, { signal });
  return (await response.json()).status;
}
</script>

<template>
  <CalmLensUploader
    :upload="uploadPhoto"
    :check-status="checkPhoto"
    accept="image/*"
    @uploaded="(upload) => emit('uploaded', upload)"
  />
</template>
