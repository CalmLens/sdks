<script setup lang="ts">
import { CalmLensAppClient } from "calmlens/app";
import { computed, ref } from "vue";

// Builds public CDN URLs without a request or an API key.
const calmlens = new CalmLensAppClient({ uploadPresetId: "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P" });

const props = defineProps<{ projectId: string; assetId?: string; status?: string; name: string }>();
const failed = ref(false);
const src = computed(() =>
  props.assetId
    ? calmlens.cdn.getAssetUrl({ projectId: props.projectId, assetId: props.assetId, resource: "rendered", lens: "avatar" })
    : undefined,
);
</script>

<template>
  <img v-if="src && (status === 'allowed' || status === 'limited') && !failed" class="avatar" :src="src" :alt="name" @error="failed = true" />
  <span v-else class="avatar" role="img" :aria-label="name">{{ name.charAt(0).toUpperCase() }}</span>
</template>
