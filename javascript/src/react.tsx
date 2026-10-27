"use client";
// React components for uploads and media: `CalmLensUploader`, `CalmLensMedia` and the
// `useCalmLensUpload` hook for your own upload UI. They also work in Preact through
// `preact/compat`.

import {
  type CSSProperties,
  type DragEvent,
  type HTMLAttributes,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  UploadControllerOptions,
  UploaderProps,
  UseCalmLensUploadResult,
} from "./ui/BrowserUpload";
import { ICON_ATTRIBUTES, ICONS, type IconName } from "./ui/Icons";
import { getMediaState, resolveMediaProps } from "./ui/Media";
import { describeUploader, describeUploadItem, resolveMessages } from "./ui/Messages";
import { getMediaAspectRatio, getMediaLoadKey, type MediaProps } from "./ui/Props";
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

export type CalmLensMediaProps = MediaProps &
  StyleOptions &
  Omit<HTMLAttributes<HTMLElement>, "children" | "placeholder">;

type LoadState = "loading" | "loaded" | "error";

/**
 * Shows an asset from the CalmLens CDN with responsive widths and a blurred placeholder while
 * it loads. Age-restricted assets stay behind the placeholder and a reveal button until
 * `canView` is set; blocked and purged assets show an unavailable notice.
 */
export function CalmLensMedia(input: CalmLensMediaProps) {
  const {
    asset: _asset,
    projectId,
    assetId,
    status,
    canView,
    type,
    resource,
    lens,
    transform,
    widths,
    url,
    placeholder,
    placeholderHash,
    placeholderUrl: customPlaceholderUrl,
    cdnBaseUrl,
    region,
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
    unstyled,
    onReveal,
    className,
    style,
    ...attributes
  } = resolveMediaProps(input);
  const messages = useMemo(() => resolveMessages(overrides), [overrides]);
  const state = getMediaState({
    projectId,
    assetId,
    status,
    canView,
    type,
    resource,
    lens,
    transform,
    widths,
    url,
    placeholder,
    placeholderHash,
    placeholderUrl: customPlaceholderUrl,
    cdnBaseUrl,
    region,
  });
  const loadKey = getMediaLoadKey(state);
  const [load, setLoad] = useState<{ key: string; state: LoadState }>({
    key: loadKey,
    state: "loading",
  });
  const current = load.key === loadKey ? load : { key: loadKey, state: "loading" as const };
  const image = useRef<HTMLImageElement>(null);

  // An image that loaded before hydration fires no load event.
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth > 0) {
      setLoad({ key: loadKey, state: "loaded" });
    }
  }, [loadKey]);

  const ratio = getMediaAspectRatio({ aspectRatio, width, height });
  const kind = current.state === "error" ? "unavailable" : state.kind;
  const placeholderUrl =
    state.kind === "audio" || state.kind === "unavailable" ? undefined : state.placeholderUrl;
  const showPlaceholder =
    placeholderUrl &&
    (state.kind === "gated" || (state.kind === "image" && current.state !== "loaded"));

  return (
    <figure
      {...attributes}
      className={joinClassNames("calmlens-media", className)}
      data-kind={state.kind}
      data-state={current.state}
      data-sized={ratio ? "" : undefined}
      style={
        {
          aspectRatio: ratio,
          backgroundColor: averageColor,
          "--calmlens-fit": fit,
          "--calmlens-position": position,
          ...style,
        } as CSSProperties
      }
    >
      <CalmLensStyles unstyled={unstyled} />
      {showPlaceholder && (
        <img
          className="calmlens-media__placeholder"
          src={placeholderUrl}
          alt=""
          aria-hidden="true"
        />
      )}
      {state.kind === "image" && current.state !== "error" && (
        <img
          key={loadKey}
          ref={image}
          className="calmlens-media__content"
          src={state.src}
          srcSet={state.srcSet}
          sizes={sizes}
          alt={alt}
          width={width}
          height={height}
          loading={lazy ? "lazy" : undefined}
          decoding="async"
          fetchPriority={fetchPriority}
          onLoad={() => setLoad({ key: loadKey, state: "loaded" })}
          onError={() => setLoad({ key: loadKey, state: "error" })}
        />
      )}
      {state.kind === "video" && current.state !== "error" && (
        // biome-ignore lint/a11y/useMediaCaption: captions come from your app, as <track> children are not supported here
        <video
          className="calmlens-media__content"
          src={state.src}
          controls={controls}
          playsInline
          preload="metadata"
          aria-label={alt || undefined}
          onError={() => setLoad({ key: loadKey, state: "error" })}
        />
      )}
      {state.kind === "audio" && current.state !== "error" && (
        // biome-ignore lint/a11y/useMediaCaption: audio has no captions track to add here
        <audio
          className="calmlens-media__content"
          src={state.src}
          controls={controls}
          preload="metadata"
          aria-label={alt || undefined}
          onError={() => setLoad({ key: loadKey, state: "error" })}
        />
      )}
      {state.kind === "gated" && (
        <figcaption className="calmlens-media__notice">
          <strong>{messages.sensitiveTitle}</strong>
          <p>{messages.sensitiveBody}</p>
          {onReveal && (
            <button type="button" className="calmlens-button" onClick={onReveal}>
              {messages.reveal}
            </button>
          )}
        </figcaption>
      )}
      {kind === "unavailable" && (
        <figcaption className="calmlens-media__notice">
          <p>
            <Icon name="unavailable" />
            <span className="calmlens-media__label">{messages.unavailable}</span>
          </p>
        </figcaption>
      )}
    </figure>
  );
}
