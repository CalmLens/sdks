<script setup lang="ts">
import type { AssetModerationStatus } from "@calmlens/sdk/app";
import { computed } from "vue";
import SensitiveImage from "./SensitiveImage.vue";

type Post = { id: string; assetId: string; status: AssetModerationStatus; alt: string; aspectRatio: number };
type ShownPost = Post & { status: "allowed" | "age-restricted" };
// revealedUrls: signed URLs for the age-restricted images this viewer may see, by asset ID.
const props = defineProps<{ projectId: string; posts: Post[]; revealedUrls: Record<string, string> }>();
const emit = defineEmits<{ reveal: [] }>();
const shown = computed(() =>
  props.posts.filter((post): post is ShownPost => post.status === "allowed" || post.status === "age-restricted"),
);
</script>

<template>
  <ul class="feed">
    <li v-for="post in shown" :key="post.id">
      <SensitiveImage
        :project-id="projectId"
        :asset-id="post.assetId"
        :status="post.status"
        :content-url="revealedUrls[post.assetId]"
        :alt="post.alt"
        :aspect-ratio="post.aspectRatio"
        @reveal="emit('reveal')"
      />
    </li>
  </ul>
</template>
