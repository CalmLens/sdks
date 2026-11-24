import { c as createMetaType, l as metaStore, n as idField, o as primaryIdField, s as updatedAt, t as EXAMPLE_IDS } from "./Ids-BBz_iuDy.js";
import { t as CLASSIFICATION_CATEGORIES } from "./ModerationCategories-CHFRoeWV.js";
import "./Media-B2PMcUf7.js";
import "./ModerationContextLimits-k930WU8i.js";
import "./SharedConstants-D-QkbICw.js";
import { t as hmacSha256Hex } from "./CryptoUtils-BLCa-oZe.js";
import { t as lazySchema } from "./LazySchema-BKMpWIaF.js";
import { i as msg, n as MODERATION_QUALIFIERS } from "./TestRegionalActions-Ce8EVv4q.js";
import { n as JURISDICTION_SCHEMA } from "./Jurisdiction-uODFGQGo.js";
import { t as ACCESS_ROLE_SCHEMA } from "./Permissions-Dwk78TtG.js";
import * as zod from "zod";
// packages/shared/src/DocMetaTypes.ts
const docPropertyInfo = createMetaType({ id: "docPropertyInfo" });
// packages/shared/src/Actor.ts
/**
* Who did something: a `user` (a person in the portal, or an assistant's key acting for the person
* who approved it), an `api-key` of its own, `automated` moderation, or CalmLens itself (`system`).
*/
const ACTOR_TYPES = [
	"user",
	"api-key",
	"automated",
	"system"
];
const ACTOR_TYPE_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum(ACTOR_TYPES));
const ACTOR_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.object({
	type: ACTOR_TYPE_SCHEMA,
	id: zod.string().nullable().describe("The user's or API key's ID. `null` for `automated` and `system`, and when the ID was not recorded.")
}).strict().meta(metaStore([docPropertyInfo({
	description: "Who did it: a `user` (or an assistant acting for one), an `api-key`, `automated` moderation or CalmLens itself (`system`).",
	namedType: "Actor"
})])));
// packages/shared/src/AssetModerationDecision.ts
/**
* What moderation decided for an asset, which also decides how it is delivered: served to anyone
* with access (`allowed`), served the same way but marked for reduced reach (`limited`), only to
* requests that confirm the viewer's age with `ageConfirmed`, signed URLs and server keys included
* (`age-restricted`), not served (`blocked`), or not served with its stored content deleted
* (`purged`).
*/
const ASSET_MODERATION_DECISION_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum([
	"allowed",
	"limited",
	"age-restricted",
	"blocked",
	"purged"
]));
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
// packages/shared/src/HashList.ts
/**
* What a match does: `flag` reports it on the asset and in an event without changing the
* decision, `block` also blocks close matches.
*/
const HASH_LIST_ACTION_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum(["flag", "block"]));
// packages/shared/src/LinkSafety.ts
/**
* Link safety (preview, `ENABLE_LINK_SAFETY`): where the links in an asset lead. It is its own
* signal with its own policy section. It never changes a moderation category's score, because
* categories describe the supplied content, not the pages it links to.
*/
/**
* What a link's destination is: `safe` when every reputation check passed, `adult` or `gambling`
* from its domain's content categories, `phishing` or `malware` from a threat list or the domain's
* security risks, and `unresolved` when a short link or redirect chain could not be followed or a
* check failed. Every URL on a link's way counts, so the worst of them is the link's verdict.
*/
const LINK_SAFETY_VERDICTS = [
	"safe",
	"adult",
	"gambling",
	"phishing",
	"malware",
	"unresolved"
];
const LINK_SAFETY_VERDICT_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum(LINK_SAFETY_VERDICTS));
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
	linkChecking: {
		id: "linkChecking",
		productId: {
			local: "prod_calmlens_link_checking",
			dev: "prod_calmlens_link_checking",
			main: "prod_calmlens_link_checking"
		},
		type: "subscription",
		name: "Link checking"
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
PRODUCTS.imageTransformed, PRODUCTS.websiteIngestion, PRODUCTS.linkChecking, PRODUCTS.textClassificationTokens, PRODUCTS.imageClassification, PRODUCTS.assetStorageGb, PRODUCTS.assetSearch, PRODUCTS.assetMediaSearchIndexing, PRODUCTS.assetRead, PRODUCTS.ocrClassification, PRODUCTS.personDetection, PRODUCTS.faceDetection, PRODUCTS.streamEncoding;
msg("Sexual Content"), MODERATION_CATEGORY_DEFINITIONS.sexual.summary, msg("Violence"), MODERATION_CATEGORY_DEFINITIONS.violence.summary, msg("Self-Harm"), MODERATION_CATEGORY_DEFINITIONS["self-harm"].summary, msg("Harassment & Bullying"), MODERATION_CATEGORY_DEFINITIONS.harassment.summary, msg("Hate & Identity Abuse"), MODERATION_CATEGORY_DEFINITIONS.hate.summary, msg("Personal Information"), MODERATION_CATEGORY_DEFINITIONS["personal-information"].summary, msg("Profanity"), MODERATION_CATEGORY_DEFINITIONS.profanity.summary, msg("Criminal & Dangerous Activity"), MODERATION_CATEGORY_DEFINITIONS["criminal-activity"].summary;
new Set(MODERATION_QUALIFIERS);
// packages/shared/src/HumanReview.ts
/**
* Automated outcomes that can be sampled. Purged content is deleted as soon as it is decided, for
* safety and legal reasons, so there is never anything left to review.
*/
const HUMAN_REVIEW_SAMPLED_OUTCOME_SCHEMA = /* @__PURE__ */ lazySchema(() => ASSET_MODERATION_DECISION_SCHEMA.exclude(["purged"]));
/**
* Why an asset joined the queue: drawn by the random sample, or routed because its decision was
* uncertain. An asset drawn by the sample is `sampled` even when it is also uncertain, so the
* random sample stays representative.
*/
const HUMAN_REVIEW_REASON_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum(["sampled", "uncertain"]));
const HUMAN_REVIEW_UNCERTAIN_CATEGORIES_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.array(zod.enum(CLASSIFICATION_CATEGORIES)));
// packages/shared/src/Asset.ts
/**
* Where the asset is in the pipeline: waiting for its content or its turn (`queued`), being
* processed, or settled (`completed` or `failed`).
*/
const ASSET_CLASSIFICATION_STATUS_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum([
	"queued",
	"processing",
	"completed",
	"failed"
]));
/**
* The moderation decision in force, which also decides delivery: `pending` until classification
* decides, then a reviewer's decision when there is one, else the policy's.
*/
const ASSET_MODERATION_STATUS_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum(["pending", ...ASSET_MODERATION_DECISION_SCHEMA.options]));
/**
* Whether CalmLens holds the asset's content (source, preview and extracted text): kept only until
* processing finishes (`temporary`), retained (`stored`) or deleted (`removed`).
*/
const ASSET_CONTENT_STATUS_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum([
	"temporary",
	"stored",
	"removed"
]));
/** Why an asset's processing failed. */
const ASSET_FAILURE_REASON_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum([
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
	"website-unavailable",
	"processing-error"
]));
const ASSET_TYPE_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum([
	"image",
	"video",
	"audio",
	"plaintext-document",
	"multimedia-document",
	"website",
	"file"
]));
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
// packages/shared/src/ConnectorType.ts
/** Where a connector delivers events. Kept apart from `Connector.ts`, which the event catalog can't import. */
const CONNECTOR_TYPE_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum([
	"in-app",
	"webhook",
	"slack",
	"email"
]));
// packages/shared/src/ProjectAccess.ts
const PROJECT_MEMBER_ROLE_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum([...ACCESS_ROLE_SCHEMA.options, "reviewer"]));
// packages/shared/src/EventCatalog.ts
const EVENT_SEVERITY_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum(["low", "high"]));
msg("Assets"), msg("Moderation"), msg("Usage"), msg("Team"), msg("API keys"), msg("Connectors");
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
	"website-unavailable": msg("Website unavailable"),
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
/** A fact's definition. Its schema is built on first use (`lazySchema`), as the catalog's are. */
const field = (schema, info) => ({
	...info,
	schema: /* @__PURE__ */ lazySchema(() => schema().meta(metaStore([docPropertyInfo({ description: info.description })])))
});
const dataSchemaFromFields = (fields, description) => zod.object(Object.fromEntries(Object.entries(fields).map(([key, definition]) => [key, definition.schema]))).meta(metaStore([docPropertyInfo({ description })]));
const assetNameField = field(() => zod.string().nullish(), {
	label: msg("Asset"),
	description: "The asset's name when the event was created.",
	display: "text"
});
const assetTypeField = field(() => ASSET_TYPE_SCHEMA.nullish(), {
	label: msg("Asset type"),
	description: "The asset's type, such as `image` or `video`.",
	display: "enum",
	valueLabels: ASSET_TYPE_LABELS
});
/** Set on assets CalmLens extracts from an upload, such as the text and images of a document. */
const parentAssetField = field(() => zod.string().optional(), {
	label: msg("Parent asset"),
	description: "ID of the uploaded asset this one was extracted from, such as the text or an image of a document, as in the asset's `parentId`. Absent for uploaded assets.",
	display: "code"
});
const reviewerNameField = field(() => zod.string().nullish(), {
	label: msg("Reviewer"),
	description: "Name or email of the user who made the decision, or the API key's name, when known.",
	display: "text",
	inAppOnly: true,
	names: "actor"
});
const flaggedCategoriesSchema = /* @__PURE__ */ lazySchema(() => zod.array(zod.enum(CLASSIFICATION_CATEGORIES)));
/** Set on the events of an asset batch operation (`POST /assets/batch`). */
const batchIdField = field(() => idField("batch").optional(), {
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
	values: /* @__PURE__ */ lazySchema(() => dataSchemaFromFields(definition.fields, `Data for \`${definition.id}\` events.`))
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
		fileFormat: field(() => zod.string().nullish(), {
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
		flaggedCategories: field(() => flaggedCategoriesSchema, FLAGGED_CATEGORIES_INFO),
		moderationStatus: field(() => ASSET_MODERATION_STATUS_SCHEMA, {
			label: msg("Moderation status"),
			description: "The asset's status once classification finished: `allowed`, `limited`, `age-restricted`, `blocked` or `purged`. Usually the status the policy decided; when a reviewer decided the asset while it was being processed, their decision stands and this is their status.",
			display: "enum",
			valueLabels: MODERATION_STATUS_LABELS
		}),
		automatedStatus: field(() => ASSET_MODERATION_DECISION_SCHEMA.optional(), {
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
		region: field(() => JURISDICTION_SCHEMA.exclude(["global"]), {
			label: msg("Region"),
			description: "Jurisdiction whose mandatory rule raises the delivery action.",
			display: "code"
		}),
		rule: field(() => zod.string(), {
			label: msg("Rule"),
			description: "Stable mandatory rule key.",
			display: "code"
		}),
		status: field(() => ASSET_MODERATION_DECISION_SCHEMA.exclude(["allowed"]), {
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
		flaggedCategories: field(() => flaggedCategoriesSchema.optional(), FLAGGED_CATEGORIES_INFO),
		reviewerName: reviewerNameField,
		note: field(() => zod.string().nullish(), {
			label: msg("Note"),
			description: "The reviewer's note, or `null`.",
			display: "text"
		}),
		childAsset: field(() => zod.string().optional(), {
			label: msg("Child asset"),
			description: "Present when a reviewer's decision on one of this asset's child assets changed this asset's status: the ID of that child. The event's `actor` is that reviewer.",
			display: "code"
		}),
		childStatus: field(() => ASSET_MODERATION_DECISION_SCHEMA.optional(), {
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
		previousStatus: field(() => ASSET_CLASSIFICATION_STATUS_SCHEMA.nullish(), {
			label: msg("Previous status"),
			description: "The asset's processing status before it failed, such as `processing`.",
			display: "enum",
			valueLabels: PROCESSING_STATUS_LABELS
		}),
		failureReason: field(() => ASSET_FAILURE_REASON_SCHEMA, {
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
const ASSET_MEDIA_READY = defineEventType({
	id: "asset.media-ready",
	name: msg("Media ready"),
	description: msg("An audio or video asset's browser-safe file and preview are ready."),
	category: "assets",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField
	},
	example: {
		assetName: "clip.mp4",
		assetType: "video"
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
		completedSections: field(() => zod.number().int().nonnegative(), {
			label: msg("Sections done"),
			description: "Sections analysed so far, as in the asset's `classification.progress.completedSections`.",
			display: "number"
		}),
		totalSections: field(() => zod.number().int().positive(), {
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
		limit: field(() => zod.number().int(), {
			label: msg("Limit"),
			description: "Number of free uploads in the allowance.",
			display: "number"
		}),
		used: field(() => zod.number().int(), {
			label: msg("Used"),
			description: "Number of free uploads used.",
			display: "number"
		}),
		organisationId: field(() => idField("org"), {
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
const MEMBER_ROLE_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum(PROJECT_MEMBER_ROLE_SCHEMA.options));
const PROJECT_MEMBER_JOINED = defineEventType({
	id: "project.member-joined",
	name: msg("Member joined"),
	description: msg("Someone accepted an invitation and joined the project."),
	category: "team",
	severity: "low",
	notify: true,
	permission: "members:read",
	fields: {
		memberUserId: field(() => idField("user"), {
			label: msg("Member ID"),
			description: "User ID of the new member.",
			display: "code",
			hidden: true
		}),
		memberName: field(() => zod.string().nullish(), {
			label: msg("Member"),
			description: "The new member's name or email.",
			display: "text",
			inAppOnly: true,
			names: "member"
		}),
		role: field(() => MEMBER_ROLE_SCHEMA, {
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
		connectorId: field(() => idField("conn"), {
			label: msg("Connector ID"),
			description: "ID of the connector that was turned off.",
			display: "code",
			hidden: true
		}),
		connectorName: field(() => zod.string(), {
			label: msg("Connector"),
			description: "The connector's name.",
			display: "text"
		}),
		connectorType: field(() => CONNECTOR_TYPE_SCHEMA, {
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
		consecutiveFailures: field(() => zod.number().int(), {
			label: msg("Failures in a row"),
			description: "Number of deliveries in a row that failed after their retries.",
			display: "number"
		}),
		lastError: field(() => zod.string().nullish(), {
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
const memberUserIdField = field(() => zod.string(), {
	label: msg("Member ID"),
	description: "User ID of the member.",
	display: "code",
	hidden: true
});
const memberNameField = field(() => zod.string().nullish(), {
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
		automatedStatus: field(() => HUMAN_REVIEW_SAMPLED_OUTCOME_SCHEMA, {
			label: msg("Automated status"),
			description: "The asset's status from automated moderation: `allowed`, `limited`, `age-restricted` or `blocked`.",
			display: "enum",
			valueLabels: MODERATION_STATUS_LABELS
		}),
		reviewReason: field(() => HUMAN_REVIEW_REASON_SCHEMA, {
			label: msg("Reason"),
			description: "Why the asset was queued: `sampled` by the project's random sample, or `uncertain` because a category's policy score was close to the threshold or evidence could not be assessed. An asset the sample draws is `sampled` even when it is also uncertain.",
			display: "enum",
			valueLabels: {
				sampled: msg("Sampled"),
				uncertain: msg("Uncertain")
			}
		}),
		uncertainCategories: field(() => HUMAN_REVIEW_UNCERTAIN_CATEGORIES_SCHEMA, {
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
const ASSET_REVIEW_COMPLETED = defineEventType({
	id: "asset.review-completed",
	name: msg("Review completed"),
	description: msg("A reviewer completed a queued review, whether confirming or changing the asset's decision."),
	category: "moderation",
	severity: "low",
	notify: false,
	permission: "reviews:read",
	enabled: true,
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		parentAsset: parentAssetField,
		reviewId: field(() => idField("rev"), {
			label: msg("Review"),
			description: "The completed review's ID.",
			display: "code"
		}),
		decision: field(() => ASSET_MODERATION_DECISION_SCHEMA, {
			label: msg("Decision"),
			description: "The reviewer's decision.",
			display: "enum",
			valueLabels: MODERATION_STATUS_LABELS
		}),
		appliedToAsset: field(() => zod.boolean(), {
			label: msg("Applied to asset"),
			description: "Whether the review changed the asset's decision.",
			display: "text"
		}),
		reviewerName: reviewerNameField,
		note: field(() => zod.string().nullable(), {
			label: msg("Note"),
			description: "The reviewer's note, or null.",
			display: "text"
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		reviewId: EXAMPLE_IDS.rev,
		decision: "allowed",
		appliedToAsset: false,
		note: null
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
		hashListId: field(() => idField("hl"), {
			label: msg("Hash list ID"),
			description: "ID of the hash list with the closest match.",
			display: "code",
			hidden: true
		}),
		hashListName: field(() => zod.string(), {
			label: msg("Hash list"),
			description: "Name of the hash list with the closest match.",
			display: "text"
		}),
		distance: field(() => zod.number().int(), {
			label: msg("Distance"),
			description: "Number of bits that differ between the image's PDQ hash and the listed hash. 0 is the same picture.",
			display: "number"
		}),
		matchAction: field(() => HASH_LIST_ACTION_SCHEMA, {
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
	enabled: false,
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		parentAsset: parentAssetField,
		linkVerdict: field(() => LINK_SAFETY_VERDICT_SCHEMA, {
			label: msg("Verdict"),
			description: "What the link's destination is: `adult`, `gambling`, `phishing`, `malware`, `unresolved` when a short link or redirect chain could not be followed or a check failed, or `safe` when only the off-platform setting acted. The most severe verdict of any address on the way decides.",
			display: "enum",
			valueLabels: LINK_SAFETY_VERDICT_LABELS
		}),
		linkUrl: field(() => zod.string(), {
			label: msg("Link"),
			description: "The link as it appears in the asset.",
			display: "text"
		}),
		linkFinalUrl: field(() => zod.string().nullish(), {
			label: msg("Destination"),
			description: "Where the link leads after its redirects. Absent when a short link or redirect chain could not be followed.",
			display: "text"
		}),
		linkStatus: field(() => ASSET_MODERATION_DECISION_SCHEMA.exclude(["allowed", "purged"]), {
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
		reason: field(() => zod.enum([
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
		resumesAt: field(() => zod.number().int().nonnegative().nullish(), {
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
		presetId: field(() => idField("preset"), {
			label: msg("Preset ID"),
			description: "ID of the upload preset.",
			display: "code",
			hidden: true
		}),
		presetName: field(() => zod.string(), {
			label: msg("Preset"),
			description: "The upload preset's name.",
			display: "text"
		}),
		dailyLimit: field(() => zod.number().int(), {
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
		role: field(() => MEMBER_ROLE_SCHEMA, {
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
		role: field(() => MEMBER_ROLE_SCHEMA, {
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
		previousRole: field(() => MEMBER_ROLE_SCHEMA, {
			label: msg("Previous role"),
			description: "The member's role before the change.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		}),
		role: field(() => MEMBER_ROLE_SCHEMA, {
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
		inviteeEmail: field(() => zod.string(), {
			label: msg("Invitee"),
			description: "The email address that was invited.",
			display: "text",
			inAppOnly: true
		}),
		role: field(() => MEMBER_ROLE_SCHEMA, {
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
		previousOrganisationId: field(() => idField("org"), {
			label: msg("Previous organisation ID"),
			description: "ID of the organisation the project left.",
			display: "code",
			hidden: true
		}),
		previousOrganisationName: field(() => zod.string(), {
			label: msg("Previous organisation"),
			description: "Name of the organisation the project left.",
			display: "text"
		}),
		organisationId: field(() => idField("org"), {
			label: msg("Organisation ID"),
			description: "ID of the organisation that now owns the project.",
			display: "code",
			hidden: true
		}),
		organisationName: field(() => zod.string(), {
			label: msg("Organisation"),
			description: "Name of the organisation that now owns the project.",
			display: "text"
		}),
		method: field(() => zod.enum(["handover", "move"]), {
			label: msg("Method"),
			description: "`handover` when an owner of the receiving organisation accepted it from another organisation, `move` when someone who owns both moved it.",
			display: "enum",
			valueLabels: {
				handover: msg("Handover"),
				move: msg("Move")
			}
		}),
		apiKeysRevoked: field(() => zod.number().int().nonnegative(), {
			label: msg("API keys revoked"),
			description: "Number of the project's API keys revoked by a handover.",
			display: "number"
		}),
		connectorsPaused: field(() => zod.number().int().nonnegative(), {
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
		keyId: field(() => idField("key"), {
			label: msg("Key ID"),
			description: "ID of the API key.",
			display: "code",
			hidden: true
		}),
		keyName: field(() => zod.string().nullish(), {
			label: msg("Key"),
			description: "The API key's name.",
			display: "text"
		}),
		role: field(() => ACCESS_ROLE_SCHEMA, {
			label: msg("Role"),
			description: "The access the key was created with: `admin`, `configurator`, `editor`, `viewer` or `custom`.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		}),
		createdByName: field(() => zod.string().nullish(), {
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
		keyId: field(() => idField("key"), {
			label: msg("Key ID"),
			description: "ID of the API key.",
			display: "code",
			hidden: true
		}),
		keyName: field(() => zod.string().nullish(), {
			label: msg("Key"),
			description: "The API key's name.",
			display: "text"
		}),
		revokedByName: field(() => zod.string().nullish(), {
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
		keyId: field(() => idField("key"), {
			label: msg("Key ID"),
			description: "ID of the API key.",
			display: "code",
			hidden: true
		}),
		keyName: field(() => zod.string().nullish(), {
			label: msg("Key"),
			description: "The API key's name.",
			display: "text"
		}),
		deletedByName: field(() => zod.string().nullish(), {
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
	appealId: field(() => idField("apl"), {
		label: msg("Appeal"),
		description: "The appeal identifier.",
		display: "code"
	}),
	subjectType: field(() => zod.enum([
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
	subjectId: field(() => zod.string(), {
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
	"asset.media-ready": ASSET_MEDIA_READY,
	"asset.deleted": ASSET_DELETED,
	"asset.content-removed": ASSET_CONTENT_REMOVED,
	"asset.retried": ASSET_RETRIED,
	"asset.review-requested": ASSET_REVIEW_REQUESTED,
	"asset.review-completed": ASSET_REVIEW_COMPLETED,
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
			decision: field(() => zod.enum(["upheld", "overturned"]), {
				label: msg("Decision"),
				description: "The appeal outcome.",
				display: "enum",
				valueLabels: {
					upheld: msg("Upheld"),
					overturned: msg("Overturned")
				}
			}),
			action: field(() => zod.string(), {
				label: msg("Action"),
				description: "The final action for the customer's integration. For an appeal about an asset it is the asset's moderation status, such as `allowed`; for other subjects it is the action the customer defined for the decision, so it is not limited to a fixed set of values.",
				display: "code"
			}),
			appliedToAsset: field(() => zod.boolean(), {
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
const EVENT_TYPE_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.enum(EVENT_TYPES));
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
const factUrl = /* @__PURE__ */ lazySchema(() => zod.string().refine((url) => getEventFactUrl({ url }) !== void 0, "Fact links must be app paths or HTTP(S) URLs").optional());
const factSchema = (key, value) => zod.strictObject({
	key: zod.literal(key),
	value: value.nonoptional(),
	url: factUrl
});
const EVENT_FACT_SCHEMAS = Object.fromEntries(EVENT_TYPES.map((type) => [type, /* @__PURE__ */ lazySchema(() => zod.array(zod.discriminatedUnion("key", [...Object.entries(EVENT_TYPE_INFO[type].fields).map(([key, definition]) => factSchema(eventFactKey(key), definition.schema)), factSchema("test", zod.boolean())])))]));
const EVENT_FACT_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.strictObject({
	key: zod.string(),
	value: zod.unknown().refine((value) => value !== void 0, "Facts require a value"),
	url: factUrl
}));
const EVENT_FACTS_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.array(EVENT_FACT_SCHEMA));
// packages/shared/src/Event.ts
const EVENT_ASSET_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.object({
	id: zod.string().describe("Asset ID"),
	externalId: zod.string().nullish().describe("The asset's `externalId`, if you set one"),
	uploadPresetId: zod.string().nullish().describe("The upload preset used to create the asset, if any"),
	upload: zod.object({ status: zod.enum(["uploading", "completed"]) }),
	classification: zod.object({
		status: ASSET_CLASSIFICATION_STATUS_SCHEMA,
		testInput: zod.boolean().describe("Whether the asset's results came from one of the project's test inputs, as `classification.testInput` on the asset"),
		moderation: zod.object({ decision: ASSET_MODERATION_DECISION_SCHEMA.nullable() })
	}),
	content: zod.object({ status: ASSET_CONTENT_STATUS_SCHEMA }).describe("Whether CalmLens held the asset's content when the event was created")
}));
const buildEventFields = () => ({
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
});
let eventFields;
const getEventFields = () => eventFields ??= buildEventFields();
/** Fields only the portal uses: who caused the event and its in-app notification state. */
const PORTAL_EVENT_FIELD_KEYS = [
	"userId",
	"notify",
	"updatedAt",
	"readAt"
];
let publicEventFields;
const getPublicEventFields = () => publicEventFields ??= Object.fromEntries(Object.entries(getEventFields()).filter(([key]) => !PORTAL_EVENT_FIELD_KEYS.includes(key)));
/** An event as `GET /events` lists it and webhooks deliver it. */
const PUBLIC_EVENT_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.strictObject(getPublicEventFields()).meta(metaStore([docPropertyInfo({
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
})])));
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
	...getPublicEventFields(),
	type: zod.literal(type).meta(metaStore([docPropertyInfo({ description: EVENT_TYPE_INFO[type].description })])),
	facts: EVENT_FACT_SCHEMAS[type]
}).meta(metaStore([docPropertyInfo({ description: `${EVENT_TYPE_INFO[type].name}: ${EVENT_TYPE_INFO[type].description}` })]));
/** An event whose `facts` is typed by its `type`. Used for the public events feed. */
const TYPED_EVENT_SCHEMA = /* @__PURE__ */ lazySchema(() => zod.discriminatedUnion("type", EVENT_TYPES.map((type) => typedEventVariant(type))).meta(metaStore([docPropertyInfo({
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
})])));
EVENT_TYPES.filter((type) => Object.values(EVENT_TYPE_INFO[type].fields).some((definition) => Boolean(definition.names)));
EXAMPLE_IDS.asset;
// packages/shared/src/WebhookPayload.ts
const WEBHOOK_DELIVERY_HEADER = "x-calmlens-delivery";
const WEBHOOK_TIMESTAMP_HEADER = "x-calmlens-timestamp";
const WEBHOOK_SIGNATURE_HEADER = "x-calmlens-signature";
/** Receivers reject deliveries whose timestamp is further than this from their clock. */
const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
/** The webhook body: the event, exactly as `GET /events` lists it, with `facts` typed by `type`. */
const WEBHOOK_EVENT_PAYLOAD_SCHEMA = /* @__PURE__ */ lazySchema(() => TYPED_EVENT_SCHEMA);
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
export { WEBHOOK_DELIVERY_HEADER, WEBHOOK_EVENT_PAYLOAD_SCHEMA, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_SIGNATURE_TOLERANCE_SECONDS, WEBHOOK_TIMESTAMP_HEADER, createWebhookHeaders, toWebhookEventPayload };
