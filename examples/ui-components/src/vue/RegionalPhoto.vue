<script setup lang="ts">
import type { Asset } from "@calmlens/sdk/app";
import { CalmLensMedia } from "@calmlens/sdk/vue";
import { computed } from "vue";

// The backend retrieves the asset with this region; your app confirms age.
const props = defineProps<{ asset: Asset; region: string; ageConfirmed: boolean }>();
const regionalBlock = computed(() => {
  const delivery = props.asset.classification.moderation.delivery;
  return delivery?.region === props.region && delivery.action === "block" && delivery.jurisdiction;
});
</script>

<template>
  <p v-if="regionalBlock" role="status">This photo is unavailable in your region.</p>
  <CalmLensMedia v-else :asset="asset" :region="region" :age-confirmed="ageConfirmed" alt="Uploaded photo" />
</template>
