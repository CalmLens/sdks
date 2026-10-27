<script setup lang="ts">
import { type CalmLensUpload, CalmLensUploader } from "@calmlens/sdk/vue";

const emit = defineEmits<{ uploaded: [upload: CalmLensUpload] }>();
</script>

<template>
  <CalmLensUploader
    upload-preset-id="preset_4Lk8Qw2Xm9Rt5Vb3Nc7P"
    accept="image/*"
    :max-file-size="10 * 1024 * 1024"
    @uploaded="(upload) => emit('uploaded', upload)"
  />
</template>
