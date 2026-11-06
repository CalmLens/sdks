<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { renderFileIconSvg } from "../file-icons.js";
  import {
    ASSET_FILE_ICON_SIZE,
    type AssetProps,
    AssetSession,
    type AssetView,
    AssetViewerMount,
    formatMessage,
    getAssetAspectRatio,
    getAssetView,
    getAssetViewKey,
    getMountedViewerOptions,
    getPeakHeights,
    getPlayedPercent,
    isMountedViewerKind,
    MediaStreamPlayer,
    resolveMessages,
  } from "../ui.js";
  import Icon from "./Icon.svelte";

  let {
    src,
    display,
    viewerClaims,
    info,
    image: imageOptions,
    video: videoOptions,
    document: documentOptions,
    spreadsheet,
    onExpired,
    alt = "",
    fit,
    aspectRatio,
    lazy = true,
    fetchPriority,
    messages: overrides,
    onLoad,
    onError,
    onAvailabilityChange,
    onAgeConfirmRequest,
    onPlay,
    onEnded,
    onTimeUpdate,
    renderUnavailable,
    renderAgeGate,
  }: AssetProps & {
    renderUnavailable?: Snippet;
    renderAgeGate?: Snippet<[{ placeholderUrl?: string; confirm?: () => void }]>;
  } = $props();

  const messages = $derived(resolveMessages(overrides));
  const options = $derived({
    src,
    display,
    viewerClaims,
    info,
    image: imageOptions,
    video: videoOptions,
    document: documentOptions,
    spreadsheet,
    onExpired,
    alt,
  });
  let version = $state(0);
  const session = new AssetSession(() => {
    version++;
  });
  const sessionState = $derived.by(() => {
    void version;
    return session.update(options);
  });
  const view: AssetView = $derived(getAssetView(options, sessionState));
  const loadKey = $derived(getAssetViewKey(view));
  const ratio = $derived(getAssetAspectRatio(view, sessionState.info, aspectRatio));
  let load: "loading" | "loaded" | "error" = $state("loading");
  let played = $state(0);
  let mounted = $state(false);
  let image: HTMLImageElement | undefined = $state();
  let media: HTMLMediaElement | undefined = $state();
  let viewerRoot: HTMLElement | undefined = $state();
  const failedAt = (element: HTMLMediaElement) => ({
    position: element.currentTime || 0,
    playing: !element.paused && !element.ended,
  });
  const streams = new MediaStreamPlayer((element) => {
    session.mediaFailed(failedAt(element));
    return true;
  });
  const viewers = new AssetViewerMount();
  // The info is read once mounted, never during server rendering.
  $effect(() => {
    void sessionState;
    if (mounted) session.load();
  });
  // A video or audio stream plays through its element, so it starts after the render.
  $effect(() => streams.update(media, view));
  $effect(() => {
    void sessionState;
    viewers.update(
      viewerRoot,
      isMountedViewerKind(view.kind) ? view.kind : undefined,
      getMountedViewerOptions(options, session),
      (viewerState) => {
        if (viewerState !== "loading") load = viewerState;
      },
    );
  });
  onMount(() => {
    mounted = true;
    // An image that loaded before hydration fires no load event.
    if (image?.complete && image.naturalWidth > 0) load = "loaded";
    return () => {
      streams.stop();
      viewers.destroy();
    };
  });
  $effect.pre(() => {
    void loadKey;
    load = "loading";
  });
  $effect(() => {
    if (load === "loaded") onLoad?.();
    if (load === "error") onError?.();
  });
  const availability = $derived(
    view.kind === "unavailable"
      ? "unavailable"
      : view.kind === "age-restricted"
        ? "age-restricted"
        : view.kind === "pending"
          ? undefined
          : "available",
  );
  $effect(() => {
    if (availability) onAvailabilityChange?.(availability);
  });

  const onMediaError = (event: Event) => {
    const element = event.currentTarget as HTMLMediaElement;
    if (!streams.recover(element)) session.mediaFailed(failedAt(element));
  };
  const onLoadedMetadata = (event: Event) => {
    session.mediaLoaded(event.currentTarget as HTMLMediaElement);
    load = "loaded";
  };
  const onMediaTime = (event: Event) => {
    const element = event.currentTarget as HTMLMediaElement;
    played = getPlayedPercent(element);
    onTimeUpdate?.(element.currentTime);
  };
  const onImageLoad = () => {
    session.loaded();
    load = "loaded";
  };
  const placeholderUrl = $derived(
    "placeholderUrl" in view &&
      (view.kind === "age-restricted" || view.kind === "pending" || load !== "loaded")
      ? view.placeholderUrl
      : undefined,
  );
  const heights = $derived(view.kind === "audio" && view.peaks ? getPeakHeights(view.peaks) : []);
  const viewerShown = $derived(isMountedViewerKind(view.kind) && mounted);
  const controls = $derived(videoOptions?.controls ?? true);
</script>

