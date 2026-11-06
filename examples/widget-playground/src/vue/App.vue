<script setup lang="ts">
import { CalmLensAsset, CalmLensUploader } from "calmlens/vue";
import { onScopeDispose, shallowRef } from "vue";
import { ACCEPT, fetchAssetUrl, GALLERY_SIZES, GALLERY_WIDTHS, MAX_FILE_SIZE, playground } from "../playground";

const state = shallowRef(playground.get());
onScopeDispose(playground.subscribe((next) => (state.value = next)));
</script>

<template>
  <section class="panel">
    <h2>Upload</h2>
    <CalmLensUploader
      :upload-preset-id="state.config.uploadPresetId"
      token-url="/api/upload-token"
      :base-url="state.config.baseUrl"
      :accept="ACCEPT"
      :max-file-size="MAX_FILE_SIZE"
      :multiple="state.multiple"
      @uploaded="(upload) => playground.addUpload(upload, 'Vue')"
    />
  </section>
  <section class="panel">
    <h2>Gallery</h2>
    <p v-if="state.items.length === 0" class="empty">Uploads that aren't blocked appear here.</p>
    <ul class="gallery">
      <li v-for="item in state.items" :key="item.assetId">
        <CalmLensAsset
          :src="item.src"
          :on-expired="() => fetchAssetUrl(item.assetId)"
          :viewer-claims="{ ageConfirmed: state.ageConfirmed }"
          :alt="item.name"
          :aspect-ratio="item.aspectRatio"
          :image="{ widths: GALLERY_WIDTHS, sizes: GALLERY_SIZES }"
          @age-confirm-request="playground.reveal"
        />
        <p class="caption">
          {{ item.name }} <span class="chip" :data-status="item.status">{{ item.status ?? "submitted" }}</span>
        </p>
      </li>
    </ul>
  </section>
</template>
