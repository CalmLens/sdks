<script setup lang="ts">
import { CalmLensAppClient } from "calmlens/app";
import { computed } from "vue";

// Builds public CDN URLs without a request or an API key.
const calmlens = new CalmLensAppClient({ uploadPresetId: "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P" });

const props = defineProps<{
  projectId: string;
  assetId: string;
  status: "allowed" | "limited" | "age-restricted";
  ageConfirmed: boolean;
  alt: string;
  /** Width divided by height, which you store when the image is uploaded. */
  aspectRatio: number;
}>();
const emit = defineEmits<{ reveal: [] }>();

const restricted = computed(() => props.status === "age-restricted");
const asset = computed(() => ({ projectId: props.projectId, assetId: props.assetId }));
// Claims make the response private and uncacheable: send them only when needed.
const contentUrl = computed(() =>
  calmlens.cdn.getAssetUrl({
    ...asset.value,
    resource: "rendered",
    ...(restricted.value ? { viewerClaims: { ageConfirmed: props.ageConfirmed } } : {}),
  }),
);
const placeholderUrl = computed(() => calmlens.cdn.getAssetUrl({ ...asset.value, resource: "placeholder" }));
</script>

<template>
  <figure class="sensitive" :style="{ aspectRatio }">
    <img v-if="!restricted || ageConfirmed" :src="contentUrl" :alt="alt" />
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
