<script setup lang="ts">
import { getAssetUrl } from "@calmlens/sdk/app";
import { computed, ref } from "vue";

const props = defineProps<{ projectId: string; assetId?: string; status?: string; name: string }>();
const failed = ref(false);
const src = computed(() =>
  props.assetId
    ? getAssetUrl({ projectId: props.projectId, assetIdentifier: props.assetId, resource: "rendered", lens: "avatar" })
    : undefined,
);
</script>

<template>
  <img v-if="src && (status === 'allowed' || status === 'limited') && !failed" class="avatar" :src="src" :alt="name" @error="failed = true" />
  <span v-else class="avatar" role="img" :aria-label="name">{{ name.charAt(0).toUpperCase() }}</span>
</template>
