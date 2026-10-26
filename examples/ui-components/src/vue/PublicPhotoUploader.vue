<script setup lang="ts">
import { type CalmLensUpload, CalmLensUploader } from "@calmlens/sdk/vue";

const emit = defineEmits<{ uploaded: [upload: CalmLensUpload] }>();
</script>

<template>
  <CalmLensUploader
    upload-preset-id="your-upload-preset-id"
    accept="image/*"
    :max-file-size="10 * 1024 * 1024"
    @uploaded="(upload) => emit('uploaded', upload)"
  />
</template>
