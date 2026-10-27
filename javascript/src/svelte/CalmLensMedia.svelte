<script lang="ts">
  import { onMount } from "svelte";
  import {
    getMediaAspectRatio,
    getMediaLoadKey,
    getMediaState,
    getMediaUnavailableMessage,
    type MediaOptions,
    type MediaProps,
    resolveMediaProps,
    resolveMessages,
  } from "../ui.js";
  import Icon from "./Icon.svelte";

  let {
    alt = "",
    aspectRatio,
    width,
    height,
    sizes,
    averageColor,
    fit,
    position,
    lazy = true,
    fetchPriority,
    controls = true,
    messages: overrides,
    onReveal,
    ...options
  }: MediaProps = $props();

  const messages = $derived(resolveMessages(overrides));
  // An `asset` fills in what isn't passed: the source, status and type, and its preview's size.
  const view = $derived(
    resolveMediaProps({ ...(options as MediaOptions), width, height, averageColor }),
  );
  const state = $derived(getMediaState(view));
  const loadKey = $derived(getMediaLoadKey(state));
  const ratio = $derived(
    getMediaAspectRatio({ aspectRatio, width: view.width, height: view.height }),
  );
  let load: "loading" | "loaded" | "error" = $state("loading");
  let image: HTMLImageElement | undefined = $state();

  $effect.pre(() => {
    void loadKey;
    load = "loading";
  });
  onMount(() => {
    // An image that loaded before hydration fires no load event.
    if (image?.complete && image.naturalWidth > 0) load = "loaded";
  });

  const onError = () => {
    load = "error";
  };
  const placeholderUrl = $derived(
    state.kind === "audio" || state.kind === "unavailable" ? undefined : state.placeholderUrl,
  );
  const showPlaceholder = $derived(
    placeholderUrl && (state.kind === "gated" || (state.kind === "image" && load !== "loaded")),
  );
  const failed = $derived(load === "error");
</script>

<figure
  class="calmlens-media"
  data-kind={state.kind}
  data-state={load}
  data-sized={ratio ? "" : undefined}
  style:aspect-ratio={ratio}
  style:background-color={view.averageColor}
  style:--calmlens-fit={fit}
  style:--calmlens-position={position}
>
  {#if showPlaceholder}
    <img class="calmlens-media__placeholder" src={placeholderUrl} alt="" aria-hidden="true" />
  {/if}
  {#if state.kind === "image" && !failed}
    {#key loadKey}
      <img
        bind:this={image}
        class="calmlens-media__content"
        src={state.src}
        srcset={state.srcSet}
        {sizes}
        {alt}
        width={view.width}
        height={view.height}
        loading={lazy ? "lazy" : undefined}
        decoding="async"
        fetchpriority={fetchPriority}
        onload={() => (load = "loaded")}
        onerror={onError}
      />
    {/key}
  {:else if state.kind === "video" && !failed}
    <!-- svelte-ignore a11y_media_has_caption -->
    <!-- biome-ignore lint/a11y/useMediaCaption: captions are your app's to add -->
    <video
      class="calmlens-media__content"
      src={state.src}
      {controls}
      playsinline
      preload="metadata"
      aria-label={alt || undefined}
      onerror={() => (load = "error")}
    ></video>
  {:else if state.kind === "audio" && !failed}
    <!-- biome-ignore lint/a11y/useMediaCaption: audio has no captions track to add here -->
    <audio
      class="calmlens-media__content"
      src={state.src}
      {controls}
      preload="metadata"
      aria-label={alt || undefined}
      onerror={() => (load = "error")}
    ></audio>
  {/if}
  {#if state.kind === "gated"}
    <figcaption class="calmlens-media__notice">
      <strong>{messages.sensitiveTitle}</strong>
      <p>{messages.sensitiveBody}</p>
      {#if onReveal}
        <button type="button" class="calmlens-button" onclick={onReveal}>{messages.reveal}</button>
      {/if}
    </figcaption>
  {/if}
  {#if state.kind === "unavailable" || failed}
    <figcaption class="calmlens-media__notice">
      <p><Icon name="unavailable" /><span class="calmlens-media__label">{getMediaUnavailableMessage(state, messages)}</span></p>
    </figcaption>
  {/if}
</figure>
