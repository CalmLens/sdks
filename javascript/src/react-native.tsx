// React Native components for uploads and assets: `CalmLensUploader`, `CalmLensAsset` and the
// `useCalmLensUpload` hook for your own upload UI. They render the same upload queue, messages and
// asset states as the web components, with React Native's own views and no native modules.

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  type LayoutChangeEvent,
  Linking,
  PixelRatio,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { appendAssetLocation } from "./client/CalmLensCdn";
import {
  type AssetOptions,
  AssetSession,
  getAssetAspectRatio,
  getAssetView,
  getAssetViewKey,
  type MediaPlayback,
  pickAssetSource,
} from "./ui/Asset";
import { FILE_ICON_COLORS, getFileIcon, getFileIconLabel } from "./ui/FileIcons";
import {
  describeUploader,
  describeUploadItem,
  formatMessage,
  resolveMessages,
} from "./ui/Messages";
import type { AssetDisplayOptions, AssetEventHandlers, UploaderProps } from "./ui/Props";
import { useOwnController, useUploadSnapshot } from "./ui/ReactUpload";
import { type CalmLensTheme, resolveTheme } from "./ui/Theme";
import type { UploadFile, UploadItem } from "./ui/UploadController";

// Not `./ui`: its stream player loads hls.js, which native players never need.
export * from "./ui/Core";
export {
  CalmLensProvider,
  type CalmLensProviderProps,
  type UseCalmLensUploadResult,
  useCalmLensUpload,
} from "./ui/ReactUpload";

/** What the uploader asks your picker for. */
export interface PickRequest {
  /** Whether the uploader takes more than one file. */
  multiple: boolean;
  /** The uploader's `accept` list, such as `image/*`, to limit the picker to those types. */
  accept?: string;
}

/**
 * Opens your app's picker and resolves with the picked files: `File`s from `expo-file-system`,
 * or anything with a name, MIME type, size, `uri` and `arrayBuffer()`. Resolve with none when the
 * person cancels.
 */
export type PickFiles<F extends UploadFile = UploadFile> = (
  request: PickRequest,
) => Promise<readonly F[] | null | undefined>;

type ThemeOptions = {
  /** Colours and corner radius; anything left out keeps the default. */
  theme?: Partial<CalmLensTheme>;
};

export type CalmLensUploaderProps<F extends UploadFile = UploadFile> = Omit<
  UploaderProps<F>,
  "capture"
> &
  ThemeOptions & {
    pick: PickFiles<F>;
    style?: StyleProp<ViewStyle>;
  };

const createUploaderStyles = (theme: CalmLensTheme) =>
  StyleSheet.create({
    uploader: { gap: 12 },
    picker: {
      alignItems: "center",
      gap: 12,
      paddingVertical: 28,
      paddingHorizontal: 20,
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: theme.border,
      borderRadius: theme.radius,
      backgroundColor: theme.surface,
    },
    hint: { fontSize: 13, color: theme.muted },
    button: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
    },
    buttonText: { fontSize: 14, fontWeight: "500", color: theme.accentText },
    outlineButton: { backgroundColor: "transparent", borderColor: theme.border },
    outlineButtonText: { color: theme.text },
    smallButton: { paddingVertical: 4, paddingHorizontal: 10 },
    // Disabled controls are dashed and muted rather than faded, so their text stays readable.
    disabledButton: {
      backgroundColor: "transparent",
      borderStyle: "dashed",
      borderColor: theme.border,
    },
    disabledButtonText: { color: theme.muted },
    uploads: { gap: 8 },
    upload: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: theme.radius,
      backgroundColor: theme.background,
    },
    messageRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    // A finished file's outcome is a dot in its status colour before the message.
    outcomeDot: { width: 8, height: 8, borderRadius: 4 },
    accepted: { backgroundColor: theme.success },
    restricted: { backgroundColor: theme.warning },
    rejected: { backgroundColor: theme.danger },
    thumb: { width: 40, height: 40, borderRadius: 8, overflow: "hidden" },
    fileIcon: { alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
    fileIconLabel: { fontSize: 9, fontWeight: "700", fontFamily: "monospace" },
    body: { flex: 1, minWidth: 0, gap: 4 },
    name: { fontWeight: "500", color: theme.text },
    size: { fontSize: 13, color: theme.muted },
    message: { fontSize: 13, color: theme.text },
    progress: { height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: theme.border },
    progressBar: { height: "100%", borderRadius: 2, backgroundColor: theme.accent },
    actions: { flexDirection: "row", alignItems: "center", gap: 8 },
    iconButton: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
    },
    iconButtonText: { fontSize: 16, color: theme.text },
  });

