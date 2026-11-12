"use client";
// React components for uploads and assets: `CalmLensUploader`, `CalmLensAsset` and the
// `useCalmLensUpload` hook for your own upload UI. They also work in Preact through
// `preact/compat`.

import {
  type CSSProperties,
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AssetSession,
  getAssetAspectRatio,
  getAssetView,
  getAssetViewKey,
  getPeakHeights,
  getPlayedPercent,
} from "./ui/Asset";
import {
  AssetViewerMount,
  getMountedViewerOptions,
  isMountedViewerKind,
} from "./ui/AssetViewerMount";
import type {
  UploadControllerOptions,
  UploaderProps,
  UseCalmLensUploadResult,
} from "./ui/BrowserUpload";
import { renderFileIconSvg } from "./ui/FileIcons";
import { ICON_ATTRIBUTES, ICONS, type IconName } from "./ui/Icons";
import { MediaStreamPlayer } from "./ui/MediaStream";
import {
  describeUploader,
  describeUploadItem,
  formatMessage,
  resolveMessages,
} from "./ui/Messages";
import { ASSET_FILE_ICON_SIZE, type AssetProps } from "./ui/Props";
import {
  useOwnController,
  useCalmLensUpload as useSharedCalmLensUpload,
  useUploadSnapshot,
} from "./ui/ReactUpload";
import { CALMLENS_STYLES, CALMLENS_STYLES_ID } from "./ui/Styles";
import type { UploadFile } from "./ui/UploadController";

export * from "./ui";
export type {
  CalmLensUpload,
  UploadControllerOptions,
  UploaderProps,
  UploadItem,
  UploadSnapshot,
  UseCalmLensUploadResult,
} from "./ui/BrowserUpload";
export { createUploadController } from "./ui/BrowserUpload";
export { CalmLensProvider, type CalmLensProviderProps } from "./ui/ReactUpload";
export * from "./viewers/React";

/**
 * Uploads files through an upload preset and re-renders as each one uploads and is checked. Use
 * it to build your own upload UI; `CalmLensUploader` is built on it. Uploads still running when
 * the component unmounts are cancelled.
 */
export const useCalmLensUpload = <F extends UploadFile = File>(
  options: UploadControllerOptions<F>,
): UseCalmLensUploadResult<F> => useSharedCalmLensUpload(options);

const joinClassNames = (...names: (string | false | undefined)[]) =>
  names.filter(Boolean).join(" ");

const Icon = ({ name }: { name: IconName }) => {
  const {
    "stroke-width": strokeWidth,
    "stroke-linecap": strokeLinecap,
    "stroke-linejoin": strokeLinejoin,
    "aria-hidden": ariaHidden,
    ...rest
  } = ICON_ATTRIBUTES;
  return (
    <svg
      {...rest}
      strokeWidth={strokeWidth}
      strokeLinecap={strokeLinecap}
      strokeLinejoin={strokeLinejoin}
      aria-hidden={ariaHidden}
    >
      <path d={ICONS[name]} />
    </svg>
  );
};

/**
 * The components' stylesheet, rendered with them: React hoists it into the document head, on the
 * server as well as in the browser, and adds it once however many components render.
 */
const CalmLensStyles = ({ unstyled }: { unstyled: boolean | undefined }) =>
  unstyled ? null : (
    <style href={CALMLENS_STYLES_ID} precedence="calmlens">
      {CALMLENS_STYLES}
    </style>
  );

/** Leaves out the stylesheet the components render, so you can style the `calmlens-*` classes. */
type StyleOptions = { unstyled?: boolean };

export type CalmLensUploaderProps = UploaderProps &
  StyleOptions & {
    className?: string;
    style?: CSSProperties;
  };

/**
 * A drop zone and file list that uploads through an upload preset, shows each file's progress
 * and moderation decision, and reports finished uploads to `onUploaded`.
 */
