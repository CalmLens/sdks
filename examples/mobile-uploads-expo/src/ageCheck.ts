import { Platform } from "react-native";

const ADULT_AGE = 18;

export type AgeCheck =
  /** The person shared an age range that starts at 18 or older. */
  | { result: "adult"; confirmed: boolean }
  /** The person shared an age range that may be under 18. */
  | { result: "minor" }
  /** The person chose not to share their age range. */
  | { result: "declined" }
  /** Google Play needs the person to verify their age in the Play Store first. */
  | { result: "verification-required" }
  /** This device can't share an age range: an older OS, no store account, or the web. */
  | { result: "unavailable" };

/**
 * Below iOS 26 and on the web, expo-age-range answers as if the person were an adult, so this
 * example only asks where the OS can really answer.
 */
const canAskTheOs = () =>
  Platform.OS === "android" ||
  (Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26);

/**
 * Asks the OS for the person's age range. The OS shows its own consent prompt (the Play Age
 * Signals screen on Android, the Declared Age Range sheet on iOS), and the app only learns the
 * range if the person agrees to share it.
 */
export const requestAgeCheck = async (): Promise<AgeCheck> => {
  if (!canAskTheOs()) return { result: "unavailable" };
  try {
    // Loaded on first use: Expo Go doesn't include this native module, so the app still starts
    // there and the check answers `unavailable`. Development and store builds include it.
    const AgeRange = await import("expo-age-range");
    // Android only: Play shows its consent screen. Resolves null on iOS.
    const access = await AgeRange.requestAgeSignalsAccessAsync();
    if (access === "NOT_SHARED") return { result: "declined" };
    if (access === "VERIFICATION_REQUIRED") return { result: "verification-required" };

    // On iOS the consent sheet is part of this call. One gate at 18 is all this app needs.
    const range = await AgeRange.requestAgeRangeAsync({ threshold1: ADULT_AGE });
    if (range.lowerBound === null && range.upperBound === null) return { result: "unavailable" };
    if ((range.lowerBound ?? 0) < ADULT_AGE) return { result: "minor" };
    return {
      result: "adult",
      // Confirmed by Apple, or checked by Google with a card, ID, selfie or digital ID rather
      // than typed in by the person. Require this where the law asks for a verified age.
      confirmed:
        range.ageRangeDeclaration === "confirmed" ||
        range.ageRangeSource === "TIER_C" ||
        range.ageRangeSource === "TIER_D",
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_AGE_RANGE_USER_DECLINED" || code === "ERR_AGE_RANGE_TASK_CANCELLED") {
      return { result: "declined" };
    }
    return { result: "unavailable" };
  }
};
