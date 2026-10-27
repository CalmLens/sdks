<script setup lang="ts">
import type { Asset } from "@calmlens/sdk/app";
import { CalmLensMedia } from "@calmlens/sdk/vue";

// The backend retrieves the asset with this region; your app confirms age.
defineProps<{ asset: Asset; region: string; ageConfirmed: boolean }>();
</script>

<template>
  <CalmLensMedia :asset="asset" :region="region" :age-confirmed="ageConfirmed" alt="Uploaded photo" />
</template>
