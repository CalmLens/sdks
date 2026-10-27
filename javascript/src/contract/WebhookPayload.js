import { a as primaryIdField, l as metaStore, n as idField, o as backfill, t as EXAMPLE_IDS } from "./Ids-aHyP9ZcF.js";
import { a as countModerationContextCharacters, n as MODERATION_CONTEXT_MAX_ITEM_CHARACTERS, r as MODERATION_CONTEXT_USED_CHARACTERS, t as MODERATION_CONTEXT_MAX_CHARACTERS } from "./ModerationContextLimits-BIMUlk2e.js";
import "./SharedConstants-CyiUWW66.js";
import { t as hmacSha256Hex } from "./CryptoUtils-B_x8lMIx.js";
import { C as updatedAtField, S as saneStringField, _ as POLICY_ALLOWANCE_SCHEMA, b as HASH_LIST_ACTION_SCHEMA, f as CLASSIFICATION_REPORT_SCHEMA, g as FLAGGED_CONTENT_ACTION_SCHEMA, h as PROCESSING_FEATURES_SCHEMA, m as MODERATION_POLICY_CATEGORY_SCHEMA, n as TEST_INPUT_KEY_PATTERN, p as MODERATION_POLICY_CATEGORIES, v as POLICY_RESTRICTION_SCHEMA, w as docPropertyInfo, x as createdAtField, y as getModerationQualifiers } from "./TestTriggers-BO8gUNOr.js";
import { i as SERVED_JURISDICTIONS_SCHEMA, n as JURISDICTION_SCHEMA, r as REGIONAL_DELIVERY_SCHEMA } from "./Jurisdiction-RnMTRb4D.js";
import { n as GRANTS_SCHEMA, t as ACCESS_ROLE_SCHEMA } from "./Permissions-Ba-H8vMt.js";
import * as zod from "zod";
// packages/shared/src/AssetModerationDecision.ts
/**
* What moderation decided for an asset, which also decides how it is delivered: served to anyone
* with access (`allowed`), served the same way but marked for reduced reach (`limited`), only
* through signed URLs, server keys or `ageConfirmed=true` (`age-restricted`), not served
* (`blocked`), or not served with its stored content deleted (`purged`).
*/
const ASSET_MODERATION_DECISION_SCHEMA = zod.enum([
	"allowed",
	"limited",
	"age-restricted",
	"blocked",
	"purged"
]);
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
// packages/shared/src/HumanReview.ts
const SAMPLE_PERCENT_SCHEMA = zod.number().min(0).max(100);
const HUMAN_REVIEW_SETTINGS_SCHEMA = zod.object({
	allowedSamplePercent: SAMPLE_PERCENT_SCHEMA.default(0),
	restrictedSamplePercent: SAMPLE_PERCENT_SCHEMA.default(0)
}).strict();
/** Automated outcomes that can be sampled, and the decisions a reviewer can make. */
const HUMAN_REVIEW_OUTCOME_SCHEMA = ASSET_MODERATION_DECISION_SCHEMA;
const HUMAN_REVIEW_STATUS_SCHEMA = zod.enum(["pending", "completed"]);
zod.object({
	id: primaryIdField("rev"),
	projectId: idField("proj"),
	assetId: idField("asset"),
	automatedOutcome: HUMAN_REVIEW_OUTCOME_SCHEMA,
	status: HUMAN_REVIEW_STATUS_SCHEMA,
	decision: HUMAN_REVIEW_OUTCOME_SCHEMA.nullish(),
	note: zod.string().max(1e3).nullish(),
	reviewerUserId: zod.string().nullish(),
	/** Whether the decision changed the asset's status (only when it overturned the outcome). */
	appliedToAsset: zod.boolean().nullish(),
	createdAt: createdAtField(),
	reviewedAt: zod.number().int().nullish()
});
zod.object({
	decision: HUMAN_REVIEW_OUTCOME_SCHEMA,
	confirmPurge: zod.boolean().optional(),
	note: zod.string().trim().max(1e3).nullish()
}).strict().superRefine((body, ctx) => {
	if (body.decision === "purged" && body.confirmPurge !== true) ctx.addIssue({
		code: "custom",
		path: ["confirmPurge"],
		message: "Confirm permanent deletion"
	});
});
// packages/shared/src/PolicyCondition.ts
const ruleCondition = (rule) => {
	return [{
		all: [...rule.when].sort(),
		none: [...rule.unless ?? []].sort()
	}];
};
const normalizePolicyCondition = (condition) => [...new Map(condition.map((clause) => {
	const normalized = {
		all: [...new Set(clause.all)].sort(),
		none: [...new Set(clause.none)].sort()
	};
	return [JSON.stringify(normalized), normalized];
})).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, clause]) => clause);
const policyConditionKey = (scope, condition) => `${scope}:${JSON.stringify(normalizePolicyCondition(condition))}`;
// packages/shared/src/MandatoryRules.ts
/** A mandatory rule acts at this policy score (category score × condition evidence). */
const MANDATORY_RULE_THRESHOLD = .5;
const MANDATORY_RULES = [
	{
		key: "sexualised-minors",
		regions: ["global"],
		action: "block",
		category: "sexual",
		condition: [{
			all: ["sexual-minors"],
			none: []
		}],
		safetyHold: true
	},
	{
		key: "intimate-image-abuse",
		regions: ["global"],
		action: "block",
		category: "sexual",
		condition: [{
			all: ["sexual-intimate-image-abuse"],
			none: []
		}],
		safetyHold: false
	},
	{
		key: "extreme-pornography",
		regions: ["global"],
		action: "block",
		category: "sexual",
		condition: [{
			all: ["sexual-extreme"],
			none: []
		}],
		safetyHold: false
	},
	{
		key: "violent-extremism",
		regions: ["global"],
		action: "block",
		category: "violence",
		condition: [{
			all: ["violence-extremism"],
			none: []
		}],
		safetyHold: false
	},
	...[],
	...[
		"DE",
		"AT",
		"FR"
	].map((region) => ({
		key: `${region.toLowerCase()}-holocaust-denial`,
		regions: [region],
		category: "hate",
		action: "block",
		safetyHold: false,
		condition: [{
			all: [region === "DE" ? "hate-nazi-genocide-public-peace" : region === "AT" ? "hate-nazi-genocide-denial-or-approval" : "hate-adjudicated-nazi-crimes-denial"],
			none: []
		}]
	})),
	{
		key: "de-unconstitutional-symbols",
		regions: ["DE"],
		category: "hate",
		action: "block",
		safetyHold: false,
		condition: [{
			all: ["hate-nazi-symbols-public-display"],
			none: []
		}]
	},
	{
		key: "at-prohibited-symbols",
		regions: ["AT"],
		category: "hate",
		action: "block",
		safetyHold: false,
		condition: [{
			all: ["hate-nazi-insignia-public-display"],
			none: []
		}]
	},
	...[
		"GB",
		"EU",
		"AU",
		"BR"
	].map((region) => ({
		key: `${region.toLowerCase()}-adult-content`,
		regions: [region],
		category: "sexual",
		action: "age-restrict",
		safetyHold: false,
		condition: [{
			all: ["sexual-pornographic-media"],
			none: []
		}]
	})),
	{
		key: "au-high-impact-violence",
		regions: ["AU"],
		category: "violence",
		action: "age-restrict",
		safetyHold: false,
		condition: [{
			all: ["violence-high-impact"],
			none: []
		}]
	},
	{
		key: "au-self-harm",
		regions: ["AU"],
		category: "self-harm",
		action: "age-restrict",
		safetyHold: false,
		condition: [{
			all: ["self-harm-age-restricted"],
			none: []
		}]
	}
];
const MANDATORY_RULE_CATEGORIES = new Set(MANDATORY_RULES.map((restriction) => restriction.category));
// packages/shared/src/Project.ts
/** The policy score from which a category's action applies. The same for every policy and category. */
const POLICY_THRESHOLD = .5;
const FLAGGED_CONTENT_POLICY_SCHEMA = zod.object({ action: FLAGGED_CONTENT_ACTION_SCHEMA });
/** Ranks actions by strength: allowances must be softer than the category action, restrictions not. */
const FLAGGED_CONTENT_ACTION_RANK = {
	allow: 0,
	limit: 1,
	"age-restrict": 2,
	block: 3,
	purge: 4
};
/**
* Why a rule can't be used with its category's action, or undefined when it can. An allowance must
* be softer than the category action. A restriction may take any action but allow; one weaker than
* the category action sets a floor where an allowance would otherwise soften the decision, such as
* age-restricting graphic detail that a reporting allowance would allow.
*/
const getPolicyRuleConflict = (kind, rule, categoryAction) => {
	const rank = FLAGGED_CONTENT_ACTION_RANK[rule.action];
	if (kind === "allowance") return rank < FLAGGED_CONTENT_ACTION_RANK[categoryAction] ? void 0 : "allowance-not-softer";
	return rule.action !== "allow" ? void 0 : "restriction-allows";
};
const policyRuleKey = (rule) => policyConditionKey("some", ruleCondition(rule));
const uniqueRules = (rules) => new Set(rules.map(policyRuleKey)).size === rules.length;
const CATEGORY_FLAGGING_SETTINGS_SCHEMA = zod.object({
	enabled: zod.boolean().optional().meta({ description: "Whether this category can affect policy decisions. Disabled categories retain their configured actions and rules." }),
	allowances: zod.array(POLICY_ALLOWANCE_SCHEMA).max(50).refine(uniqueRules, "Two allowances cannot be about the same qualifiers").optional().meta({ description: "Contexts that let content through, or act on it more softly, when all of the category's content is one of their qualifiers." }),
	restrictions: zod.array(POLICY_RESTRICTION_SCHEMA).max(50).refine(uniqueRules, "Two restrictions cannot be about the same qualifiers").optional().meta({ description: "Conditions that act on at least one matching qualifying instance. They outweigh allowances." }),
	flaggedContentPolicy: FLAGGED_CONTENT_POLICY_SCHEMA.nullish().meta({ description: "What happens when this category's policy score reaches 0.5: allow it, limit it so it is delivered normally but marked for reduced reach, age-restrict it so it is delivered only through signed URLs, API keys or an explicit `ageConfirmed=true` opt-in, block it while retaining content, or permanently purge content." })
}).strict().superRefine((value, context) => {
	const categoryAction = value.flaggedContentPolicy?.action ?? "block";
	for (const kind of ["allowance", "restriction"]) {
		const key = kind === "allowance" ? "allowances" : "restrictions";
		for (const [index, rule] of (value[key] ?? []).entries()) {
			const conflict = getPolicyRuleConflict(kind, rule, categoryAction);
			if (conflict) context.addIssue({
				code: "custom",
				message: conflict === "allowance-not-softer" ? "An allowance's action must be softer than the category action" : "A restriction's action must be at least as strong as the category action",
				path: [
					key,
					index,
					"action"
				],
				params: { conflict }
			});
		}
	}
});
zod.object({ categorySettings: zod.partialRecord(MODERATION_POLICY_CATEGORY_SCHEMA, CATEGORY_FLAGGING_SETTINGS_SCHEMA) }).strict().superRefine((settings, context) => {
	for (const [category, value] of Object.entries(settings.categorySettings)) for (const key of ["allowances", "restrictions"]) for (const [index, rule] of (value?.[key] ?? []).entries()) if ([...rule.when, ...rule.unless ?? []].some((q) => !getModerationQualifiers(category).includes(q))) context.addIssue({
		code: "custom",
		message: "Unsupported qualifier for this category",
		path: [
			"categorySettings",
			category,
			key,
			index,
			"when"
		]
	});
});
const METADATA_FIELD_DEFINITION_SCHEMA = zod.object({
	id: zod.string().min(1).max(128).regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/),
	title: zod.string().trim().min(1).max(100),
	description: zod.string().trim().max(500).optional(),
	type: zod.enum([
		"string",
		"number",
		"boolean",
		"date",
		"url"
	]),
	icon: zod.enum([
		"tag",
		"hash",
		"user",
		"folder",
		"layers",
		"photo",
		"link"
	]),
	color: zod.string().regex(/^#[0-9a-fA-F]{6}$/)
});
const METADATA_FIELD_DEFINITIONS_SCHEMA = zod.array(METADATA_FIELD_DEFINITION_SCHEMA).max(50).refine((fields) => new Set(fields.map((field) => field.id)).size === fields.length, { message: "Metadata field IDs must be unique" });
/**
* Which websites and files a project accepts by URL. A domain also covers its subdomains:
* `example.com` matches `example.com` and `www.example.com`.
*/
const REMOTE_URL_RULE_SCHEMA = zod.object({
	mode: zod.enum(["allow", "deny"]).meta({ description: "`allow` accepts only the listed domains; `deny` accepts every domain except the listed ones." }),
	domains: zod.array(zod.string().regex(/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/, { message: "Use a bare lowercase domain such as example.com" })).min(1).max(100).refine((domains) => new Set(domains).size === domains.length, { message: "Domains must be unique" })
});
zod.enum([
	"general-community",
	"children-platform",
	"education-support",
	"wholesome-community"
]);
const PROJECT_SETTINGS_SCHEMA = zod.object({
	jurisdictions: SERVED_JURISDICTIONS_SCHEMA.optional().describe("Jurisdictions served; global always applies. Defaults to global only."),
	aiMediaSearchEnabled: zod.boolean().optional().meta({ description: "Index audio speech and video frames and transcripts for AI search. Billed per indexed media unit. Disabled by default; images are always searchable." }),
	moderationProfileId: zod.string().min(1).optional(),
	metadataFields: METADATA_FIELD_DEFINITIONS_SCHEMA.optional(),
	blockUnmoderatedAssets: zod.boolean().optional().meta({ description: "When true, the CDN refuses to serve assets whose moderation is still pending. Defaults to false, so retained content is servable while classification runs." }),
	testInputsEnabled: zod.boolean().optional().meta({ description: "When true, the project's test images, text codes and media phrases are classified as their chosen category instead of being moderated. They carry the project's secret test input key, so only its members can make one. Defaults to true." }),
	remoteUrlRule: REMOTE_URL_RULE_SCHEMA.nullish().meta({ description: "Restricts the domains this project accepts when content is submitted by URL, including websites. Unset or null accepts every public domain." }),
	websiteSubmissionsPerMinute: zod.number().int().min(1).max(60).nullish().meta({ description: "Lowers how many websites this project can submit per minute. Defaults to, and cannot exceed, the platform limit." }),
	humanReview: HUMAN_REVIEW_SETTINGS_SCHEMA.optional()
}).strict();
zod.object({
	projectId: primaryIdField("proj"),
	assetStorageSizeInGigaBytes: zod.number().nonnegative().default(0),
	assetsUpdatedAt: zod.number().int().nullish(),
	updatedAt: updatedAtField()
});
zod.object({
	id: primaryIdField("proj"),
	/** The organisation that owns the project and is billed for its usage. */
	orgId: idField("org"),
	createdAt: createdAtField(),
	updatedAt: updatedAtField(),
	name: saneStringField(),
	description: saneStringField().nullish(),
	metadata: zod.any().nullish(),
	tags: zod.array(saneStringField()).nullish(),
	settings: PROJECT_SETTINGS_SCHEMA.nullish(),
	flags: zod.array(saneStringField()).nullish(),
	/** Secret that the project's test inputs carry, so only its members can make one. */
	testInputKey: zod.string().regex(TEST_INPUT_KEY_PATTERN).nullish()
});
Object.fromEntries(MODERATION_POLICY_CATEGORIES.map((category) => [category, MANDATORY_RULE_CATEGORIES.has(category) ? Math.min(POLICY_THRESHOLD, MANDATORY_RULE_THRESHOLD) : POLICY_THRESHOLD]));
// packages/shared/src/Asset.ts
/** Where the asset is in the pipeline: receiving content, processing it, or finished. */
const ASSET_CLASSIFICATION_STATUS_SCHEMA = zod.enum([
	"pending",
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
	reviewerUserId: zod.string().nullable(),
	reviewerName: zod.string().nullish(),
	reviewerEmail: zod.string().nullish(),
	reviewedAt: zod.number().int(),
	appliedToAsset: zod.boolean()
});
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
const ASSET_TYPE_SCHEMA = zod.enum([
	"image",
	"video",
	"audio",
	"plaintext-document",
	"multimedia-document",
	"website",
	"file"
]);
const ASSET_VISIBILITY_SCHEMA = zod.enum(["public", "private"]);
const ASSET_SAFETY_HOLD_REASON_SCHEMA = zod.enum(["suspected-illegal-content"]);
const ASSET_SAFETY_HOLD_SCHEMA = zod.object({
	placedAt: zod.number().int().describe("When the hold was placed, in milliseconds since the Unix epoch"),
	reason: ASSET_SAFETY_HOLD_REASON_SCHEMA.describe("Why the asset is held"),
	disposedAt: zod.number().int().nullish().describe("When the held content was disposed of, in milliseconds since the Unix epoch")
});
const SMALL_PLAINTEXT_DOCUMENT_MAX_BYTES = 16384;
const EXTRACTED_TEXT_SCHEMA = zod.discriminatedUnion("type", [zod.object({
	type: zod.literal("string"),
	content: zod.string().refine((value) => new TextEncoder().encode(value).byteLength <= SMALL_PLAINTEXT_DOCUMENT_MAX_BYTES, `Extracted text must be at most ${SMALL_PLAINTEXT_DOCUMENT_MAX_BYTES} bytes when stored inline`)
}), zod.object({
	type: zod.literal("document"),
	id: saneStringField()
})]);
const CHECKSUMS_SCHEMA = zod.object({
	md5: zod.string().nullish().describe("MD5 digest of the uploaded content"),
	sha1: zod.string().nullish().describe("SHA-1 digest of the uploaded content"),
	sha256: zod.string().nullish().describe("SHA-256 digest of the uploaded content"),
	sha384: zod.string().nullish().describe("SHA-384 digest of the uploaded content"),
	sha512: zod.string().nullish().describe("SHA-512 digest of the uploaded content")
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
/**
* The picture CalmLens can show for an asset, as the API returns it. For image assets it is the
* original upload; for documents and websites it is the page image CalmLens generates.
*/
const ASSET_IMAGE_SCHEMA = zod.object({
	width: zod.number().int().positive().nullable().describe("Width in pixels: the original's for image assets (a converted HEIC is served smaller at the same aspect ratio), and the generated image's for documents and websites"),
	height: zod.number().int().positive().nullable().describe("Height in pixels, like `width`"),
	thumbhash: saneStringField().nullable().describe("ThumbHash placeholder you can render while the image loads; `null` once the image is removed"),
	averageColor: saneStringField().nullable().describe("Average color of the image; `null` once the image is removed"),
	perceptualHash: zod.string().nullable().describe("PDQ perceptual hash used to match visually similar images, as 64 hexadecimal characters, for image assets. Hashes 31 or fewer bits apart are usually the same picture."),
	perceptualHashQuality: zod.number().int().min(0).max(100).nullable().describe("How much detail `perceptualHash` captured, from 0 to 100. Hashes below 50 come from flat or featureless images and match unrelated pictures, so leave them out of comparisons.")
});
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
	flaggedContentPolicy: FLAGGED_CONTENT_POLICY_SCHEMA.nullish().meta(metaStore([docPropertyInfo({
		description: "Override the project moderation action for this asset. Allow takes no action, limit delivers the asset normally but marks it for reduced reach, age-restrict serves the asset only through signed URLs, API keys or the `ageConfirmed=true` opt-in, block stops delivery (content is still removed after processing when `keepContentAfterProcessing` is false), and purge deletes content.",
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
	folderId: idField("fldr").nullish().meta(metaStore([docPropertyInfo({ description: "Folder containing the asset" })])),
	uploadPresetId: idField("preset").nullish().describe("ID of the upload preset the asset was uploaded through, if any"),
	createdAt: createdAtField().describe("When the asset was created, in milliseconds since the Unix epoch"),
	updatedAt: updatedAtField().describe("When the asset was last updated, in milliseconds since the Unix epoch"),
	checksums: CHECKSUMS_SCHEMA.nullish().describe("Digests of the uploaded content"),
	imageData: IMAGE_DATA_SCHEMA.nullish().describe("Image properties, for image assets"),
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
	previewImage: PREVIEW_IMAGE_SCHEMA.nullish().describe("Browser-friendly preview generated for images, documents and websites"),
	storageId: saneStringField().nullish().describe("Internal storage key of the retained content; `null` when nothing is stored"),
	uploadPartsReceived: zod.number().int().nullish().describe("Number of parts received so far for a multipart upload"),
	type: ASSET_TYPE_SCHEMA.describe("Asset type, detected from the content's MIME type"),
	metadata: zod.array(METADATA_ITEM_SCHEMA).nullish().meta(metaStore([docPropertyInfo({ description: "List of custom metadata items for the asset" })])),
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
	moderationStatus: ASSET_MODERATION_STATUS_SCHEMA,
	manualReviews: zod.array(ASSET_REVIEW_SCHEMA).default([]).meta(metaStore([backfill({ value: [] })])),
	reviewRevision: zod.number().int().default(0).meta(metaStore([backfill({ value: 0 })])),
	completedAt: zod.number().int().nullish(),
	contentStatus: ASSET_CONTENT_STATUS_SCHEMA,
	contentRemovalReason: ASSET_CONTENT_REMOVAL_REASON_SCHEMA.nullish(),
	contentUpdatedAt: zod.number().nullish(),
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
/** Findings and the policy/reviewer decision for the moderation capability. */
const ASSET_MODERATION_SCHEMA = zod.object({
	delivery: REGIONAL_DELIVERY_SCHEMA.optional().describe("Effective decision for the requested viewer region; the client performs the required age check."),
	status: ASSET_MODERATION_STATUS_SCHEMA.describe("The decision in force, which also decides delivery: `pending`, `allowed`, `limited` (delivered normally, marked for reduced reach), `age-restricted` (served only through signed URLs, API keys or the `ageConfirmed=true` opt-in), `blocked` or `purged`. A reviewer's decision takes precedence."),
	manualReviews: zod.array(ASSET_REVIEW_SCHEMA).describe("Review history, oldest first. Later applied reviews supersede earlier decisions."),
	categories: CLASSIFICATION_REPORT_SCHEMA.shape.categories.optional(),
	score: CLASSIFICATION_REPORT_SCHEMA.shape.score.optional(),
	timeline: CLASSIFICATION_REPORT_SCHEMA.shape.media,
	policy: CLASSIFICATION_REPORT_SCHEMA.shape.policy,
	hashMatches: CLASSIFICATION_REPORT_SCHEMA.shape.hashMatches
}).meta(metaStore([docPropertyInfo({
	description: "Moderation findings and decision",
	namedType: "AssetModeration"
})]));
const ASSET_CLASSIFICATION_SCHEMA = zod.object({
	status: ASSET_CLASSIFICATION_STATUS_SCHEMA,
	updatedAt: epoch("When classification state last changed"),
	completedAt: epoch("When classification completed"),
	moderation: ASSET_MODERATION_SCHEMA,
	personDetection: CLASSIFICATION_REPORT_SCHEMA.shape.features.unwrap().shape.personDetection,
	faceDetection: CLASSIFICATION_REPORT_SCHEMA.shape.features.unwrap().shape.faceDetection,
	linkDetection: CLASSIFICATION_REPORT_SCHEMA.shape.features.unwrap().shape.linkDetection,
	aiGeneratedDetection: CLASSIFICATION_REPORT_SCHEMA.shape.features.unwrap().shape.aiGeneratedDetection,
	textRegions: CLASSIFICATION_REPORT_SCHEMA.shape.textRegions,
	labels: CLASSIFICATION_REPORT_SCHEMA.shape.labels
}).meta(metaStore([docPropertyInfo({
	description: "Classification results",
	namedType: "AssetClassification"
})]));
const ASSET_CONTENT_SCHEMA = zod.object({
	status: ASSET_CONTENT_STATUS_SCHEMA.describe("Whether CalmLens holds the content (source, preview and extracted text): `temporary` until processing finishes, `stored`, or `removed`"),
	removalReason: ASSET_CONTENT_REMOVAL_REASON_SCHEMA.nullable().describe("Why the content was removed: your `policy` purged it, `retention` because `keepContentAfterProcessing` was off, `requested` through the API or portal, `parent-removed` with its parent asset's content, or `disposed` after a safety hold. `null` while content is held."),
	updatedAt: epoch("When the content status last changed"),
	safetyHold: ASSET_SAFETY_HOLD_SCHEMA.nullable().describe("Internal delivery restriction for suspected illegal content. Held content cannot be viewed, changed, or deleted through normal asset operations."),
	format: zod.string().nullable().describe("MIME type of the content"),
	extension: zod.string().nullable().describe("File extension of the content"),
	sizeInBytes: zod.number().int().nullable().describe("Size of the uploaded content in bytes"),
	checksums: CHECKSUMS_SCHEMA.nullable().describe("Digests of the uploaded content"),
	image: ASSET_IMAGE_SCHEMA.nullable().describe("The picture CalmLens serves at the rendered resource: the original image for image assets, or a generated image for documents and websites. It remains after the content is removed, so check `status` before loading it; `null` when the asset has no image."),
	extractedText: EXTRACTED_TEXT_SCHEMA.nullable().describe("Text extracted from the content (including image OCR), inline for small content or stored as a document")
}).meta(metaStore([docPropertyInfo({
	description: "Content state",
	namedType: "AssetContent"
})]));
STORED_ASSET_SCHEMA.pick({
	id: true,
	projectId: true,
	userId: true,
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
	context: true,
	metadata: true,
	tags: true,
	processingOptions: true,
	visibility: true
}).extend({
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
		tags: ["catalogue", "backpacks"],
		upload: {
			status: "completed",
			updatedAt: 17672256e5,
			partsReceived: null
		},
		classification: {
			status: "completed",
			updatedAt: 1767225601e3,
			completedAt: 1767225601e3,
			moderation: {
				status: "allowed",
				manualReviews: []
			}
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
			image: null,
			extractedText: null
		}
	}
})]));
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
	manualDecision: MANUAL_DECISION_SCHEMA.nullish()
});
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
zod.enum([
	"text",
	"code",
	"enum",
	"list",
	"number"
]);
/** Project roles as the portal names them. */
const PROJECT_ROLE_LABELS = {
	admin: "Administrator",
	editor: "Editor",
	viewer: "Viewer",
	custom: "Custom",
	reviewer: "Reviewer"
};
const field = (schema, info) => ({
	...info,
	schema: schema.meta(metaStore([docPropertyInfo({ description: info.description })]))
});
const dataSchemaFromFields = (fields, description) => zod.object(Object.fromEntries(Object.entries(fields).map(([key, definition]) => [key, definition.schema]))).meta(metaStore([docPropertyInfo({ description })]));
const assetNameField = field(zod.string().nullish(), {
	label: "Asset",
	description: "The asset's name when the event was created.",
	display: "text"
});
const assetTypeField = field(ASSET_TYPE_SCHEMA.nullish(), {
	label: "Asset type",
	description: "The asset's type, such as `image` or `video`.",
	display: "enum"
});
const reviewerUserIdField = field(zod.string().nullish(), {
	label: "Reviewer ID",
	description: "ID of the user who made the decision, or `null` when an API key made it.",
	display: "code",
	hidden: true
});
const reviewerNameField = field(zod.string().nullish(), {
	label: "Reviewer",
	description: "Name or email of the user who made the decision, when known.",
	display: "text",
	inAppOnly: true
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
	name: "Asset uploaded",
	description: "A new asset was uploaded to the project.",
	category: "assets",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		fileFormat: field(zod.string().nullish(), {
			label: "File format",
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
	label: "Categories",
	description: "The parent policy categories whose findings decided the status, or none when nothing was acted on. Inspect the asset's classification results for qualifier detail.",
	display: "list"
};
const ASSET_CLASSIFIED = defineEventType({
	id: "asset.classified",
	name: "Asset classified",
	description: "Classification finished for the asset, including the moderation decision it produced.",
	category: "moderation",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		flaggedCategories: field(zod.array(zod.string()), FLAGGED_CATEGORIES_INFO),
		moderationStatus: field(ASSET_MODERATION_STATUS_SCHEMA, {
			label: "Moderation status",
			description: "The status the policy decided: `allowed`, `limited`, `age-restricted`, `blocked` or `purged`. A reviewer's earlier decision on the asset keeps precedence.",
			display: "enum"
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
	name: "Asset region restricted",
	description: "An asset has a stricter delivery decision in a jurisdiction served by the project.",
	category: "moderation",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		region: field(JURISDICTION_SCHEMA.exclude(["global"]), {
			label: "Region",
			description: "Jurisdiction whose mandatory rule raises the delivery action.",
			display: "code"
		}),
		rule: field(zod.string(), {
			label: "Rule",
			description: "Stable mandatory rule key.",
			display: "code"
		}),
		action: field(FLAGGED_CONTENT_ACTION_SCHEMA.exclude(["allow"]), {
			label: "Action",
			description: "Regional delivery action.",
			display: "enum"
		})
	},
	example: {
		assetName: "photo.jpg",
		assetType: "image",
		region: "GB",
		rule: "gb-adult-content",
		action: "age-restrict"
	}
});
const decidedByField = field(zod.enum(["automated", "reviewer"]), {
	label: "Decided by",
	description: "Who made the decision: `automated` moderation or a `reviewer` in the portal, through the API or by resolving an appeal.",
	display: "enum",
	valueLabels: {
		automated: "Automated moderation",
		reviewer: "Reviewer"
	}
});
/** One event per moderation status, emitted whenever automated moderation or a reviewer sets it. */
const defineModerationOutcome = (outcome) => defineEventType({
	...outcome,
	category: "moderation",
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		decidedBy: decidedByField,
		flaggedCategories: field(zod.array(zod.string()).optional(), FLAGGED_CATEGORIES_INFO),
		reviewerUserId: reviewerUserIdField,
		reviewerName: reviewerNameField,
		note: field(zod.string().nullish(), {
			label: "Note",
			description: "The reviewer's note, or `null`.",
			display: "text"
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		decidedBy: "automated",
		flaggedCategories: outcome.id === "asset.allowed" ? [] : ["sexual"]
	}
});
const ASSET_ALLOWED = defineModerationOutcome({
	id: "asset.allowed",
	name: "Asset allowed",
	description: "The asset was allowed and is delivered normally.",
	severity: "low",
	notify: false
});
const ASSET_LIMITED = defineModerationOutcome({
	id: "asset.limited",
	name: "Asset limited",
	description: "The asset was limited: it is delivered normally, but marked so your app can reduce its reach, such as keeping it out of recommendations, trending and notifications, ranking it lower or collapsing it.",
	severity: "low",
	notify: false
});
const ASSET_AGE_RESTRICTED = defineModerationOutcome({
	id: "asset.age-restricted",
	name: "Asset age-restricted",
	description: "The asset was age-restricted: it is not served from its plain URL, only through signed URLs, API keys or an explicit `ageConfirmed=true` opt-in, so your app decides who sees it.",
	severity: "high",
	notify: true
});
const ASSET_BLOCKED = defineModerationOutcome({
	id: "asset.blocked",
	name: "Asset blocked",
	description: "The asset was blocked and is no longer delivered. Its content is kept.",
	severity: "high",
	notify: true
});
const ASSET_PURGED = defineModerationOutcome({
	id: "asset.purged",
	name: "Asset purged",
	description: "The asset was purged: it is no longer delivered and its stored content was deleted.",
	severity: "high",
	notify: true
});
const ASSET_FAILED = defineEventType({
	id: "asset.failed",
	name: "Asset failed",
	description: "The asset could not be processed and its processing status is `failed`.",
	category: "assets",
	severity: "high",
	notify: true,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		previousStatus: field(ASSET_CLASSIFICATION_STATUS_SCHEMA.nullish(), {
			label: "Previous status",
			description: "The asset's processing status before it failed, such as `processing`.",
			display: "enum"
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		previousStatus: "processing"
	}
});
const USAGE_LIMIT_REACHED = defineEventType({
	id: "usage.limit-reached",
	name: "Upload limit reached",
	description: "The project's organisation used its free upload allowance; new uploads are blocked until billing is set up.",
	category: "usage",
	severity: "high",
	notify: true,
	permission: "assets:read",
	fields: {
		limit: field(zod.number().int(), {
			label: "Limit",
			description: "Number of free uploads in the allowance.",
			display: "number"
		}),
		used: field(zod.number().int(), {
			label: "Used",
			description: "Number of free uploads used.",
			display: "number"
		}),
		organisationId: field(idField("org"), {
			label: "Organisation ID",
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
	name: "Member joined",
	description: "Someone accepted an invitation and joined the project.",
	category: "team",
	severity: "low",
	notify: true,
	permission: "members:read",
	fields: {
		memberUserId: field(idField("user"), {
			label: "Member ID",
			description: "User ID of the new member.",
			display: "code",
			hidden: true
		}),
		memberName: field(zod.string().nullish(), {
			label: "Member",
			description: "The new member's name or email.",
			display: "text",
			inAppOnly: true
		}),
		role: field(ACCESS_ROLE_SCHEMA, {
			label: "Role",
			description: "The member's role: `admin`, `editor`, `viewer` or `custom`.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		}),
		invitedByUserId: field(zod.string().nullish(), {
			label: "Invited by ID",
			description: "User ID of the person who sent the invitation.",
			display: "code",
			hidden: true
		})
	},
	example: {
		memberUserId: "user_7Tq2Wm9Lk4Xr8Vb3Np6C",
		memberName: "alex@example.com",
		role: "editor",
		invitedByUserId: EXAMPLE_IDS.user
	}
});
const CONNECTOR_FAILING = defineEventType({
	id: "connector.failing",
	name: "Connector failing",
	description: "Deliveries to a connector kept failing, so it was turned off.",
	category: "connectors",
	severity: "high",
	notify: true,
	permission: "connectors:read",
	fields: {
		connectorId: field(idField("conn"), {
			label: "Connector ID",
			description: "ID of the failing connector.",
			display: "code",
			hidden: true
		}),
		connectorName: field(zod.string(), {
			label: "Connector",
			description: "The connector's name.",
			display: "text"
		}),
		connectorType: field(zod.string(), {
			label: "Connector type",
			description: "The connector's type, such as `webhook`, `slack` or `email`.",
			display: "enum"
		}),
		consecutiveFailures: field(zod.number().int(), {
			label: "Failures in a row",
			description: "Number of deliveries in a row that failed after their retries.",
			display: "number"
		}),
		lastError: field(zod.string().nullish(), {
			label: "Last error",
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
const MEMBER_ROLE_SCHEMA = ACCESS_ROLE_SCHEMA;
const memberUserIdField = field(zod.string(), {
	label: "Member ID",
	description: "User ID of the member.",
	display: "code",
	hidden: true
});
const memberNameField = field(zod.string().nullish(), {
	label: "Member",
	description: "The member's name or email.",
	display: "text",
	inAppOnly: true
});
const actorUserIdField = (label, description) => field(zod.string().nullish(), {
	label,
	description,
	display: "code",
	hidden: true
});
const ASSET_DELETED = defineEventType({
	id: "asset.deleted",
	name: "Asset deleted",
	description: "An asset was deleted from the project, with its stored content.",
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
const ASSET_CONTENT_REMOVED = defineEventType({
	id: "asset.content-removed",
	name: "Content removed",
	description: "An asset's stored content was removed on request. The asset and its classification results remain.",
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
const ASSET_RETRIED = defineEventType({
	id: "asset.retried",
	name: "Asset retried",
	description: "A failed asset was queued for processing again.",
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
	name: "Review requested",
	description: "An asset was added to the human review queue.",
	category: "moderation",
	severity: "low",
	notify: false,
	permission: "reviews:read",
	enabled: false,
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		automatedOutcome: field(ASSET_MODERATION_STATUS_SCHEMA, {
			label: "Automated outcome",
			description: "The asset's status from automated moderation: `allowed`, `limited`, `age-restricted`, `blocked` or `purged`.",
			display: "enum"
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		automatedOutcome: "allowed"
	}
});
const ASSET_HASH_MATCHED = defineEventType({
	id: "asset.hash-matched",
	name: "Hash list match",
	description: "An uploaded image matched an entry in one of the project's hash lists. A close match on a block list blocks the asset.",
	category: "moderation",
	severity: "high",
	notify: true,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		hashListId: field(idField("hl"), {
			label: "Hash list ID",
			description: "ID of the hash list with the closest match.",
			display: "code",
			hidden: true
		}),
		hashListName: field(zod.string(), {
			label: "Hash list",
			description: "Name of the hash list with the closest match.",
			display: "text"
		}),
		distance: field(zod.number().int(), {
			label: "Distance",
			description: "Number of bits that differ between the image's PDQ hash and the listed hash. 0 is the same picture.",
			display: "number"
		}),
		matchAction: field(HASH_LIST_ACTION_SCHEMA, {
			label: "Action",
			description: "What the match did: `block` blocked the asset, `flag` only reported it.",
			display: "enum",
			valueLabels: {
				flag: "Flagged",
				block: "Blocked"
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
const USAGE_SPEND_LIMIT_REACHED = defineEventType({
	id: "usage.spend-limit-reached",
	name: "Spend limit reached",
	description: "The project's organisation reached a limit on its usage; new uploads are paused until it resumes.",
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
			label: "Reason",
			description: "Which limit paused uploads: the organisation's `spend-limit`, its `usage-cap`, the project's `project-budget`, or `payment-failed` while an invoice is unpaid.",
			display: "enum"
		}),
		resumesOn: field(zod.string().nullish(), {
			label: "Uploads resume",
			description: "The date uploads resume, as `YYYY-MM-DD` in UTC: the end of the billing period, or sooner if the limit is raised. Null while an invoice is unpaid: uploads resume once it is paid.",
			display: "text"
		})
	},
	example: {
		reason: "usage-cap",
		resumesOn: "2026-11-01"
	}
});
const UPLOAD_PRESET_DAILY_LIMIT_REACHED = defineEventType({
	id: "upload-preset.daily-limit-reached",
	name: "Preset daily limit reached",
	description: "A client reached an upload preset's daily upload limit; that client's uploads pause until it resets.",
	category: "usage",
	severity: "low",
	notify: false,
	permission: "upload-presets:read",
	fields: {
		presetId: field(idField("preset"), {
			label: "Preset ID",
			description: "ID of the upload preset.",
			display: "code",
			hidden: true
		}),
		presetName: field(zod.string(), {
			label: "Preset",
			description: "The upload preset's name.",
			display: "text"
		}),
		dailyLimit: field(zod.number().int(), {
			label: "Daily limit",
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
	name: "Member removed",
	description: "A member was removed from the project, or left it.",
	category: "team",
	severity: "low",
	notify: true,
	permission: "members:read",
	fields: {
		memberUserId: memberUserIdField,
		memberName: memberNameField,
		role: field(MEMBER_ROLE_SCHEMA, {
			label: "Role",
			description: "The role the member held.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		}),
		left: field(zod.boolean(), {
			label: "Left the project",
			description: "`true` when the member left, `false` when someone removed them.",
			display: "enum"
		}),
		removedByUserId: actorUserIdField("Removed by ID", "User ID of the person who removed the member.")
	},
	example: {
		memberUserId: "user_7Tq2Wm9Lk4Xr8Vb3Np6C",
		memberName: "alex@example.com",
		role: "editor",
		left: false,
		removedByUserId: EXAMPLE_IDS.user
	}
});
const PROJECT_MEMBER_ROLE_CHANGED = defineEventType({
	id: "project.member-role-changed",
	name: "Member access changed",
	description: "A member's role or custom permissions were changed.",
	category: "team",
	severity: "low",
	notify: true,
	permission: "members:read",
	fields: {
		memberUserId: memberUserIdField,
		memberName: memberNameField,
		previousRole: field(MEMBER_ROLE_SCHEMA, {
			label: "Previous role",
			description: "The member's role before the change.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		}),
		role: field(MEMBER_ROLE_SCHEMA, {
			label: "Role",
			description: "The member's role after the change; `custom` roles may have changed permissions.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		}),
		changedByUserId: actorUserIdField("Changed by ID", "User ID of the person who changed the access.")
	},
	example: {
		memberUserId: "user_7Tq2Wm9Lk4Xr8Vb3Np6C",
		memberName: "alex@example.com",
		previousRole: "viewer",
		role: "editor",
		changedByUserId: EXAMPLE_IDS.user
	}
});
const PROJECT_INVITATION_SENT = defineEventType({
	id: "project.invitation-sent",
	name: "Invitation sent",
	description: "Someone was invited to join the project.",
	category: "team",
	severity: "low",
	notify: false,
	permission: "members:read",
	fields: {
		inviteeEmail: field(zod.string(), {
			label: "Invitee",
			description: "The email address that was invited.",
			display: "text",
			inAppOnly: true
		}),
		role: field(MEMBER_ROLE_SCHEMA, {
			label: "Role",
			description: "The role the invitation grants.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		}),
		invitedByUserId: actorUserIdField("Invited by ID", "User ID of the person who sent the invitation.")
	},
	example: {
		inviteeEmail: "alex@example.com",
		role: "editor",
		invitedByUserId: EXAMPLE_IDS.user
	}
});
const API_KEY_CREATED = defineEventType({
	id: "api-key.created",
	name: "API key created",
	description: "An API key was created for the project.",
	category: "api-keys",
	severity: "low",
	notify: false,
	permission: "api-keys:read",
	fields: {
		keyId: field(idField("key"), {
			label: "Key ID",
			description: "ID of the API key.",
			display: "code",
			hidden: true
		}),
		keyName: field(zod.string().nullish(), {
			label: "Key",
			description: "The API key's name.",
			display: "text"
		}),
		role: field(ACCESS_ROLE_SCHEMA, {
			label: "Role",
			description: "The access the key was created with: `admin`, `editor`, `viewer` or `custom`.",
			display: "enum",
			valueLabels: PROJECT_ROLE_LABELS
		}),
		createdByUserId: actorUserIdField("Created by ID", "User ID of the person who created the key."),
		createdByName: field(zod.string().nullish(), {
			label: "Created by",
			description: "Name or email of the person who created the key, when known.",
			display: "text",
			inAppOnly: true
		})
	},
	example: {
		keyId: EXAMPLE_IDS.key,
		keyName: "Production server",
		role: "editor",
		createdByUserId: EXAMPLE_IDS.user,
		createdByName: "alex@example.com"
	}
});
const API_KEY_REVOKED = defineEventType({
	id: "api-key.revoked",
	name: "API key revoked",
	description: "An API key was revoked or deleted and can no longer be used.",
	category: "api-keys",
	severity: "low",
	notify: false,
	permission: "api-keys:read",
	fields: {
		keyId: field(idField("key"), {
			label: "Key ID",
			description: "ID of the API key.",
			display: "code",
			hidden: true
		}),
		keyName: field(zod.string().nullish(), {
			label: "Key",
			description: "The API key's name.",
			display: "text"
		}),
		action: field(zod.enum(["revoked", "deleted"]), {
			label: "Action",
			description: "`revoked` when the key was kept but disabled, `deleted` when it was removed.",
			display: "enum"
		}),
		revokedByUserId: actorUserIdField("Revoked by ID", "User ID of the person who revoked the key."),
		revokedByName: field(zod.string().nullish(), {
			label: "Revoked by",
			description: "Name or email of the person who revoked the key, when known.",
			display: "text",
			inAppOnly: true
		})
	},
	example: {
		keyId: EXAMPLE_IDS.key,
		keyName: "Production server",
		action: "revoked",
		revokedByUserId: EXAMPLE_IDS.user,
		revokedByName: "alex@example.com"
	}
});
const appealFields = {
	appealId: field(idField("apl"), {
		label: "Appeal",
		description: "The appeal identifier.",
		display: "code"
	}),
	subjectType: field(zod.enum([
		"post",
		"user",
		"reported-post",
		"reported-user"
	]), {
		label: "Subject type",
		description: "The type of moderation decision appealed.",
		display: "enum"
	}),
	subjectId: field(zod.string(), {
		label: "Subject",
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
	"asset.deleted": ASSET_DELETED,
	"asset.content-removed": ASSET_CONTENT_REMOVED,
	"asset.retried": ASSET_RETRIED,
	"asset.review-requested": ASSET_REVIEW_REQUESTED,
	"asset.hash-matched": ASSET_HASH_MATCHED,
	"usage.limit-reached": USAGE_LIMIT_REACHED,
	"usage.spend-limit-reached": USAGE_SPEND_LIMIT_REACHED,
	"upload-preset.daily-limit-reached": UPLOAD_PRESET_DAILY_LIMIT_REACHED,
	"project.member-joined": PROJECT_MEMBER_JOINED,
	"project.member-removed": PROJECT_MEMBER_REMOVED,
	"project.member-role-changed": PROJECT_MEMBER_ROLE_CHANGED,
	"project.invitation-sent": PROJECT_INVITATION_SENT,
	"api-key.created": API_KEY_CREATED,
	"api-key.revoked": API_KEY_REVOKED,
	"connector.failing": CONNECTOR_FAILING,
	"appeal.submitted": defineEventType({
		id: "appeal.submitted",
		name: "Appeal submitted",
		description: "A moderation decision was appealed.",
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
		name: "Appeal resolved",
		description: "A reviewer upheld or overturned a moderation decision.",
		category: "moderation",
		severity: "low",
		notify: true,
		permission: "project:manage",
		fields: {
			...appealFields,
			decision: field(zod.enum(["upheld", "overturned"]), {
				label: "Decision",
				description: "The appeal outcome.",
				display: "enum"
			}),
			action: field(zod.string(), {
				label: "Action",
				description: "The final action for the customer's integration.",
				display: "code"
			}),
			appliedToAsset: field(zod.boolean(), {
				label: "Applied to asset",
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
		moderation: zod.object({ status: ASSET_MODERATION_STATUS_SCHEMA })
	}),
	content: zod.object({ status: ASSET_CONTENT_STATUS_SCHEMA }).describe("Whether CalmLens held the asset's content when the event was created")
});
const EVENT_FIELDS = {
	id: primaryIdField("evt").describe("Unique event ID"),
	projectId: idField("proj").describe("ID of the project the event belongs to"),
	userId: saneStringField().nullish().describe("ID of the user who caused the event, if any"),
	type: EVENT_TYPE_SCHEMA.describe("Event type. See [Event types](/docs/api/events#event-types)."),
	severity: EVENT_SEVERITY_SCHEMA.describe("Default severity of the event type"),
	title: saneStringField().describe("Short human-readable summary"),
	description: saneStringField({ type: "large" }).nullish().describe("Longer human-readable explanation"),
	assetId: idField("asset").nullish().describe("ID of the asset the event is about, for asset events"),
	asset: EVENT_ASSET_SCHEMA.nullish().describe("Snapshot of the asset's moderation decision when the event was created, for asset events"),
	facts: EVENT_FACTS_SCHEMA.describe("Registered event facts. See [Event facts](/docs/api/events#event-facts)."),
	notify: zod.boolean().nullish().describe("Whether the event triggers in-app notifications"),
	createdAt: createdAtField().describe("When the event was created, in milliseconds since the Unix epoch"),
	updatedAt: updatedAtField().describe("When the event was last updated, in milliseconds since the Unix epoch"),
	readAt: zod.number().int().nullish().describe("When the event was marked as read in the portal, in milliseconds since the Unix epoch")
};
const EVENT_SCHEMA = zod.strictObject(EVENT_FIELDS).meta(metaStore([docPropertyInfo({
	description: "An event or alert in the system",
	namedType: "Event",
	example: {
		id: EXAMPLE_IDS.evt,
		projectId: EXAMPLE_IDS.proj,
		type: "asset.uploaded",
		severity: "low",
		title: "Product photo uploaded",
		assetId: EXAMPLE_IDS.asset,
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
const typedEventVariant = (type) => zod.strictObject({
	...EVENT_FIELDS,
	type: zod.literal(type).meta(metaStore([docPropertyInfo({ description: EVENT_TYPE_INFO[type].description })])),
	facts: EVENT_FACT_SCHEMAS[type]
}).meta(metaStore([docPropertyInfo({ description: `${EVENT_TYPE_INFO[type].name}: ${EVENT_TYPE_INFO[type].description}` })]));
zod.discriminatedUnion("type", EVENT_TYPES.map((type) => typedEventVariant(type))).meta(metaStore([docPropertyInfo({
	description: "An event; `facts` depends on `type`",
	namedType: "Event",
	example: {
		id: EXAMPLE_IDS.evt,
		projectId: EXAMPLE_IDS.proj,
		type: "asset.uploaded",
		severity: "low",
		title: "Product photo uploaded",
		assetId: EXAMPLE_IDS.asset,
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
	docsSchema: EVENT_SCHEMA
})]));
EXAMPLE_IDS.asset;
// packages/shared/src/WebhookPayload.ts
const WEBHOOK_DELIVERY_HEADER = "x-calmlens-delivery";
const WEBHOOK_TIMESTAMP_HEADER = "x-calmlens-timestamp";
const WEBHOOK_SIGNATURE_HEADER = "x-calmlens-signature";
/** Receivers reject deliveries whose timestamp is further than this from their clock. */
const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
const WEBHOOK_EVENT_DATA_SCHEMA = zod.strictObject({
	severity: EVENT_SEVERITY_SCHEMA,
	title: zod.string(),
	description: zod.string().nullish(),
	assetId: zod.string().nullish(),
	asset: EVENT_ASSET_SCHEMA.nullish(),
	facts: EVENT_FACTS_SCHEMA
});
const webhookPayloadVariant = (type) => zod.strictObject({
	id: zod.string(),
	type: zod.literal(type),
	createdAt: zod.number(),
	projectId: zod.string(),
	data: WEBHOOK_EVENT_DATA_SCHEMA.extend({ facts: EVENT_FACT_SCHEMAS[type] })
});
/** The webhook body, discriminated by `type`: `data.facts` is typed per event type. */
const WEBHOOK_EVENT_PAYLOAD_SCHEMA = zod.discriminatedUnion("type", EVENT_TYPES.map((type) => webhookPayloadVariant(type)));
const toWebhookEventPayload = (event) => ({
	id: event.id,
	type: event.type,
	createdAt: event.createdAt,
	projectId: event.projectId,
	data: {
		severity: event.severity,
		title: event.title,
		description: event.description ?? null,
		assetId: event.assetId ?? null,
		asset: event.asset ?? null,
		facts: event.facts
	}
});
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
	data: zod.looseObject({
		severity: zod.string().optional(),
		title: zod.string().optional(),
		description: zod.string().nullish(),
		assetId: zod.string().nullish(),
		asset: zod.looseObject({ id: zod.string() }).nullish(),
		facts: zod.array(zod.looseObject({
			key: zod.string(),
			value: zod.unknown(),
			url: zod.string().optional()
		})).optional()
	})
});
export { WEBHOOK_DELIVERY_HEADER, WEBHOOK_EVENT_PAYLOAD_SCHEMA, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_SIGNATURE_TOLERANCE_SECONDS, WEBHOOK_TIMESTAMP_HEADER, createWebhookHeaders, toWebhookEventPayload };
