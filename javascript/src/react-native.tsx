// React Native components for uploads and media: `CalmLensUploader`, `CalmLensMedia` and the
// `useCalmLensUpload` hook for your own upload UI. They render the same upload queue, messages and
// media states as the web components, with React Native's own views and no native modules.

import { type ReactNode, useMemo, useState } from "react";
import {
  Image,
  type LayoutChangeEvent,
  PixelRatio,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { FILE_ICON_COLORS, getFileIcon, getFileIconLabel } from "./ui/FileIcons";
import { getMediaState, type MediaOptions, pickMediaSource, resolveMediaProps } from "./ui/Media";
import { describeUploader, describeUploadItem, resolveMessages } from "./ui/Messages";
import {
  getMediaAspectRatio,
  getMediaLoadKey,
  type MediaDisplayOptions,
  type UploaderProps,
} from "./ui/Props";
import { useOwnController, useUploadSnapshot } from "./ui/ReactUpload";
import { type CalmLensTheme, resolveTheme } from "./ui/Theme";
import type { UploadFile, UploadItem } from "./ui/UploadController";

export * from "./ui";
export { type UseCalmLensUploadResult, useCalmLensUpload } from "./ui/ReactUpload";

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

/** A video or audio file for your app's player to play. */
export interface MediaPlayerSource {
  kind: "video" | "audio";
  /** The asset's original file. */
  src: string;
  /** Describes the media, from the component's `alt`. */
  alt: string;
}

export type CalmLensMediaProps = MediaOptions &
  Omit<MediaDisplayOptions, "sizes" | "lazy" | "fetchPriority" | "position" | "controls"> &
  ThemeOptions & {
    /**
     * Renders video and audio, which React Native has no built-in player for, such as `expo-video`.
     * Without it, video and audio assets show their placeholder.
     */
    renderPlayer?: (source: MediaPlayerSource) => ReactNode;
    style?: StyleProp<ViewStyle>;
  };

const mediaStyles = StyleSheet.create({
  media: { position: "relative", overflow: "hidden", minHeight: 160 },
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
});

type LoadState = "loading" | "loaded" | "error";

/**
 * Shows an asset from the CalmLens CDN, at the width in `widths` that covers its measured size,
 * with a blurred placeholder while it loads. Age-restricted assets stay behind the placeholder and
 * a reveal button until `ageConfirmed` is set; blocked and purged assets show an unavailable notice.
 */
export function CalmLensMedia(input: CalmLensMediaProps) {
  const {
    asset: _asset,
    projectId,
    assetId,
    status,
    ageConfirmed,
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
    averageColor,
    fit = "cover",
    messages: overrides,
    theme: themeOverrides,
    onReveal,
    renderPlayer,
    style,
  } = resolveMediaProps(input);
  const messages = useMemo(() => resolveMessages(overrides), [overrides]);
  const theme = useMemo(() => resolveTheme(themeOverrides), [themeOverrides]);
  const state = getMediaState({
    projectId,
    assetId,
    status,
    ageConfirmed,
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
  const [layoutWidth, setLayoutWidth] = useState<number>();
  const src = state.kind === "image" ? pickMediaSource(state, layoutWidth) : undefined;
  const loadKey = src ?? getMediaLoadKey(state);
  const [load, setLoad] = useState<{ key: string; state: LoadState }>({
    key: loadKey,
    state: "loading",
  });
  const current = load.key === loadKey ? load.state : "loading";

  const ratio = getMediaAspectRatio({ aspectRatio, width, height });
  const unavailable = state.kind === "unavailable" || current === "error";
  const placeholderUrl =
    state.kind === "audio" || state.kind === "unavailable" ? undefined : state.placeholderUrl;
  const showPlaceholder =
    placeholderUrl &&
    !unavailable &&
    (state.kind !== "image" || current !== "loaded") &&
    !(state.kind === "video" && renderPlayer);
  const player =
    (state.kind === "video" || state.kind === "audio") && !unavailable
      ? renderPlayer?.({ kind: state.kind, src: state.src, alt })
      : undefined;

  return (
    <View
      onLayout={(event: LayoutChangeEvent) => {
        // The device's pixels, so a phone's sharper screen gets a large enough image.
        setLayoutWidth(PixelRatio.getPixelSizeForLayoutSize(event.nativeEvent.layout.width));
      }}
      style={[
        mediaStyles.media,
        ratio !== undefined && [mediaStyles.sized, { aspectRatio: ratio }],
        { backgroundColor: averageColor ?? theme.surface },
        style,
      ]}
    >
      {showPlaceholder && (
        <Image
          source={{ uri: placeholderUrl }}
          aria-hidden
          blurRadius={12}
          resizeMode={fit}
          style={mediaStyles.fill}
        />
      )}
      {src && !unavailable && (
        <Image
          key={loadKey}
          source={{ uri: src }}
          aria-label={alt || undefined}
          accessible={Boolean(alt)}
          resizeMode={fit}
          onLoad={() => setLoad({ key: loadKey, state: "loaded" })}
          onError={() => setLoad({ key: loadKey, state: "error" })}
          style={[mediaStyles.fill, { opacity: current === "loaded" ? 1 : 0 }]}
        />
      )}
      {player}
      {state.kind === "gated" && (
        <View style={mediaStyles.notice}>
          <Text style={mediaStyles.noticeTitle}>{messages.sensitiveTitle}</Text>
          <Text style={mediaStyles.noticeText}>{messages.sensitiveBody}</Text>
          {onReveal && (
            <Pressable
              role="button"
              aria-label={messages.reveal}
              onPress={onReveal}
              style={mediaStyles.revealButton}
            >
              <Text style={mediaStyles.revealText}>{messages.reveal}</Text>
            </Pressable>
          )}
        </View>
      )}
      {unavailable && (
        <View style={[mediaStyles.notice, { backgroundColor: theme.surface }]}>
          <Text style={{ color: theme.text }}>{messages.unavailable}</Text>
        </View>
      )}
    </View>
  );
}