{#snippet still(shown: Extract<AssetView, { kind: "image" | "website" }>)}
  {#key loadKey}
    <img
      bind:this={image}
      class="calmlens-asset__content"
      src={shown.src}
      srcset={shown.srcSet}
      sizes={shown.srcSet ? imageOptions?.sizes : undefined}
      {alt}
      width={shown.width}
      height={shown.height}
      loading={lazy ? "lazy" : undefined}
      decoding="async"
      fetchpriority={fetchPriority}
      onload={onImageLoad}
      onerror={() => session.failed()}
    />
  {/key}
{/snippet}

<figure
  class="calmlens-asset"
  data-kind={view.kind}
  data-state={load}
  data-sized={ratio ? "" : undefined}
  aria-busy={view.kind === "pending" ? "true" : undefined}
  style:aspect-ratio={ratio}
  style:background-color={sessionState.info?.content?.preview?.averageColor ?? undefined}
  style:--calmlens-fit={fit}
>
  {#if placeholderUrl}
    <img class="calmlens-asset__placeholder" src={placeholderUrl} alt="" aria-hidden="true" />
  {/if}
  {#if view.kind === "image"}
    {@render still(view)}
  {:else if view.kind === "website"}
    {#if view.link}
      <div class="calmlens-asset__bar">
        <a class="calmlens-button" href={view.link} target="_blank" rel="noopener noreferrer nofollow"
          >{formatMessage(messages.openWebsite, { host: new URL(view.link).host })}</a
        >
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- biome-ignore lint/a11y/noNoninteractiveTabindex: the screenshot scrolls, so keyboards must reach it -->
    <section class="calmlens-asset__scroll" aria-label={alt || undefined} tabindex="0">
      {@render still(view)}
    </section>
  {:else if view.kind === "video"}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={media}
      class="calmlens-asset__content"
      src={view.stream ? undefined : view.src}
      poster={view.poster}
      {controls}
      autoplay={videoOptions?.autoPlay}
      muted={videoOptions?.muted}
      loop={videoOptions?.loop}
      playsinline
      preload="metadata"
      aria-label={alt || undefined}
      onloadedmetadata={onLoadedMetadata}
      onerror={onMediaError}
      onplay={() => onPlay?.()}
      onended={() => onEnded?.()}
      ontimeupdate={onMediaTime}
    ></video>
  {:else if view.kind === "audio"}
    {#if view.waveformUrl || view.peaks}
      <div class="calmlens-asset__waveform">
        {#if view.waveformUrl}
          <img class="calmlens-asset__wave" src={view.waveformUrl} alt="" aria-hidden="true" />
        {/if}
        {#if view.peaks}
          <!-- Decorative: the audio element's own controls report its progress. -->
          <div
            class="calmlens-asset__progress"
            role="progressbar"
            aria-hidden="true"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={played}
            style:--calmlens-played={`${played}%`}
          >
            <div class="calmlens-asset__peaks">
              {#each heights as height}<span style:height={`${height}%`}></span>{/each}
            </div>
            <div class="calmlens-asset__peaks" data-played="">
              {#each heights as height}<span style:height={`${height}%`}></span>{/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
    <!-- biome-ignore lint/a11y/useMediaCaption: audio has no captions track to add here -->
    <audio
      bind:this={media}
      class="calmlens-asset__content"
      src={view.stream ? undefined : view.src}
      {controls}
      autoplay={videoOptions?.autoPlay}
      muted={videoOptions?.muted}
      loop={videoOptions?.loop}
      preload="metadata"
      aria-label={alt || undefined}
      onloadedmetadata={onLoadedMetadata}
      onerror={onMediaError}
      onplay={() => onPlay?.()}
      onended={() => onEnded?.()}
      ontimeupdate={onMediaTime}
    ></audio>
  {:else if viewerShown}
    <!-- The viewer owns this element's children; Svelte renders none. -->
    <div bind:this={viewerRoot} class="calmlens-asset__viewer"></div>
  {:else if view.kind === "document"}
    {#if view.still}
      <img class="calmlens-asset__content" src={view.still} {alt} decoding="async" />
    {/if}
    <a class="calmlens-button calmlens-asset__open" href={view.src} target="_blank" rel="noopener noreferrer"
      >{messages.openDocument}</a
    >
  {:else if view.kind === "file"}
    <span
      class="calmlens-asset__file"
      role="img"
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : "true"}
    >{@html renderFileIconSvg({ family: view.icon, extension: "" }, ASSET_FILE_ICON_SIZE)}</span>
  {:else if view.kind === "age-restricted"}
    {#if renderAgeGate}
      {@render renderAgeGate({ placeholderUrl: view.placeholderUrl, confirm: onAgeConfirmRequest })}
    {:else}
      <figcaption class="calmlens-asset__notice">
        <strong>{messages.sensitiveTitle}</strong>
        <p>{messages.sensitiveBody}</p>
        {#if onAgeConfirmRequest}
          <button type="button" class="calmlens-button" onclick={onAgeConfirmRequest}>{messages.reveal}</button>
        {/if}
      </figcaption>
    {/if}
  {:else if view.kind === "unavailable"}
    {#if renderUnavailable}
      {@render renderUnavailable()}
    {:else}
      <figcaption class="calmlens-asset__notice">
        <p><Icon name="unavailable" /><span class="calmlens-asset__label">{messages.unavailable}</span></p>
      </figcaption>
    {/if}
  {/if}
</figure>