/** The `testID` of the uploader's pick buttons, for end-to-end tests such as Detox or Maestro. */
export const CHOOSE_TEST_ID = "calmlens-choose";

type UploaderStyles = ReturnType<typeof createUploaderStyles>;

const Button = ({
  label,
  onPress,
  disabled,
  variant,
  size,
  styles,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "outline";
  size?: "small";
  styles: UploaderStyles;
  testID?: string;
}) => (
  <Pressable
    role="button"
    aria-label={label}
    testID={testID}
    disabled={disabled}
    onPress={onPress}
    style={[
      styles.button,
      variant === "outline" && styles.outlineButton,
      size === "small" && styles.smallButton,
      disabled && styles.disabledButton,
    ]}
  >
    <Text
      style={[
        styles.buttonText,
        variant === "outline" && styles.outlineButtonText,
        disabled && styles.disabledButtonText,
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

/** The file-type tile shown for files without an image preview, in the family's colour. */
const FileIcon = ({ file, styles }: { file: UploadFile; styles: UploaderStyles }) => {
  const { family, extension } = getFileIcon(file);
  const tint = FILE_ICON_COLORS[family];
  return (
    <View aria-hidden style={[styles.thumb, styles.fileIcon, { borderColor: tint }]}>
      <Text style={[styles.fileIconLabel, { color: tint }]}>
        {getFileIconLabel(extension).text}
      </Text>
    </View>
  );
};

const UploadRow = ({
  item,
  view,
  messages,
  styles,
  showChooseAnother,
  disabled,
  onChooseAnother,
  onRetry,
  onRemove,
}: {
  item: UploadItem;
  view: ReturnType<typeof describeUploadItem>;
  messages: ReturnType<typeof resolveMessages>;
  styles: UploaderStyles;
  showChooseAnother: boolean;
  disabled?: boolean;
  onChooseAnother: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) => (
  <View style={styles.upload}>
    {item.previewUrl ? (
      <Image
        source={{ uri: item.previewUrl }}
        aria-hidden
        blurRadius={view.outcome === "rejected" ? 6 : undefined}
        style={styles.thumb}
      />
    ) : (
      <FileIcon file={item.file} styles={styles} />
    )}
    <View style={styles.body}>
      <Text style={styles.name} numberOfLines={1}>
        {item.file.name}
      </Text>
      <Text style={styles.size}>{view.size}</Text>
      {view.busy && (
        <View
          role="progressbar"
          aria-label={view.message}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.progressPercent}
          style={styles.progress}
        >
          {/* An unknown amount, while checking, shows a full bar. */}
          <View style={[styles.progressBar, { width: `${view.progressPercent ?? 100}%` }]} />
        </View>
      )}
      {view.message ? (
        <View style={styles.messageRow}>
          {view.outcome && <View aria-hidden style={[styles.outcomeDot, styles[view.outcome]]} />}
          <Text role="status" style={styles.message}>
            {view.message}
          </Text>
        </View>
      ) : null}
    </View>
    <View style={styles.actions}>
      {showChooseAnother && (
        <Button
          label={messages.chooseAnother}
          testID={CHOOSE_TEST_ID}
          variant="outline"
          size="small"
          disabled={disabled}
          onPress={onChooseAnother}
          styles={styles}
        />
      )}
      {view.canRetry && (
        <Pressable
          role="button"
          aria-label={messages.retry}
          onPress={onRetry}
          style={styles.iconButton}
        >
          <Text aria-hidden style={styles.iconButtonText}>
            ↻
          </Text>
        </Pressable>
      )}
      <Pressable
        role="button"
        aria-label={view.removeLabel}
        onPress={onRemove}
        style={styles.iconButton}
      >
        <Text aria-hidden style={styles.iconButtonText}>
          ✕
        </Text>
      </Pressable>
    </View>
  </View>
);

/**
 * A pick button and file list that uploads through an upload preset, shows each file's progress
 * and moderation decision, and reports finished uploads to `onUploaded`. `pick` opens your app's
 * picker, such as `expo-image-picker`.
 */
export function CalmLensUploader<F extends UploadFile = UploadFile>({
  pick,
  disabled,
  messages: overrides,
  controller: external,
  theme: themeOverrides,
  style,
  ...options
}: CalmLensUploaderProps<F>) {
  const own = useOwnController(options, !external);
  const upload = useUploadSnapshot(external ?? own);
  const { accept, multiple = false } = upload.controller.options;
  const messages = useMemo(() => resolveMessages(overrides), [overrides]);
  const styles = useMemo(
    () => createUploaderStyles(resolveTheme(themeOverrides)),
    [themeOverrides],
  );
  const view = describeUploader(upload, upload.controller.options, messages);

  const openPicker = async () => {
    if (disabled) return;
    const files = await pick({ multiple, accept });
    if (files?.length) upload.addFiles(files);
  };

  return (
    <View style={[styles.uploader, style]}>
      {view.showDropzone && (
        <View style={styles.picker}>
          <Button
            label={view.chooseLabel}
            testID={CHOOSE_TEST_ID}
            variant="outline"
            disabled={disabled}
            onPress={() => void openPicker()}
            styles={styles}
          />
          {view.hint && <Text style={styles.hint}>{view.hint}</Text>}
        </View>
      )}
      {upload.items.length > 0 && (
        <View style={styles.uploads}>
          {upload.items.map((item) => (
            <UploadRow
              key={item.key}
              item={item}
              view={describeUploadItem(item, messages)}
              messages={messages}
              styles={styles}
              showChooseAnother={!view.showDropzone}
              disabled={disabled}
              onChooseAnother={() => void openPicker()}
              onRetry={() => upload.retry(item.key)}
              onRemove={() => upload.remove(item.key)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/** A video or audio file or stream for your app's player to play. */
export interface MediaPlayerSource {
  kind: "video" | "audio";
  /**
   * What to play: the asset's adaptive stream (an HLS playlist, which AVPlayer and ExoPlayer play)
   * when it has one, or its rendered file, which plays in every browser and on phones. If the
   * stream fails, the component renders the player again with the file.
   */
  src: string;
  /**
   * Whether `src` is the HLS stream, for players that are told the source's type, such as
   * `expo-video`'s `contentType: "hls"`.
   */
  streaming: boolean;
  /** The preview still, if the asset has one: a video's poster or an audio waveform. */
  poster?: string;
  /** Audio's waveform peaks from 0 to 1, for drawing its progress. */
  peaks?: readonly number[];
  /** Describes the media, from the component's `alt`. */
  alt: string;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls: boolean;
  /** Where to resume after `onError` fetched a fresh asset URL, which is now `src`. */
  resumeFrom?: MediaPlayback;
  /**
   * Call when the player fails, with where it was. A stream gives way to the rendered file (with
   * `resumeFrom`); a file is retried once beneath a fresh asset URL from `onExpired`, and
   * otherwise, or when that fails too, the CDN decides between the unavailable and age notices.
   */
  onError: (playback?: MediaPlayback) => void;
  /** Call once the player has loaded `src`, so a later expiry can fetch a fresh URL again. */
  onLoad: () => void;
  onPlay?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
}

export type CalmLensAssetProps = Omit<AssetOptions, "document" | "spreadsheet"> &
  Omit<AssetDisplayOptions, "lazy" | "fetchPriority"> &
  AssetEventHandlers &
  ThemeOptions & {
    /**
     * Renders video and audio, which React Native has no built-in player for, such as `expo-video`.
     * Without it, video and audio show their preview still with a button that opens the file in
     * the device's player.
     */
    renderPlayer?: (source: MediaPlayerSource) => ReactNode;
    /** Replaces the unavailable notice. */
    renderUnavailable?: () => ReactNode;
    /** Replaces the age notice; call `confirm` from your own reveal button. */
    renderAgeGate?: (props: { placeholderUrl?: string; confirm?: () => void }) => ReactNode;
    style?: StyleProp<ViewStyle>;
  };

const assetStyles = StyleSheet.create({
  asset: { position: "relative", overflow: "hidden", minHeight: 160 },
  sized: { minHeight: 0 },
  fill: { ...StyleSheet.absoluteFill },
  notice: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 12,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  noticeTitle: { fontWeight: "600", color: "#fff", textAlign: "center" },
  noticeText: { color: "#fff", textAlign: "center" },
  revealButton: {
    marginTop: 4,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  revealText: { fontSize: 14, fontWeight: "500", color: "#111" },
  open: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  file: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  fileIcon: {
    width: 48,
    height: 60,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 8,
    borderWidth: 1.5,
    borderRadius: 6,
  },
  fileIconLabel: { fontSize: 11, fontWeight: "700", fontFamily: "monospace" },
});

type LoadState = "loading" | "loaded" | "error";

/**
 * Shows an asset from its asset URL (public, or signed by your server) with React Native's own
 * views: images at the width in `image.widths` that covers their measured size, over a blurred
 * placeholder; video and audio in `renderPlayer`'s player; and for documents, text, spreadsheets
 * and websites, their preview still with a button that opens them. It reads `{src}/info` once
 * mounted, unless `info` is given. Age-restricted content stays behind its placeholder and a
 * reveal button; content the CDN refuses shows the unavailable notice.
 */
export function CalmLensAsset(props: CalmLensAssetProps) {
  const {
    src,
    display,
    viewerClaims,
    info,
    image,
    video,
    onExpired,
    alt = "",
    fit = "contain",
    aspectRatio,
    messages: overrides,
    theme: themeOverrides,
    onLoad,
    onError,
    onAvailabilityChange,
    onAgeConfirmRequest,
    onPlay,
    onEnded,
    onTimeUpdate,
    renderPlayer,
    renderUnavailable,
    renderAgeGate,
    style,
  } = props;
  const options = { src, display, viewerClaims, info, image, video, onExpired };
  const messages = useMemo(() => resolveMessages(overrides), [overrides]);
  const theme = useMemo(() => resolveTheme(themeOverrides), [themeOverrides]);
  const [, setVersion] = useState(0);
  const [session] = useState(() => new AssetSession(() => setVersion((count) => count + 1)));
  const state = session.update(options);
  const view = getAssetView(options, state);
  const [layoutWidth, setLayoutWidth] = useState<number>();
  const callbacks = useRef({ onLoad, onError, onAvailabilityChange });
  callbacks.current = { onLoad, onError, onAvailabilityChange };
  useEffect(() => session.load());

  // What the component shows itself: an image, or the still of what it can't show (video and
  // audio without a player, documents, text, spreadsheets and websites), and what that opens.
  const base = state.src?.split("?", 1)[0];
  const previewUrl =
    base && state.info?.content?.preview
      ? appendAssetLocation(base, { resource: "preview", viewerClaims })
      : undefined;
  const playable = view.kind === "video" || view.kind === "audio";
  const shownImage =
    view.kind === "image" || view.kind === "website"
      ? pickAssetSource(view, layoutWidth)
      : undefined;
  const still =
    view.kind === "video" && !renderPlayer
      ? view.poster
      : view.kind === "audio" && !renderPlayer
        ? view.waveformUrl
        : view.kind === "document"
          ? view.still
          : view.kind === "text" || view.kind === "spreadsheet"
            ? previewUrl
            : undefined;
  const shown = shownImage ?? still;
  const opens =
    view.kind === "document"
      ? view.src
      : view.kind === "website"
        ? view.link
        : (view.kind === "text" || view.kind === "spreadsheet") && base
          ? appendAssetLocation(base, { resource: "original", viewerClaims })
          : playable && !renderPlayer
            ? view.src
            : undefined;
  const openLabel = playable ? messages.play : messages.open;
  const loadKey = shown ?? getAssetViewKey(view);
  const [load, setLoad] = useState<{ key: string; state: LoadState }>({
    key: loadKey,
    state: "loading",
  });
  const current = load.key === loadKey ? load.state : "loading";
  const [resumeFrom, setResumeFrom] = useState<MediaPlayback>();
  // The stream that failed, after which the rendered file plays.
  const [failedStream, setFailedStream] = useState<string>();
  useEffect(() => {
    if (current === "loaded") callbacks.current.onLoad?.();
    if (current === "error") callbacks.current.onError?.();
  }, [current]);
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

  const ratio = getAssetAspectRatio(view, state.info, aspectRatio);
  const placeholderUrl =
    "placeholderUrl" in view && (view.kind !== "image" || current !== "loaded")
      ? view.placeholderUrl
      : undefined;
  const streaming = playable && Boolean(view.stream) && view.stream !== failedStream;
  const player =
    playable && renderPlayer
      ? renderPlayer({
          kind: view.kind,
          src: streaming && view.stream ? view.stream : view.src,
          streaming,
          poster: view.kind === "video" ? view.poster : view.waveformUrl,
          peaks: view.kind === "audio" ? view.peaks : undefined,
          alt,
          autoPlay: video?.autoPlay,
          muted: video?.muted,
          loop: video?.loop,
          controls: video?.controls ?? true,
          resumeFrom,
          onError: (playback) => {
            const from = playback ?? { position: 0, playing: false };
            setResumeFrom(from);
            // A failed stream gives way to the rendered file; a failed file asks the CDN.
            if (streaming) setFailedStream(view.stream);
            else session.mediaFailed(from);
          },
          onLoad: () => {
            session.loaded();
            setLoad({ key: loadKey, state: "loaded" });
          },
          onPlay,
          onEnded,
          onTimeUpdate,
        })
      : undefined;

  return (
    <View
      onLayout={(event: LayoutChangeEvent) => {
        // The device's pixels, so a phone's sharper screen gets a large enough image.
        setLayoutWidth(PixelRatio.getPixelSizeForLayoutSize(event.nativeEvent.layout.width));
      }}
      aria-busy={view.kind === "pending" ? true : undefined}
      style={[
        assetStyles.asset,
        ratio !== undefined && [assetStyles.sized, { aspectRatio: ratio }],
        { backgroundColor: state.info?.content?.preview?.averageColor ?? theme.surface },
        style,
      ]}
    >
      {placeholderUrl && (
        <Image
          source={{ uri: placeholderUrl }}
          aria-hidden
          blurRadius={12}
          resizeMode={fit}
          style={assetStyles.fill}
        />
      )}
      {shown && (
        <Image
          key={loadKey}
          source={{ uri: shown }}
          aria-label={alt || undefined}
          accessible={Boolean(alt)}
          resizeMode={view.kind === "audio" ? "stretch" : fit}
          onLoad={() => {
            session.loaded();
            setLoad({ key: loadKey, state: "loaded" });
          }}
          onError={() => {
            if (shownImage) session.failed();
            else setLoad({ key: loadKey, state: "error" });
          }}
          style={[assetStyles.fill, { opacity: current === "loaded" ? 1 : 0 }]}
        />
      )}
      {player}
      {view.kind === "file" && (
        <View
          style={assetStyles.file}
          aria-label={alt || undefined}
          role={alt ? "img" : undefined}
          accessible={Boolean(alt)}
        >
          <View
            aria-hidden
            style={[assetStyles.fileIcon, { borderColor: FILE_ICON_COLORS[view.icon] }]}
          >
            <Text style={[assetStyles.fileIconLabel, { color: FILE_ICON_COLORS[view.icon] }]}>
              {getFileIconLabel("").text}
            </Text>
          </View>
        </View>
      )}
      {opens && view.kind !== "website" && (
        <View style={assetStyles.open}>
          <Pressable
            role="link"
            aria-label={openLabel}
            onPress={() => void Linking.openURL(opens)}
            style={assetStyles.revealButton}
          >
            <Text style={assetStyles.revealText}>{openLabel}</Text>
          </Pressable>
        </View>
      )}
      {view.kind === "website" && opens && (
        <Pressable
          role="link"
          aria-label={formatMessage(messages.openWebsite, { host: new URL(opens).host })}
          onPress={() => void Linking.openURL(opens)}
          style={[assetStyles.revealButton, { position: "absolute", top: 8, left: 8 }]}
        >
          <Text style={assetStyles.revealText}>
            {formatMessage(messages.openWebsite, { host: new URL(opens).host })}
          </Text>
        </Pressable>
      )}
      {view.kind === "age-restricted" &&
        (renderAgeGate ? (
          renderAgeGate({ placeholderUrl: view.placeholderUrl, confirm: onAgeConfirmRequest })
        ) : (
          <View style={assetStyles.notice}>
            <Text style={assetStyles.noticeTitle}>{messages.sensitiveTitle}</Text>
            <Text style={assetStyles.noticeText}>{messages.sensitiveBody}</Text>
            {onAgeConfirmRequest && (
              <Pressable
                role="button"
                aria-label={messages.reveal}
                onPress={onAgeConfirmRequest}
                style={assetStyles.revealButton}
              >
                <Text style={assetStyles.revealText}>{messages.reveal}</Text>
              </Pressable>
            )}
          </View>
        ))}
      {(view.kind === "unavailable" || current === "error") &&
        (renderUnavailable ? (
          renderUnavailable()
        ) : (
          <View style={[assetStyles.notice, { backgroundColor: theme.surface }]}>
            <Text style={{ color: theme.text }}>{messages.unavailable}</Text>
          </View>
        ))}
    </View>
  );
}
