<script setup lang="ts">
import type { Asset } from "@calmlens/sdk/app";
import { CalmLensMedia } from "@calmlens/sdk/vue";

// Your app supplies optional viewer context to the CDN.
defineProps<{ asset: Asset; region: string; ageConfirmed: boolean }>();
</script>

<template>
  <CalmLensMedia :asset="asset" :viewer-claims="{ region, ageConfirmed }" alt="Uploaded photo" />
</template>
