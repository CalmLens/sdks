<script setup lang="ts">
import { getAssetUrl } from "@calmlens/sdk/app";
import { computed } from "vue";

const props = defineProps<{
  projectId: string;
  assetId: string;
  status: "allowed" | "age-restricted";
  /** For an age-restricted image, the URL your server signed once this viewer may see it. */
  contentUrl?: string;
  alt: string;
  /** Width divided by height, which you store when the image is uploaded. */
  aspectRatio: number;
}>();
const emit = defineEmits<{ reveal: [] }>();

const asset = computed(() => ({ projectId: props.projectId, assetIdentifier: props.assetId }));
const src = computed(() => (props.status === "allowed" ? getAssetUrl(asset.value) : props.contentUrl));
const placeholderUrl = computed(() => getAssetUrl({ ...asset.value, resource: "placeholder" }));
</script>

<template>
  <figure class="sensitive" :style="{ aspectRatio }">
    <img v-if="src" :src="src" :alt="alt" />
    <template v-else>
      <img :src="placeholderUrl" alt="" />
      <figcaption>Sensitive content <button type="button" @click="emit('reveal')">View</button></figcaption>
    </template>
  </figure>
</template>

<style scoped>
.sensitive { margin: 0; position: relative; }
img { width: 100%; height: 100%; object-fit: cover; }
figcaption { position: absolute; inset: 0; display: grid; place-content: center; }
</style>
