<script lang="ts">
  import { onMount } from "svelte";
  import { renderFileIconSvg } from "../file-icons.js";
  import {
    getMediaAspectRatio,
    getMediaLoadKey,
    getMediaState,
    getMediaUnavailableMessage,
    getPeakHeights,
    getPlayedPercent,
    getShownPlaceholder,
    MEDIA_FILE_ICON_SIZE,
    type MediaOptions,
    type MediaProps,
    MediaStreamPlayer,
    MediaUrlSigner,
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
  let signed = $state(0);
  const signer = new MediaUrlSigner(() => {
    signed++;
  });
  const state = $derived.by(() => {
    void signed;
    return getMediaState(view, signer.urls(view));
  });
  const loadKey = $derived(getMediaLoadKey(state));
  const ratio = $derived(
    getMediaAspectRatio({ aspectRatio, width: view.width, height: view.height }),
  );
  let load: "loading" | "loaded" | "error" = $state("loading");
  let played = $state(0);
  let image: HTMLImageElement | undefined = $state();
  let media: HTMLMediaElement | undefined = $state();
  const streams = new MediaStreamPlayer(signer);
  // A video or audio stream plays through its element, so it starts after the render.
  $effect(() => streams.update(media, state));
  onMount(() => () => streams.stop());

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
  const onMediaError = (event: Event) => {
    if (!streams.recover(event.currentTarget as HTMLMediaElement)) load = "error";
  };
  const onLoadedMetadata = (event: Event) =>
    signer.loaded(event.currentTarget as HTMLMediaElement);
  const failed = $derived(load === "error");
  const placeholderUrl = $derived(failed ? undefined : getShownPlaceholder(state, load === "loaded"));
  const heights = $derived(state.kind === "audio" && state.peaks ? getPeakHeights(state.peaks) : []);
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
  {#if placeholderUrl}
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
      bind:this={media}
      class="calmlens-media__content"
      src={state.stream ? undefined : state.src}
      poster={state.poster}
      {controls}
      playsinline
      preload="metadata"
      aria-label={alt || undefined}
      onloadedmetadata={onLoadedMetadata}
      onerror={onMediaError}
    ></video>
  {:else if state.kind === "audio" && !failed}
    {#if state.waveformUrl || state.peaks}
      <div class="calmlens-media__waveform">
        {#if state.waveformUrl}
          <img class="calmlens-media__wave" src={state.waveformUrl} alt="" aria-hidden="true" />
        {/if}
        {#if state.peaks}
          <!-- Decorative: the audio element's own controls report its progress. -->
          <div
            class="calmlens-media__progress"
            role="progressbar"
            aria-hidden="true"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={played}
            style:--calmlens-played={`${played}%`}
          >
            <div class="calmlens-media__peaks">
              {#each heights as height}<span style:height={`${height}%`}></span>{/each}
            </div>
            <div class="calmlens-media__peaks" data-played="">
              {#each heights as height}<span style:height={`${height}%`}></span>{/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
    <!-- biome-ignore lint/a11y/useMediaCaption: audio has no captions track to add here -->
    <audio
      bind:this={media}
      class="calmlens-media__content"
      src={state.stream ? undefined : state.src}
      {controls}
      preload="metadata"
      aria-label={alt || undefined}
      onloadedmetadata={onLoadedMetadata}
      ontimeupdate={(event) => (played = getPlayedPercent(event.currentTarget))}
      onerror={onMediaError}
    ></audio>
  {:else if state.kind === "pdf"}
    <iframe class="calmlens-media__content" src={state.src} title={alt || messages.pdfTitle}></iframe>
    <a
      class="calmlens-button calmlens-media__open"
      href={state.src}
      target="_blank"
      rel="noopener noreferrer">{messages.openPdf}</a
    >
  {:else if state.kind === "file"}
    <span
      class="calmlens-media__file"
      role="img"
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : "true"}
    >{@html renderFileIconSvg({ family: state.icon, extension: "" }, MEDIA_FILE_ICON_SIZE)}</span>
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