export function CalmLensUploader({
  disabled,
  capture,
  messages: overrides,
  unstyled,
  controller: external,
  className,
  style,
  ...options
}: CalmLensUploaderProps) {
  const own = useOwnController(options, !external);
  const upload = useUploadSnapshot(external ?? own);
  const { accept, multiple } = upload.controller.options;
  const messages = useMemo(() => resolveMessages(overrides), [overrides]);
  const view = describeUploader(upload, upload.controller.options, messages);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    if (!disabled) input.current?.click();
  };
  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (!disabled) setDragging(true);
  };

  return (
    <div className={joinClassNames("calmlens-uploader", className)} style={style}>
      <CalmLensStyles unstyled={unstyled} />
      {view.showDropzone && (
        // Keyboard users open the picker with the button; the zone adds drop and click targets.
        // biome-ignore lint/a11y/noStaticElementInteractions: the button inside is the accessible control
        <div
          className="calmlens-dropzone"
          data-dragging={dragging || undefined}
          data-disabled={disabled || undefined}
          onClick={openPicker}
          onDragOver={onDragOver}
          onDragEnter={onDragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!disabled) upload.addFiles(event.dataTransfer.files);
          }}
          onPaste={(event) => {
            if (!disabled && event.clipboardData.files.length)
              upload.addFiles(event.clipboardData.files);
          }}
        >
          <span className="calmlens-dropzone__icon">
            <Icon name="upload" />
          </span>
          <div className="calmlens-dropzone__text">
            <p className="calmlens-dropzone__title">
              {dragging ? messages.dropzoneTitleDragging : messages.dropzoneTitle}
            </p>
            {view.hint && <p className="calmlens-dropzone__hint">{view.hint}</p>}
          </div>
          <button
            type="button"
            className="calmlens-button"
            data-variant="outline"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              openPicker();
            }}
          >
            {view.chooseLabel}
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        capture={capture}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.files) upload.addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {upload.items.length > 0 && (
        <ul className="calmlens-uploads">
          {upload.items.map((item) => {
            const itemView = describeUploadItem(item, messages);
            return (
              <li
                key={item.key}
                className="calmlens-upload"
                data-stage={item.stage}
                data-outcome={itemView.outcome}
              >
                {item.previewUrl ? (
                  <img className="calmlens-upload__thumb" src={item.previewUrl} alt="" />
                ) : (
                  <span
                    className="calmlens-upload__thumb"
                    data-kind="file"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: itemView.fileIcon }}
                  />
                )}
                <div className="calmlens-upload__body">
                  <span className="calmlens-upload__name">{item.file.name}</span>
                  <span className="calmlens-upload__size">{itemView.size}</span>
                  {itemView.busy && (
                    <div
                      className="calmlens-progress"
                      role="progressbar"
                      aria-label={itemView.message}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={itemView.progressPercent}
                    >
                      <div
                        className="calmlens-progress__bar"
                        style={
                          itemView.progressPercent === undefined
                            ? undefined
                            : { width: `${itemView.progressPercent}%` }
                        }
                      />
                    </div>
                  )}
                  {itemView.message && (
                    <p className="calmlens-upload__message" role="status">
                      {itemView.message}
                    </p>
                  )}
                </div>
                <div className="calmlens-upload__actions">
                  {!view.showDropzone && (
                    <button
                      type="button"
                      className="calmlens-button"
                      data-variant="outline"
                      data-size="small"
                      disabled={disabled}
                      onClick={openPicker}
                    >
                      {messages.chooseAnother}
                    </button>
                  )}
                  {itemView.canRetry && (
                    <button
                      type="button"
                      className="calmlens-icon-button"
                      aria-label={messages.retry}
                      title={messages.retry}
                      onClick={() => upload.retry(item.key)}
                    >
                      <Icon name="retry" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="calmlens-icon-button"
                    aria-label={itemView.removeLabel}
                    title={itemView.removeLabel}
                    onClick={() => upload.remove(item.key)}
                  >
                    <Icon name="remove" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export type CalmLensAssetProps = AssetProps &
  StyleOptions &
  Omit<
    HTMLAttributes<HTMLElement>,
    "children" | "placeholder" | "onLoad" | "onError" | "onPlay" | "onEnded" | "onTimeUpdate"
  > & {
    /** Replaces the unavailable notice. */
    renderUnavailable?: () => ReactNode;
    /** Replaces the age notice; call `confirm` from your own reveal button. */
    renderAgeGate?: (props: { placeholderUrl?: string; confirm?: () => void }) => ReactNode;
  };

type LoadState = "loading" | "loaded" | "error";

/** Audio's waveform: the preview still, with the played part of its peaks drawn over it. */
const Waveform = ({
  url,
  peaks,
  played,
}: {
  url: string | undefined;
  peaks: readonly number[] | undefined;
  played: number;
}) => {
  if (!url && !peaks) return null;
  const heights = peaks ? getPeakHeights(peaks) : [];
  const bars = heights.map((height, index) => (
    <span key={index} style={{ height: `${height}%` }} />
  ));
  return (
    <div className="calmlens-asset__waveform">
      {url && <img className="calmlens-asset__wave" src={url} alt="" aria-hidden="true" />}
      {peaks && (
        // Decorative: the audio element's own controls report its progress.
        <div
          className="calmlens-asset__progress"
          role="progressbar"
          aria-hidden="true"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={played}
          style={{ "--calmlens-played": `${played}%` } as CSSProperties}
        >
          <div className="calmlens-asset__peaks">{bars}</div>
          <div className="calmlens-asset__peaks" data-played="">
            {bars}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Shows any asset from its asset URL (public, or signed by your server), natively in the page: an
 * image with responsive widths, a website's screenshot and link, video and audio with their
 * adaptive stream, a document, text or spreadsheet viewer, or a preview still or file icon. It
 * reads `{src}/info` once mounted, unless `info` is given, in which case the first render, on the
 * server too, is the real element. Age-restricted content stays behind its blurred placeholder
 * and a reveal button; content the CDN refuses shows the unavailable notice.
 */
export function CalmLensAsset(props: CalmLensAssetProps) {
  const {
    src,
    display,
    viewerClaims,
    info,
    image,
    video,
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
    unstyled,
    className,
    style,
    ...attributes
  } = props;
  const options = {
    src,
    display,
    viewerClaims,
    info,
    image,
    video,
    document: documentOptions,
    spreadsheet,
    onExpired,
    alt,
  };
  const messages = useMemo(() => resolveMessages(overrides), [overrides]);
  const [, setVersion] = useState(0);
  const [session] = useState(() => new AssetSession(() => setVersion((count) => count + 1)));
  const [streams] = useState(
    () =>
      new MediaStreamPlayer((media) => {
        session.mediaFailed({
          position: media.currentTime || 0,
          playing: !media.paused && !media.ended,
        });
        return true;
      }),
  );
  const [viewers] = useState(() => new AssetViewerMount());
  const [mounted, setMounted] = useState(false);
  const state = session.update(options);
  const view = getAssetView(options, state);
  const loadKey = getAssetViewKey(view);
  const [load, setLoad] = useState<{ key: string; state: LoadState }>({
    key: loadKey,
    state: "loading",
  });
  const current = load.key === loadKey ? load : { key: loadKey, state: "loading" as const };
  const [played, setPlayed] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const viewerRoot = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onLoad, onError, onAvailabilityChange });
  callbacks.current = { onLoad, onError, onAvailabilityChange };

  useEffect(() => setMounted(true), []);
  // The info is read once mounted, never during server rendering.
  useEffect(() => session.load());
  // An image that loaded before hydration fires no load event.
  useEffect(() => {
    if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) {
      setLoad({ key: loadKey, state: "loaded" });
    }
  }, [loadKey]);
  useEffect(() => {
    if (current.state === "loaded") callbacks.current.onLoad?.();
    if (current.state === "error") callbacks.current.onError?.();
  }, [current.state]);
  const availability =
    view.kind === "unavailable"
      ? "unavailable"
      : view.kind === "age-restricted"
        ? "age-restricted"
        : view.kind === "pending"
          ? undefined
          : "available";
  useEffect(() => {
    if (availability) callbacks.current.onAvailabilityChange?.(availability);
  }, [availability]);

  const viewerKind = isMountedViewerKind(view.kind) && mounted ? view.kind : undefined;
  // Every render: the viewer loads again only when what it shows changed.
  useEffect(() => {
    viewers.update(
      viewerRoot.current,
      viewerKind,
      getMountedViewerOptions(options, session),
      (viewerState) => {
        if (viewerState !== "loading") setLoad({ key: loadKey, state: viewerState });
      },
    );
  });
  useEffect(() => () => viewers.destroy(), [viewers]);
  // A video or audio stream plays through its element, so it starts after the render.
  useEffect(() => streams.update(media.current, view));
  useEffect(() => () => streams.stop(), [streams]);

  const ratio = getAssetAspectRatio(view, state.info, aspectRatio);
  const placeholderUrl =
    "placeholderUrl" in view &&
    (view.kind === "age-restricted" || view.kind === "pending" || current.state !== "loaded")
      ? view.placeholderUrl
      : undefined;
  const onMediaError = (element: HTMLMediaElement) => {
    if (streams.recover(element)) return;
    session.mediaFailed({
      position: element.currentTime || 0,
      playing: !element.paused && !element.ended,
    });
  };
  const playerEvents = {
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      session.mediaLoaded(event.currentTarget);
      setLoad({ key: loadKey, state: "loaded" });
    },
    onError: (event: SyntheticEvent<HTMLMediaElement>) => onMediaError(event.currentTarget),
    onPlay,
    onEnded,
    onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) => {
      setPlayed(getPlayedPercent(event.currentTarget));
      onTimeUpdate?.(event.currentTarget.currentTime);
    },
  };
  const confirm = onAgeConfirmRequest;
  const imageElement = (shown: Extract<typeof view, { kind: "image" | "website" }>) => (
    <img
      key={loadKey}
      ref={imageRef}
      className="calmlens-asset__content"
      src={shown.src}
      srcSet={shown.srcSet}
      sizes={shown.srcSet ? image?.sizes : undefined}
      alt={alt}
      width={shown.width}
      height={shown.height}
      loading={lazy ? "lazy" : undefined}
      decoding="async"
      fetchPriority={fetchPriority}
      onLoad={() => {
        session.loaded();
        setLoad({ key: loadKey, state: "loaded" });
      }}
      onError={() => session.failed()}
    />
  );

  return (
    <figure
      {...attributes}
      className={joinClassNames("calmlens-asset", className)}
      data-kind={view.kind}
      data-state={current.state}
      data-sized={ratio ? "" : undefined}
      aria-busy={view.kind === "pending" ? true : undefined}
      style={
        {
          aspectRatio: ratio,
          backgroundColor: state.info?.content?.preview?.averageColor ?? undefined,
          "--calmlens-fit": fit,
          ...style,
        } as CSSProperties
      }
    >
      <CalmLensStyles unstyled={unstyled} />
      {placeholderUrl && (
        <img
          className="calmlens-asset__placeholder"
          src={placeholderUrl}
          alt=""
          aria-hidden="true"
        />
      )}
      {view.kind === "image" && imageElement(view)}
      {view.kind === "website" && (
        <>
          {view.link && (
            <div className="calmlens-asset__bar">
              <a
                className="calmlens-button"
                href={view.link}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {formatMessage(messages.openWebsite, {
                  host: new URL(view.link).host,
                })}
              </a>
            </div>
          )}
          <section
            className="calmlens-asset__scroll"
            aria-label={alt || undefined}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the screenshot scrolls, so keyboards must reach it
            tabIndex={0}
          >
            {imageElement(view)}
          </section>
        </>
      )}
      {view.kind === "video" && (
        <video
          ref={media}
          className="calmlens-asset__content"
          src={view.stream ? undefined : view.src}
          poster={view.poster}
          controls={video?.controls ?? true}
          autoPlay={video?.autoPlay}
          muted={video?.muted}
          loop={video?.loop}
          playsInline
          preload="metadata"
          aria-label={alt || undefined}
          {...playerEvents}
        />
      )}
      {view.kind === "audio" && (
        <>
          <Waveform url={view.waveformUrl} peaks={view.peaks} played={played} />
          <audio
            ref={media}
            className="calmlens-asset__content"
            src={view.stream ? undefined : view.src}
            controls={video?.controls ?? true}
            autoPlay={video?.autoPlay}
            muted={video?.muted}
            loop={video?.loop}
            preload="metadata"
            aria-label={alt || undefined}
            {...playerEvents}
          />
        </>
      )}
      {view.kind === "document" && !viewerKind && (
        <>
          {view.still && (
            <img className="calmlens-asset__content" src={view.still} alt={alt} decoding="async" />
          )}
          <a
            className="calmlens-button calmlens-asset__open"
            href={view.src}
            target="_blank"
            rel="noopener noreferrer"
          >
            {messages.openDocument}
          </a>
        </>
      )}
      {/* The viewer owns this element's children; React renders none. */}
      {viewerKind && <div ref={viewerRoot} className="calmlens-asset__viewer" />}
      {view.kind === "file" && (
        <span
          className="calmlens-asset__file"
          role="img"
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : "true"}
          dangerouslySetInnerHTML={{
            __html: renderFileIconSvg({ family: view.icon, extension: "" }, ASSET_FILE_ICON_SIZE),
          }}
        />
      )}
      {view.kind === "age-restricted" &&
        (renderAgeGate ? (
          renderAgeGate({ placeholderUrl: view.placeholderUrl, confirm })
        ) : (
          <figcaption className="calmlens-asset__notice">
            <strong>{messages.sensitiveTitle}</strong>
            <p>{messages.sensitiveBody}</p>
            {confirm && (
              <button type="button" className="calmlens-button" onClick={confirm}>
                {messages.reveal}
              </button>
            )}
          </figcaption>
        ))}
      {view.kind === "unavailable" &&
        (renderUnavailable ? (
          renderUnavailable()
        ) : (
          <figcaption className="calmlens-asset__notice">
            <p>
              <Icon name="unavailable" />
              <span className="calmlens-asset__label">{messages.unavailable}</span>
            </p>
          </figcaption>
        ))}
    </figure>
  );
}
