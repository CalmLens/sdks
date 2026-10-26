<script lang="ts">
  import { onMount } from "svelte";
  import {
    createUploadController,
    describeUploader,
    describeUploadItem,
    resolveMessages,
    type UploaderProps,
  } from "../ui.js";
  import Icon from "./Icon.svelte";

  let {
    disabled = false,
    capture,
    messages: overrides,
    controller: external,
    ...options
  }: UploaderProps = $props();

  // The latest options, without restarting uploads when the parent re-renders.
  const own = createUploadController(options);
  $effect.pre(() => {
    if (!external) own.setOptions({ ...options });
  });
  onMount(() => () => own.clear());

  const queue = $derived(external ?? own);
  const messages = $derived(resolveMessages(overrides));
  const view = $derived(describeUploader($queue, queue.options, messages));
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
  {#if view.showDropzone}
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
        if (!disabled && event.dataTransfer) queue.addFiles(event.dataTransfer.files);
      }}
      onpaste={(event) => {
        const files = event.clipboardData?.files;
        if (!disabled && files?.length) queue.addFiles(files);
      }}
    >
      <span class="calmlens-dropzone__icon"><Icon name="upload" /></span>
      <div class="calmlens-dropzone__text">
        <p class="calmlens-dropzone__title">
          {dragging ? messages.dropzoneTitleDragging : messages.dropzoneTitle}
        </p>
        {#if view.hint}<p class="calmlens-dropzone__hint">{view.hint}</p>{/if}
      </div>
      <button
        type="button"
        class="calmlens-button"
        data-variant="outline"
        {disabled}
        onclick={(event) => {
          event.stopPropagation();
          openPicker();
        }}
      >
        {view.chooseLabel}
      </button>
    </div>
  {/if}
  <input
    bind:this={input}
    type="file"
    hidden
    accept={queue.options.accept}
    multiple={queue.options.multiple}
    {capture}
    {disabled}
    onchange={(event) => {
      if (event.currentTarget.files) queue.addFiles(event.currentTarget.files);
      event.currentTarget.value = "";
    }}
  />
  {#if $queue.items.length > 0}
    <ul class="calmlens-uploads">
      {#each $queue.items as item (item.key)}
        {@const itemView = describeUploadItem(item, messages)}
        <li class="calmlens-upload" data-stage={item.stage} data-outcome={itemView.outcome}>
          {#if item.previewUrl}
            <img class="calmlens-upload__thumb" src={item.previewUrl} alt="" />
          {:else}
            <span class="calmlens-upload__thumb" data-kind="file" aria-hidden="true"
              >{@html itemView.fileIcon}</span
            >
          {/if}
          <div class="calmlens-upload__body">
            <span class="calmlens-upload__name">{item.file.name}</span>
            <span class="calmlens-upload__size">{itemView.size}</span>
            {#if itemView.busy}
              <div
                class="calmlens-progress"
                role="progressbar"
                aria-label={itemView.message}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={itemView.progressPercent}
              >
                <div
                  class="calmlens-progress__bar"
                  style:width={itemView.progressPercent === undefined
                    ? undefined
                    : `${itemView.progressPercent}%`}
                ></div>
              </div>
            {/if}
            {#if itemView.message}
              <p class="calmlens-upload__message" role="status">{itemView.message}</p>
            {/if}
          </div>
          <div class="calmlens-upload__actions">
            {#if !view.showDropzone}
              <button
                type="button"
                class="calmlens-button"
                data-variant="outline"
                data-size="small"
                {disabled}
                onclick={openPicker}
              >
                {messages.chooseAnother}
              </button>
            {/if}
            {#if itemView.canRetry}
              <button
                type="button"
                class="calmlens-icon-button"
                aria-label={messages.retry}
                title={messages.retry}
                onclick={() => queue.retry(item.key)}
              >
                <Icon name="retry" />
              </button>
            {/if}
            <button
              type="button"
              class="calmlens-icon-button"
              aria-label={itemView.removeLabel}
              title={itemView.removeLabel}
              onclick={() => queue.remove(item.key)}
            >
              <Icon name="remove" />
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
