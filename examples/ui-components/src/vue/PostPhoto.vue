<script setup lang="ts">
import type { AssetModerationStatus } from "@calmlens/sdk/app";
import { CalmLensMedia } from "@calmlens/sdk/vue";

defineProps<{
  projectId: string;
  assetId: string;
  status: AssetModerationStatus;
  alt: string;
  /** Width divided by height, which you store when the image is uploaded. */
  aspectRatio: number;
  ageConfirmed: boolean;
}>();
const emit = defineEmits<{ reveal: [] }>();
</script>

<template>
  <CalmLensMedia
    :project-id="projectId"
    :asset-id="assetId"
    :status="status"
    :age-confirmed="ageConfirmed"
    :alt="alt"
    :aspect-ratio="aspectRatio"
    :widths="[400, 800]"
    sizes="(min-width: 768px) 50vw, 100vw"
    @reveal="emit('reveal')"
  />
</template>
