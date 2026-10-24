<script lang="ts">
  import { CalmLensMedia, CalmLensUploader } from "@calmlens/sdk/svelte";
  import { ACCEPT, GALLERY_SIZES, GALLERY_WIDTHS, MAX_FILE_SIZE, playground } from "../playground";
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
    onUploaded={(upload) => playground.addUpload(upload, "Svelte")}
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
        <CalmLensMedia
          projectId={$playground.config.projectId}
          assetId={item.assetId}
          status={item.status}
          canView={$playground.canView}
          type={item.type}
          alt={item.name}
          aspectRatio={item.aspectRatio}
          widths={GALLERY_WIDTHS}
          sizes={GALLERY_SIZES}
          cdnBaseUrl={$playground.config.cdnBaseUrl}
          onReveal={playground.reveal}
        />
        <p class="caption">
          {item.name} <span class="chip" data-status={item.status}>{item.status ?? "submitted"}</span>
        </p>
      </li>
    {/each}
  </ul>
</section>
