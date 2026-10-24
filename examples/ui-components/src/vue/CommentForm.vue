<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ postId: string }>();
const emit = defineEmits<{ posted: [comment: { id: string; status: string }] }>();

const CATEGORY_NAMES: Record<string, string> = {
  harassment: "harassment", hate: "hate speech", sexual: "sexual content", violence: "violence",
  "self-harm": "self-harm", "criminal-activity": "criminal activity", profanity: "profanity",
  "personal-information": "personal information",
};

function refusalMessage({ categories = [] }: { categories?: string[] }) {
  const names = categories.map((category) => CATEGORY_NAMES[category]).filter(Boolean);
  return names.length
    ? `Your comment wasn't posted because it may contain ${names.join(", ")}. Edit it and try again.`
    : "Your comment wasn't posted because it may break our community guidelines.";
}

const sending = ref(false);
const error = ref("");

async function handleSubmit(event: SubmitEvent) {
  const form = event.currentTarget as HTMLFormElement;
  sending.value = true;
  error.value = "";
  const response = await fetch(`/api/posts/${props.postId}/comments`, { method: "POST", body: new FormData(form) });
  const result = await response.json();
  sending.value = false;
  if (response.ok) {
    form.reset();
    emit("posted", result);
  } else {
    error.value = result.code === "comment/refused" ? refusalMessage(result) : "Your comment wasn't posted. Please try again.";
  }
}
</script>

<template>
  <form @submit.prevent="handleSubmit">
    <label>Comment <textarea name="body" required /></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <button type="submit" :disabled="sending">{{ sending ? "Posting…" : "Post" }}</button>
  </form>
</template>
