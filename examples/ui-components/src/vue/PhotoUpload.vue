<script setup lang="ts">
import { CalmLensAppClient, CalmLensError } from "@calmlens/sdk/app";
import { computed, ref } from "vue";

type Upload = { assetId: string; status: string };
const emit = defineEmits<{ uploaded: [upload: Upload] }>();

const MESSAGES: Record<string, string> = {
  uploading: "Uploading…",
  checking: "Checking your photo…",
  pending: "Uploaded. We'll show it once it has been checked.",
  allowed: "Uploaded.",
  limited: "Uploaded.",
  "age-restricted": "Uploaded. It will only be shown to people who can see sensitive content.",
  blocked: "This photo can't be used because it may break our community guidelines.",
  purged: "This photo can't be used because it breaks our community guidelines.",
  "upload-preset/too-large": "Choose a smaller photo.",
  "upload-preset/content-type-not-allowed": "Choose a JPEG, PNG or WebP photo.",
  failed: "We couldn't upload this photo. Please try again.",
};

const stage = ref<string | null>(null);
const busy = computed(() => stage.value === "uploading" || stage.value === "checking");

async function uploadPhoto(file: File): Promise<Upload> {
  stage.value = "uploading";
  const response = await fetch("/api/upload-token", { method: "POST" });
  if (!response.ok) throw new Error("Upload refused");
  const { token } = await response.json();
  const client = new CalmLensAppClient({ uploadPresetId: "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P", token });

  let asset = await client.assets.create({ name: file.name, content: { data: file, type: file.type } });
  stage.value = "checking";
  for (let delay = 1000; asset.status === "pending" && delay <= 8000; delay *= 2) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    asset = await client.assets.retrieve({ assetId: asset.id });
  }
  return { assetId: asset.id, status: asset.status ?? "pending" };
}

async function handleChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const upload = await uploadPhoto(file);
    stage.value = upload.status;
    if (upload.status !== "blocked" && upload.status !== "purged") emit("uploaded", upload);
  } catch (error) {
    const known = CalmLensError.isCalmLensError(error) && MESSAGES[error.code];
    stage.value = known ? error.code : "failed";
  }
}
</script>

<template>
  <div>
    <label>Photo <input type="file" accept="image/*" :disabled="busy" @change="handleChange" /></label>
    <progress v-if="busy" :aria-label="MESSAGES[stage!]" />
    <p role="status">{{ stage ? MESSAGES[stage] : "" }}</p>
  </div>
</template>
