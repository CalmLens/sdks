import type { UploadedAsset } from "@calmlens/sdk";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { type AgeCheck, requestAgeCheck } from "./src/ageCheck";
import {
  checkUpload,
  describeError,
  isConfigured,
  type PickedPhoto,
  uploadPhoto,
} from "./src/calmlens";

const POLL_INTERVAL_MS = 1_500;
const MAX_POLLS = 40;

type UploadState =
  | { step: "idle" }
  | { step: "uploading" }
  | { step: "checking"; asset: UploadedAsset; gaveUp: boolean }
  | { step: "done"; asset: UploadedAsset }
  | { step: "failed"; message: string; code?: string };

export default function App() {
  const [photo, setPhoto] = useState<PickedPhoto>();
  const [state, setState] = useState<UploadState>({ step: "idle" });
  // Kept for the session, so the person is asked once rather than for every photo.
  const [ageCheck, setAgeCheck] = useState<AgeCheck>();
  const [checkingAge, setCheckingAge] = useState(false);
  const run = useRef(0);

  useEffect(() => () => void run.current++, []);

  /** Checks an upload until CalmLens decides, or until MAX_POLLS checks. */
  const pollUntilDecided = async (asset: UploadedAsset, id: number) => {
    let latest = asset;
    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      // `status` is the moderation status: `pending` until CalmLens decides.
      if (latest.status !== "pending") break;
      setState({ step: "checking", asset: latest, gaveUp: false });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (run.current !== id) return;
      latest = await checkUpload(latest.id);
    }
    if (run.current !== id) return;
    const decided = latest.status !== "pending";
    setState(
      decided ? { step: "done", asset: latest } : { step: "checking", asset: latest, gaveUp: true },
    );
  };

  const pickAndUpload = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      // HEIC photos arrive as JPEG; JPEG and PNG files arrive unchanged.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      quality: 1,
    });
    if (result.canceled) return;
    const picked = result.assets[0];
    const type = picked.mimeType ?? "image/jpeg";
    const next = {
      uri: picked.uri,
      type,
      name: picked.fileName ?? `photo.${type.split("/")[1] ?? "jpg"}`,
    };
    setPhoto(next);
    const id = ++run.current;
    setState({ step: "uploading" });
    try {
      const asset = await uploadPhoto(next);
      if (run.current === id) await pollUntilDecided(asset, id);
    } catch (error) {
      if (run.current === id) setState({ step: "failed", ...describeError(error) });
    }
  };

  const checkAgain = async (asset: UploadedAsset) => {
    const id = ++run.current;
    try {
      await pollUntilDecided(await checkUpload(asset.id), id);
    } catch (error) {
      if (run.current === id) setState({ step: "failed", ...describeError(error) });
    }
  };

  const checkAge = async () => {
    setCheckingAge(true);
    try {
      setAgeCheck(await requestAgeCheck());
    } finally {
      setCheckingAge(false);
    }
  };

  // Age-restricted photos stay hidden until the person shares an age range of 18 or older.
  const hidden =
    state.step === "done" &&
    state.asset.status === "age-restricted" &&
    ageCheck?.result !== "adult";
  const busy = state.step === "uploading" || (state.step === "checking" && !state.gaveUp);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.content}>
          <Text style={styles.title} accessibilityRole="header">
            Calmsnap
          </Text>
          <Text style={styles.lead}>
            Photos upload straight from this phone to CalmLens through an upload preset. The app
            never sees an API key.
          </Text>

          <View style={styles.preview}>
            {photo && !hidden ? (
              <Image source={{ uri: photo.uri }} style={styles.image} resizeMode="contain" />
            ) : (
              <Text style={styles.placeholder}>
                {photo ? "Hidden: age restricted" : "No photo yet"}
              </Text>
            )}
          </View>

          <Result
            state={state}
            onCheckAgain={checkAgain}
            ageCheck={ageCheck}
            checkingAge={checkingAge}
            onCheckAge={checkAge}
          />

          {isConfigured ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={pickAndUpload}
              style={({ pressed }) => [
                styles.button,
                busy && styles.buttonBusy,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={[styles.buttonText, busy && styles.buttonTextBusy]}>
                {photo ? "Choose another photo" : "Choose a photo"}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.error}>
              Set EXPO_PUBLIC_CALMLENS_UPLOAD_PRESET_ID in .env.local, then restart Expo.
            </Text>
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Result({
  state,
  onCheckAgain,
  ageCheck,
  checkingAge,
  onCheckAge,
}: {
  state: UploadState;
  onCheckAgain: (asset: UploadedAsset) => void;
  ageCheck: AgeCheck | undefined;
  checkingAge: boolean;
  onCheckAge: () => void;
}) {
  switch (state.step) {
    case "idle":
      return null;
    case "uploading":
      return <Status tone="neutral" title="Uploading…" busy />;
    case "checking":
      return state.gaveUp ? (
        <Status
          tone="neutral"
          title="Still checking"
          detail="CalmLens hasn't decided yet. Check again in a moment."
          action={{ label: "Check again", onPress: () => onCheckAgain(state.asset) }}
        />
      ) : (
        <Status
          tone="neutral"
          title="Still checking…"
          detail="Uploaded. Waiting for the decision."
          busy
        />
      );
    case "done":
      switch (state.asset.status) {
        case "allowed":
          return <Status tone="good" title="Allowed" detail="This photo can be shown." />;
        case "limited":
          return (
            <Status
              tone="good"
              title="Limited"
              detail="This photo can be shown, but keep it out of recommendations."
            />
          );
        case "age-restricted":
          return <AgeRestricted ageCheck={ageCheck} checking={checkingAge} onCheck={onCheckAge} />;
        case "blocked":
          return (
            <Status tone="bad" title="Blocked" detail="This photo breaks the project's policy." />
          );
        case "purged":
          return (
            <Status
              tone="bad"
              title="Removed"
              detail="This photo breaks the project's policy and CalmLens deleted it."
            />
          );
      }
      return (
        <Status
          tone="neutral"
          title="Uploaded"
          detail="This preset doesn't show decisions to the app. Turn on “Show the decision to the uploader” to see them."
        />
      );
    case "failed":
      return <Status tone="bad" title="Upload failed" detail={state.message} code={state.code} />;
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
  if (checking) {
    return (
      <Status tone="neutral" title="Age restricted" detail="Asking for your age range…" busy />
    );
  }
  switch (ageCheck?.result) {
    case undefined:
      return (
        <Status
          tone="neutral"
          title="Age restricted"
          detail="This photo is only shown to adults. Share your age range from your Apple or Google account to see it. The app only learns whether you're 18 or older."
          action={ask}
        />
      );
    case "adult":
      return (
        <Status
          tone="good"
          title="Age restricted"
          detail={
            ageCheck.confirmed
              ? "Shown because your account confirms you're 18 or older."
              : "Shown because you declared that you're 18 or older."
          }
        />
      );
    case "minor":
      return (
        <Status
          tone="bad"
          title="Age restricted"
          detail="Your age range may be under 18, so this photo isn't shown."
        />
      );
    case "declined":
      return (
        <Status
          tone="bad"
          title="Age restricted"
          detail="You didn't share your age range, so this photo isn't shown."
          action={ask}
        />
      );
    case "verification-required":
      return (
        <Status
          tone="bad"
          title="Age restricted"
          detail="Google Play needs you to verify your age in the Play Store first. Then try again."
          action={ask}
        />
      );
    case "unavailable":
      return (
        <Status
          tone="bad"
          title="Age restricted"
          detail="This device can't share an age range. It needs iOS 26 or Android with Google Play, signed in to an account."
        />
      );
  }
}

function Status({
  tone,
  title,
  detail,
  code,
  busy,
  action,
}: {
  tone: "neutral" | "good" | "bad";
  title: string;
  detail?: string;
  code?: string;
  busy?: boolean;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={[styles.status, styles[tone]]} accessibilityLiveRegion="polite" accessible>
      <View style={styles.statusRow}>
        {busy ? <ActivityIndicator color="#1f2a37" /> : null}
        <Text style={styles.statusTitle}>{title}</Text>
      </View>
      {detail ? <Text style={styles.statusDetail}>{detail}</Text> : null}
      {code ? <Text style={styles.statusCode}>{code}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.link}>
          <Text style={styles.linkText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f6f7f9" },
  content: { flex: 1, padding: 20, gap: 16 },
  title: { fontSize: 32, fontWeight: "700", color: "#111827", marginTop: 8 },
  lead: { fontSize: 16, lineHeight: 22, color: "#374151" },
  preview: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  placeholder: { fontSize: 16, color: "#4b5563" },
  status: { borderRadius: 12, padding: 16, gap: 6, borderWidth: 1 },
  neutral: { backgroundColor: "#ffffff", borderColor: "#d1d5db" },
  good: { backgroundColor: "#ecfdf3", borderColor: "#34a853" },
  bad: { backgroundColor: "#fef2f2", borderColor: "#dc2626" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusTitle: { fontSize: 20, fontWeight: "700", color: "#111827" },
  statusDetail: { fontSize: 15, lineHeight: 21, color: "#1f2937" },
  statusCode: { fontSize: 13, fontFamily: "Menlo", color: "#374151" },
  link: { alignSelf: "flex-start", paddingVertical: 4 },
  linkText: { fontSize: 16, fontWeight: "600", color: "#1d4ed8" },
  button: {
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  buttonBusy: {
    backgroundColor: "#e5e7eb",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#6b7280",
  },
  buttonPressed: { backgroundColor: "#374151" },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
  buttonTextBusy: { color: "#374151" },
  error: { fontSize: 15, color: "#b91c1c" },
});
