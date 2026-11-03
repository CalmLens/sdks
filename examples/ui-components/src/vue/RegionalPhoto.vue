<script setup lang="ts">
import type { Asset } from "calmlens/app";
import { CalmLensMedia } from "calmlens/vue";

// Your app supplies optional viewer context to the CDN.
defineProps<{ asset: Asset; region: string; ageConfirmed: boolean }>();
</script>

<template>
  <CalmLensMedia :asset="asset" :viewer-claims="{ region, ageConfirmed }" alt="Uploaded photo" />
</template>
