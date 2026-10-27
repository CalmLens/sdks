import { type UploadItem, useCalmLensUpload } from "@calmlens/sdk/react-native";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { type AgeCheck, requestAgeCheck } from "./src/ageCheck";
import { describeError, isConfigured, pickPhoto, uploadOptions } from "./src/calmlens";
import { getOutcome, isBusy, photoOf } from "./src/uploads";

const colors = {
  page: "#f7f7f5",
  surface: "#ffffff",
  ink: "#17191c",
  soft: "#5b6168",
  line: "#e3e4e1",
  good: "#1f7a4d",
  warn: "#9a5b00",
  bad: "#b4232a",
};

export default function App() {
  // The SDK's upload queue: it uploads each photo with a new token, checks it until CalmLens
  // decides, and retries or checks again on request.
  const queue = useCalmLensUpload(uploadOptions);
  const uploads = [...queue.items].reverse();
  const [selectedKey, setSelectedKey] = useState<string>();
  // Kept for the session, so the person is asked once rather than for every photo.
  const [ageCheck, setAgeCheck] = useState<AgeCheck>();
  const [checkingAge, setCheckingAge] = useState(false);

  const pickAndUpload = async () => {
    const photo = await pickPhoto();
    if (!photo) return;
    // Make room in the queue by dropping the oldest photo.
    const oldest = queue.items[0];
    if (oldest && queue.items.length >= (uploadOptions.maxFiles ?? 10)) queue.remove(oldest.key);
    queue.addFiles([photo]);
    // Show the new photo.
    setSelectedKey(undefined);
  };

  const checkAge = async () => {
    setCheckingAge(true);
    try {
      setAgeCheck(await requestAgeCheck());
    } finally {
      setCheckingAge(false);
    }
  };

  const selected = uploads.find((item) => item.key === selectedKey) ?? uploads[0];

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <Text style={styles.brand} accessibilityRole="header">
            Calmsnap
          </Text>
          {isConfigured ? (
            <Pressable
              accessibilityRole="button"
              onPress={pickAndUpload}
              style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
            >
              <Text style={styles.newButtonText}>New photo</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {!isConfigured ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Not set up yet</Text>
              <Text style={styles.body}>
                Set EXPO_PUBLIC_CALMLENS_UPLOAD_PRESET_ID in .env.local, then restart Expo.
              </Text>
            </View>
          ) : selected ? (
            <Featured
              upload={selected}
              ageCheck={ageCheck}
              checkingAge={checkingAge}
              onCheckAge={checkAge}
              onRetry={() => queue.retry(selected.key)}
              onChooseAnother={pickAndUpload}
            />
          ) : (
            <View style={[styles.card, styles.empty]}>
              <Text style={styles.cardTitle}>Share a photo</Text>
              <Text style={[styles.body, styles.center]}>
                Pick one from your library. It's checked before anyone sees it.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={pickAndUpload}
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>Choose a photo</Text>
              </Pressable>
            </View>
          )}

          {uploads.length > 1 ? (
            <View style={styles.recent}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                Recent
              </Text>
              <View style={styles.list}>
                {uploads.map((item, index) => (
                  <RecentRow
                    key={item.key}
                    upload={item}
                    selected={item.key === selected?.key}
                    first={index === 0}
                    hidden={isHidden(item, ageCheck)}
                    onPress={() => setSelectedKey(item.key)}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/**
 * Whether the photo is covered: refused photos never show, and age-restricted ones stay hidden
 * until the person shares an age range of 18 or older.
 */
const isHidden = (upload: UploadItem, ageCheck: AgeCheck | undefined) => {
  const outcome = getOutcome(upload);
  return outcome === "refused" || (outcome === "age-restricted" && ageCheck?.result !== "adult");
};

function Featured({
  upload,
  ageCheck,
  checkingAge,
  onCheckAge,
  onRetry,
  onChooseAnother,
}: {
  upload: UploadItem;
  ageCheck: AgeCheck | undefined;
  checkingAge: boolean;
  onCheckAge: () => void;
  onRetry: () => void;
  onChooseAnother: () => void;
}) {
  const photo = photoOf(upload);
  const { width, height } = photo;
  // Portrait photos up to 4:5 and landscape ones up to 16:9 keep their shape.
  const aspectRatio = width && height ? Math.min(Math.max(width / height, 4 / 5), 16 / 9) : 1;
  const hidden = isHidden(upload, ageCheck);
  return (
    <View style={styles.card}>
      <View style={[styles.photoFrame, { aspectRatio }]}>
        <Image
          source={{ uri: photo.uri }}
          style={styles.photo}
          resizeMode="cover"
          blurRadius={hidden ? 40 : 0}
          accessibilityIgnoresInvertColors
        />
        {hidden ? <View style={[StyleSheet.absoluteFill, styles.veil]} /> : null}
      </View>
      <View style={styles.status}>
        <Status
          upload={upload}
          ageCheck={ageCheck}
          checkingAge={checkingAge}
          onCheckAge={onCheckAge}
          onRetry={onRetry}
          onChooseAnother={onChooseAnother}
        />
      </View>
    </View>
  );
}

function Status({
  upload,
  ageCheck,
  checkingAge,
  onCheckAge,
  onRetry,
  onChooseAnother,
}: {
  upload: UploadItem;
  ageCheck: AgeCheck | undefined;
  checkingAge: boolean;
  onCheckAge: () => void;
  onRetry: () => void;
  onChooseAnother: () => void;
}) {
  switch (getOutcome(upload)) {
    case "busy":
      if (upload.stage !== "checking") return <Line busy title="Uploading" />;
      return (
        <Line
          busy
          title="Checking photo"
          detail="Usually takes a few seconds. You can keep sharing meanwhile."
        />
      );
    case "stalled":
      return (
        <Line
          title="Still checking"
          detail="This is taking longer than usual."
          action={{ label: "Check again", onPress: onRetry }}
        />
      );
    case "shared":
      return <Line tone="good" title="Shared" detail="Visible to everyone." />;
    case "limited":
      return <Line tone="good" title="Shared" detail="Visible, but kept out of recommendations." />;
    case "age-restricted":
      return <AgeRestricted ageCheck={ageCheck} checking={checkingAge} onCheck={onCheckAge} />;
    case "refused":
      return (
        <Line
          tone="bad"
          title="Not allowed"
          detail={
            upload.status === "purged"
              ? "This photo breaks the community rules, so it wasn't shared and has been deleted."
              : "This photo breaks the community rules, so it wasn't shared."
          }
          action={{ label: "Choose another photo", onPress: onChooseAnother }}
        />
      );
    case "failed":
      return (
        <Line
          tone="bad"
          title="Upload failed"
          detail={describeError(upload.errorCode)}
          code={upload.errorCode}
          action={{ label: "Try again", onPress: onRetry }}
        />
      );
    case "unknown":
      return (
        <Line
          title="Uploaded"
          detail="This preset doesn't show decisions to the app. Turn on “Show the decision to the uploader” to see them."
        />
      );
  }
}

function AgeRestricted({
  ageCheck,
  checking,
  onCheck,
}: {
  ageCheck: AgeCheck | undefined;
  checking: boolean;
  onCheck: () => void;
}) {
  const ask = { label: "Share my age range", onPress: onCheck };
  if (checking) return <Line busy title="Adults only" detail="Asking for your age range…" />;
  switch (ageCheck?.result) {
    case undefined:
      return (
        <Line
          tone="warn"
          title="Adults only"
          detail="Share your age range from your Apple or Google account to see it. The app only learns whether you're 18 or older."
          action={ask}
        />
      );
    case "adult":
      return (
        <Line
          tone="good"
          title="Adults only"
          detail={
            ageCheck.confirmed
              ? "Shown because your account confirms you're 18 or older."
              : "Shown because you declared that you're 18 or older."
          }
        />
      );
    case "minor":
      return (
        <Line
          tone="warn"
          title="Adults only"
          detail="Your age range may be under 18, so this photo isn't shown."
        />
      );
    case "declined":
      return (
        <Line
          tone="warn"
          title="Adults only"
          detail="You didn't share your age range, so this photo isn't shown."
          action={ask}
        />
      );
    case "verification-required":
      return (
        <Line
          tone="warn"
          title="Adults only"
          detail="Google Play needs you to verify your age in the Play Store first. Then try again."
          action={ask}
        />
      );
    case "unavailable":
      return (
        <Line
          tone="warn"
          title="Adults only"
          detail="This device can't share an age range. It needs iOS 26 or Android with Google Play, signed in to an account."
        />
      );
  }
}

const toneColor = { neutral: colors.ink, good: colors.good, warn: colors.warn, bad: colors.bad };

function Line({
  tone = "neutral",
  title,
  detail,
  code,
  busy,
  action,
}: {
  tone?: keyof typeof toneColor;
  title: string;
  detail?: string;
  code?: string;
  busy?: boolean;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.statusBody} accessibilityLiveRegion="polite">
      <View style={styles.statusRow} accessible>
        {busy ? (
          <ActivityIndicator size="small" color={colors.soft} />
        ) : (
          <View style={[styles.dot, { backgroundColor: toneColor[tone] }]} />
        )}
        <Text style={[styles.statusTitle, { color: toneColor[tone] }]}>{title}</Text>
      </View>
      {detail ? <Text style={styles.body}>{detail}</Text> : null}
      {code ? <Text style={styles.code}>{code}</Text> : null}
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const rowLabel: Record<
  ReturnType<typeof getOutcome>,
  { text: string; hint: string; tone: keyof typeof toneColor }
> = {
  busy: { text: "Checking", hint: "Usually takes a few seconds", tone: "neutral" },
  stalled: { text: "Still checking", hint: "Tap to check again", tone: "neutral" },
  shared: { text: "Shared", hint: "Visible to everyone", tone: "good" },
  limited: { text: "Shared", hint: "Kept out of recommendations", tone: "good" },
  "age-restricted": { text: "Adults only", hint: "Shown to people 18 and over", tone: "warn" },
  refused: { text: "Not allowed", hint: "Breaks the community rules", tone: "bad" },
  failed: { text: "Upload failed", hint: "Tap to try again", tone: "bad" },
  unknown: { text: "Uploaded", hint: "No decision shown", tone: "neutral" },
};

function RecentRow({
  upload,
  selected,
  first,
  hidden,
  onPress,
}: {
  upload: UploadItem;
  selected: boolean;
  first: boolean;
  hidden: boolean;
  onPress: () => void;
}) {
  const photo = photoOf(upload);
  const label =
    upload.stage === "queued" || upload.stage === "uploading"
      ? { text: "Uploading", hint: "Sending your photo", tone: "neutral" as const }
      : rowLabel[getOutcome(upload)];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label.text}, ${label.hint}, ${timeAgo(photo.pickedAt)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && styles.rowDivider,
        selected && styles.rowSelected,
        pressed && styles.pressed,
      ]}
    >
      <Image source={{ uri: photo.uri }} style={styles.thumb} blurRadius={hidden ? 20 : 0} />
      <View style={styles.rowText}>
        <View style={styles.statusRow}>
          {isBusy(upload) ? (
            <ActivityIndicator size="small" color={colors.soft} />
          ) : (
            <View style={[styles.dot, { backgroundColor: toneColor[label.tone] }]} />
          )}
          <Text style={[styles.rowName, { color: toneColor[label.tone] }]}>{label.text}</Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {label.hint}
        </Text>
      </View>
      <Text style={styles.meta}>{timeAgo(photo.pickedAt)}</Text>
    </Pressable>
  );
}

const timeAgo = (at: number) => {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  brand: { fontSize: 26, fontWeight: "700", color: colors.ink, letterSpacing: -0.3 },
  newButton: {
    backgroundColor: colors.ink,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  newButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
  },
  empty: { alignItems: "center", padding: 28, gap: 10 },
  cardTitle: { fontSize: 19, fontWeight: "700", color: colors.ink },
  center: { textAlign: "center" },
  photoFrame: { width: "100%", backgroundColor: "#e9eae7" },
  photo: { width: "100%", height: "100%" },
  veil: { backgroundColor: "rgba(23,25,28,0.18)" },
  status: { padding: 16 },
  statusBody: { gap: 6 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusTitle: { fontSize: 17, fontWeight: "700", color: colors.ink, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  body: { fontSize: 15, lineHeight: 21, color: colors.soft },
  meta: { fontSize: 13, color: colors.soft },
  code: { fontSize: 12, fontFamily: "Menlo", color: colors.soft },
  primary: {
    marginTop: 6,
    backgroundColor: colors.ink,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 22,
  },
  primaryText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  secondary: {
    alignSelf: "flex-start",
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  secondaryText: { fontSize: 15, fontWeight: "600", color: colors.ink },
  pressed: { opacity: 0.85 },
  recent: { gap: 10 },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: colors.ink, paddingHorizontal: 4 },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowSelected: { backgroundColor: "#f1f3f9" },
  thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.line },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontWeight: "600", color: colors.ink },
});
