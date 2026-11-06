<script setup lang="ts">
import { CalmLensAsset } from "calmlens/vue";

// Your app supplies optional viewer context to the CDN. src is the asset URL: public, or signed by
// your server for a private asset.
defineProps<{ src: string; region: string; ageConfirmed: boolean }>();
</script>

<template>
  <CalmLensAsset :src="src" :viewer-claims="{ region, ageConfirmed }" alt="Uploaded photo" />
</template>
