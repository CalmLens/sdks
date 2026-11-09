import { a as primaryIdField, c as createMetaType, l as metaStore, n as idField, o as backfill, s as updatedAt, t as EXAMPLE_IDS } from "./Ids-BESMSxGb.js";
import { t as CLASSIFICATION_CATEGORIES } from "./ModerationCategories-CHFRoeWV.js";
import "./Media-B2PMcUf7.js";
import { a as countModerationContextCharacters, n as MODERATION_CONTEXT_MAX_ITEM_CHARACTERS, r as MODERATION_CONTEXT_USED_CHARACTERS, t as MODERATION_CONTEXT_MAX_CHARACTERS } from "./ModerationContextLimits-BIMUlk2e.js";
import "./SharedConstants-DxUCZwLZ.js";
import { t as hmacSha256Hex } from "./CryptoUtils-B_x8lMIx.js";
import { i as msg, n as MODERATION_QUALIFIERS, t as TEST_REGIONAL_ACTIONS_SCHEMA } from "./TestRegionalActions-JvK0VrLT.js";
import { n as JURISDICTION_SCHEMA, r as SERVED_JURISDICTIONS_SCHEMA } from "./Jurisdiction-CtB_d_2M.js";
import { n as GRANTS_SCHEMA, t as ACCESS_ROLE_SCHEMA } from "./Permissions-DPNlE8m-.js";
import * as zod from "zod";
// packages/shared/src/DocMetaTypes.ts
const docPropertyInfo = createMetaType({ id: "docPropertyInfo" });
const ACTOR_TYPE_SCHEMA = zod.enum([
	"user",
	"api-key",
	"automated",
	"system"
]);
const ACTOR_SCHEMA = zod.object({
	type: ACTOR_TYPE_SCHEMA,
	id: zod.string().nullable().describe("The user's or API key's ID. `null` for `automated` and `system`, and when the ID was not recorded.")
}).strict().meta(metaStore([docPropertyInfo({
	description: "Who did it: a `user` (or an assistant acting for one), an `api-key`, `automated` moderation or CalmLens itself (`system`).",
	namedType: "Actor"
})]));
/** Who made a reviewer's decision on an asset: a person, or an API key through the API. */
const REVIEW_ACTOR_SCHEMA = ACTOR_SCHEMA.extend({ type: ACTOR_TYPE_SCHEMA.extract(["user", "api-key"]) }).meta(metaStore([docPropertyInfo({
	description: "Who made the decision: a `user` (or an assistant acting for one) or an `api-key`.",
	namedType: "ReviewActor"
})]));
// packages/shared/src/AssetModerationDecision.ts
/**
* What moderation decided for an asset, which also decides how it is delivered: served to anyone
* with access (`allowed`), served the same way but marked for reduced reach (`limited`), only to
* requests that confirm the viewer's age with `ageConfirmed`, signed URLs and server keys included
* (`age-restricted`), not served (`blocked`), or not served with its stored content deleted
* (`purged`).
*/
const ASSET_MODERATION_DECISION_SCHEMA = zod.enum([
	"allowed",
	"limited",
	"age-restricted",
	"blocked",
	"purged"
]);
// packages/shared/src/ZodUtils.ts
const createdAtField = () => zod.number().int().meta({ examples: [17672256e5] });
const updatedAtField = () => zod.number().int().optional().meta({
	...metaStore([updatedAt()]),
	examples: [17672259e5]
});
const SIZE_LIMITS = {
	small: 64,
	medium: 200,
	large: 1500,
	xlarge: 1e4,
	token: 1e4
};
const saneStringField = (options) => {
	return zod.string().transform((value) => value.trim()).refine((value) => {
		if (options?.minWidth && value.length < options.minWidth) return false;
		return true;
	}, "Not long enough").refine((value) => {
		const sizeLimit = options?.maxLength ?? SIZE_LIMITS[options?.type ?? "medium"];
		return typeof value === "string" && value.length < sizeLimit;
	}, "Too long");
};
/** A real PDQ hash, for documentation examples. */
const EXAMPLE_PDQ_HASH = "d8f8f0cce0f4a84f0e370a22028f67f0b36e2ed596623e1d33e6b39c4e9c9b22";
const PDQ_HASH_SCHEMA = zod.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, msg("Use a PDQ hash of 64 hexadecimal characters"));
/**
* What a match does: `flag` reports it on the asset and in an event without changing the
* decision, `block` also blocks close matches.
*/
const HASH_LIST_ACTION_SCHEMA = zod.enum(["flag", "block"]);
zod.object({
	id: primaryIdField("hl").describe("Unique hash list ID"),
	projectId: idField("proj").describe("ID of the project that owns the list"),
	name: saneStringField({
		type: "medium",
		minWidth: 1
	}).meta(metaStore([docPropertyInfo({
		description: "Display name",
		example: "Removed images"
	})])),
	description: saneStringField({ type: "large" }).nullish().describe("What the list is for, such as the policy it enforces"),
	action: HASH_LIST_ACTION_SCHEMA.describe(`What a match does: \`flag\` reports it without changing the decision, \`block\` blocks matches 16 bits apart or fewer and flags looser ones`),
	createdAt: createdAtField().describe("When the list was created, in milliseconds since the Unix epoch"),
	updatedAt: updatedAtField().describe("When the list was last updated, in milliseconds since the Unix epoch")
}).meta(metaStore([docPropertyInfo({
	description: "A list of image hashes the project flags or blocks",
	namedType: "HashList"
})])).extend({
	createdByUserId: idField("user").nullish(),
	revision: zod.string().max(64).nullish()
});
zod.object({
	id: primaryIdField("hle").describe("Unique entry ID"),
	projectId: idField("proj").describe("ID of the project that owns the entry"),
	hashListId: idField("hl").describe("ID of the list the entry belongs to"),
	hash: PDQ_HASH_SCHEMA.meta(metaStore([docPropertyInfo({
		description: "PDQ hash of the listed image, as 64 hexadecimal characters",
		example: EXAMPLE_PDQ_HASH
	})])),
	quality: zod.number().int().min(0).max(100).nullable().describe(`PDQ quality of the hash from 0 to 100, or \`null\` when it was added without one. Entries below 50 are never matched.`),
	label: saneStringField({ type: "medium" }).nullish().describe("Your own note or reference for the entry"),
	assetId: idField("asset").nullish().describe("ID of the asset the hash was taken from, when it was added from an asset (`assetId` when adding the entry)"),
	createdAt: createdAtField().describe("When the entry was added, in milliseconds since the Unix epoch")
}).meta(metaStore([docPropertyInfo({
	description: "An image hash in a hash list",
	namedType: "HashListEntry"
})])).extend({ createdByUserId: idField("user").nullish() });
/**
* Where a match came from. Project hash lists are the only source today; shared industry lists
* join this enum as they are connected.
*/
const HASH_MATCH_SOURCE_SCHEMA = zod.enum(["hash-list"]);
const HASH_MATCH_SCHEMA = zod.object({
	source: HASH_MATCH_SOURCE_SCHEMA.describe("Where the matching hash came from"),
	hashListId: idField("hl").describe("ID of the matching hash list"),
	hashListEntryId: idField("hle").describe("ID of the matching entry in that list"),
	distance: zod.number().int().min(0).max(256).describe("Number of bits that differ between the hashes. 0 is the same picture."),
	action: HASH_LIST_ACTION_SCHEMA.describe("What this match did: `block` when it is close enough for a block list to block, otherwise `flag`")
}).strict();
const LINK_SAFETY_VERDICT_SCHEMA = zod.enum([
	"safe",
	"adult",
	"gambling",
	"phishing",
	"malware",
	"unresolved"
]);
/** The verdicts a policy can act on, in the order the portal and docs list them. */
const FLAGGED_LINK_VERDICTS = [
	"phishing",
	"malware",
	"adult",
	"gambling",
	"unresolved"
];
const LINK_SAFETY_ACTION_SCHEMA = zod.enum([
	"allow",
	"limit",
	"age-restrict",
	"block"
]);
const LINK_SAFETY_SETTINGS_SCHEMA = zod.object({
	verdictActions: zod.partialRecord(zod.enum(FLAGGED_LINK_VERDICTS), LINK_SAFETY_ACTION_SCHEMA).meta({ description: "What happens to an asset with a link of each verdict. A verdict left out is allowed." }),
	offPlatformLinks: zod.object({
		action: LINK_SAFETY_ACTION_SCHEMA.exclude(["allow"]),
		allowedDomains: zod.array(zod.string().regex(/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/, { message: msg("Use a bare lowercase domain such as example.com") }).meta({ examples: ["example.com"] })).max(100).refine((domains) => new Set(domains).size === domains.length, { message: msg("Domains must be unique") })
	}).strict().optional().meta({ description: "Acts on every link whose destination is outside `allowedDomains`, whatever its verdict. A domain also covers its subdomains." })
}).strict().meta(metaStore([docPropertyInfo({
	description: "Preview. What happens to assets that link to unsafe destinations. Link checks never change a moderation category's score.",
	namedType: "LinkSafetySettings"
})]));
const LINK_SAFETY_EVIDENCE_SCHEMA = zod.object({
	check: zod.enum(["domain-categories", "threat-lists"]).describe("Which check this is: the domain categories, or a threat-list lookup, of the link, every address it redirects through and its destination"),
	status: zod.enum(["checked", "failed"]).describe("`failed` when the check could not answer, which makes the link `unresolved`"),
	labels: zod.array(zod.string()).describe("What the check reported for any of the addresses, such as the domains' content categories and security risks or the threat types listed")
}).strict().meta(metaStore([docPropertyInfo({
	description: "One reputation check of a link, its redirects and its destination",
	namedType: "LinkSafetyEvidence"
})]));
const CHECKED_LINK_SCHEMA = zod.object({
	url: zod.string().describe("The link as found, with `https://` added when it was left out"),
	finalUrl: zod.string().nullable().describe("Where the link leads after following its redirects, or `null` when a short link or redirect chain could not be followed"),
	redirects: zod.number().int().nonnegative().describe("How many redirects were followed to reach `finalUrl`"),
	source: zod.enum(["qr-code", "text"]).describe("Where the link was found: in a QR code, or in the text"),
	verdict: LINK_SAFETY_VERDICT_SCHEMA,
	evidence: zod.array(LINK_SAFETY_EVIDENCE_SCHEMA)
}).strict().meta(metaStore([docPropertyInfo({
	description: "A link in the asset and what its destination is",
	namedType: "CheckedLink"
})]));
/** Readable verdict names, shared by the portal, event messages and docs. */
const LINK_SAFETY_VERDICT_LABELS = {
	safe: msg("Safe"),
	adult: msg("Adult site"),
	gambling: msg("Gambling site"),
	phishing: msg("Phishing"),
	malware: msg("Malware"),
	unresolved: msg("Unresolved")
};
const MODERATION_CATEGORY_DEFINITIONS = {
	sexual: {
		summary: msg("Sexual acts, explicit sexual anatomy, sexual services, sexual assault depictions and clearly erotic material."),
		definition: "covers sexual acts, explicit sexual anatomy, sexual services and clearly erotic material. Actual exposed adult breasts or nipples, genitals or buttocks, and descriptions of masturbation, oral sex, ejaculation or orgasm count in clinical, educational and non-erotic material too. Descriptions of sexual assault can qualify without erotic intent. Fictional, illustrated and generated depictions can also qualify. Flirtation, innuendo and sexual jokes, and in images people shown in swimwear or other revealing clothing, also count, so that a policy can allow or restrict them.",
		exclusions: "Ordinary affection, diagrams without exposed sexual anatomy or acts, and general sexual-health education without a qualifying sexual description do not qualify on their own. Clinical, medical or educational framing does not erase actual sexual anatomy or activity; educational qualifiers control allowances.",
		docsHref: "/docs/guides/moderation-categories#sexual-content"
	},
	violence: {
		summary: msg("Physical attacks, graphic bodily harm, death, threats against others, and planning or encouraging physical violence."),
		definition: "covers physical attacks, sexual assault, graphic bodily harm, death and threats against others. Non-consensual sexual touching and coerced sexual acts count even without a separately described injury. Graphic bodily detail and natural death also count without an attacker; a non-graphic injury or medical condition alone does not. It also includes planning, requesting, encouraging or praising physical violence. A depicted or described act can qualify in fiction or news reporting even when the author condemns it. In images, a weapon shown without an attack and consensual combat sport or training also count, so that a policy can allow or restrict them.",
		exclusions: "Solely intentional self-injury or suicide belongs under self-harm. Property damage alone, figurative language and abstract discussion of violence, injury or death do not establish violence. Non-graphic injuries and medical states alone do not qualify, regardless of severity: fractures, wounds, bruises, scars, coma, treatment and recovery do not establish an attack. Explicit disturbing bodily detail such as exposed bone, organs or mutilation can qualify even after an accident or during medical treatment.",
		docsHref: "/docs/guides/moderation-categories#violence"
	},
	"self-harm": {
		summary: msg("Intentional self-injury, suicide, preparation, methods or encouragement; text also includes current or recurring self-harm thoughts."),
		definition: "covers intentional self-injury, suicide, current self-harm risk, preparation, methods and encouragement. For text, it also includes current or recurring self-harm thoughts and an explicitly expressed desire to die. Asking for support does not cancel a separate disclosure of current risk or behavior.",
		exclusions: "An injury or covered body does not establish that harm was self-inflicted. General sadness, neutral statistics and healed scars alone are excluded. Prevention or recovery without a concrete described act, current risk or harmful methods is insufficient; reported or historical acts still count.",
		docsHref: "/docs/guides/moderation-categories#self-harm"
	},
	harassment: {
		summary: msg("Attacks on an identifiable person or a non-protected group: insults and humiliation, threats and intimidation, bullying and exclusion, sexual harassment and abuse, abuse within a relationship, and encouraging others to do these."),
		definition: "covers content that attacks an identifiable person, or a group that is not a protected identity group, or asks others to. Attacks are insults and contemptuous name-calling, demeaning or humiliating treatment, threats and intimidation, bullying and exclusion, sexual harassment, sexual abuse or objectification, and abuse or coercive control by a partner, family member or someone else in an ongoing relationship. Mild mockery and teasing, including mild or jokey name-calling such as fool, dummy, silly or clowns, sarcasm and mocking nicknames, are a lighter form of their own rather than insults, so that a policy can allow or restrict them. The target can be named, addressed, implied or invented, and need not have a protected identity. Attacks that are quoted, reported, shown in fiction, taught or condemned still count; qualifiers record their framing, their severity and whether the target is a public figure or group.",
		exclusions: "Not harassment on its own: dislike or anger without an attack, such as \"I hate you\"; disagreement or criticism of an idea, argument, decision, conduct or work, however blunt; untargeted profanity; affectionate teasing between people on good terms; telling someone not to call another person a name. An attack on a protected identity group is Hate, and a one-off physical attack is Violence; either is also Harassment when the content separately attacks a person in one of the ways above.",
		docsHref: "/docs/guides/moderation-categories#harassment-and-bullying"
	},
	hate: {
		summary: msg("Identity-based abuse, dehumanization, discriminatory exclusion or threats against people because of protected characteristics."),
		definition: "covers attacks on people because of race, ethnicity, nationality, religion, caste, sex, gender identity, sexual orientation or disability. It includes dehumanization, claims that a group is inferior, harmful stereotypes and generalisations such as saying a group is criminal, violent, dangerous or immoral, discriminatory exclusion, identity-based slurs and abuse, and threats. Images that show a hate symbol or attack to counter or prevent hate, such as anti-hate education, also count, so that a policy can allow or restrict them.",
		exclusions: "Not hate on its own: mentioning an identity, cultural clothing or religious imagery; describing differences in outcomes or treatment between groups without claiming that a group is inferior; criticism of beliefs, ideologies, political movements or conduct; reclaimed identity language used without contempt; discussing a slur as a word; an insult about someone’s conduct where a protected trait only identifies them; everyday insults such as dummy or fool. Attacks that are quoted, reported, condemned or taught still count, and qualifiers record that framing.",
		docsHref: "/docs/guides/moderation-categories#hate-and-identity-abuse"
	},
	"personal-information": {
		summary: msg("Private contact details, precise personal location, sensitive identifiers or credentials, and requests to disclose them."),
		definition: "covers supplied private personal contact details such as personal email addresses and phone numbers, precise home or current location, government or financial identifiers, account credentials and authentication secrets. Explicit requests to disclose those details also count even when no value is supplied. Own details and other people's details both count; qualifiers distinguish them. Concrete quoted, reported or educational instances remain present; framing does not erase them. Readable details in images count, but do not infer identity or unseen details from a face or setting.",
		exclusions: "Ordinary names alone, ages alone, broad locations such as a city, public business or official contact details, clearly fictional examples or placeholders such as example.com addresses, redacted values, generic privacy advice and descriptions of omitted details do not qualify.",
		docsHref: "/docs/guides/moderation-categories#personal-information"
	},
	profanity: {
		summary: msg("Actual swear words, vulgar language or offensive slurs, including clearly recognisable obfuscations."),
		definition: "covers actual swear words, vulgar expletives and offensive slurs in the supplied language, including mild and strong forms and clearly recognisable censored or obfuscated spellings. It does not require a target, abusive intent or an attack. Quoted, reclaimed, historical, fictional, educational and supportive uses still contain the language; qualifiers distinguish its form and framing. Readable words in images count.",
		exclusions: "Descriptions such as the character swears or the passage contains a slur without the actual wording, ordinary anatomical or medical terminology, insults or dehumanising words that are neither swear words nor conventional slurs (such as vermin, pests, idiot or clown), words with innocent literal meanings, names containing a swear-word substring, and ambiguous abbreviations or symbols without supported profane meaning do not qualify.",
		docsHref: "/docs/guides/moderation-categories#profanity"
	},
	"criminal-activity": {
		summary: msg("Concrete criminal or seriously dangerous acts, plans, assistance or instructions; fraud, scams, grooming, illegal drugs and contraband, plus policy-controlled alcohol, tobacco/vaping and gambling."),
		definition: "covers concrete criminal or seriously dangerous acts and their planning, requests for assistance, instructions, encouragement or facilitation, including help evading detection, consequences or accountability for them, and concrete acts depicted or described in reporting, fiction, education or prevention. A request can qualify even when no act occurs and a later reply refuses it. Dangerous activity requires a concrete serious risk of physical harm. It also covers fraud, scams and phishing aimed at the reader, illegal drug use, dealing, production or trafficking, and contraband such as stolen goods, counterfeit money or documents and smuggled or illegally traded weapons. Consensual adult sexual solicitation, including paid services, also counts so that a policy can allow or restrict it; this does not establish illegality. Concrete grooming for sexual exploitation or abuse also counts, including evidenced manipulation before explicit sexual content. Child sexual abuse material counts whenever it is supplied, sought, traded or merely named or referred to, so that a policy can restrict even a bare mention; conduct qualifiers distinguish an actual instance from a mention. Depicted or concretely described alcohol drinking or trade, tobacco or vaping use or trade, and gambling with real-value stakes count for policy control even when lawful; this does not assert illegality. In images, graffiti on property counts. Harm-reduction, recovery or prevention material about illegal drug use counts in text and images. A policy can allow or restrict each.",
		exclusions: `Solely self-directed harm, suicidal thoughts, self-harm risk or help-seeking belongs under self-harm, not criminal activity; require separate criminal conduct or serious endangerment of others. A depiction or report of a non-violent offence that endangers no one, such as theft, burglary, shoplifting, trespass, vandalism or a past fraud, does not qualify on its own, even when it shows the act in progress; it qualifies only with an actual plan, request, instructions, facilitation, promotion or encouragement, or as an offer to sell stolen or counterfeit goods. Violent acts, threats, coercion such as blackmail, and acts that seriously endanger people still qualify when depicted or reported. A topic mention, lawful safety advice without a concrete criminal act, or vague dangerous reference does not qualify. Lawful medical, pharmaceutical, clinical and research activity is not criminal, including prescriptions, dosages, side effects, controlled medicines used as prescribed, pharmacies, hospitals and lawful pharmaceutical manufacturing. Framing something as reporting, education or prevention does not erase an actual qualifying criminal act or harmful instructions. Generic alcohol, tobacco, gambling or drug-policy discussion without a concrete qualifying instance does not qualify. Non-alcoholic drinks, disinfectant, prescribed cessation treatment and games without real-value stakes do not qualify. Masks, computers, payment cards, detention or ordinary tools do not establish criminal facilitation by themselves. A clear visual demonstration of how to carry out a crime can qualify.`,
		docsHref: "/docs/guides/moderation-categories#criminal-and-dangerous-activity"
	}
};
// packages/shared/src/PolicyRule.ts
/**
* What a policy does with content: deliver it (`allow`), deliver it but mark it so your app
* reduces its reach (`limit`), keep it off its plain URL so your app limits it to adults
* (`age-restrict`: `viewerClaims.ageConfirmed: true`), stop delivering it
* (`block`), or stop delivering it and delete its stored content (`purge`).
*/
const POLICY_ACTION_SCHEMA = zod.enum([
	"allow",
	"limit",
	"age-restrict",
	"block",
	"purge"
]);
const policyRuleSchema = (whenDescription, actionDescription) => zod.object({
	name: zod.string().trim().min(1).max(80).optional(),
	when: zod.array(zod.enum(MODERATION_QUALIFIERS)).min(1).max(MODERATION_QUALIFIERS.length).refine((v) => new Set(v).size === v.length, msg("Qualifiers must be unique")).meta({ description: whenDescription }),
	unless: zod.array(zod.enum(MODERATION_QUALIFIERS)).min(1).max(MODERATION_QUALIFIERS.length).refine((v) => new Set(v).size === v.length, msg("Qualifiers must be unique")).optional().meta({ description: "Exclude instances covered by any of these qualifiers from this rule. Does not exempt other content or other categories." }),
	action: POLICY_ACTION_SCHEMA.meta({ description: actionDescription })
}).strict().refine((rule) => !rule.unless || !rule.when.some((qualifier) => rule.unless.includes(qualifier)), {
	message: msg("The exclusions prevent this rule from ever matching"),
	path: ["unless"]
});
const POLICY_ALLOWANCE_SCHEMA = policyRuleSchema("Qualifiers describing the content this allowance covers. Every selected qualifier must hold on the same instance. Eligible allowances may jointly cover all qualifying content.", "Softer than the category action: what happens to content the allowance covers.").refine((rule) => !rule.unless?.length, {
	message: msg("Only restrictions can have exclusions"),
	path: ["unless"]
});
/** Acts when one qualifying instance meets every selected qualifier and no exclusion. */
const POLICY_RESTRICTION_SCHEMA = policyRuleSchema("Qualifiers describing restricted content. Every selected qualifier must hold on the same instance. One matching qualifying instance can trigger this restriction.", "Any action except `allow`, including one weaker than the category action.");
/** The built-in policies (`BUILT_IN_MODERATION_PROFILES`), in the order the portal offers them. */
const POLICY_PRESET_IDS = [
	"general-community",
	"children-platform",
	"education-support",
	"wholesome-community"
];
// packages/shared/src/Subscriptions.ts
/**
* Product IDs are chosen by the repo (Stripe accepts an `id` on product creation) so the admin Stripe
* setup provisions the same catalogue in test and live mode without per-environment overrides.
*/
const PRODUCTS = {
	assetSearch: {
		id: "assetSearch",
		productId: {
			local: "prod_calmlens_asset_search",
			dev: "prod_calmlens_asset_search",
			main: "prod_calmlens_asset_search"
		},
		type: "subscription",
		name: "AI Asset Search"
	},
	assetMediaSearchIndexing: {
		id: "assetMediaSearchIndexing",
		productId: {
			local: "prod_calmlens_asset_media_search_indexing",
			dev: "prod_calmlens_asset_media_search_indexing",
			main: "prod_calmlens_asset_media_search_indexing"
		},
		type: "subscription",
		name: "AI Video & Audio Indexing"
	},
	imageTransformed: {
		id: "imageTransformed",
		productId: {
			local: "prod_calmlens_image_transformed",
			dev: "prod_calmlens_image_transformed",
			main: "prod_calmlens_image_transformed"
		},
		type: "subscription",
		name: "Image Transformed"
	},
	websiteIngestion: {
		id: "websiteIngestion",
		productId: {
			local: "prod_calmlens_website_ingestion",
			dev: "prod_calmlens_website_ingestion",
			main: "prod_calmlens_website_ingestion"
		},
		type: "subscription",
		name: "Website Ingestion"
	},
	textClassificationTokens: {
		id: "textClassificationTokens",
		productId: {
			local: "prod_calmlens_text_classification_tokens",
			dev: "prod_calmlens_text_classification_tokens",
			main: "prod_calmlens_text_classification_tokens"
		},
		type: "subscription",
		name: "Text Classification"
	},
	imageClassification: {
		id: "imageClassification",
		productId: {
			local: "prod_calmlens_image_classification",
			dev: "prod_calmlens_image_classification",
			main: "prod_calmlens_image_classification"
		},
		type: "subscription",
		name: "Image Classification"
	},
	assetStorageGb: {
		id: "assetStorageGb",
		productId: {
			local: "prod_calmlens_asset_storage_gb",
			dev: "prod_calmlens_asset_storage_gb",
			main: "prod_calmlens_asset_storage_gb"
		},
		type: "subscription",
		name: "Asset Storage"
	},
	assetRead: {
		id: "assetRead",
		productId: {
			local: "prod_calmlens_asset_read",
			dev: "prod_calmlens_asset_read",
			main: "prod_calmlens_asset_read"
		},
		type: "subscription",
		name: "Asset Read"
	},
	ocrClassification: {
		id: "ocrClassification",
		productId: {
			local: "prod_calmlens_ocr_classification",
			dev: "prod_calmlens_ocr_classification",
			main: "prod_calmlens_ocr_classification"
		},
		type: "subscription",
		name: "OCR Classification"
	},
	personDetection: {
		id: "personDetection",
		productId: {
			local: "prod_calmlens_person_detection",
			dev: "prod_calmlens_person_detection",
			main: "prod_calmlens_person_detection"
		},
		type: "subscription",
		name: "Person Detection"
	},
	faceDetection: {
		id: "faceDetection",
		productId: {
			local: "prod_calmlens_face_detection",
			dev: "prod_calmlens_face_detection",
			main: "prod_calmlens_face_detection"
		},
		type: "subscription",
		name: "Face Detection"
	},
	streamEncoding: {
		id: "streamEncoding",
		productId: {
			local: "prod_calmlens_stream_encoding",
			dev: "prod_calmlens_stream_encoding",
			main: "prod_calmlens_stream_encoding"
		},
		type: "subscription",
		name: "Stream Encoding"
	}
};
PRODUCTS.imageTransformed, PRODUCTS.websiteIngestion, PRODUCTS.textClassificationTokens, PRODUCTS.imageClassification, PRODUCTS.assetStorageGb, PRODUCTS.assetSearch, PRODUCTS.assetMediaSearchIndexing, PRODUCTS.assetRead, PRODUCTS.ocrClassification, PRODUCTS.personDetection, PRODUCTS.faceDetection, PRODUCTS.streamEncoding;
// packages/shared/src/ProcessingFeatures.ts
const createFeatureOptionsSchemas = (booleanSchema) => {
	const enabled = booleanSchema.meta(metaStore([docPropertyInfo({ description: "Whether to run the feature. It runs only when this is true." })]));
	const enabledUnlessFalse = booleanSchema.meta(metaStore([docPropertyInfo({ description: "Whether to run the feature. It runs unless this is false, including when the feature is left out." })]));
	return {
		ocr: zod.object({ enabled }).strict().meta(metaStore([docPropertyInfo({
			description: "Extract text onto the image asset and run an additional text moderation pass. Applies to images, including those extracted from multimedia documents and websites.",
			namedType: "OcrFeatureOptions"
		})])),
		personDetection: zod.object({ enabled }).strict().meta(metaStore([docPropertyInfo({
			description: "Preview. Locate people in images, including people whose faces are not visible. Results are informational and never change the moderation decision.",
			namedType: "PersonDetectionFeatureOptions"
		})])),
		faceDetection: zod.object({
			enabled,
			ageEstimation: booleanSchema.optional().meta(metaStore([docPropertyInfo({
				description: "Also estimate an age range for each face",
				defaultValue: false
			})]))
		}).strict().meta(metaStore([docPropertyInfo({
			description: "Preview. Locate faces in images and optionally estimate an age range for each. Faces are not identified or stored as biometric templates. Results are informational and never change the moderation decision.",
			namedType: "FaceDetectionFeatureOptions"
		})])),
		linkDetection: zod.object({ enabled: enabledUnlessFalse }).strict().meta(metaStore([docPropertyInfo({
			description: "Find QR codes and web links in images. On by default: send `enabled: false` to turn it off. QR code contents are moderated as text. With OCR on, links in the extracted text are listed too. Free.",
			namedType: "LinkDetectionFeatureOptions"
		})])),
		aiGeneratedDetection: zod.object({ enabled }).strict().meta(metaStore([docPropertyInfo({
			description: "Preview. Read the provenance metadata AI image generators attach (C2PA Content Credentials, the IPTC digital source type and generator tool settings) to tell whether an image says it was made or edited with AI. Images whose metadata was stripped, such as screenshots, report no provenance. Results are informational and never change the moderation decision. Free.",
			namedType: "AiGeneratedDetectionFeatureOptions"
		})])),
		streaming: zod.object({ enabled: booleanSchema.meta(metaStore([docPropertyInfo({ description: "Whether to prepare the stream. Left out, the project's streaming setting decides." })])) }).strict().meta(metaStore([docPropertyInfo({
			description: "Preview. Prepare an adaptive stream (HLS) of audio or video once it is decided and made browser-safe, served at `/hls/index.m3u8` and played by the embed page at `/embed`. Needs `keepContentAfterProcessing`. Billed per started minute of video; without billing, video uses the organisation's free allowance of 60 started minutes a month, and isn't streamed once it is used. `false` turns it off for an upload in a project that streams by default.",
			namedType: "StreamingFeatureOptions"
		})]))
	};
};
const createProcessingFeaturesSchema = (booleanSchema) => {
	const options = createFeatureOptionsSchemas(booleanSchema);
	return zod.object({
		ocr: options.ocr.nullish(),
		personDetection: options.personDetection.nullish(),
		faceDetection: options.faceDetection.nullish(),
		linkDetection: options.linkDetection.nullish(),
		aiGeneratedDetection: options.aiGeneratedDetection.nullish(),
		streaming: options.streaming.nullish()
	}).strict().omit({ aiGeneratedDetection: true }).meta(metaStore([docPropertyInfo({
		description: "Optional analyses and delivery features for this asset, keyed by feature. Link detection runs unless turned off; streaming follows the project's setting unless set here; the others run only when turned on. Unknown features are rejected.",
		namedType: "ProcessingFeatures"
	})]));
};
const PROCESSING_FEATURES_SCHEMA = createProcessingFeaturesSchema(zod.boolean());
/** Position and size as fractions of the image width and height, from 0 to 1. */
const BOUNDING_BOX_SCHEMA = zod.object({
	left: zod.number(),
	top: zod.number(),
	width: zod.number().min(0),
	height: zod.number().min(0)
}).strict().meta(metaStore([docPropertyInfo({
	description: "Position and size as fractions of the image width and height, from 0 to 1. `left` and `top` can be slightly negative when the subject extends past the edge.",
	namedType: "BoundingBox"
})]));
const TEXT_REGION_SCHEMA = zod.object({
	box: BOUNDING_BOX_SCHEMA,
	personalInformation: zod.boolean().describe("Whether the region is personal information, such as an email address, phone number or card number, rather than a paragraph of text")
}).strict().meta(metaStore([docPropertyInfo({
	description: "Where OCR found text in the image",
	namedType: "TextRegion"
})]));
const DETECTION_CONFIDENCE_SCHEMA = zod.number().min(0).max(1).describe("Detection confidence from 0 to 1");
const AGE_RANGE_SCHEMA = zod.object({
	low: zod.number().int().nonnegative(),
	high: zod.number().int().nonnegative()
}).strict().meta(metaStore([docPropertyInfo({
	description: "Estimated age range in years. Estimates can be off by several years.",
	namedType: "AgeRange"
})]));
const DETECTED_PERSON_SCHEMA = zod.object({
	box: BOUNDING_BOX_SCHEMA,
	confidence: DETECTION_CONFIDENCE_SCHEMA
}).strict().meta(metaStore([docPropertyInfo({
	description: "A detected person",
	namedType: "DetectedPerson"
})]));
const DETECTED_FACE_SCHEMA = zod.object({
	box: BOUNDING_BOX_SCHEMA,
	confidence: DETECTION_CONFIDENCE_SCHEMA,
	ageRange: AGE_RANGE_SCHEMA.optional()
}).strict().meta(metaStore([docPropertyInfo({
	description: "A detected face",
	namedType: "DetectedFace"
})]));
/**
* Why a feature has no findings of its own: it can't analyse this content (`not-supported`), its
* analysis failed (`unavailable`), or the asset is a document or website whose images are each
* analysed as their own child asset (`in-children`).
*/
const FEATURE_NOT_EVALUATED_REASON_SCHEMA = zod.enum([
	"not-supported",
	"unavailable",
	"in-children"
]);
/**
* A feature's result: `evaluated` with its findings, or `not-evaluated` with why it has none
* (`FEATURE_NOT_EVALUATED_REASON_SCHEMA`).
*/
const createFeatureResultSchema = (name, description, shape) => zod.discriminatedUnion("status", [zod.object({
	status: zod.literal("evaluated"),
	...shape
}).strict(), zod.object({
	status: zod.literal("not-evaluated"),
	reason: FEATURE_NOT_EVALUATED_REASON_SCHEMA.describe("Why the feature has no findings: `not-supported` for content it can't analyse, `unavailable` when its analysis failed, `in-children` for a document or website, whose images are each analysed as a child asset with its own result (list them with `GET /v1/assets/{assetId}/children`)")
}).strict()]).meta(metaStore([docPropertyInfo({
	description,
	namedType: name
})]));
const OCR_RESULT_SCHEMA = createFeatureResultSchema("OcrResult", "What OCR found in the image. Its text is `content.extractedText`.", { textRegions: zod.array(TEXT_REGION_SCHEMA).max(200).describe("Where OCR found text, and personal information within it. Redaction transforms blur these regions. Empty when the image has no text.") });
const PERSON_DETECTION_RESULT_SCHEMA = createFeatureResultSchema("PersonDetectionResult", "Preview. The people person detection found", { people: zod.array(DETECTED_PERSON_SCHEMA) });
const FACE_DETECTION_RESULT_SCHEMA = createFeatureResultSchema("FaceDetectionResult", "Preview. The faces face detection found", { faces: zod.array(DETECTED_FACE_SCHEMA) });
const DETECTED_QR_CODE_SCHEMA = zod.object({
	value: zod.string().describe("The text the QR code holds, such as a URL"),
	box: BOUNDING_BOX_SCHEMA
}).strict().meta(metaStore([docPropertyInfo({
	description: "A decoded QR code",
	namedType: "DetectedQrCode"
})]));
const DETECTED_LINK_SCHEMA = zod.object({
	url: zod.string().describe("The link, with `https://` added when the image left it out"),
	source: zod.enum(["qr-code", "text"]).describe("Where the link was found: in a QR code, or in the text OCR extracted")
}).strict().meta(metaStore([docPropertyInfo({
	description: "A web link found in the image",
	namedType: "DetectedLink"
})]));
const LINK_DETECTION_RESULT_SCHEMA = createFeatureResultSchema("LinkDetectionResult", "The QR codes and web links link detection found", {
	qrCodes: zod.array(DETECTED_QR_CODE_SCHEMA),
	links: zod.array(DETECTED_LINK_SCHEMA)
});
/**
* Link safety's result: every link found in the asset, where it leads and its verdict. It runs when
* the project's policy acts on links, not through `processingOptions.features`.
*/
const LINK_SAFETY_RESULT_SCHEMA = createFeatureResultSchema("LinkSafetyResult", "Preview. Where each link in the asset leads and its verdict", { links: zod.array(CHECKED_LINK_SCHEMA) });
const PROVENANCE_SIGNAL_SCHEMA = zod.object({
	kind: zod.enum([
		"c2pa",
		"iptc-digital-source-type",
		"generator-metadata"
	]).describe("Where the evidence was found: a C2PA manifest, the IPTC digital source type in XMP, or settings an image generator wrote"),
	value: zod.string().describe("What it says, such as the digital source type or the generator's name")
}).strict().meta(metaStore([docPropertyInfo({
	description: "Provenance metadata found in the image file",
	namedType: "ProvenanceSignal"
})]));
const AI_PROVENANCE_SHAPE = {
	provenance: zod.enum([
		"ai-generated",
		"ai-edited",
		"unknown"
	]).describe("What the metadata says: `ai-generated`, `ai-edited` (a composite or edit made with AI), or `unknown` when the file carries no AI provenance. `unknown` doesn't mean a person made it: screenshots and re-saved images lose their metadata."),
	signals: zod.array(PROVENANCE_SIGNAL_SCHEMA)
};
/** The AI provenance an uploaded image declares, read before its metadata is removed. */
const AI_PROVENANCE_SCHEMA = zod.object(AI_PROVENANCE_SHAPE).strict();
const AI_GENERATED_DETECTION_RESULT_SCHEMA = createFeatureResultSchema("AiGeneratedDetectionResult", "Preview. The AI provenance the image's metadata declares", AI_PROVENANCE_SHAPE);
const PROCESSING_FEATURE_RESULTS_SCHEMA = zod.object({
	ocr: OCR_RESULT_SCHEMA.optional(),
	personDetection: PERSON_DETECTION_RESULT_SCHEMA.optional(),
	faceDetection: FACE_DETECTION_RESULT_SCHEMA.optional(),
	linkDetection: LINK_DETECTION_RESULT_SCHEMA.optional(),
	linkSafety: LINK_SAFETY_RESULT_SCHEMA.optional(),
	aiGeneratedDetection: AI_GENERATED_DETECTION_RESULT_SCHEMA.optional()
}).strict().meta(metaStore([docPropertyInfo({
	description: "Results of the optional features requested in `processingOptions.features`, keyed by feature",
	namedType: "ProcessingFeatureResults"
})]));
const CLASSIFICATION_INPUT_TYPE_SCHEMA = zod.enum(["text", "image"]);
const CLASSIFICATION_CATEGORY_SCHEMA = zod.enum(CLASSIFICATION_CATEGORIES);
zod.object({
	category: CLASSIFICATION_CATEGORY_SCHEMA,
	displayName: saneStringField(),
	description: saneStringField(),
	supportedInputTypes: zod.array(CLASSIFICATION_INPUT_TYPE_SCHEMA).min(1)
});
msg("Sexual Content"), MODERATION_CATEGORY_DEFINITIONS.sexual.summary, msg("Violence"), MODERATION_CATEGORY_DEFINITIONS.violence.summary, msg("Self-Harm"), MODERATION_CATEGORY_DEFINITIONS["self-harm"].summary, msg("Harassment & Bullying"), MODERATION_CATEGORY_DEFINITIONS.harassment.summary, msg("Hate & Identity Abuse"), MODERATION_CATEGORY_DEFINITIONS.hate.summary, msg("Personal Information"), MODERATION_CATEGORY_DEFINITIONS["personal-information"].summary, msg("Profanity"), MODERATION_CATEGORY_DEFINITIONS.profanity.summary, msg("Criminal & Dangerous Activity"), MODERATION_CATEGORY_DEFINITIONS["criminal-activity"].summary;
const LIKELIHOOD_SCHEMA = zod.enum([
	"very-unlikely",
	"unlikely",
	"possible",
	"likely",
	"very-likely"
]);
const CLASSIFICATION_NOT_EVALUATED_REASON_SCHEMA = zod.enum(["not-supported", "unavailable"]);
const STRICT_QUALIFIER_RESULTS_SCHEMA = zod.partialRecord(zod.enum(MODERATION_QUALIFIERS), zod.discriminatedUnion("status", [zod.object({
	status: zod.literal("evaluated"),
	/** Evidence that some of the category's qualifying content is this qualifier. */
	someScore: zod.number().min(0).max(1),
	/** Evidence that only this qualifier is in it: all of the qualifying content is one. */
	allScore: zod.number().min(0).max(1).optional(),
	likelihood: LIKELIHOOD_SCHEMA
}).strict().refine(({ someScore, allScore }) => allScore === void 0 || allScore <= someScore, {
	message: "The All score cannot exceed the Some score",
	path: ["allScore"]
}), zod.object({
	status: zod.literal("not-evaluated"),
	reason: CLASSIFICATION_NOT_EVALUATED_REASON_SCHEMA
}).strict()]).meta(metaStore([docPropertyInfo({
	description: "What the evidence says about one qualifier",
	namedType: "QualifierResult"
})])));
const KNOWN_QUALIFIERS = new Set(MODERATION_QUALIFIERS);
/**
* Qualifier results keyed by qualifier. Keys from removed or renamed qualifiers are dropped rather
* than failing the report; known keys are still validated. Typed as the strict schema: the filter
* changes neither the accepted shape of known keys nor the JSON schema.
*/
const CLASSIFICATION_QUALIFIER_RESULTS_SCHEMA = zod.preprocess((value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => KNOWN_QUALIFIERS.has(key))) : value, STRICT_QUALIFIER_RESULTS_SCHEMA);
const CLASSIFICATION_POLICY_CONDITIONS_SCHEMA = zod.record(zod.string().min(1).max(65536), zod.discriminatedUnion("status", [zod.object({
	status: zod.literal("evaluated"),
	score: zod.number().min(0).max(1)
}).strict(), zod.object({
	status: zod.literal("not-evaluated"),
	reason: CLASSIFICATION_NOT_EVALUATED_REASON_SCHEMA
}).strict()]));
const CLASSIFICATION_CATEGORY_REPORT_SCHEMA = zod.discriminatedUnion("status", [
	zod.object({
		status: zod.literal("evaluated"),
		likelihood: LIKELIHOOD_SCHEMA,
		score: zod.number().min(0).max(1),
		qualifiers: CLASSIFICATION_QUALIFIER_RESULTS_SCHEMA.optional(),
		policyConditions: CLASSIFICATION_POLICY_CONDITIONS_SCHEMA.optional()
	}).strict(),
	zod.object({
		status: zod.literal("partial"),
		likelihood: LIKELIHOOD_SCHEMA,
		score: zod.number().min(0).max(1),
		qualifiers: CLASSIFICATION_QUALIFIER_RESULTS_SCHEMA.optional(),
		policyConditions: CLASSIFICATION_POLICY_CONDITIONS_SCHEMA.optional()
	}).strict(),
	zod.object({
		status: zod.literal("not-evaluated"),
		reason: CLASSIFICATION_NOT_EVALUATED_REASON_SCHEMA,
		qualifiers: CLASSIFICATION_QUALIFIER_RESULTS_SCHEMA.optional(),
		policyConditions: CLASSIFICATION_POLICY_CONDITIONS_SCHEMA.optional()
	}).strict()
]);
/**
* A category's detection findings as the API returns them: without the direct answers to policy
* conditions, whose keys are internal cache identities.
*/
const PUBLIC_CATEGORY_REPORT_SCHEMA = zod.discriminatedUnion("status", [
	CLASSIFICATION_CATEGORY_REPORT_SCHEMA.options[0].omit({ policyConditions: true }),
	CLASSIFICATION_CATEGORY_REPORT_SCHEMA.options[1].omit({ policyConditions: true }),
	CLASSIFICATION_CATEGORY_REPORT_SCHEMA.options[2].omit({ policyConditions: true })
]).meta(metaStore([docPropertyInfo({
	description: "A category's detection findings, before the policy is applied",
	namedType: "CategoryReport"
})]));
const CATEGORIES_SCHEMA = zod.object({
	sexual: CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	violence: CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	"self-harm": CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	harassment: CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	hate: CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	"criminal-activity": CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	"personal-information": CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	profanity: CLASSIFICATION_CATEGORY_REPORT_SCHEMA
}).strict();
/** Every category's detection findings as the API returns them. */
const PUBLIC_CATEGORIES_SCHEMA = zod.object({
	sexual: PUBLIC_CATEGORY_REPORT_SCHEMA,
	violence: PUBLIC_CATEGORY_REPORT_SCHEMA,
	"self-harm": PUBLIC_CATEGORY_REPORT_SCHEMA,
	harassment: PUBLIC_CATEGORY_REPORT_SCHEMA,
	hate: PUBLIC_CATEGORY_REPORT_SCHEMA,
	"criminal-activity": PUBLIC_CATEGORY_REPORT_SCHEMA,
	"personal-information": PUBLIC_CATEGORY_REPORT_SCHEMA,
	profanity: PUBLIC_CATEGORY_REPORT_SCHEMA
}).strict();
const POLICY_SCORE_DESCRIPTION = "How strongly the content meets the policy, from 0 to 1: the category score, lowered by allowances that cover the content and raised to the presence score of a restriction.";
/** What decided an asset: the policy's categories, an override, its children, a list or a rule. */
const DECISION_SOURCES = [
	"policy",
	"children",
	"hash-list",
	"mandatory-rule",
	"link-safety"
];
const CATEGORY_SETTINGS_SNAPSHOT_SCHEMA = zod.object({
	action: POLICY_ACTION_SCHEMA,
	allowances: zod.array(POLICY_ALLOWANCE_SCHEMA).max(50),
	restrictions: zod.array(POLICY_RESTRICTION_SCHEMA).max(50)
}).strict().optional().describe("The category's default action and rules in force at decision time.");
const RULE_INDEXES_SCHEMA = zod.array(zod.number().int().nonnegative()).min(1).describe("Indexes into the category's `settings.allowances` or `settings.restrictions` of the rules that decided the action, the decisive one first. Several allowances list every rule that covers the content together.");
const CATEGORY_ASSESSMENT_FIELDS = {
	score: zod.number().min(0).max(1).describe(POLICY_SCORE_DESCRIPTION),
	action: POLICY_ACTION_SCHEMA.describe("What the policy does with this category. `allow` when the policy score is below 0.5."),
	settings: CATEGORY_SETTINGS_SNAPSHOT_SCHEMA
};
/** What the policy made of one category, as a decision records it. */
const CATEGORY_ASSESSMENT_SCHEMA = zod.object({
	...CATEGORY_ASSESSMENT_FIELDS,
	source: zod.discriminatedUnion("kind", [
		zod.object({ kind: zod.literal("default") }).strict(),
		zod.object({ kind: zod.literal("below-threshold") }).strict(),
		zod.object({
			kind: zod.literal("allowance"),
			indexes: RULE_INDEXES_SCHEMA
		}).strict(),
		zod.object({
			kind: zod.literal("restriction"),
			indexes: RULE_INDEXES_SCHEMA
		}).strict()
	]).optional()
}).strict();
const CONDITION_SCORE_SCHEMA = zod.number().min(0).max(1).describe("The evidence that triggered the rules, from 0 to 1. For a restriction: how likely some of the category's content meets the rule, with all its `when` qualifiers and none of its `unless` qualifiers on the same content. For allowances: how much of the category's content they cover together. A rule with `unless` qualifiers, or with several `when` qualifiers, is assessed as a whole, so its qualifiers can be missing from `raw`.");
/** What the policy made of one category, as the API shows it: with the evidence behind its rules. */
const PUBLIC_CATEGORY_ASSESSMENT_SCHEMA = zod.object({
	...CATEGORY_ASSESSMENT_FIELDS,
	source: zod.discriminatedUnion("kind", [
		zod.object({ kind: zod.literal("default") }).strict(),
		zod.object({ kind: zod.literal("below-threshold") }).strict(),
		zod.object({
			kind: zod.literal("allowance"),
			indexes: RULE_INDEXES_SCHEMA,
			conditionScore: CONDITION_SCORE_SCHEMA
		}).strict(),
		zod.object({
			kind: zod.literal("restriction"),
			indexes: RULE_INDEXES_SCHEMA,
			conditionScore: CONDITION_SCORE_SCHEMA
		}).strict()
	]).meta(metaStore([docPropertyInfo({
		description: "What decided the category's action: its `default` action, a policy score `below-threshold`, or the `allowance` or `restriction` rules listed by `indexes`, with the `conditionScore` that triggered them.",
		namedType: "CategoryAssessmentSource"
	})])).optional()
}).strict().meta(metaStore([docPropertyInfo({
	description: "What the policy made of one category",
	namedType: "CategoryAssessment"
})]));
/** The policy a decision was made with, as it was then. */
const DECISION_POLICY_SCHEMA = zod.object({
	id: idField("pol").describe("The policy's ID"),
	revision: zod.number().int().positive().describe("The policy's `revision` when it made the decision"),
	preset: zod.object({
		id: zod.enum(POLICY_PRESET_IDS).describe("The built-in preset the policy started from"),
		version: zod.number().int().positive().describe("The preset release the policy used when it made the decision")
	}).strict().nullable().describe("The preset release the policy used, `null` for a policy not made from a preset")
}).strict().meta(metaStore([docPropertyInfo({
	description: "The policy that made a decision, as it was when it made it",
	namedType: "DecisionPolicy"
})]));
/** What the project's policy made of the report when the asset was decided. */
const MODERATION_ASSESSMENT_FIELDS_SCHEMA = zod.object({
	policy: DECISION_POLICY_SCHEMA.optional().describe("The policy that made the decision. Absent from a preview, which no saved policy made."),
	categories: zod.partialRecord(CLASSIFICATION_CATEGORY_SCHEMA, CATEGORY_ASSESSMENT_SCHEMA).describe("Each assessed category's policy score and action. Unassessed categories are left out."),
	explanationComplete: zod.boolean().describe("Whether all questions needed for a complete explanation of this decision were answered. False means questions that could not change any action were skipped; the actions are still final."),
	source: zod.enum(DECISION_SOURCES),
	automatedAction: POLICY_ACTION_SCHEMA.describe("The original automated action. Manual reviews can change the current moderation status without changing this action."),
	rule: zod.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).optional(),
	regions: zod.array(zod.object({
		region: JURISDICTION_SCHEMA.exclude(["global"]),
		action: POLICY_ACTION_SCHEMA.exclude(["allow"]),
		rule: zod.string(),
		category: CLASSIFICATION_CATEGORY_SCHEMA.optional()
	}).strict()),
	flaggedCategories: zod.array(CLASSIFICATION_CATEGORY_SCHEMA).describe("Categories acted on by the automated decision. Empty when none were acted on; manual reviews do not change this list."),
	linkSafety: zod.object({
		action: LINK_SAFETY_ACTION_SCHEMA.describe("The strongest action the asset's links take under the policy's link-safety settings."),
		links: zod.array(zod.number().int().nonnegative()).describe("Indexes into the link-safety result's `links` of the links that take that action."),
		settings: LINK_SAFETY_SETTINGS_SCHEMA
	}).strict().optional().describe("Preview. What the policy's link-safety section made of the asset's links. Absent when the policy doesn't act on links.")
}).strict().omit({});
const hasValidModerationRule = (assessment) => assessment.source === "mandatory-rule" ? Boolean(assessment.rule) : assessment.rule === void 0;
MODERATION_ASSESSMENT_FIELDS_SCHEMA.refine(hasValidModerationRule, {
	message: "moderation/rule-required",
	path: ["rule"]
});
zod.object({
	source: zod.enum([
		"frame",
		"speech",
		"frame-text",
		"clip"
	]),
	startSeconds: zod.number().nonnegative(),
	endSeconds: zod.number().nonnegative(),
	categories: CATEGORIES_SCHEMA
}).strict();
const CLASSIFICATION_REPORT_SCHEMA = zod.object({
	testInput: zod.literal(true).optional().describe("Set when the findings come from one of the project's authenticated test inputs."),
	testCategoryActions: zod.partialRecord(CLASSIFICATION_CATEGORY_SCHEMA, zod.enum([
		"allow",
		"limit",
		"age-restrict",
		"block"
	])).optional().describe("Explicit category outcomes from an authenticated test scenario; bypass policy evaluation."),
	testRegionalActions: TEST_REGIONAL_ACTIONS_SCHEMA.optional().describe("Explicit regional restrictions from an authenticated test input."),
	processedAt: zod.number(),
	...MODERATION_ASSESSMENT_FIELDS_SCHEMA.partial().shape,
	raw: zod.object({
		categories: CATEGORIES_SCHEMA,
		timeline: zod.object({
			durationSeconds: zod.number().positive(),
			frameIntervalSeconds: zod.number().positive().optional(),
			sampledFrames: zod.number().int().nonnegative(),
			audioTranscribed: zod.boolean(),
			/** How many segments the asset's timeline holds; they are stored beside the asset. */
			segmentCount: zod.number().int().nonnegative()
		}).strict().optional(),
		hashMatches: zod.array(HASH_MATCH_SCHEMA).optional().describe("Entries in the project's hash lists that the image matched, blocking matches first and then the closest. Absent when nothing matched.")
	}).strict().describe("Detection findings before policy evaluation."),
	features: PROCESSING_FEATURE_RESULTS_SCHEMA.optional()
}).strict().refine(hasValidModerationRule, {
	message: "moderation/rule-required",
	path: ["rule"]
});
// packages/shared/src/AssetConstants.ts
const ASSET_REJECTION_NOTE_MAX_LENGTH = 1499;
// packages/shared/src/HumanReview.ts
const SAMPLE_PERCENT_SCHEMA = zod.number().min(0).max(100);
zod.object({
	allowedSamplePercent: SAMPLE_PERCENT_SCHEMA.default(0),
	restrictedSamplePercent: SAMPLE_PERCENT_SCHEMA.default(0),
	/**
	* Queues decisions with a moderated category whose policy score lies less than this many
	* percentage points from the policy threshold. 0 turns it off.
	*/
	uncertaintyMarginPercent: zod.number().min(0).max(50).default(0),
	/** Queues decisions whose report has evidence the moderation pipeline couldn't assess. */
	reviewMissingEvidence: zod.boolean().default(false)
}).strict();
/** The decisions a reviewer can make, and the statuses they review. */
const HUMAN_REVIEW_OUTCOME_SCHEMA = ASSET_MODERATION_DECISION_SCHEMA;
/**
* Automated outcomes that can be sampled. Purged content is deleted as soon as it is decided, for
* safety and legal reasons, so there is never anything left to review.
*/
const HUMAN_REVIEW_SAMPLED_OUTCOME_SCHEMA = ASSET_MODERATION_DECISION_SCHEMA.exclude(["purged"]);
const HUMAN_REVIEW_STATUS_SCHEMA = zod.enum(["pending", "completed"]);
/**
* Why an asset joined the queue: drawn by the random sample, or routed because its decision was
* uncertain. An asset drawn by the sample is `sampled` even when it is also uncertain, so the
* random sample stays representative.
*/
const HUMAN_REVIEW_REASON_SCHEMA = zod.enum(["sampled", "uncertain"]);
const HUMAN_REVIEW_UNCERTAIN_CATEGORIES_SCHEMA = zod.array(zod.enum(CLASSIFICATION_CATEGORIES));
zod.object({
	id: primaryIdField("rev"),
	projectId: idField("proj"),
	assetId: idField("asset"),
	automatedOutcome: HUMAN_REVIEW_OUTCOME_SCHEMA,
	reason: HUMAN_REVIEW_REASON_SCHEMA,
	/** The categories whose decision was uncertain when the asset was queued, sampled or not. */
	uncertainCategories: HUMAN_REVIEW_UNCERTAIN_CATEGORIES_SCHEMA,
	status: HUMAN_REVIEW_STATUS_SCHEMA,
	decision: HUMAN_REVIEW_OUTCOME_SCHEMA.nullish(),
	/**
	* The decision the reviewer judged: the asset's status when they decided, which differs from
	* the automated outcome when someone decided the asset after sampling. Set once completed.
	*/
	reviewedOutcome: HUMAN_REVIEW_OUTCOME_SCHEMA.nullish(),
	note: zod.string().max(ASSET_REJECTION_NOTE_MAX_LENGTH).nullish(),
	reviewerUserId: zod.string().nullish(),
	/** Whether the decision changed the asset's status (only when it overturned `reviewedOutcome`). */
	appliedToAsset: zod.boolean().nullish(),
	createdAt: createdAtField(),
	reviewedAt: zod.number().int().nullish()
});
zod.object({
	decision: HUMAN_REVIEW_OUTCOME_SCHEMA,
	confirmPurge: zod.boolean().optional(),
	note: zod.string().trim().max(ASSET_REJECTION_NOTE_MAX_LENGTH).nullish()
}).strict().superRefine((body, ctx) => {
	if (body.decision === "purged" && body.confirmPurge !== true) ctx.addIssue({
		code: "custom",
		path: ["confirmPurge"],
		message: "Confirm permanent deletion"
	});
});
// packages/shared/src/ModerationContext.ts
const MODERATION_AUTHOR_ID_SCHEMA = zod.string().min(1).max(256).meta(metaStore([docPropertyInfo({
	description: `Your identifier for who wrote the content, up to 256 characters. CalmLens only compares it with the author IDs in \`context\`, to tell which posts share a speaker, so any stable opaque value works. See [Threaded moderation](/docs/guides/threaded-moderation).`,
	placeholder: "user-123"
})]));
const MODERATION_CONTEXT_ITEM_SCHEMA = zod.object({
	text: zod.string().refine((text) => text.trim().length > 0, "Context text must not be empty").refine((text) => countModerationContextCharacters(text) <= MODERATION_CONTEXT_MAX_ITEM_CHARACTERS, `Context text must be at most ${MODERATION_CONTEXT_MAX_ITEM_CHARACTERS} characters`).meta(metaStore([docPropertyInfo({
		description: `The earlier post's text, up to ${MODERATION_CONTEXT_MAX_ITEM_CHARACTERS.toLocaleString("en-US")} characters`,
		placeholder: "Has anyone tried the new update?"
	})])),
	authorId: MODERATION_AUTHOR_ID_SCHEMA.optional().meta(metaStore([docPropertyInfo({
		description: "Your identifier for who wrote the earlier post",
		placeholder: "user-456"
	})]))
}).strict().meta(metaStore([docPropertyInfo({
	description: "An earlier post in the conversation",
	namedType: "ModerationContextItem"
})]));
zod.object({ items: zod.array(MODERATION_CONTEXT_ITEM_SCHEMA).max(20).refine((items) => items.reduce((sum, item) => sum + countModerationContextCharacters(item.text), 0) <= MODERATION_CONTEXT_MAX_CHARACTERS, `Context must be at most ${MODERATION_CONTEXT_MAX_CHARACTERS} characters in total`).meta(metaStore([docPropertyInfo({ description: `Earlier posts in the conversation, oldest first: up to 20 posts and ${MODERATION_CONTEXT_MAX_CHARACTERS.toLocaleString("en-US")} characters. CalmLens uses the most recent 5 that fit in ${MODERATION_CONTEXT_USED_CHARACTERS.toLocaleString("en-US")} characters.` })])) }).strict().meta(metaStore([docPropertyInfo({
	description: "Earlier posts in the conversation the content belongs to. CalmLens moderates only the content; the context only helps it read who the content addresses, what it refers to and whether it quotes, reports, counters or mocks something. See [Threaded moderation](/docs/guides/threaded-moderation).",
	namedType: "ModerationContext"
})]));
/** The context CalmLens used, as stored with an asset and returned by the API. */
const USED_MODERATION_CONTEXT_SCHEMA = zod.object({ items: zod.array(MODERATION_CONTEXT_ITEM_SCHEMA).max(5) }).meta(metaStore([docPropertyInfo({
	description: `The earlier posts CalmLens used to read the content, oldest first: the most recent 5 sent that fit in ${MODERATION_CONTEXT_USED_CHARACTERS.toLocaleString("en-US")} characters. Removed with the content.`,
	namedType: "UsedModerationContext"
})]));
// packages/shared/src/Asset.ts
/**
* Where the asset is in the pipeline: waiting for its content or its turn (`queued`), being
* processed, or settled (`completed` or `failed`).
*/
const ASSET_CLASSIFICATION_STATUS_SCHEMA = zod.enum([
	"queued",
	"processing",
	"completed",
	"failed"
]);
/**
* The moderation decision in force, which also decides delivery: `pending` until classification
* decides, then a reviewer's decision when there is one, else the policy's.
*/
const ASSET_MODERATION_STATUS_SCHEMA = zod.enum(["pending", ...ASSET_MODERATION_DECISION_SCHEMA.options]);
const ASSET_REVIEW_SCHEMA = zod.object({
	id: idField("rev"),
	decision: ASSET_MODERATION_DECISION_SCHEMA,
	note: zod.string().nullable(),
	decidedBy: REVIEW_ACTOR_SCHEMA,
	reviewedAt: zod.number().int(),
	applied: zod.boolean().describe("Whether the decision was applied to the asset. `false` for a human review queue decision that was recorded without changing the asset's status.")
});
/**
* A review as stored and shown in the portal: the API shape plus the reviewer's name and email when
* the decision was made, which stay in the portal as personal data.
*/
const STORED_ASSET_REVIEW_SCHEMA = ASSET_REVIEW_SCHEMA.extend({
	reviewerName: zod.string().nullable(),
	reviewerEmail: zod.string().nullable()
});
/** A review the project's human review queue is waiting for. */
const ASSET_PENDING_REVIEW_SCHEMA = zod.object({
	requestedAt: zod.number().int().describe("When the asset joined the queue, in milliseconds since the Unix epoch"),
	reason: HUMAN_REVIEW_REASON_SCHEMA.describe("Why it joined: `sampled` by the project's sample rate, or `uncertain` because a category's policy score was close to the threshold or its evidence was missing"),
	uncertainCategories: HUMAN_REVIEW_UNCERTAIN_CATEGORIES_SCHEMA.describe("The categories that made the decision uncertain. Empty for a sampled decision.")
}).strict().meta(metaStore([docPropertyInfo({
	description: "A review the human review queue is waiting for",
	namedType: "AssetPendingReview"
})]));
/**
* Whether CalmLens holds the asset's content (source, preview and extracted text): kept only until
* processing finishes (`temporary`), retained (`stored`) or deleted (`removed`).
*/
const ASSET_CONTENT_STATUS_SCHEMA = zod.enum([
	"temporary",
	"stored",
	"removed"
]);
/** Why an asset's content was removed. */
const ASSET_CONTENT_REMOVAL_REASON_SCHEMA = zod.enum([
	"policy",
	"retention",
	"requested",
	"parent-removed",
	"disposed"
]);
/** Why an asset's processing failed. */
const ASSET_FAILURE_REASON_SCHEMA = zod.enum([
	"file-too-large",
	"duration-limit",
	"resolution-limit",
	"unsupported-format",
	"undecodable-content",
	"multiple-tracks",
	"type-mismatch",
	"free-uploads-exhausted",
	"media-limit",
	"uploads-paused",
	"too-many-items",
	"processing-error"
]);
/** How far sectioned analysis of long audio or video has got. */
const CLASSIFICATION_PROGRESS_SCHEMA = zod.object({
	completedSections: zod.number().int().nonnegative().describe("Sections analysed so far"),
	totalSections: zod.number().int().positive().describe("Sections the media is analysed in")
}).meta(metaStore([docPropertyInfo({
	description: "Progress of long audio or video analysed in sections",
	namedType: "ClassificationProgress"
})]));
const ASSET_TYPE_SCHEMA = zod.enum([
	"image",
	"video",
	"audio",
	"plaintext-document",
	"multimedia-document",
	"website",
	"file"
]);
/** Spreadsheets: their sheets' text and embedded images are moderated, without page renders. */
const SPREADSHEET_MIME_TYPES = [
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-excel.sheet.macroenabled.12",
	"application/vnd.ms-excel",
	"application/vnd.oasis.opendocument.spreadsheet"
];
/** Presentations: their slides' text and a render of each slide are moderated. */
const PRESENTATION_MIME_TYPES = [
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.ms-powerpoint.presentation.macroenabled.12",
	"application/vnd.ms-powerpoint",
	"application/vnd.oasis.opendocument.presentation"
];
[...SPREADSHEET_MIME_TYPES, ...PRESENTATION_MIME_TYPES];
const ASSET_VISIBILITY_SCHEMA = zod.enum(["public", "private"]);
const ASSET_SAFETY_HOLD_REASON_SCHEMA = zod.enum(["suspected-illegal-content"]);
const ASSET_SAFETY_HOLD_SCHEMA = zod.object({
	placedAt: zod.number().int().describe("When the hold was placed, in milliseconds since the Unix epoch"),
	reason: ASSET_SAFETY_HOLD_REASON_SCHEMA.describe("Why the asset is held"),
	disposedAt: zod.number().int().nullish().describe("When the held content was disposed of, in milliseconds since the Unix epoch")
});
const SMALL_PLAINTEXT_DOCUMENT_MAX_BYTES = 16384;
const fileMetadataText = (description) => zod.string().max(200).nullable().describe(description);
const FILE_METADATA_SCHEMA = zod.object({
	capturedAt: fileMetadataText("When the picture was taken, as the file records it: an ISO 8601 date and time, such as `2026-05-01T12:30:00+01:00`. Includes the UTC offset only when the file records one; without it, the time is the camera's local time."),
	cameraMake: fileMetadataText("Camera manufacturer, such as `Canon`"),
	cameraModel: fileMetadataText("Camera or phone model, such as `EOS R5`"),
	lensModel: fileMetadataText("Lens model"),
	software: fileMetadataText("Software that created or last edited the file"),
	creator: fileMetadataText("Creator or artist the file names. Sensitive: recorded only when `storeSensitiveMetadata` is on."),
	copyright: fileMetadataText("Copyright notice the file declares"),
	digitalSourceType: fileMetadataText("IPTC digital source type the file declares, such as `digitalCapture` for a camera photo or `trainedAlgorithmicMedia` for generated media. Files can declare any value, so treat it as a claim."),
	containsLocation: zod.boolean().describe("Whether the uploaded file embedded GPS coordinates, whatever `storeSensitiveMetadata` is set to."),
	location: zod.object({
		latitude: zod.number().min(-90).max(90).describe("Latitude in decimal degrees"),
		longitude: zod.number().min(-180).max(180).describe("Longitude in decimal degrees")
	}).nullable().describe("Where the picture was taken, from its GPS coordinates. Sensitive: recorded only when `storeSensitiveMetadata` is on.")
}).meta(metaStore([docPropertyInfo({
	description: "Descriptive metadata embedded in an uploaded image",
	namedType: "FileMetadata"
})]));
const EXTRACTED_TEXT_SCHEMA = zod.discriminatedUnion("type", [zod.object({
	type: zod.literal("string"),
	content: zod.string().refine((value) => new TextEncoder().encode(value).byteLength <= SMALL_PLAINTEXT_DOCUMENT_MAX_BYTES, `Extracted text must be at most ${SMALL_PLAINTEXT_DOCUMENT_MAX_BYTES} bytes when stored inline`)
}), zod.object({
	type: zod.literal("document"),
	id: saneStringField()
})]).meta(metaStore([docPropertyInfo({
	description: "Extracted text: inline as `content` (`type: string`), or stored as a document with its `id` (`type: document`)",
	namedType: "ExtractedText"
})]));
const CHECKSUMS_SCHEMA = zod.object({
	md5: zod.string().nullish().describe("MD5 digest of the stored content"),
	sha1: zod.string().nullish().describe("SHA-1 digest of the stored content"),
	sha256: zod.string().nullish().describe("SHA-256 digest of the stored content"),
	sha384: zod.string().nullish().describe("SHA-384 digest of the stored content"),
	sha512: zod.string().nullish().describe("SHA-512 digest of the stored content")
});
const IMAGE_DATA_SCHEMA = zod.object({
	perceptualHash: zod.string().nullish().describe("PDQ perceptual hash used to match visually similar images, as 64 hexadecimal characters"),
	perceptualHashQuality: zod.number().int().min(0).max(100).nullish().describe("PDQ quality of `perceptualHash`, from 0 to 100"),
	width: zod.number().int().positive().nullish().describe("Image width in pixels"),
	height: zod.number().int().positive().nullish().describe("Image height in pixels")
});
const PREVIEW_IMAGE_SCHEMA = zod.object({
	id: saneStringField().nullable().describe("Identifier of the stored preview image"),
	fileFormat: saneStringField().nullable().describe("File format of the preview, such as `webp`"),
	thumbhash: saneStringField().nullable().describe("ThumbHash placeholder you can render while the preview loads"),
	averageColor: saneStringField().nullable().describe("Average color of the preview"),
	width: zod.number().int().positive().nullable().describe("Preview width in pixels"),
	height: zod.number().int().positive().nullable().describe("Preview height in pixels")
});
const pixels = (description) => zod.number().int().positive().nullable().describe(description);
/** Why a stream that was asked for isn't prepared. */
const ASSET_HLS_UNAVAILABLE_REASON_SCHEMA = zod.enum([
	"allowance-used",
	"billing-required",
	"spend-limit",
	"processing-failed",
	"content-not-kept"
]);
/** A rendition ID: `audio`, or `v` and the picture's height (`v720`). It names its CDN path. */
const STREAM_RENDITION_ID_SCHEMA = zod.string().regex(/^(audio|v[1-9][0-9]{1,3})$/);
/**
* One rendition of an adaptive stream as stored: fragmented MP4 (CMAF) files of `bytes` bytes in
* all, each holding an init segment and media segments, and its media playlist, beside the others
* under the stream's `prefix`.
*/
const STORED_STREAM_RENDITION_SCHEMA = zod.object({
	id: STREAM_RENDITION_ID_SCHEMA,
	kind: zod.enum(["video", "audio"]),
	width: zod.number().int().positive().nullable(),
	height: zod.number().int().positive().nullable(),
	/** Peak segment bit rate in bits per second, as HLS's `BANDWIDTH` (audio not included). */
	bandwidth: zod.number().int().positive(),
	averageBandwidth: zod.number().int().positive(),
	codecs: saneStringField(),
	frameRate: zod.number().positive().nullable(),
	channels: zod.number().int().positive().nullable(),
	bytes: zod.number().int().nonnegative()
});
/** An adaptive (HLS) stream processing stored for a browser-safe copy. Stored only. */
const STORED_MEDIA_STREAM_SCHEMA = zod.object({
	/**
	* Storage key prefix of its files: per rendition its media playlist `<id>.m3u8` and one
	* fragmented MP4 per encoded window, `<id>-<window>.mp4` (audio is one window).
	*/
	prefix: saneStringField(),
	durationSeconds: zod.number().nonnegative(),
	/** How many windows the video was encoded in. */
	windows: zod.number().int().positive(),
	renditions: zod.array(STORED_STREAM_RENDITION_SCHEMA).min(1).max(5),
	/** Every file's bytes together, counted towards the project's storage. */
	bytes: zod.number().int().nonnegative()
});
/**
* A browser-safe copy of an audio or video asset that processing stores, served at the rendered
* resource in place of the upload. Stored only; the API describes it as `content.rendered`.
*/
const RENDERED_MEDIA_SCHEMA = zod.object({
	storageId: saneStringField().describe("Internal storage key of the browser-safe copy"),
	format: saneStringField().describe("MIME type of the copy, such as `video/mp4`"),
	kind: zod.enum(["video", "audio"]),
	width: zod.number().int().positive().nullish(),
	height: zod.number().int().positive().nullish(),
	peaks: zod.array(zod.number().min(0).max(1)).max(512).nullish(),
	/** Its adaptive stream, once one is prepared from it. */
	stream: STORED_MEDIA_STREAM_SCHEMA.nullish(),
	/** What became of the stream asked for, until it is saved in `stream`. */
	streamStatus: zod.discriminatedUnion("status", [zod.object({ status: zod.literal("preparing") }), zod.object({
		status: zod.literal("unavailable"),
		reason: ASSET_HLS_UNAVAILABLE_REASON_SCHEMA
	})]).nullish()
});
/** One rendition of an adaptive stream, as the HLS master playlist lists it. */
const ASSET_HLS_RENDITION_SCHEMA = zod.object({
	kind: zod.enum(["video", "audio"]).describe("`video` for a picture size (video renditions carry no sound; they play with the `audio` rendition), or `audio`"),
	width: pixels("Picture width in pixels; `null` for audio"),
	height: pixels("Picture height in pixels; `null` for audio"),
	bandwidth: zod.number().int().positive().describe("Peak bit rate in bits per second, counting the audio a video rendition plays with"),
	codecs: zod.string().describe("The rendition's codecs as RFC 6381 names, such as `avc1.64001f`")
}).meta(metaStore([docPropertyInfo({
	description: "One rendition of the adaptive (HLS) stream",
	namedType: "AssetHlsRendition"
})]));
/** The adaptive stream of audio or video, as the CDN's `/hls` resource serves it. */
const ASSET_HLS_SCHEMA = zod.object({ renditions: zod.array(ASSET_HLS_RENDITION_SCHEMA).describe("Every rendition, video from the largest down, then audio") }).meta(metaStore([docPropertyInfo({
	description: "The adaptive stream of audio or video: HLS with fragmented MP4 (CMAF) segments, served at `/hls/index.m3u8`",
	namedType: "AssetHls"
})]));
/** Whether the stream asked for is ready, or why it isn't. */
const ASSET_HLS_STATUS_SCHEMA = zod.object({
	status: zod.enum([
		"preparing",
		"ready",
		"unavailable"
	]).describe("`preparing` until the stream is saved, `ready` once `content.hls` lists it, `unavailable` when it won't be prepared: see `reason`"),
	reason: ASSET_HLS_UNAVAILABLE_REASON_SCHEMA.nullable().describe("Why an `unavailable` stream isn't prepared: `allowance-used` (this month's free streaming minutes don't have room for it), `billing-required` (it is longer than the free minutes allow, so it needs billing), `spend-limit` (its expected cost would pass a spend limit), `processing-failed` (preparing it failed) or `content-not-kept` (the upload keeps no content to stream). `null` otherwise.")
}).meta(metaStore([docPropertyInfo({
	description: "Whether the adaptive stream asked for is ready, or why it isn't",
	namedType: "AssetHlsStatus"
})]));
const ASSET_RENDERED_KIND_SCHEMA = zod.enum([
	"image",
	"pdf",
	"video",
	"audio"
]).describe("What the rendered resource serves: an `image` (images, and a website's screenshot), a `pdf` (PDFs, and documents and presentations converted to PDF), or browser-safe `video` or `audio`");
/** The one displayable file of the asset, as the CDN's `rendered` resource serves it. */
const ASSET_RENDERED_SCHEMA = zod.object({
	kind: ASSET_RENDERED_KIND_SCHEMA,
	format: zod.string().describe("MIME type of the rendered file. An image is served in the best format the client accepts, such as AVIF or WebP, unless a transform sets one."),
	width: pixels("Width in pixels of the full view, for images and video, before any transform; `null` when unknown or for PDFs and audio"),
	height: pixels("Height in pixels of the full view, like `width`"),
	peaks: zod.array(zod.number().min(0).max(1)).max(512).optional().describe(`Audio only, once processing has measured them: up to 512 loudness peaks from 0 to 1 (3 decimal places), evenly spaced over the audio, for drawing a waveform`)
}).meta(metaStore([docPropertyInfo({
	description: "The displayable file of the asset, served at the rendered resource",
	namedType: "AssetRendered"
})]));
/** The still image that stands for the asset, as the CDN's `preview` resource serves it. */
const ASSET_PREVIEW_SCHEMA = zod.object({
	width: pixels("Width in pixels of the source still image, before the preview is sized or transformed"),
	height: pixels("Height in pixels of the source still image, like `width`"),
	thumbhash: saneStringField().nullable().describe("ThumbHash placeholder you can render while any view of the asset loads (also served as a PNG at the placeholder resource)"),
	averageColor: saneStringField().nullable().describe("Average color of the source still image, a placeholder for any view of the asset")
}).meta(metaStore([docPropertyInfo({
	description: "A still image for the asset, served at the preview resource: the image itself, a document's first page or slide, a website's first screen, a video's poster frame or an audio waveform",
	namedType: "AssetPreview"
})]));
const METADATA_ITEM_SCHEMA = zod.object({
	id: saneStringField().meta(metaStore([docPropertyInfo({
		description: "Identifier for the metadata item",
		placeholder: "meta_123"
	})])),
	value: zod.json().meta(metaStore([docPropertyInfo({
		description: "Value of the metadata item",
		placeholder: "John Doe"
	})]))
}).meta(metaStore([docPropertyInfo({
	description: "A metadata item with an ID and value",
	namedType: "MetadataItem"
})]));
const PROCESSING_OPTIONS_SCHEMA = zod.object({
	keepContentAfterProcessing: zod.boolean().nullish().meta(metaStore([docPropertyInfo({
		description: "Whether to keep the asset content after processing",
		defaultValue: false
	})])),
	storeSensitiveMetadata: zod.boolean().nullish().meta(metaStore([docPropertyInfo({
		description: "Override the project's `storeSensitiveMetadata` setting for this upload. When false, embedded image metadata (EXIF, XMP and IPTC) is removed from the file before it is stored, and `fileMetadata` leaves out the creator and location. When true, the image is stored as uploaded.",
		defaultValue: void 0
	})])),
	features: PROCESSING_FEATURES_SCHEMA.nullish()
}).strict().nullish();
/** A URL the portal links to: only ones a browser may follow, never `javascript:` or `data:`. */
const EXTERNAL_URL_SCHEMA = zod.string().url().refine((url) => /^https?:\/\//i.test(url), { message: "externalUrl must be an http or https URL" });
/**
* An asset as stored: one column per field, so filters, updates and indexes work on plain columns.
* The API returns the nested `Asset` built from it by `toPublicAsset`.
*/
const STORED_ASSET_SCHEMA = zod.object({
	id: primaryIdField("asset").describe("Unique asset ID"),
	projectId: idField("proj").describe("ID of the project that owns the asset"),
	sizeInBytes: zod.number().int().nullish().describe("Size of the uploaded content in bytes"),
	userId: idField("user").nullish().describe("ID of the user whose account created the asset"),
	parentId: idField("asset").nullish().describe("ID of the parent asset for child assets CalmLens extracts during processing, such as images in a document. `null` for uploaded assets."),
	parentPages: zod.array(zod.number().int().positive()).nullish().describe("The pages of the parent document a child asset shows, numbered from 1: each page an extracted image is drawn on, or the page or slide a render shows"),
	folderId: idField("fldr").nullish().meta(metaStore([docPropertyInfo({ description: "Folder containing the asset" })])),
	uploadPresetId: idField("preset").nullish().describe("ID of the upload preset the asset was uploaded through, if any"),
	createdAt: createdAtField().describe("When the asset was created, in milliseconds since the Unix epoch"),
	updatedAt: updatedAtField().describe("When the asset was last updated, in milliseconds since the Unix epoch"),
	checksums: CHECKSUMS_SCHEMA.nullish().describe("Digests of the stored content"),
	imageData: IMAGE_DATA_SCHEMA.nullish().describe("Image properties, for image assets"),
	fileMetadata: FILE_METADATA_SCHEMA.nullish().describe("Metadata embedded in the uploaded image, read during processing"),
	aiProvenance: AI_PROVENANCE_SCHEMA.nullish().describe("AI provenance the uploaded image declares, read at upload for AI-generated content detection"),
	name: saneStringField({ type: "large" }).meta(metaStore([docPropertyInfo({
		description: "Name of the asset",
		placeholder: "my-image.jpg",
		example: "product-photo.jpg"
	})])),
	fileFormat: saneStringField().nullish().describe("MIME type of the stored content"),
	fileExtension: saneStringField().nullish().describe("File extension of the stored content"),
	description: saneStringField({ type: "large" }).nullish().meta(metaStore([docPropertyInfo({
		description: "Optional description of the asset",
		placeholder: "A beautiful landscape image"
	})])),
	externalId: saneStringField().nullish().meta(metaStore([docPropertyInfo({
		description: "External identifier for the asset",
		placeholder: "ext-12345"
	})])),
	externalUrl: EXTERNAL_URL_SCHEMA.nullish().meta(metaStore([docPropertyInfo({
		description: "External URL associated with the asset (http or https)",
		placeholder: "https://example.com/asset"
	})])),
	authorId: MODERATION_AUTHOR_ID_SCHEMA.nullish(),
	context: USED_MODERATION_CONTEXT_SCHEMA.nullish(),
	previewImage: PREVIEW_IMAGE_SCHEMA.nullish().describe("The still image served at the preview resource: an image's own picture (or its converted HEIC), a document's first page, a website's screenshot, a video's poster or an audio waveform"),
	renderedMedia: RENDERED_MEDIA_SCHEMA.nullish().describe("Browser-safe copy of an audio or video upload, served at the rendered resource; `null` until processing makes one"),
	storageId: saneStringField().nullish().describe("Internal storage key of the retained content; `null` when nothing is stored"),
	uploadPartsReceived: zod.number().int().nullish().describe("Number of parts received so far for a multipart upload"),
	type: ASSET_TYPE_SCHEMA.describe("Asset type, detected from the content's MIME type"),
	metadata: zod.array(METADATA_ITEM_SCHEMA, { error: "Expected an array of { id, value } metadata items" }).nullish().meta(metaStore([docPropertyInfo({ description: "List of custom metadata items for the asset" })])),
	tags: zod.array(saneStringField()).nullish().meta(metaStore([docPropertyInfo({
		description: "Array of tags for the asset",
		placeholder: "[\"tag1\", \"tag2\"]"
	})])),
	moderatedJurisdictions: SERVED_JURISDICTIONS_SCHEMA.optional(),
	report: CLASSIFICATION_REPORT_SCHEMA.nullish().describe("Moderation report, set once classification finishes. See [Report format](/docs/guides/classification-results)."),
	uploadStatus: zod.enum(["uploading", "completed"]).default("completed"),
	uploadUpdatedAt: zod.number().nullish(),
	classificationStatus: ASSET_CLASSIFICATION_STATUS_SCHEMA,
	classificationUpdatedAt: zod.number().nullish(),
	/** Set with `classificationStatus: "failed"`, cleared when processing starts again. */
	classificationFailureReason: ASSET_FAILURE_REASON_SCHEMA.nullish(),
	/** Set while long audio or video is analysed in sections. */
	classificationProgress: CLASSIFICATION_PROGRESS_SCHEMA.nullish(),
	moderationStatus: ASSET_MODERATION_STATUS_SCHEMA,
	manualReviews: zod.array(STORED_ASSET_REVIEW_SCHEMA).default([]).meta(metaStore([backfill({ value: [] })])),
	reviewRevision: zod.number().int().default(0).meta(metaStore([backfill({ value: 0 })])),
	/** The review the project's human review queue is waiting for (`AssetPendingReview`). */
	pendingReview: ASSET_PENDING_REVIEW_SCHEMA.nullish(),
	completedAt: zod.number().int().nullish(),
	contentStatus: ASSET_CONTENT_STATUS_SCHEMA,
	contentRemovalReason: ASSET_CONTENT_REMOVAL_REASON_SCHEMA.nullish(),
	contentUpdatedAt: zod.number().nullish(),
	safetyTest: zod.boolean().nullish(),
	safetyHold: ASSET_SAFETY_HOLD_SCHEMA.nullish(),
	copyrightHolds: zod.array(idField("tkt")).nullish(),
	extractedText: EXTRACTED_TEXT_SCHEMA.nullish().meta(metaStore([docPropertyInfo({ description: "Extracted text stored inline for small content or in R2 for larger content" })])),
	processingOptions: PROCESSING_OPTIONS_SCHEMA.describe("Processing options supplied when the asset was uploaded"),
	freeUpload: zod.boolean().nullish().describe("Uploaded with the organisation's free uploads, before billing was set up; its text is moderated only up to the free upload limit while billing is still not set up"),
	visibility: ASSET_VISIBILITY_SCHEMA.nullish().meta(metaStore([docPropertyInfo({
		description: "Visibility level of the asset",
		defaultValue: "private"
	})]))
}).meta(metaStore([docPropertyInfo({
	description: "An asset as stored",
	namedType: "StoredAsset"
})]));
const epoch = (description) => zod.number().int().nullable().describe(`${description}, in milliseconds since the Unix epoch`);
const ASSET_UPLOAD_STATUS_SCHEMA = zod.enum(["uploading", "completed"]);
const ASSET_UPLOAD_SCHEMA = zod.object({
	status: ASSET_UPLOAD_STATUS_SCHEMA,
	updatedAt: epoch("When upload state last changed"),
	partsReceived: zod.number().int().nullable()
}).meta(metaStore([docPropertyInfo({
	description: "Upload state",
	namedType: "AssetUpload"
})]));
const ASSET_MODERATION_TIMELINE_SCHEMA = zod.object({ segmentCount: zod.number().int().nonnegative().describe("How many segments the asset's findings timeline holds") }).meta(metaStore([docPropertyInfo({
	description: "Summary of an audio or video asset's findings timeline",
	namedType: "AssetModerationTimeline"
})]));
/** A stricter delivery decision in one jurisdiction the project serves. */
const ASSET_REGIONAL_DECISION_SCHEMA = zod.object({
	region: JURISDICTION_SCHEMA.exclude(["global"]),
	status: ASSET_MODERATION_DECISION_SCHEMA.exclude(["allowed"]).describe("The status in force in the region, stricter than `moderation.status`"),
	rule: zod.string().describe("The mandatory rule that sets it"),
	category: CLASSIFICATION_CATEGORY_SCHEMA.optional().describe("The category whose findings the rule acted on, when it acts on one")
}).strict().meta(metaStore([docPropertyInfo({
	description: "A stricter delivery decision in a jurisdiction the project serves",
	namedType: "AssetRegionalDecision"
})]));
const ASSESSMENT_FIELDS = MODERATION_ASSESSMENT_FIELDS_SCHEMA.shape;
/** Findings and the policy/reviewer decision for the moderation capability. */
const ASSET_MODERATION_SCHEMA = zod.object({
	status: ASSET_MODERATION_STATUS_SCHEMA.describe("The decision in force, which also decides delivery: `pending`, `allowed`, `limited` (delivered normally, marked for reduced reach), `age-restricted` (served only with `viewerClaims.ageConfirmed: true` and any required private-asset access), `blocked` or `purged`. A reviewer's decision takes precedence."),
	manualReviews: zod.array(ASSET_REVIEW_SCHEMA).describe("Review history, oldest first. Later applied reviews supersede earlier decisions."),
	automatedStatus: ASSET_MODERATION_DECISION_SCHEMA.nullable().describe("The status automated moderation decided, `null` until it decides. Manual reviews can change `status` without changing this, so the two differ when a reviewer overrode the automated decision."),
	source: ASSESSMENT_FIELDS.source.nullable().describe("What decided the automated status: the `policy`'s categories, the asset's `children`, a `hash-list` match, a `mandatory-rule` or `link-safety`. `null` until moderation decides."),
	policy: DECISION_POLICY_SCHEMA.nullable().describe("The policy that made the automated decision: its ID, its `revision` then and the preset release it used. `null` until moderation decides."),
	pendingReview: ASSET_PENDING_REVIEW_SCHEMA.nullable().describe("The review your human review queue is waiting for, set together with the automated decision that joined the queue. `null` when no review is waiting: once a reviewer decides it, or when the asset leaves the queue unreviewed because its content was removed."),
	rule: ASSESSMENT_FIELDS.rule.unwrap().nullable().describe("The mandatory rule that decided, when `source` is `mandatory-rule`; otherwise `null`"),
	explanationComplete: ASSESSMENT_FIELDS.explanationComplete.nullable().describe("Whether all questions needed for a complete explanation of the decision were answered, `null` until moderation decides. False means questions that could not change any action were skipped; the actions are still final."),
	categories: zod.partialRecord(CLASSIFICATION_CATEGORY_SCHEMA, PUBLIC_CATEGORY_ASSESSMENT_SCHEMA).nullable().describe("Each assessed category's policy score and action, `null` until moderation decides. Unassessed categories are left out."),
	flaggedCategories: ASSESSMENT_FIELDS.flaggedCategories,
	regions: zod.array(ASSET_REGIONAL_DECISION_SCHEMA).describe("Stricter decisions in jurisdictions the project serves, which apply to viewers there. Empty when there are none."),
	linkSafety: zod.object({
		action: LINK_SAFETY_ACTION_SCHEMA.describe("The strongest action the asset's links take under the policy's link-safety settings."),
		links: zod.array(CHECKED_LINK_SCHEMA).describe("The links that take that action, with where each leads and its verdict."),
		settings: LINK_SAFETY_SETTINGS_SCHEMA
	}).strict().nullable().describe("Preview. What the policy's link-safety section made of the asset's links. `null` when the policy doesn't act on links and until moderation decides."),
	raw: zod.object({
		categories: PUBLIC_CATEGORIES_SCHEMA,
		hashMatches: CLASSIFICATION_REPORT_SCHEMA.shape.raw.shape.hashMatches.unwrap().describe("Entries in the project's hash lists that the image matched, blocking matches first and then the closest. Empty when nothing matched.")
	}).strict().nullable().describe("Detection findings before policy evaluation, `null` until the asset is analysed."),
	timeline: ASSET_MODERATION_TIMELINE_SCHEMA.nullable().describe("For audio and video: a summary of the findings timeline, which lists findings for each stretch of the media. Page through it with `GET /v1/projects/:projectId/assets/:assetId/timeline`. `null` for other assets, before there are findings and while a safety or copyright hold withholds the asset's content.")
}).omit({}).refine((moderation) => moderation.source === "mandatory-rule" ? Boolean(moderation.rule) : moderation.rule === null, {
	message: "moderation/rule-required",
	path: ["rule"]
}).meta(metaStore([docPropertyInfo({
	description: "Moderation findings and decision",
	namedType: "AssetModeration"
})]));
const ASSET_CLASSIFICATION_SCHEMA = zod.object({
	status: ASSET_CLASSIFICATION_STATUS_SCHEMA.describe("Where processing is: `queued` while the asset waits for its content (a multipart upload still receiving parts) or its turn, `processing`, then `completed` or `failed`. The asset is settled once it is `completed` or `failed`; a failed asset's `moderation.status` stays `pending`."),
	failureReason: ASSET_FAILURE_REASON_SCHEMA.nullable().describe("Why processing failed, while `status` is `failed`; otherwise `null`. See [Failure reasons](/docs/guides/asset-lifecycle#failure-reasons)."),
	updatedAt: epoch("When classification state last changed"),
	completedAt: epoch("When classification completed"),
	progress: CLASSIFICATION_PROGRESS_SCHEMA.nullable().describe("While long audio or video is analysed in sections and `status` is `processing`: how many of its sections are done. `null` otherwise. See [Long audio and video](/docs/guides/audio-and-video#long-audio-and-video)."),
	testInput: zod.boolean().describe("Whether the results came from one of the project's test inputs (a signed text code, test image or media test phrase) rather than from analysing the content. Test results, including person and face detection and age ranges, are declared by the input: never use them for real decisions such as age checks. See [Testing](/docs/guides/testing)."),
	moderation: ASSET_MODERATION_SCHEMA,
	ocr: OCR_RESULT_SCHEMA.nullable().describe("OCR's result for an image processed with `processingOptions.features.ocr`: where it found text. For a document or website with OCR on, `not-evaluated` with reason `in-children`: each of its images is a child asset with its own `ocr`, and a document's children give their pages in `parentPages` (list them with `GET /v1/assets/{assetId}/children`). `null` when OCR wasn't requested."),
	personDetection: PERSON_DETECTION_RESULT_SCHEMA.nullable().describe("Preview. Person detection's result, `null` when it didn't run"),
	faceDetection: FACE_DETECTION_RESULT_SCHEMA.nullable().describe("Preview. Face detection's result, `null` when it didn't run"),
	linkDetection: LINK_DETECTION_RESULT_SCHEMA.nullable().describe("Link detection's result for an image, `null` when it didn't run"),
	linkSafety: LINK_SAFETY_RESULT_SCHEMA.nullable().describe("Preview. Where each link in the asset leads and its verdict, when the project's policy acts on links; otherwise `null`."),
	aiGeneratedDetection: AI_GENERATED_DETECTION_RESULT_SCHEMA.nullable().describe("Preview. AI-generated detection's result, `null` when it didn't run")
}).omit({ aiGeneratedDetection: true }).meta(metaStore([docPropertyInfo({
	description: "Classification results",
	namedType: "AssetClassification"
})]));
const ASSET_CONTENT_SCHEMA = zod.object({
	status: ASSET_CONTENT_STATUS_SCHEMA.describe("Whether CalmLens holds the content (source, preview, extracted text and file metadata): `temporary` until processing finishes, `stored`, or `removed`"),
	removalReason: ASSET_CONTENT_REMOVAL_REASON_SCHEMA.nullable().describe("Why the content was removed: your `policy` purged it, `retention` because `keepContentAfterProcessing` was off, `requested` through the API or portal, `parent-removed` with its parent asset's content, or `disposed` after a safety hold. `null` while content is held."),
	updatedAt: epoch("When the content status last changed"),
	safetyHold: ASSET_SAFETY_HOLD_SCHEMA.nullable().describe("Set while CalmLens holds the asset for suspected illegal content: its content isn't delivered and the asset can't be changed or deleted until the hold ends, so such requests return `asset/held`. `null` when there is no hold."),
	format: zod.string().nullable().describe("MIME type of the uploaded file"),
	extension: zod.string().nullable().describe("File extension of the uploaded file"),
	sizeInBytes: zod.number().int().nullable().describe("Size of the uploaded file in bytes"),
	checksums: CHECKSUMS_SCHEMA.nullable().describe("Digests of the file as stored: for an image, after embedded metadata is removed unless `storeSensitiveMetadata` is on"),
	width: pixels("Width in pixels of the uploaded image or video; `null` when unknown, for other types and while the asset is held"),
	height: pixels("Height in pixels of the uploaded image or video, like `width`"),
	durationSeconds: zod.number().positive().nullable().describe("Length in seconds of audio and video once analysed; otherwise `null`"),
	pageCount: zod.number().int().positive().nullable().describe("Number of pages or slides of a document or presentation, when known"),
	perceptualHash: zod.string().nullable().describe("PDQ perceptual hash used to match visually similar images, as 64 hexadecimal characters, for image assets. Hashes 31 or fewer bits apart are usually the same picture. `null` while the asset is held."),
	perceptualHashQuality: zod.number().int().min(0).max(100).nullable().describe("How much detail `perceptualHash` captured, from 0 to 100. Hashes below 50 come from flat or featureless images and match unrelated pictures, so leave them out of comparisons."),
	metadata: FILE_METADATA_SCHEMA.nullable().describe("Metadata embedded in an uploaded image, such as its capture time, camera and software, read before any of it is removed for `storeSensitiveMetadata`. Read-only and separate from the asset's own `metadata`. `null` when the image declares none, for other asset types, once the content is removed and while the asset is held."),
	extractedText: EXTRACTED_TEXT_SCHEMA.nullable().describe("Text extracted from the content (including image OCR), inline for small content or stored as a document. `null` while the asset is held."),
	rendered: ASSET_RENDERED_SCHEMA.nullable().describe("The displayable file, served at `/rendered`: an image, a PDF, or browser-safe video or audio. `null` when the asset has none (text, spreadsheets and other files, or media not yet made browser-safe), once the content is removed and while the asset is held."),
	hls: ASSET_HLS_SCHEMA.nullable().describe("Preview. The adaptive (HLS) stream of video or audio, once streaming has prepared it from the rendered file, served at `/hls/index.m3u8` and played by the embed page at `/embed`. `null` for other assets, until a stream is prepared, once the content is removed and while the asset is held."),
	hlsStatus: ASSET_HLS_STATUS_SCHEMA.nullable().describe("Preview. Whether the adaptive stream asked for is ready, or why it isn't. `null` when no stream was asked for, once the content is removed, while the asset is held and while it is blocked; with only the project's streaming setting asking, also until the asset's rendered file exists."),
	preview: ASSET_PREVIEW_SCHEMA.nullable().describe("A still image for the asset, served at `/preview` (and its blurred placeholder at `/placeholder`). `null` when the asset has none (text, spreadsheets and other files, or a document, video or audio whose still isn't made yet), once the content is removed and while the asset is held.")
}).meta(metaStore([docPropertyInfo({
	description: "Content state",
	namedType: "AssetContent"
})]));
STORED_ASSET_SCHEMA.pick({
	id: true,
	projectId: true,
	parentId: true,
	folderId: true,
	uploadPresetId: true,
	createdAt: true,
	updatedAt: true,
	type: true,
	name: true,
	description: true,
	externalId: true,
	externalUrl: true,
	authorId: true,
	context: true
}).extend({
	parentPages: zod.array(zod.number().int().positive()).describe("For a child asset extracted from a document: the pages of the parent document it shows, numbered from 1. An image drawn on several pages lists each; a render of a page or slide lists that one. Empty for other assets, and for children whose page isn't known: a document's text, an image read from a Word, OpenDocument or spreadsheet file without laying out its pages, a presentation's embedded images, and website children."),
	metadata: zod.array(METADATA_ITEM_SCHEMA).describe("Custom metadata items, by metadata field. Empty when the asset has none."),
	tags: zod.array(saneStringField()).describe("Tags for the asset. Empty when it has none."),
	visibility: ASSET_VISIBILITY_SCHEMA.describe("`public` assets are delivered from their plain URL; `private` ones, the default, need a signed asset URL"),
	upload: ASSET_UPLOAD_SCHEMA,
	classification: ASSET_CLASSIFICATION_SCHEMA,
	content: ASSET_CONTENT_SCHEMA
}).meta(metaStore([docPropertyInfo({
	description: "An asset in the system",
	namedType: "Asset",
	example: {
		id: EXAMPLE_IDS.asset,
		projectId: EXAMPLE_IDS.proj,
		name: "product-photo.jpg",
		type: "image",
		createdAt: 17672256e5,
		description: "Front view of a blue backpack",
		parentId: null,
		parentPages: [],
		folderId: null,
		uploadPresetId: null,
		updatedAt: 1767225601e3,
		externalId: null,
		externalUrl: null,
		authorId: null,
		context: null,
		metadata: [],
		tags: ["catalogue", "backpacks"],
		visibility: "private",
		upload: {
			status: "completed",
			updatedAt: 17672256e5,
			partsReceived: null
		},
		classification: {
			status: "completed",
			failureReason: null,
			updatedAt: 1767225601e3,
			completedAt: 1767225601e3,
			progress: null,
			testInput: false,
			moderation: {
				status: "allowed",
				manualReviews: [],
				automatedStatus: "allowed",
				policy: {
					id: EXAMPLE_IDS.pol,
					revision: 3,
					preset: {
						id: "general-community",
						version: 35
					}
				},
				pendingReview: null,
				source: "policy",
				rule: null,
				explanationComplete: true,
				categories: { violence: {
					score: .01,
					action: "allow",
					source: { kind: "below-threshold" }
				} },
				flaggedCategories: [],
				regions: [],
				linkSafety: null,
				raw: {
					categories: Object.fromEntries(CLASSIFICATION_CATEGORIES.map((category) => [category, {
						status: "evaluated",
						likelihood: "very-unlikely",
						score: .01
					}])),
					hashMatches: []
				},
				timeline: null
			},
			ocr: null,
			linkDetection: {
				status: "evaluated",
				qrCodes: [],
				links: []
			},
			personDetection: null,
			faceDetection: null,
			linkSafety: null
		},
		content: {
			status: "stored",
			removalReason: null,
			updatedAt: 1767225601e3,
			safetyHold: null,
			format: "image/jpeg",
			extension: "jpg",
			sizeInBytes: 245760,
			checksums: null,
			width: 1200,
			height: 900,
			durationSeconds: null,
			pageCount: null,
			perceptualHash: null,
			perceptualHashQuality: null,
			metadata: {
				capturedAt: "2026-05-01T12:30:00+01:00",
				cameraMake: "Canon",
				cameraModel: "EOS R5",
				lensModel: null,
				software: "Adobe Lightroom",
				creator: null,
				copyright: null,
				digitalSourceType: null,
				containsLocation: false,
				location: null
			},
			rendered: {
				kind: "image",
				format: "image/jpeg",
				width: 1200,
				height: 900
			},
			preview: {
				width: 1200,
				height: 900,
				thumbhash: null,
				averageColor: null
			},
			hls: null,
			hlsStatus: null,
			extractedText: null
		}
	}
})])).extend({
	userId: STORED_ASSET_SCHEMA.shape.userId,
	processingOptions: STORED_ASSET_SCHEMA.shape.processingOptions.optional(),
	report: CLASSIFICATION_REPORT_SCHEMA.nullish(),
	classification: ASSET_CLASSIFICATION_SCHEMA.extend({ moderation: ASSET_MODERATION_SCHEMA.safeExtend({ manualReviews: zod.array(ASSET_REVIEW_SCHEMA.extend({
		reviewerName: zod.string().nullish(),
		reviewerEmail: zod.string().nullish()
	})) }) }),
	content: ASSET_CONTENT_SCHEMA.extend({ safetyTest: zod.boolean().optional().describe("Marks a synthetic back-office safety exercise asset") })
});
/**
* Where a composite asset (a website or document with extracted children) is in unpacking its
* content. Its status comes from its children only once they all exist (`ready`).
*/
const CHILD_PROCESSING_SCHEMA = zod.enum(["extracting", "ready"]);
/** A reviewer's decision on a composite asset, which its children's statuses don't override. */
const MANUAL_DECISION_SCHEMA = ASSET_MODERATION_DECISION_SCHEMA;
zod.object({
	assetId: idField("asset"),
	projectId: idField("proj"),
	childProcessing: CHILD_PROCESSING_SCHEMA.nullish(),
	manualDecision: MANUAL_DECISION_SCHEMA.nullish(),
	/** The children extraction created: fewer existing (one deleted) can't decide the parent. */
	expectedChildren: zod.number().int().nonnegative().nullish()
});
// packages/shared/src/ConnectorType.ts
/** Where a connector delivers events. Kept apart from `Connector.ts`, which the event catalog can't import. */
const CONNECTOR_TYPE_SCHEMA = zod.enum([
	"in-app",
	"webhook",
	"slack",
	"email"
]);
// packages/shared/src/ProjectAccess.ts
const PROJECT_MEMBER_ROLE_SCHEMA = zod.enum([...ACCESS_ROLE_SCHEMA.options, "reviewer"]);
zod.object({
	id: primaryIdField("mem"),
	projectId: idField("proj"),
	userId: idField("user"),
	role: PROJECT_MEMBER_ROLE_SCHEMA,
	grants: GRANTS_SCHEMA.default([]),
	createdAt: zod.number()
});
zod.object({
	id: primaryIdField("inv"),
	projectId: idField("proj"),
	email: zod.string().email(),
	role: PROJECT_MEMBER_ROLE_SCHEMA,
	grants: GRANTS_SCHEMA.default([]),
	tokenHash: zod.string(),
	invitedBy: zod.string(),
	createdAt: zod.number(),
	expiresAt: zod.number(),
	status: zod.enum([
		"pending",
		"accepted",
		"revoked"
	])
});
// packages/shared/src/EventCatalog.ts
const EVENT_SEVERITY_SCHEMA = zod.enum(["low", "high"]);
zod.enum([
	"assets",
	"moderation",
	"usage",
	"team",
	"api-keys",
	"connectors"
]);
msg("Assets"), msg("Moderation"), msg("Usage"), msg("Team"), msg("API keys"), msg("Connectors");
zod.enum([
	"text",
	"code",
	"enum",
	"list",
	"number",
	"date"
]);
const ASSET_TYPE_LABELS = {
	image: msg("Image"),
	video: msg("Video"),
	audio: msg("Audio"),
	"plaintext-document": msg("Plaintext document"),
	"multimedia-document": msg("Multimedia document"),
	website: msg("Website"),
	file: msg("File")
};
const MODERATION_STATUS_LABELS = {
	pending: msg("Pending"),
	allowed: msg("Allowed"),
	limited: msg("Limited"),
	"age-restricted": msg("Age restricted"),
	blocked: msg("Blocked"),
	purged: msg("Purged")
};
const PROCESSING_STATUS_LABELS = {
	queued: msg("Queued"),
	processing: msg("Processing"),
	completed: msg("Completed"),
	failed: msg("Failed")
};
/** Readable names for why an asset's processing failed, shared with the portal. */
const ASSET_FAILURE_REASON_LABELS = {
	"file-too-large": msg("File too large"),
	"duration-limit": msg("Too long"),
	"resolution-limit": msg("Resolution too high"),
	"unsupported-format": msg("Unsupported format"),
	"undecodable-content": msg("Can't be decoded"),
	"multiple-tracks": msg("Multiple tracks"),
	"type-mismatch": msg("Doesn't match asset type"),
	"free-uploads-exhausted": msg("Free uploads used"),
	"media-limit": msg("Daily media limit"),
	"uploads-paused": msg("Uploads paused"),
	"too-many-items": msg("Too many parts"),
	"processing-error": msg("Processing error")
};
const CATEGORY_LABELS = {
	sexual: msg("Sexual"),
	violence: msg("Violence"),
	"self-harm": msg("Self harm"),
	harassment: msg("Harassment"),
	hate: msg("Hate"),
	"personal-information": msg("Personal information"),
	profanity: msg("Profanity"),
	"criminal-activity": msg("Criminal activity")
};
/** Project roles as the portal names them. */
const PROJECT_ROLE_LABELS = {
	admin: msg("Administrator"),
	configurator: msg("Configurator"),
	editor: msg("Editor"),
	viewer: msg("Viewer"),
	custom: msg("Custom"),
	reviewer: msg("Reviewer")
};
const field = (schema, info) => ({
	...info,
	schema: schema.meta(metaStore([docPropertyInfo({ description: info.description })]))
});
const dataSchemaFromFields = (fields, description) => zod.object(Object.fromEntries(Object.entries(fields).map(([key, definition]) => [key, definition.schema]))).meta(metaStore([docPropertyInfo({ description })]));
const assetNameField = field(zod.string().nullish(), {
	label: msg("Asset"),
	description: "The asset's name when the event was created.",
	display: "text"
});
const assetTypeField = field(ASSET_TYPE_SCHEMA.nullish(), {
	label: msg("Asset type"),
	description: "The asset's type, such as `image` or `video`.",
	display: "enum",
	valueLabels: ASSET_TYPE_LABELS
});
/** Set on assets CalmLens extracts from an upload, such as the text and images of a document. */
const parentAssetField = field(zod.string().optional(), {
	label: msg("Parent asset"),
	description: "ID of the uploaded asset this one was extracted from, such as the text or an image of a document, as in the asset's `parentId`. Absent for uploaded assets.",
	display: "code"
});
const reviewerNameField = field(zod.string().nullish(), {
	label: msg("Reviewer"),
	description: "Name or email of the user who made the decision, or the API key's name, when known.",
	display: "text",
	inAppOnly: true,
	names: "actor"
});
const flaggedCategoriesSchema = zod.array(zod.enum(CLASSIFICATION_CATEGORIES));
/** Set on the events of an asset batch operation (`POST /assets/batch`). */
const batchIdField = field(idField("batch").optional(), {
	label: msg("Batch ID"),
	description: "ID of the batch operation that caused the event, as `batchId` in the batch response. Absent when the asset was changed on its own.",
	display: "code",
	hidden: true
});
const eventFactKey = (key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const defineEventType = (definition) => ({
	...definition,
	factInfo: Object.entries(definition.fields).map(([key, info]) => ({
		key: eventFactKey(key),
		...info
	})),
	values: dataSchemaFromFields(definition.fields, `Data for \`${definition.id}\` events.`)
});
const ASSET_UPLOADED = defineEventType({
	id: "asset.uploaded",
	name: msg("Asset uploaded"),
	description: msg("A new asset was uploaded to the project."),
	category: "assets",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		fileFormat: field(zod.string().nullish(), {
			label: msg("File format"),
			description: "The uploaded file's format, such as `jpg`.",
			display: "code"
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		fileFormat: "jpg"
	}
});
const FLAGGED_CATEGORIES_INFO = {
	label: msg("Categories"),
	description: "The parent policy categories whose findings decided the status, or none when nothing was acted on. Inspect the asset's classification results for qualifier detail.",
	display: "list",
	valueLabels: CATEGORY_LABELS
};
const ASSET_CLASSIFIED = defineEventType({
	id: "asset.classified",
	name: msg("Asset classified"),
	description: msg("Classification finished for the asset, including the moderation decision it produced."),
	category: "moderation",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		parentAsset: parentAssetField,
		flaggedCategories: field(flaggedCategoriesSchema, FLAGGED_CATEGORIES_INFO),
		moderationStatus: field(ASSET_MODERATION_STATUS_SCHEMA, {
			label: msg("Moderation status"),
			description: "The asset's status once classification finished: `allowed`, `limited`, `age-restricted`, `blocked` or `purged`. Usually the status the policy decided; when a reviewer decided the asset while it was being processed, their decision stands and this is their status.",
			display: "enum",
			valueLabels: MODERATION_STATUS_LABELS
		}),
		automatedStatus: field(ASSET_MODERATION_DECISION_SCHEMA.optional(), {
			label: msg("Automated status"),
			description: "Present only when a reviewer decided the asset while it was being processed: the status the policy decided, which was not applied. The report and scores are still stored with the asset.",
			display: "enum",
			valueLabels: MODERATION_STATUS_LABELS
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		flaggedCategories: ["sexual"],
		moderationStatus: "age-restricted"
	}
});
const ASSET_REGION_RESTRICTED = defineEventType({
	id: "asset.region-restricted",
	name: msg("Asset region restricted"),
	description: msg("An asset has a stricter delivery decision in a jurisdiction served by the project."),
	category: "moderation",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		parentAsset: parentAssetField,
		region: field(JURISDICTION_SCHEMA.exclude(["global"]), {
			label: msg("Region"),
			description: "Jurisdiction whose mandatory rule raises the delivery action.",
			display: "code"
		}),
		rule: field(zod.string(), {
			label: msg("Rule"),
			description: "Stable mandatory rule key.",
			display: "code"
		}),
		status: field(ASSET_MODERATION_DECISION_SCHEMA.exclude(["allowed"]), {
			label: msg("Status"),
			description: "The asset's status for viewers in the region: `limited`, `age-restricted`, `blocked` or `purged`.",
			display: "enum",
			valueLabels: MODERATION_STATUS_LABELS
		})
	},
	example: {
		assetName: "photo.jpg",
		assetType: "image",
		region: "GB",
		rule: "gb-adult-content",
		status: "age-restricted"
	}
});
/**
* One event per moderation status, emitted whenever automated moderation or a reviewer sets it. The
* event's `actor` says who decided: `automated` moderation, a `user` (a reviewer in the portal, or
* an assistant acting for one) or an `api-key` through the API.
*/
const defineModerationOutcome = (outcome) => defineEventType({
	...outcome,
	category: "moderation",
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		parentAsset: parentAssetField,
		flaggedCategories: field(flaggedCategoriesSchema.optional(), FLAGGED_CATEGORIES_INFO),
		reviewerName: reviewerNameField,
		note: field(zod.string().nullish(), {
			label: msg("Note"),
			description: "The reviewer's note, or `null`.",
			display: "text"
		}),
		childAsset: field(zod.string().optional(), {
			label: msg("Child asset"),
			description: "Present when a reviewer's decision on one of this asset's child assets changed this asset's status: the ID of that child. The event's `actor` is that reviewer.",
			display: "code"
		}),
		childStatus: field(ASSET_MODERATION_DECISION_SCHEMA.optional(), {
			label: msg("Child status"),
			description: "Present with `child-asset`: the status the reviewer gave that child, such as `blocked`.",
			display: "enum",
			valueLabels: MODERATION_STATUS_LABELS
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		flaggedCategories: outcome.id === "asset.allowed" ? [] : ["sexual"]
	}
});
const ASSET_ALLOWED = defineModerationOutcome({
	id: "asset.allowed",
	name: msg("Asset allowed"),
	description: msg("The asset was allowed and is delivered normally."),
	severity: "low",
	notify: false
});
const ASSET_LIMITED = defineModerationOutcome({
	id: "asset.limited",
	name: msg("Asset limited"),
	description: msg("The asset was limited: it is delivered normally, but marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it."),
	severity: "low",
	notify: false
});
const ASSET_AGE_RESTRICTED = defineModerationOutcome({
	id: "asset.age-restricted",
	name: msg("Asset age-restricted"),
	description: msg("The asset was age-restricted: it is not served from its plain URL, only with `viewerClaims.ageConfirmed: true` and any required private-asset access, so your app decides who sees it."),
	severity: "high",
	notify: true
});
const ASSET_BLOCKED = defineModerationOutcome({
	id: "asset.blocked",
	name: msg("Asset blocked"),
	description: msg("The asset was blocked and is no longer delivered. Its content is kept."),
	severity: "high",
	notify: true
});
const ASSET_PURGED = defineModerationOutcome({
	id: "asset.purged",
	name: msg("Asset purged"),
	description: msg("The asset was purged: it is no longer delivered and its stored content was deleted."),
	severity: "high",
	notify: true
});
const ASSET_FAILED = defineEventType({
	id: "asset.failed",
	name: msg("Asset failed"),
	description: msg("The asset could not be processed and its processing status is `failed`."),
	category: "assets",
	severity: "high",
	notify: true,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		parentAsset: parentAssetField,
		previousStatus: field(ASSET_CLASSIFICATION_STATUS_SCHEMA.nullish(), {
			label: msg("Previous status"),
			description: "The asset's processing status before it failed, such as `processing`.",
			display: "enum",
			valueLabels: PROCESSING_STATUS_LABELS
		}),
		failureReason: field(ASSET_FAILURE_REASON_SCHEMA, {
			label: msg("Reason"),
			description: "Why processing failed, as in the asset's `classification.failureReason`, such as `duration-limit`.",
			display: "enum",
			valueLabels: ASSET_FAILURE_REASON_LABELS
		})
	},
	example: {
		assetName: "clip.mp4",
		assetType: "video",
		previousStatus: "processing",
		failureReason: "duration-limit"
	}
});
const ASSET_PROGRESS_UPDATED = defineEventType({
	id: "asset.progress-updated",
	name: msg("Processing progress"),
	description: msg("Long audio or video analysed in sections finished more of them. Sent every tenth of its sections or 30 seconds, whichever comes first, while it is processing."),
	category: "assets",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		completedSections: field(zod.number().int().nonnegative(), {
			label: msg("Sections done"),
			description: "Sections analysed so far, as in the asset's `classification.progress.completedSections`.",
			display: "number"
		}),
		totalSections: field(zod.number().int().positive(), {
			label: msg("Sections"),
			description: "Sections the media is analysed in, as in `classification.progress.totalSections`.",
			display: "number"
		})
	},
	example: {
		assetName: "lecture.mp4",
		assetType: "video",
		completedSections: 13,
		totalSections: 63
	}
});
const USAGE_FREE_UPLOADS_EXHAUSTED = defineEventType({
	id: "usage.free-uploads-exhausted",
	name: msg("Free uploads used"),
	description: msg("The project's organisation used its free upload allowance; new uploads are blocked until billing is set up."),
	category: "usage",
	severity: "high",
	notify: true,
	permission: "assets:read",
	fields: {
		limit: field(zod.number().int(), {
			label: msg("Limit"),
			description: "Number of free uploads in the allowance.",
			display: "number"
		}),
		used: field(zod.number().int(), {
			label: msg("Used"),
			description: "Number of free uploads used.",
			display: "number"
		}),
		organisationId: field(idField("org"), {
			label: msg("Organisation ID"),
			description: "ID of the organisation whose allowance was used.",
			display: "code",
			hidden: true,
			inAppOnly: true
		})
	},
	example: {
		limit: 100,
		used: 100,
		organisationId: EXAMPLE_IDS.org
	}
});
const PROJECT_MEMBER_JOINED = defineEventType({
	id: "project.member-joined",
	name: msg("Member joined"),
	description: msg("Someone accepted an invitation and joined the project."),
	category: "team",
	severity: "low",
	notify: true,
	permission: "members:read",
	fields: {
		memberUserId: field(idField("user"), {
			label: msg("Member ID"),
			description: "User ID of the new member.",
			display: "code",
			hidden: true
		}),
		memberName: field(zod.string().nullish(), {
			label: msg("Member"),
			description: "The new member's name or email.",
			display: "text",
			inAppOnly: true,
			names: "member"
		}),
		role: field(PROJECT_MEMBER_ROLE_SCHEMA, {
			label: msg("Role"),
			description: "The member's role: `admin`, `configurator`, `editor`, `viewer` or `custom`.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		})
	},
	example: {
		memberUserId: "user_7Tq2Wm9Lk4Xr8Vb3Np6C",
		memberName: "alex@example.com",
		role: "editor"
	}
});
const CONNECTOR_DISABLED = defineEventType({
	id: "connector.disabled",
	name: msg("Connector turned off"),
	description: msg("Deliveries to a connector kept failing, so it was turned off."),
	category: "connectors",
	severity: "high",
	notify: true,
	permission: "connectors:read",
	fields: {
		connectorId: field(idField("conn"), {
			label: msg("Connector ID"),
			description: "ID of the connector that was turned off.",
			display: "code",
			hidden: true
		}),
		connectorName: field(zod.string(), {
			label: msg("Connector"),
			description: "The connector's name.",
			display: "text"
		}),
		connectorType: field(CONNECTOR_TYPE_SCHEMA, {
			label: msg("Connector type"),
			description: "The connector's type, such as `webhook`, `slack` or `email`.",
			display: "enum",
			valueLabels: {
				"in-app": msg("In app"),
				webhook: msg("Webhook"),
				slack: msg("Slack"),
				email: msg("Email")
			}
		}),
		consecutiveFailures: field(zod.number().int(), {
			label: msg("Failures in a row"),
			description: "Number of deliveries in a row that failed after their retries.",
			display: "number"
		}),
		lastError: field(zod.string().nullish(), {
			label: msg("Last error"),
			description: "Summary of the most recent failure, or `null`.",
			display: "text",
			inAppOnly: true
		})
	},
	example: {
		connectorId: EXAMPLE_IDS.conn,
		connectorName: "Moderation alerts",
		connectorType: "webhook",
		consecutiveFailures: 10,
		lastError: "HTTP 500 Internal Server Error"
	}
});
/** Project roles a member can hold; reviewers only exist while the human review beta is on. */
const MEMBER_ROLE_SCHEMA = PROJECT_MEMBER_ROLE_SCHEMA;
const memberUserIdField = field(zod.string(), {
	label: msg("Member ID"),
	description: "User ID of the member.",
	display: "code",
	hidden: true
});
const memberNameField = field(zod.string().nullish(), {
	label: msg("Member"),
	description: "The member's name or email.",
	display: "text",
	inAppOnly: true,
	names: "member"
});
const ASSET_DELETED = defineEventType({
	id: "asset.deleted",
	name: msg("Asset deleted"),
	description: msg("An asset was deleted from the project, with its stored content."),
	category: "assets",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		batchId: batchIdField
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image"
	}
});
const ASSET_CONTENT_REMOVED = defineEventType({
	id: "asset.content-removed",
	name: msg("Content removed"),
	description: msg("An asset's stored content was removed on request. The asset and its classification results remain."),
	category: "assets",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		batchId: batchIdField
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image"
	}
});
const ASSET_RETRIED = defineEventType({
	id: "asset.retried",
	name: msg("Asset retried"),
	description: msg("A failed asset was queued for processing again."),
	category: "assets",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image"
	}
});
const ASSET_RERUN_REQUESTED = defineEventType({
	id: "asset.rerun-requested",
	name: msg("Moderation re-run requested"),
	description: msg("Moderation of a decided asset was requested again under the project's current policy. The event's `actor` made the request. The asset keeps its decision until the re-run's `asset.classified` event and status event report the new one; if the re-run fails, it keeps it."),
	category: "moderation",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		moderationStatus: field(ASSET_MODERATION_DECISION_SCHEMA, {
			label: msg("Status"),
			description: "The asset's status when the re-run was requested, which stands until the re-run decides it again: `allowed`, `limited`, `age-restricted` or `blocked`.",
			display: "enum",
			valueLabels: MODERATION_STATUS_LABELS
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		moderationStatus: "limited"
	}
});
const ASSET_REVIEW_REQUESTED = defineEventType({
	id: "asset.review-requested",
	name: msg("Review requested"),
	description: msg("An asset was added to the human review queue."),
	category: "moderation",
	severity: "low",
	notify: false,
	permission: "reviews:read",
	enabled: true,
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		parentAsset: parentAssetField,
		automatedStatus: field(HUMAN_REVIEW_SAMPLED_OUTCOME_SCHEMA, {
			label: msg("Automated status"),
			description: "The asset's status from automated moderation: `allowed`, `limited`, `age-restricted` or `blocked`.",
			display: "enum",
			valueLabels: MODERATION_STATUS_LABELS
		}),
		reviewReason: field(HUMAN_REVIEW_REASON_SCHEMA, {
			label: msg("Reason"),
			description: "Why the asset was queued: `sampled` by the project's random sample, or `uncertain` because a category's policy score was close to the threshold or evidence could not be assessed. An asset the sample draws is `sampled` even when it is also uncertain.",
			display: "enum",
			valueLabels: {
				sampled: msg("Sampled"),
				uncertain: msg("Uncertain")
			}
		}),
		uncertainCategories: field(HUMAN_REVIEW_UNCERTAIN_CATEGORIES_SCHEMA, {
			label: msg("Uncertain categories"),
			description: "The parent policy categories whose decision was uncertain under the project's review settings, or none.",
			display: "list",
			valueLabels: CATEGORY_LABELS
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		automatedStatus: "allowed",
		reviewReason: "uncertain",
		uncertainCategories: ["harassment"]
	}
});
const ASSET_HASH_MATCHED = defineEventType({
	id: "asset.hash-matched",
	name: msg("Hash list match"),
	description: msg("An uploaded image matched an entry in one of the project's hash lists. A close match on a block list blocks the asset."),
	category: "moderation",
	severity: "high",
	notify: true,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		parentAsset: parentAssetField,
		hashListId: field(idField("hl"), {
			label: msg("Hash list ID"),
			description: "ID of the hash list with the closest match.",
			display: "code",
			hidden: true
		}),
		hashListName: field(zod.string(), {
			label: msg("Hash list"),
			description: "Name of the hash list with the closest match.",
			display: "text"
		}),
		distance: field(zod.number().int(), {
			label: msg("Distance"),
			description: "Number of bits that differ between the image's PDQ hash and the listed hash. 0 is the same picture.",
			display: "number"
		}),
		matchAction: field(HASH_LIST_ACTION_SCHEMA, {
			label: msg("Action"),
			description: "What the match did: `block` blocked the asset, `flag` only reported it.",
			display: "enum",
			valueLabels: {
				flag: msg("Flagged"),
				block: msg("Blocked")
			}
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		hashListId: EXAMPLE_IDS.hl,
		hashListName: "Banned images",
		distance: 4,
		matchAction: "block"
	}
});
const ASSET_LINK_FLAGGED = defineEventType({
	id: "asset.link-flagged",
	name: msg("Link flagged"),
	description: msg("A link in an asset leads somewhere the project's policy acts on, such as a phishing, malware, adult or gambling site."),
	category: "moderation",
	severity: "high",
	notify: true,
	permission: "assets:read",
	enabled: true,
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		parentAsset: parentAssetField,
		linkVerdict: field(LINK_SAFETY_VERDICT_SCHEMA, {
			label: msg("Verdict"),
			description: "What the link's destination is: `adult`, `gambling`, `phishing`, `malware`, `unresolved` when a short link or redirect chain could not be followed or a check failed, or `safe` when only the off-platform setting acted. The most severe verdict of any address on the way decides.",
			display: "enum",
			valueLabels: LINK_SAFETY_VERDICT_LABELS
		}),
		linkUrl: field(zod.string(), {
			label: msg("Link"),
			description: "The link as it appears in the asset.",
			display: "text"
		}),
		linkFinalUrl: field(zod.string().nullish(), {
			label: msg("Destination"),
			description: "Where the link leads after its redirects. Absent when a short link or redirect chain could not be followed.",
			display: "text"
		}),
		linkStatus: field(ASSET_MODERATION_DECISION_SCHEMA.exclude(["allowed", "purged"]), {
			label: msg("Status"),
			description: "The status the policy's link-safety settings decided for the asset: `limited`, `age-restricted` or `blocked`.",
			display: "enum",
			valueLabels: MODERATION_STATUS_LABELS
		})
	},
	example: {
		assetName: "flyer.png",
		assetType: "image",
		linkVerdict: "phishing",
		linkUrl: "https://bit.ly/claim-prize",
		linkFinalUrl: "https://claim-your-prize.example.com/login",
		linkStatus: "blocked"
	}
});
const USAGE_UPLOADS_PAUSED = defineEventType({
	id: "usage.uploads-paused",
	name: msg("Uploads paused"),
	description: msg("The project's organisation reached a limit on its usage; new uploads are paused until it resumes."),
	category: "usage",
	severity: "high",
	notify: true,
	permission: "assets:read",
	fields: {
		reason: field(zod.enum([
			"spend-limit",
			"usage-cap",
			"project-budget",
			"payment-failed"
		]), {
			label: msg("Reason"),
			description: "Which limit paused uploads: the organisation's `spend-limit`, its `usage-cap`, the project's `project-budget`, or `payment-failed` while an invoice is unpaid.",
			display: "enum",
			valueLabels: {
				"spend-limit": msg("Spend limit"),
				"usage-cap": msg("Usage cap"),
				"project-budget": msg("Project budget"),
				"payment-failed": msg("Payment failed")
			}
		}),
		resumesAt: field(zod.number().int().nonnegative().nullish(), {
			label: msg("Uploads resume"),
			description: "When uploads resume at the latest, in milliseconds since the Unix epoch: the end of the billing period, or sooner if the limit is raised. Null while an invoice is unpaid: uploads resume once it is paid.",
			display: "date"
		})
	},
	example: {
		reason: "usage-cap",
		resumesAt: 17934912e5
	}
});
const UPLOAD_PRESET_DAILY_LIMIT_REACHED = defineEventType({
	id: "upload-preset.daily-limit-reached",
	name: msg("Preset daily limit reached"),
	description: msg("A client reached an upload preset's daily upload limit; that client's uploads pause until it resets."),
	category: "usage",
	severity: "low",
	notify: false,
	permission: "upload-presets:read",
	fields: {
		presetId: field(idField("preset"), {
			label: msg("Preset ID"),
			description: "ID of the upload preset.",
			display: "code",
			hidden: true
		}),
		presetName: field(zod.string(), {
			label: msg("Preset"),
			description: "The upload preset's name.",
			display: "text"
		}),
		dailyLimit: field(zod.number().int(), {
			label: msg("Daily limit"),
			description: "Number of uploads the preset allows each day.",
			display: "number"
		})
	},
	example: {
		presetId: EXAMPLE_IDS.preset,
		presetName: "Profile photos",
		dailyLimit: 500
	}
});
const PROJECT_MEMBER_REMOVED = defineEventType({
	id: "project.member-removed",
	name: msg("Member removed"),
	description: msg("Someone removed a member from the project."),
	category: "team",
	severity: "low",
	notify: true,
	permission: "members:read",
	fields: {
		memberUserId: memberUserIdField,
		memberName: memberNameField,
		role: field(MEMBER_ROLE_SCHEMA, {
			label: msg("Role"),
			description: "The role the member held.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		})
	},
	example: {
		memberUserId: "user_7Tq2Wm9Lk4Xr8Vb3Np6C",
		memberName: "alex@example.com",
		role: "editor"
	}
});
const PROJECT_MEMBER_LEFT = defineEventType({
	id: "project.member-left",
	name: msg("Member left"),
	description: msg("A member left the project."),
	category: "team",
	severity: "low",
	notify: true,
	permission: "members:read",
	fields: {
		memberUserId: memberUserIdField,
		memberName: memberNameField,
		role: field(MEMBER_ROLE_SCHEMA, {
			label: msg("Role"),
			description: "The role the member held.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		})
	},
	example: {
		memberUserId: "user_7Tq2Wm9Lk4Xr8Vb3Np6C",
		memberName: "alex@example.com",
		role: "editor"
	}
});
const PROJECT_MEMBER_ROLE_CHANGED = defineEventType({
	id: "project.member-role-changed",
	name: msg("Member access changed"),
	description: msg("A member's role or custom permissions were changed."),
	category: "team",
	severity: "low",
	notify: true,
	permission: "members:read",
	fields: {
		memberUserId: memberUserIdField,
		memberName: memberNameField,
		previousRole: field(MEMBER_ROLE_SCHEMA, {
			label: msg("Previous role"),
			description: "The member's role before the change.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		}),
		role: field(MEMBER_ROLE_SCHEMA, {
			label: msg("Role"),
			description: "The member's role after the change; `custom` roles may have changed permissions.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		})
	},
	example: {
		memberUserId: "user_7Tq2Wm9Lk4Xr8Vb3Np6C",
		memberName: "alex@example.com",
		previousRole: "viewer",
		role: "editor"
	}
});
const PROJECT_INVITATION_SENT = defineEventType({
	id: "project.invitation-sent",
	name: msg("Invitation sent"),
	description: msg("Someone was invited to join the project."),
	category: "team",
	severity: "low",
	notify: false,
	permission: "members:read",
	fields: {
		inviteeEmail: field(zod.string(), {
			label: msg("Invitee"),
			description: "The email address that was invited.",
			display: "text",
			inAppOnly: true
		}),
		role: field(MEMBER_ROLE_SCHEMA, {
			label: msg("Role"),
			description: "The role the invitation grants.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		})
	},
	example: {
		inviteeEmail: "alex@example.com",
		role: "editor"
	}
});
const PROJECT_TRANSFERRED = defineEventType({
	id: "project.transferred",
	name: msg("Project transferred"),
	description: msg("The project moved to another organisation, which is billed for its usage from then on."),
	category: "team",
	severity: "high",
	notify: true,
	permission: "members:read",
	fields: {
		previousOrganisationId: field(idField("org"), {
			label: msg("Previous organisation ID"),
			description: "ID of the organisation the project left.",
			display: "code",
			hidden: true
		}),
		previousOrganisationName: field(zod.string(), {
			label: msg("Previous organisation"),
			description: "Name of the organisation the project left.",
			display: "text"
		}),
		organisationId: field(idField("org"), {
			label: msg("Organisation ID"),
			description: "ID of the organisation that now owns the project.",
			display: "code",
			hidden: true
		}),
		organisationName: field(zod.string(), {
			label: msg("Organisation"),
			description: "Name of the organisation that now owns the project.",
			display: "text"
		}),
		method: field(zod.enum(["handover", "move"]), {
			label: msg("Method"),
			description: "`handover` when an owner of the receiving organisation accepted it from another organisation, `move` when someone who owns both moved it.",
			display: "enum",
			valueLabels: {
				handover: msg("Handover"),
				move: msg("Move")
			}
		}),
		apiKeysRevoked: field(zod.number().int().nonnegative(), {
			label: msg("API keys revoked"),
			description: "Number of the project's API keys revoked by a handover.",
			display: "number"
		}),
		connectorsPaused: field(zod.number().int().nonnegative(), {
			label: msg("Connectors paused"),
			description: "Number of the project's webhooks and other connectors paused by a handover.",
			display: "number"
		})
	},
	example: {
		previousOrganisationId: "org_7Vb3Xk9Lm2Qt4Wp8Nc5R",
		previousOrganisationName: "Studio North",
		organisationId: EXAMPLE_IDS.org,
		organisationName: "Acme",
		method: "handover",
		apiKeysRevoked: 2,
		connectorsPaused: 1
	}
});
const API_KEY_CREATED = defineEventType({
	id: "api-key.created",
	name: msg("API key created"),
	description: msg("An API key was created for the project."),
	category: "api-keys",
	severity: "low",
	notify: false,
	permission: "api-keys:read",
	fields: {
		keyId: field(idField("key"), {
			label: msg("Key ID"),
			description: "ID of the API key.",
			display: "code",
			hidden: true
		}),
		keyName: field(zod.string().nullish(), {
			label: msg("Key"),
			description: "The API key's name.",
			display: "text"
		}),
		role: field(ACCESS_ROLE_SCHEMA, {
			label: msg("Role"),
			description: "The access the key was created with: `admin`, `configurator`, `editor`, `viewer` or `custom`.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		}),
		createdByName: field(zod.string().nullish(), {
			label: msg("Created by"),
			description: "Name or email of the person who created the key, when known.",
			display: "text",
			inAppOnly: true,
			names: "actor"
		})
	},
	example: {
		keyId: EXAMPLE_IDS.key,
		keyName: "Production server",
		role: "editor",
		createdByName: "alex@example.com"
	}
});
const API_KEY_REVOKED = defineEventType({
	id: "api-key.revoked",
	name: msg("API key revoked"),
	description: msg("An API key was revoked: it is kept but can no longer be used."),
	category: "api-keys",
	severity: "low",
	notify: false,
	permission: "api-keys:read",
	fields: {
		keyId: field(idField("key"), {
			label: msg("Key ID"),
			description: "ID of the API key.",
			display: "code",
			hidden: true
		}),
		keyName: field(zod.string().nullish(), {
			label: msg("Key"),
			description: "The API key's name.",
			display: "text"
		}),
		revokedByName: field(zod.string().nullish(), {
			label: msg("Revoked by"),
			description: "Name or email of the person who revoked the key, when known.",
			display: "text",
			inAppOnly: true,
			names: "actor"
		})
	},
	example: {
		keyId: EXAMPLE_IDS.key,
		keyName: "Production server",
		revokedByName: "alex@example.com"
	}
});
const API_KEY_DELETED = defineEventType({
	id: "api-key.deleted",
	name: msg("API key deleted"),
	description: msg("An API key was deleted and can no longer be used."),
	category: "api-keys",
	severity: "low",
	notify: false,
	permission: "api-keys:read",
	fields: {
		keyId: field(idField("key"), {
			label: msg("Key ID"),
			description: "ID of the API key.",
			display: "code",
			hidden: true
		}),
		keyName: field(zod.string().nullish(), {
			label: msg("Key"),
			description: "The API key's name.",
			display: "text"
		}),
		deletedByName: field(zod.string().nullish(), {
			label: msg("Deleted by"),
			description: "Name or email of the person who deleted the key, when known.",
			display: "text",
			inAppOnly: true,
			names: "actor"
		})
	},
	example: {
		keyId: EXAMPLE_IDS.key,
		keyName: "Production server",
		deletedByName: "alex@example.com"
	}
});
const appealFields = {
	appealId: field(idField("apl"), {
		label: msg("Appeal"),
		description: "The appeal identifier.",
		display: "code"
	}),
	subjectType: field(zod.enum([
		"post",
		"user",
		"reported-post",
		"reported-user"
	]), {
		label: msg("Subject type"),
		description: "The type of moderation decision appealed.",
		display: "enum",
		valueLabels: {
			post: msg("Post"),
			user: msg("User"),
			"reported-post": msg("Reported post"),
			"reported-user": msg("Reported user")
		}
	}),
	subjectId: field(zod.string(), {
		label: msg("Subject"),
		description: "The customer's subject identifier.",
		display: "code"
	})
};
/** Every event type, in the order the portal and docs list them. */
const EVENT_TYPE_INFO = {
	"asset.uploaded": ASSET_UPLOADED,
	"asset.classified": ASSET_CLASSIFIED,
	"asset.region-restricted": ASSET_REGION_RESTRICTED,
	"asset.allowed": ASSET_ALLOWED,
	"asset.limited": ASSET_LIMITED,
	"asset.age-restricted": ASSET_AGE_RESTRICTED,
	"asset.blocked": ASSET_BLOCKED,
	"asset.purged": ASSET_PURGED,
	"asset.failed": ASSET_FAILED,
	"asset.progress-updated": ASSET_PROGRESS_UPDATED,
	"asset.deleted": ASSET_DELETED,
	"asset.content-removed": ASSET_CONTENT_REMOVED,
	"asset.retried": ASSET_RETRIED,
	"asset.rerun-requested": ASSET_RERUN_REQUESTED,
	"asset.review-requested": ASSET_REVIEW_REQUESTED,
	"asset.hash-matched": ASSET_HASH_MATCHED,
	"asset.link-flagged": ASSET_LINK_FLAGGED,
	"usage.free-uploads-exhausted": USAGE_FREE_UPLOADS_EXHAUSTED,
	"usage.uploads-paused": USAGE_UPLOADS_PAUSED,
	"upload-preset.daily-limit-reached": UPLOAD_PRESET_DAILY_LIMIT_REACHED,
	"project.member-joined": PROJECT_MEMBER_JOINED,
	"project.member-removed": PROJECT_MEMBER_REMOVED,
	"project.member-left": PROJECT_MEMBER_LEFT,
	"project.member-role-changed": PROJECT_MEMBER_ROLE_CHANGED,
	"project.invitation-sent": PROJECT_INVITATION_SENT,
	"project.transferred": PROJECT_TRANSFERRED,
	"api-key.created": API_KEY_CREATED,
	"api-key.revoked": API_KEY_REVOKED,
	"api-key.deleted": API_KEY_DELETED,
	"connector.disabled": CONNECTOR_DISABLED,
	"appeal.submitted": defineEventType({
		id: "appeal.submitted",
		name: msg("Appeal submitted"),
		description: msg("A moderation decision was appealed."),
		category: "moderation",
		severity: "low",
		notify: true,
		permission: "project:manage",
		fields: appealFields,
		example: {
			appealId: EXAMPLE_IDS.apl,
			subjectType: "post",
			subjectId: "post-1"
		}
	}),
	"appeal.resolved": defineEventType({
		id: "appeal.resolved",
		name: msg("Appeal resolved"),
		description: msg("A reviewer upheld or overturned a moderation decision."),
		category: "moderation",
		severity: "low",
		notify: true,
		permission: "project:manage",
		fields: {
			...appealFields,
			decision: field(zod.enum(["upheld", "overturned"]), {
				label: msg("Decision"),
				description: "The appeal outcome.",
				display: "enum",
				valueLabels: {
					upheld: msg("Upheld"),
					overturned: msg("Overturned")
				}
			}),
			action: field(zod.string(), {
				label: msg("Action"),
				description: "The final action for the customer's integration. For an appeal about an asset it is the asset's moderation status, such as `allowed`; for other subjects it is the action the customer defined for the decision, so it is not limited to a fixed set of values.",
				display: "code"
			}),
			appliedToAsset: field(zod.boolean(), {
				label: msg("Applied to asset"),
				description: "Whether CalmLens updated the linked asset.",
				display: "enum"
			})
		},
		example: {
			appealId: EXAMPLE_IDS.apl,
			subjectType: "post",
			subjectId: "post-1",
			decision: "overturned",
			action: "allowed",
			appliedToAsset: true
		}
	})
};
const EVENT_TYPES = Object.keys(EVENT_TYPE_INFO).filter((type) => !type.startsWith("appeal.") && EVENT_TYPE_INFO[type].enabled !== false);
const EVENT_TYPE_SCHEMA = zod.enum(EVENT_TYPES);
Object.fromEntries(EVENT_TYPES.map((type) => [type, EVENT_TYPE_INFO[type].values]));
const getEventFactUrl = (fact) => {
	if (!fact.url || fact.url.includes("\\")) return void 0;
	if (fact.url.startsWith("/") && !fact.url.startsWith("//")) return fact.url;
	try {
		const url = new URL(fact.url);
		return url.protocol === "https:" || url.protocol === "http:" ? fact.url : void 0;
	} catch {
		return;
	}
};
const factUrl = zod.string().refine((url) => getEventFactUrl({ url }) !== void 0, "Fact links must be app paths or HTTP(S) URLs").optional();
const factSchema = (key, value) => zod.strictObject({
	key: zod.literal(key),
	value,
	url: factUrl
}).refine((fact) => fact.value !== void 0, "Facts require a value");
const EVENT_FACT_SCHEMAS = Object.fromEntries(EVENT_TYPES.map((type) => [type, zod.array(zod.discriminatedUnion("key", [...Object.entries(EVENT_TYPE_INFO[type].fields).map(([key, definition]) => factSchema(eventFactKey(key), definition.schema)), factSchema("test", zod.boolean())]))]));
const EVENT_FACT_SCHEMA = zod.strictObject({
	key: zod.string(),
	value: zod.unknown().refine((value) => value !== void 0, "Facts require a value"),
	url: factUrl
});
const EVENT_FACTS_SCHEMA = zod.array(EVENT_FACT_SCHEMA);
// packages/shared/src/Event.ts
const EVENT_ASSET_SCHEMA = zod.object({
	id: zod.string().describe("Asset ID"),
	externalId: zod.string().nullish().describe("The asset's `externalId`, if you set one"),
	uploadPresetId: zod.string().nullish().describe("The upload preset used to create the asset, if any"),
	upload: zod.object({ status: zod.enum(["uploading", "completed"]) }),
	classification: zod.object({
		status: ASSET_CLASSIFICATION_STATUS_SCHEMA,
		testInput: zod.boolean().describe("Whether the asset's results came from one of the project's test inputs, as `classification.testInput` on the asset"),
		moderation: zod.object({ status: ASSET_MODERATION_STATUS_SCHEMA })
	}),
	content: zod.object({ status: ASSET_CONTENT_STATUS_SCHEMA }).describe("Whether CalmLens held the asset's content when the event was created")
});
const EVENT_FIELDS = {
	id: primaryIdField("evt").describe("Unique event ID"),
	projectId: idField("proj").describe("ID of the project the event belongs to"),
	userId: saneStringField().nullish().describe("ID of the user the event concerns in the portal, such as an asset's uploader"),
	actor: ACTOR_SCHEMA,
	type: EVENT_TYPE_SCHEMA.describe("Event type. See [Event types](/docs/api/events#event-types)."),
	severity: EVENT_SEVERITY_SCHEMA.describe("Default severity of the event type"),
	title: saneStringField().describe("Short human-readable summary"),
	description: saneStringField({ type: "large" }).nullish().describe("Longer human-readable explanation"),
	assetId: idField("asset").nullish().describe("ID of the asset the event is about, for asset events"),
	assetSequence: zod.number().int().positive().nullish().describe("The event's place among the events about its asset: it increases with each later event about the same asset. Deliveries can arrive out of order, so store the highest `assetSequence` you have processed for each asset and ignore an event with a lower one. Null for events that aren't about an asset."),
	asset: EVENT_ASSET_SCHEMA.nullish().describe("Snapshot of the asset's moderation decision when the event was created, for asset events"),
	facts: EVENT_FACTS_SCHEMA.describe("Registered event facts. See [Event facts](/docs/api/events#event-facts)."),
	notify: zod.boolean().nullish().describe("Whether the event triggers in-app notifications"),
	createdAt: createdAtField().describe("When the event was created, in milliseconds since the Unix epoch"),
	updatedAt: updatedAtField().describe("When the event was last updated, in milliseconds since the Unix epoch"),
	readAt: zod.number().int().nullish().describe("When the event was marked as read in the portal, in milliseconds since the Unix epoch")
};
/** Fields only the portal uses: who caused the event and its in-app notification state. */
const PORTAL_EVENT_FIELD_KEYS = [
	"userId",
	"notify",
	"updatedAt",
	"readAt"
];
const PUBLIC_EVENT_FIELDS = Object.fromEntries(Object.entries(EVENT_FIELDS).filter(([key]) => !PORTAL_EVENT_FIELD_KEYS.includes(key)));
zod.strictObject(EVENT_FIELDS);
/** An event as `GET /events` lists it and webhooks deliver it. */
const PUBLIC_EVENT_SCHEMA = zod.strictObject(PUBLIC_EVENT_FIELDS).meta(metaStore([docPropertyInfo({
	description: "An event or alert in the system",
	namedType: "Event",
	example: {
		id: EXAMPLE_IDS.evt,
		projectId: EXAMPLE_IDS.proj,
		type: "asset.uploaded",
		severity: "low",
		title: "Product photo uploaded",
		actor: {
			type: "api-key",
			id: EXAMPLE_IDS.key
		},
		assetId: EXAMPLE_IDS.asset,
		assetSequence: 1,
		facts: [
			{
				key: "asset-name",
				value: "product-photo.jpg"
			},
			{
				key: "asset-type",
				value: "image"
			},
			{
				key: "file-format",
				value: "jpg"
			}
		],
		createdAt: 17672256e5
	}
})]));
/** The event as the API lists it and webhooks deliver it: its public fields, in one shape. */
const toPublicEvent = (event) => ({
	id: event.id,
	projectId: event.projectId,
	actor: event.actor,
	type: event.type,
	severity: event.severity,
	title: event.title,
	description: event.description ?? null,
	assetId: event.assetId ?? null,
	assetSequence: event.assetSequence ?? null,
	asset: event.asset ?? null,
	facts: event.facts,
	createdAt: event.createdAt
});
const typedEventVariant = (type) => zod.strictObject({
	...PUBLIC_EVENT_FIELDS,
	type: zod.literal(type).meta(metaStore([docPropertyInfo({ description: EVENT_TYPE_INFO[type].description })])),
	facts: EVENT_FACT_SCHEMAS[type]
}).meta(metaStore([docPropertyInfo({ description: `${EVENT_TYPE_INFO[type].name}: ${EVENT_TYPE_INFO[type].description}` })]));
/** An event whose `facts` is typed by its `type`. Used for the public events feed. */
const TYPED_EVENT_SCHEMA = zod.discriminatedUnion("type", EVENT_TYPES.map((type) => typedEventVariant(type))).meta(metaStore([docPropertyInfo({
	description: "An event; `facts` depends on `type`",
	namedType: "Event",
	example: {
		id: EXAMPLE_IDS.evt,
		projectId: EXAMPLE_IDS.proj,
		type: "asset.uploaded",
		severity: "low",
		title: "Product photo uploaded",
		actor: {
			type: "api-key",
			id: EXAMPLE_IDS.key
		},
		assetId: EXAMPLE_IDS.asset,
		assetSequence: 1,
		facts: [
			{
				key: "asset-name",
				value: "product-photo.jpg"
			},
			{
				key: "asset-type",
				value: "image"
			},
			{
				key: "file-format",
				value: "jpg"
			}
		],
		createdAt: 17672256e5
	},
	docsSchema: PUBLIC_EVENT_SCHEMA
})]));
EVENT_TYPES.filter((type) => Object.values(EVENT_TYPE_INFO[type].fields).some((definition) => Boolean(definition.names)));
EXAMPLE_IDS.asset;
// packages/shared/src/WebhookPayload.ts
const WEBHOOK_DELIVERY_HEADER = "x-calmlens-delivery";
const WEBHOOK_TIMESTAMP_HEADER = "x-calmlens-timestamp";
const WEBHOOK_SIGNATURE_HEADER = "x-calmlens-signature";
/** Receivers reject deliveries whose timestamp is further than this from their clock. */
const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
/** The webhook body: the event, exactly as `GET /events` lists it, with `facts` typed by `type`. */
const WEBHOOK_EVENT_PAYLOAD_SCHEMA = TYPED_EVENT_SCHEMA;
/** The body CalmLens sends for an event (its public fields; see `toPublicEvent`). */
const toWebhookEventPayload = (event) => toPublicEvent(event);
/** `v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`, the `x-calmlens-signature` header value. */
const createWebhookSignatureHeader = async (secret, timestampSeconds, body) => `v1=${await hmacSha256Hex(secret, `${timestampSeconds}.${body}`)}`;
/** Headers for one signed delivery of `body`. */
const createWebhookHeaders = async (options) => {
	const timestamp = options.timestampSeconds ?? Math.floor(Date.now() / 1e3);
	return {
		"content-type": "application/json",
		[WEBHOOK_DELIVERY_HEADER]: options.deliveryId,
		[WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
		[WEBHOOK_SIGNATURE_HEADER]: await createWebhookSignatureHeader(options.secret, timestamp, options.body)
	};
};
zod.looseObject({
	id: zod.string(),
	type: zod.string(),
	projectId: zod.string(),
	createdAt: zod.number(),
	severity: zod.string().optional(),
	title: zod.string().optional(),
	description: zod.string().nullish(),
	actor: zod.looseObject({
		type: zod.string(),
		id: zod.string().nullable()
	}).optional(),
	assetId: zod.string().nullish(),
	assetSequence: zod.number().nullish(),
	asset: zod.looseObject({ id: zod.string() }).nullish(),
	facts: zod.array(zod.looseObject({
		key: zod.string(),
		value: zod.unknown(),
		url: zod.string().optional()
	})).optional()
});
export { WEBHOOK_DELIVERY_HEADER, WEBHOOK_EVENT_PAYLOAD_SCHEMA, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_SIGNATURE_TOLERANCE_SECONDS, WEBHOOK_TIMESTAMP_HEADER, createWebhookHeaders, toWebhookEventPayload };
