<script lang="ts">
  import { onMount } from "svelte";
  import {
    createUploadController,
    describeUploadItem,
    getDropzoneHint,
    resolveMessages,
    type UploaderProps,
  } from "../ui.js";
  import Icon from "./Icon.svelte";

  let { disabled = false, capture, messages: overrides, ...options }: UploaderProps =
    $props();

  // The latest options, without restarting uploads when the parent re-renders.
  const controller = createUploadController(options);
  $effect.pre(() => controller.setOptions({ ...options }));
  onMount(() => () => controller.clear());

  const messages = $derived(resolveMessages(overrides));
  const hint = $derived(getDropzoneHint(messages, options.maxFileSize));
  let dragging = $state(false);
  let input: HTMLInputElement | undefined = $state();

  const openPicker = () => {
    if (!disabled) input?.click();
  };
  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (!disabled) dragging = true;
  };
</script>

<div class="calmlens-uploader">
  <!-- Keyboard users open the picker with the button; the zone adds drop and click targets. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: the button inside is the accessible control -->
  <div
    class="calmlens-dropzone"
    data-dragging={dragging || undefined}
    data-disabled={disabled || undefined}
    onclick={openPicker}
    ondragover={onDragOver}
    ondragenter={onDragOver}
    ondragleave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dragging = false;
    }}
    ondrop={(event) => {
      event.preventDefault();
      dragging = false;
      if (!disabled && event.dataTransfer) controller.addFiles(event.dataTransfer.files);
    }}
    onpaste={(event) => {
      const files = event.clipboardData?.files;
      if (!disabled && files?.length) controller.addFiles(files);
    }}
  >
    <span class="calmlens-dropzone__icon"><Icon name="upload" /></span>
    <p class="calmlens-dropzone__title">
      {dragging ? messages.dropzoneTitleDragging : messages.dropzoneTitle}
    </p>
    {#if hint}<p class="calmlens-dropzone__hint">{hint}</p>{/if}
    <button
      type="button"
      class="calmlens-button"
      {disabled}
      onclick={(event) => {
        event.stopPropagation();
        openPicker();
      }}
    >
      {messages.chooseFiles}
    </button>
    <input
      bind:this={input}
      type="file"
      hidden
      accept={options.accept}
      multiple={options.multiple}
      {capture}
      {disabled}
      onclick={(event) => event.stopPropagation()}
      onchange={(event) => {
        if (event.currentTarget.files) controller.addFiles(event.currentTarget.files);
        event.currentTarget.value = "";
      }}
    />
  </div>
  {#if $controller.items.length > 0}
    <ul class="calmlens-uploads">
      {#each $controller.items as item (item.key)}
        {@const view = describeUploadItem(item, messages)}
        <li class="calmlens-upload" data-stage={item.stage} data-outcome={view.outcome}>
          {#if item.previewUrl}
            <img class="calmlens-upload__thumb" src={item.previewUrl} alt="" />
          {:else}
            <span class="calmlens-upload__thumb" aria-hidden="true">{view.extension}</span>
          {/if}
          <div class="calmlens-upload__body">
            <span class="calmlens-upload__name">
              {item.file.name}<span class="calmlens-upload__size">{view.size}</span>
            </span>
            {#if view.busy}
              <div
                class="calmlens-progress"
                role="progressbar"
                aria-label={view.message}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={view.progressPercent}
              >
                <div
                  class="calmlens-progress__bar"
                  style:width={view.progressPercent === undefined
                    ? undefined
                    : `${view.progressPercent}%`}
                ></div>
              </div>
            {/if}
            <p class="calmlens-upload__message" role="status">{view.message}</p>
          </div>
          <div class="calmlens-upload__actions">
            {#if view.canRetry}
              <button
                type="button"
                class="calmlens-icon-button"
                aria-label={messages.retry}
                title={messages.retry}
                onclick={() => controller.retry(item.key)}
              >
                <Icon name="retry" />
              </button>
            {/if}
            <button
              type="button"
              class="calmlens-icon-button"
              aria-label={view.removeLabel}
              title={view.removeLabel}
              onclick={() => controller.remove(item.key)}
            >
              <Icon name="remove" />
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
