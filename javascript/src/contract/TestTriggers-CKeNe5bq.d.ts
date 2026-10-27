import { n as ClassificationCategory } from "./Classification-DNcRatgW.js";
import * as z from "zod";
type ClassificationTestSignal = ClassificationCategory | "sexual.involving-minors" | "violence.graphic" | "harassment.insult" | "sexual.adult" | "hate.regional-symbol";
/** A project's test input key: 32 hexadecimal characters only its members can see. */
declare const TEST_INPUT_KEY_PATTERN: RegExp;
/** Category shortcuts are presets in the same instance-based format. */
declare function testInputForSignal(signal: ClassificationTestSignal, kind?: "image" | "text"): TestInput;
declare const getImageTestCategories: () => ClassificationTestSignal[];
/** Each row is one qualifying instance. Unselected qualifiers are explicitly absent. */
declare const TEST_INPUT_SCHEMA: z.ZodObject<{
  unassessedCategories: z.ZodOptional<z.ZodArray<z.ZodEnum<{
    "criminal-activity": "criminal-activity";
    harassment: "harassment";
    hate: "hate";
    "personal-information": "personal-information";
    profanity: "profanity";
    "self-harm": "self-harm";
    sexual: "sexual";
    violence: "violence";
  }>>>;
  instances: z.ZodArray<z.ZodObject<{
    category: z.ZodEnum<{
      "criminal-activity": "criminal-activity";
      harassment: "harassment";
      hate: "hate";
      "personal-information": "personal-information";
      profanity: "profanity";
      "self-harm": "self-harm";
      sexual: "sexual";
      violence: "violence";
    }>;
    score: z.ZodOptional<z.ZodNumber>;
    qualifiers: z.ZodArray<z.ZodEnum<{
      "criminal-activity-alcohol": "criminal-activity-alcohol";
      "criminal-activity-csam": "criminal-activity-csam";
      "criminal-activity-demonstration": "criminal-activity-demonstration";
      "criminal-activity-discussion": "criminal-activity-discussion";
      "criminal-activity-documentary": "criminal-activity-documentary";
      "criminal-activity-educational": "criminal-activity-educational";
      "criminal-activity-fictional": "criminal-activity-fictional";
      "criminal-activity-fraud": "criminal-activity-fraud";
      "criminal-activity-gambling": "criminal-activity-gambling";
      "criminal-activity-graffiti": "criminal-activity-graffiti";
      "criminal-activity-grooming": "criminal-activity-grooming";
      "criminal-activity-historical": "criminal-activity-historical";
      "criminal-activity-instructions": "criminal-activity-instructions";
      "criminal-activity-preparation": "criminal-activity-preparation";
      "criminal-activity-promotion": "criminal-activity-promotion";
      "criminal-activity-request": "criminal-activity-request";
      "criminal-activity-sexual-solicitation": "criminal-activity-sexual-solicitation";
      "criminal-activity-substances": "criminal-activity-substances";
      "criminal-activity-support-prevention": "criminal-activity-support-prevention";
      "criminal-activity-tobacco": "criminal-activity-tobacco";
      "harassment-abuse": "harassment-abuse";
      "harassment-bullying": "harassment-bullying";
      "harassment-documentary": "harassment-documentary";
      "harassment-educational": "harassment-educational";
      "harassment-encouragement": "harassment-encouragement";
      "harassment-fictional": "harassment-fictional";
      "harassment-historical": "harassment-historical";
      "harassment-mild": "harassment-mild";
      "harassment-public-target": "harassment-public-target";
      "harassment-sexual": "harassment-sexual";
      "harassment-support-prevention": "harassment-support-prevention";
      "harassment-threat": "harassment-threat";
      "hate-abuse": "hate-abuse";
      "hate-adjudicated-nazi-crimes-denial": "hate-adjudicated-nazi-crimes-denial";
      "hate-counterspeech": "hate-counterspeech";
      "hate-dehumanization": "hate-dehumanization";
      "hate-documentary": "hate-documentary";
      "hate-educational": "hate-educational";
      "hate-exclusion": "hate-exclusion";
      "hate-fictional": "hate-fictional";
      "hate-historical": "hate-historical";
      "hate-hostility": "hate-hostility";
      "hate-inferiority": "hate-inferiority";
      "hate-nazi-genocide-denial-or-approval": "hate-nazi-genocide-denial-or-approval";
      "hate-nazi-genocide-public-peace": "hate-nazi-genocide-public-peace";
      "hate-nazi-insignia-public-display": "hate-nazi-insignia-public-display";
      "hate-nazi-symbols-public-display": "hate-nazi-symbols-public-display";
      "hate-personal": "hate-personal";
      "hate-slurs": "hate-slurs";
      "hate-support-prevention": "hate-support-prevention";
      "hate-symbol": "hate-symbol";
      "hate-threat": "hate-threat";
      "personal-information-contact": "personal-information-contact";
      "personal-information-credentials": "personal-information-credentials";
      "personal-information-documentary": "personal-information-documentary";
      "personal-information-educational": "personal-information-educational";
      "personal-information-email": "personal-information-email";
      "personal-information-fictional": "personal-information-fictional";
      "personal-information-financial": "personal-information-financial";
      "personal-information-government-id": "personal-information-government-id";
      "personal-information-historical": "personal-information-historical";
      "personal-information-identifiers": "personal-information-identifiers";
      "personal-information-location": "personal-information-location";
      "personal-information-phone": "personal-information-phone";
      "personal-information-request": "personal-information-request";
      "personal-information-self-disclosure": "personal-information-self-disclosure";
      "personal-information-support-prevention": "personal-information-support-prevention";
      "personal-information-third-party": "personal-information-third-party";
      "profanity-documentary": "profanity-documentary";
      "profanity-educational": "profanity-educational";
      "profanity-fictional": "profanity-fictional";
      "profanity-historical": "profanity-historical";
      "profanity-mild": "profanity-mild";
      "profanity-obfuscated": "profanity-obfuscated";
      "profanity-slurs": "profanity-slurs";
      "profanity-strong": "profanity-strong";
      "profanity-support-prevention": "profanity-support-prevention";
      "self-harm-act": "self-harm-act";
      "self-harm-age-restricted": "self-harm-age-restricted";
      "self-harm-documentary": "self-harm-documentary";
      "self-harm-educational": "self-harm-educational";
      "self-harm-encouragement": "self-harm-encouragement";
      "self-harm-fictional": "self-harm-fictional";
      "self-harm-historical": "self-harm-historical";
      "self-harm-methods": "self-harm-methods";
      "self-harm-preparation": "self-harm-preparation";
      "self-harm-support-prevention": "self-harm-support-prevention";
      "self-harm-thoughts": "self-harm-thoughts";
      "sexual-activity": "sexual-activity";
      "sexual-adult-promotion": "sexual-adult-promotion";
      "sexual-assault-media": "sexual-assault-media";
      "sexual-discussion": "sexual-discussion";
      "sexual-documentary": "sexual-documentary";
      "sexual-educational": "sexual-educational";
      "sexual-explicit-language": "sexual-explicit-language";
      "sexual-extreme": "sexual-extreme";
      "sexual-fictional": "sexual-fictional";
      "sexual-historical": "sexual-historical";
      "sexual-intimate-image-abuse": "sexual-intimate-image-abuse";
      "sexual-minors": "sexual-minors";
      "sexual-non-consensual": "sexual-non-consensual";
      "sexual-non-erotic-nudity": "sexual-non-erotic-nudity";
      "sexual-nudity": "sexual-nudity";
      "sexual-pornographic-media": "sexual-pornographic-media";
      "sexual-revealing-clothing": "sexual-revealing-clothing";
      "sexual-solicitation": "sexual-solicitation";
      "sexual-suggestive": "sexual-suggestive";
      "sexual-support-prevention": "sexual-support-prevention";
      "sexual-text": "sexual-text";
      "violence-attack": "violence-attack";
      "violence-decapitation-act": "violence-decapitation-act";
      "violence-discussion": "violence-discussion";
      "violence-documentary": "violence-documentary";
      "violence-educational": "violence-educational";
      "violence-encouragement": "violence-encouragement";
      "violence-extremism": "violence-extremism";
      "violence-fantasy": "violence-fantasy";
      "violence-fictional": "violence-fictional";
      "violence-gore": "violence-gore";
      "violence-graphic": "violence-graphic";
      "violence-high-impact": "violence-high-impact";
      "violence-historical": "violence-historical";
      "violence-injury": "violence-injury";
      "violence-natural-death": "violence-natural-death";
      "violence-preparation": "violence-preparation";
      "violence-sport": "violence-sport";
      "violence-support-prevention": "violence-support-prevention";
      "violence-text": "violence-text";
      "violence-threat": "violence-threat";
      "violence-violent-death": "violence-violent-death";
      "violence-weapon": "violence-weapon";
      "violence-wish": "violence-wish";
    }>>;
  }, z.core.$strict>>;
}, z.core.$strict>;
type TestInput = z.infer<typeof TEST_INPUT_SCHEMA>;
declare const TEST_INPUT_PRESETS: {
  clean: {
    instances: never[];
  };
  limited: {
    instances: {
      category: "harassment";
      qualifiers: "harassment-abuse"[];
    }[];
  };
  adultImage: {
    instances: {
      category: "sexual";
      qualifiers: "sexual-pornographic-media"[];
    }[];
  };
  adultText: {
    instances: {
      category: "sexual";
      qualifiers: "sexual-explicit-language"[];
    }[];
  };
  germany: {
    instances: {
      category: "hate";
      qualifiers: ("hate-nazi-symbols-public-display" | "hate-symbol")[];
    }[];
  };
  mixed: {
    instances: ({
      category: "harassment";
      qualifiers: ("harassment-abuse" | "harassment-documentary")[];
    } | {
      category: "harassment";
      qualifiers: "harassment-threat"[];
    })[];
  };
};
declare function generateTestTextCode(scenario: TestInput | ClassificationTestSignal, key: string): Promise<string>;
declare function detectTestTrigger(text: string, key: string): Promise<TestInput | undefined>;
/** Lossless PNG grid: magic, length, then authenticated scenario bytes, one byte per 4px cell. */
declare function paintTestImage(scenario: TestInput | ClassificationTestSignal, key: string): Promise<{
  width: number;
  height: number;
  rgba: Uint8Array<ArrayBuffer>;
}>;
declare function detectTestImage(image: {
  width: number;
  height: number;
  rgba: Uint8Array;
}, key: string): Promise<{
  unassessedCategories?: ("criminal-activity" | "harassment" | "hate" | "personal-information" | "profanity" | "self-harm" | "sexual" | "violence")[] | undefined;
  instances: {
    category: "criminal-activity" | "harassment" | "hate" | "personal-information" | "profanity" | "self-harm" | "sexual" | "violence";
    score?: number | undefined;
    qualifiers: ("criminal-activity-alcohol" | "criminal-activity-csam" | "criminal-activity-demonstration" | "criminal-activity-discussion" | "criminal-activity-documentary" | "criminal-activity-educational" | "criminal-activity-fictional" | "criminal-activity-fraud" | "criminal-activity-gambling" | "criminal-activity-graffiti" | "criminal-activity-grooming" | "criminal-activity-historical" | "criminal-activity-instructions" | "criminal-activity-preparation" | "criminal-activity-promotion" | "criminal-activity-request" | "criminal-activity-sexual-solicitation" | "criminal-activity-substances" | "criminal-activity-support-prevention" | "criminal-activity-tobacco" | "harassment-abuse" | "harassment-bullying" | "harassment-documentary" | "harassment-educational" | "harassment-encouragement" | "harassment-fictional" | "harassment-historical" | "harassment-mild" | "harassment-public-target" | "harassment-sexual" | "harassment-support-prevention" | "harassment-threat" | "hate-abuse" | "hate-adjudicated-nazi-crimes-denial" | "hate-counterspeech" | "hate-dehumanization" | "hate-documentary" | "hate-educational" | "hate-exclusion" | "hate-fictional" | "hate-historical" | "hate-hostility" | "hate-inferiority" | "hate-nazi-genocide-denial-or-approval" | "hate-nazi-genocide-public-peace" | "hate-nazi-insignia-public-display" | "hate-nazi-symbols-public-display" | "hate-personal" | "hate-slurs" | "hate-support-prevention" | "hate-symbol" | "hate-threat" | "personal-information-contact" | "personal-information-credentials" | "personal-information-documentary" | "personal-information-educational" | "personal-information-email" | "personal-information-fictional" | "personal-information-financial" | "personal-information-government-id" | "personal-information-historical" | "personal-information-identifiers" | "personal-information-location" | "personal-information-phone" | "personal-information-request" | "personal-information-self-disclosure" | "personal-information-support-prevention" | "personal-information-third-party" | "profanity-documentary" | "profanity-educational" | "profanity-fictional" | "profanity-historical" | "profanity-mild" | "profanity-obfuscated" | "profanity-slurs" | "profanity-strong" | "profanity-support-prevention" | "self-harm-act" | "self-harm-age-restricted" | "self-harm-documentary" | "self-harm-educational" | "self-harm-encouragement" | "self-harm-fictional" | "self-harm-historical" | "self-harm-methods" | "self-harm-preparation" | "self-harm-support-prevention" | "self-harm-thoughts" | "sexual-activity" | "sexual-adult-promotion" | "sexual-assault-media" | "sexual-discussion" | "sexual-documentary" | "sexual-educational" | "sexual-explicit-language" | "sexual-extreme" | "sexual-fictional" | "sexual-historical" | "sexual-intimate-image-abuse" | "sexual-minors" | "sexual-non-consensual" | "sexual-non-erotic-nudity" | "sexual-nudity" | "sexual-pornographic-media" | "sexual-revealing-clothing" | "sexual-solicitation" | "sexual-suggestive" | "sexual-support-prevention" | "sexual-text" | "violence-attack" | "violence-decapitation-act" | "violence-discussion" | "violence-documentary" | "violence-educational" | "violence-encouragement" | "violence-extremism" | "violence-fantasy" | "violence-fictional" | "violence-gore" | "violence-graphic" | "violence-high-impact" | "violence-historical" | "violence-injury" | "violence-natural-death" | "violence-preparation" | "violence-sport" | "violence-support-prevention" | "violence-text" | "violence-threat" | "violence-violent-death" | "violence-weapon" | "violence-wish")[];
  }[];
} | undefined>;
export { detectTestImage as a, getImageTestCategories as c, TestInput as i, paintTestImage as l, TEST_INPUT_KEY_PATTERN as n, detectTestTrigger as o, TEST_INPUT_PRESETS as r, generateTestTextCode as s, ClassificationTestSignal as t, testInputForSignal as u };