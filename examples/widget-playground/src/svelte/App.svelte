<script lang="ts">
  import { CalmLensAsset, type CalmLensUpload, CalmLensUploader } from "calmlens/svelte";
  import { ACCEPT, fetchAssetUrl, GALLERY_SIZES, GALLERY_WIDTHS, MAX_FILE_SIZE, playground } from "../playground";
</script>

<section class="panel">
  <h2>Upload</h2>
  <CalmLensUploader
    uploadPresetId={$playground.config.uploadPresetId}
    tokenUrl="/api/upload-token"
    baseUrl={$playground.config.baseUrl}
    accept={ACCEPT}
    maxFileSize={MAX_FILE_SIZE}
    multiple={$playground.multiple}
    onUploaded={(upload: CalmLensUpload) => playground.addUpload(upload, "Svelte")}
  />
</section>
<section class="panel">
  <h2>Gallery</h2>
  {#if $playground.items.length === 0}
    <p class="empty">Uploads that aren't blocked appear here.</p>
  {/if}
  <ul class="gallery">
    {#each $playground.items as item (item.assetId)}
      <li>
        <CalmLensAsset
          src={item.src}
          onExpired={() => fetchAssetUrl(item.assetId)}
          viewerClaims={{ ageConfirmed: $playground.ageConfirmed }}
          alt={item.name}
          aspectRatio={item.aspectRatio}
          image={{ widths: GALLERY_WIDTHS, sizes: GALLERY_SIZES }}
          onAgeConfirmRequest={playground.reveal}
        />
        <p class="caption">
          {item.name} <span class="chip" data-status={item.status}>{item.status ?? "submitted"}</span>
        </p>
      </li>
    {/each}
  </ul>
</section>
