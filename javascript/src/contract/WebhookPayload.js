import { C as POLICY_ALLOWANCE_SCHEMA, D as metaStore, E as backfill, S as FLAGGED_CONTENT_ACTION_SCHEMA, T as getModerationQualifiers, _ as saneStringField, b as PROCESSING_FEATURES_SCHEMA, f as CLASSIFICATION_REPORT_SCHEMA, g as primaryUuidField, h as createdAtField, m as MODERATION_POLICY_CATEGORY_SCHEMA, n as TEST_INPUT_KEY_PATTERN, p as MODERATION_POLICY_CATEGORIES, v as updatedAtField, w as POLICY_RESTRICTION_SCHEMA, x as docPropertyInfo, y as uuidField } from "./TestTriggers-BaWVfu5z.js";
import "./SharedConstants-CdFPZV7z.js";
import { t as hmacSha256Hex } from "./CryptoUtils-Cb7_Afa0.js";
import { n as GRANTS_SCHEMA, t as ACCESS_ROLE_SCHEMA } from "./Permissions-Blo3Tgky.js";
import * as zod from "zod";
//#region packages/shared/src/AssetReviewAction.ts
const ASSET_REVIEW_ACTION_SCHEMA = zod.enum([
	"approve",
	"hide",
	"purge"
]);
//#endregion
//#region packages/shared/src/HumanReview.ts
const SAMPLE_PERCENT_SCHEMA = zod.number().min(0).max(100);
const HUMAN_REVIEW_SETTINGS_SCHEMA = zod.object({
	approvedSamplePercent: SAMPLE_PERCENT_SCHEMA.default(0),
	rejectedSamplePercent: SAMPLE_PERCENT_SCHEMA.default(0)
}).strict();
/** Automated outcomes that can be sampled, and the decisions a reviewer can make. */
const HUMAN_REVIEW_OUTCOME_SCHEMA = zod.enum(["approved", "rejected"]);
const HUMAN_REVIEW_STATUS_SCHEMA = zod.enum(["pending", "completed"]);
zod.object({
	id: primaryUuidField(),
	projectId: uuidField(),
	assetId: uuidField(),
	automatedOutcome: HUMAN_REVIEW_OUTCOME_SCHEMA,
	status: HUMAN_REVIEW_STATUS_SCHEMA,
	decision: HUMAN_REVIEW_OUTCOME_SCHEMA.nullish(),
	action: ASSET_REVIEW_ACTION_SCHEMA.nullish(),
	note: zod.string().max(1e3).nullish(),
	reviewerUserId: zod.string().nullish(),
	/** Whether the decision changed the asset's status (only when it overturned the outcome). */
	appliedToAsset: zod.boolean().nullish(),
	createdAt: createdAtField(),
	reviewedAt: zod.number().int().nullish()
});
zod.object({
	action: ASSET_REVIEW_ACTION_SCHEMA,
	confirmPurge: zod.boolean().optional(),
	note: zod.string().trim().max(1e3).nullish()
}).strict().superRefine((body, ctx) => {
	if (body.action === "purge" && body.confirmPurge !== true) ctx.addIssue({
		code: "custom",
		path: ["confirmPurge"],
		message: "Confirm permanent deletion"
	});
});
//#endregion
//#region packages/shared/src/PolicyCondition.ts
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
//#endregion
//#region packages/shared/src/Project.ts
const MINIMUM_MODERATION_THRESHOLD = .1;
const FLAGGED_CONTENT_POLICY_SCHEMA = zod.object({ action: FLAGGED_CONTENT_ACTION_SCHEMA });
/** Ranks actions by strength: allowances must be softer than the category action, restrictions not. */
const FLAGGED_CONTENT_ACTION_RANK = {
	allow: 0,
	flag: 1,
	hide: 2,
	purge: 3
};
/** Why a rule can't be used with its category's action, or undefined when it can. */
const getPolicyRuleConflict = (kind, rule, categoryAction) => {
	const rank = FLAGGED_CONTENT_ACTION_RANK[rule.action];
	if (kind === "allowance") return rank < FLAGGED_CONTENT_ACTION_RANK[categoryAction] ? void 0 : "allowance-not-softer";
	return rule.action !== "allow" && rank >= FLAGGED_CONTENT_ACTION_RANK[categoryAction] ? void 0 : "restriction-weaker";
};
const policyRuleKey = (rule) => policyConditionKey("some", ruleCondition(rule));
const uniqueRules = (rules) => new Set(rules.map(policyRuleKey)).size === rules.length;
const CATEGORY_FLAGGING_SETTINGS_SCHEMA = zod.object({
	enabled: zod.boolean().optional().meta({ description: "Whether this category can affect policy decisions. Disabled categories retain their configured actions and rules." }),
	threshold: zod.number().min(0).max(1).transform((threshold) => Math.max(threshold, MINIMUM_MODERATION_THRESHOLD)).meta({ description: "The policy score at which the category's action applies. The policy score is the category score, lowered by allowances that cover the content and raised to a restriction's presence score." }),
	allowances: zod.array(POLICY_ALLOWANCE_SCHEMA).max(50).refine(uniqueRules, "Two allowances cannot be about the same qualifiers").optional().meta({ description: "Contexts that let content through, or act on it more softly, when all of the category's content is one of their qualifiers." }),
	restrictions: zod.array(POLICY_RESTRICTION_SCHEMA).max(50).refine(uniqueRules, "Two restrictions cannot be about the same qualifiers").optional().meta({ description: "Conditions that act on at least one matching qualifying instance. They outweigh allowances." }),
	flaggedContentPolicy: FLAGGED_CONTENT_POLICY_SCHEMA.nullish().meta({ description: "What happens when this category's policy score reaches its threshold: allow it, flag it while continuing delivery, hide while retaining content, or permanently purge content." })
}).strict().superRefine((value, context) => {
	const categoryAction = value.flaggedContentPolicy?.action ?? "hide";
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
const PROJECT_SETTINGS_SCHEMA = zod.object({
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
	projectId: primaryUuidField(),
	assetStorageSizeInGigaBytes: zod.number().nonnegative().default(0),
	assetsUpdatedAt: zod.number().int().nullish(),
	updatedAt: updatedAtField()
});
zod.object({
	id: primaryUuidField(),
	humanReadableId: saneStringField(),
	userId: saneStringField(),
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
Object.fromEntries(MODERATION_POLICY_CATEGORIES.map((category) => [category, MINIMUM_MODERATION_THRESHOLD]));
//#endregion
//#region packages/shared/src/Asset.ts
/** Where the asset is in the pipeline: receiving content, processing it, or finished. */
const ASSET_CLASSIFICATION_STATUS_SCHEMA = zod.enum([
	"pending",
	"processing",
	"completed",
	"failed"
]);
/** The moderation outcome in force: a reviewer's decision when there is one, else the automated one. */
const ASSET_MODERATION_STATUS_SCHEMA = zod.enum([
	"pending",
	"approved",
	"rejected"
]);
/** What the policy did with flagged content. `null` when the policy matched nothing. */
const ASSET_MODERATION_ACTION_SCHEMA = zod.enum([
	"flag",
	"hide",
	"purge"
]);
/** A reviewer's decision on an asset. */
const ASSET_REVIEWER_ACTION_SCHEMA = zod.enum(["approved", "rejected"]);
const ASSET_REVIEW_SCHEMA = zod.object({
	id: zod.string().uuid(),
	decision: ASSET_REVIEWER_ACTION_SCHEMA,
	action: ASSET_REVIEW_ACTION_SCHEMA,
	note: zod.string().nullable(),
	reviewerUserId: zod.string().nullable(),
	reviewerName: zod.string().nullish(),
	reviewerEmail: zod.string().nullish(),
	reviewedAt: zod.number(),
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
	placedAt: zod.number().describe("When the hold was placed, in milliseconds since the Unix epoch"),
	reason: ASSET_SAFETY_HOLD_REASON_SCHEMA.describe("Why the asset is held"),
	disposedAt: zod.number().nullish().describe("When the held content was disposed of, in milliseconds since the Unix epoch")
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
	perceptualHash: zod.string().nullish().describe("Perceptual hash used to match visually similar images"),
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
		description: "Override the project moderation action for this asset. Allow takes no action, flag keeps delivery enabled and flags the asset, hide blocks delivery (content is still removed after processing when `keepContentAfterProcessing` is false), and purge deletes content.",
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
	id: primaryUuidField().describe("Unique asset ID"),
	projectId: uuidField().describe("ID of the project that owns the asset"),
	sizeInBytes: zod.number().nullish().describe("Size of the uploaded content in bytes"),
	userId: saneStringField().nullish().describe("ID of the user whose account created the asset"),
	parentId: uuidField().nullish().describe("ID of the parent asset for child assets CalmLens extracts during processing, such as images in a document. `null` for uploaded assets."),
	folderId: uuidField().nullish().meta(metaStore([docPropertyInfo({ description: "Folder containing the asset" })])),
	uploadPresetId: uuidField().nullish().describe("ID of the upload preset the asset was uploaded through, if any"),
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
	previewImage: PREVIEW_IMAGE_SCHEMA.nullish().describe("Browser-friendly preview generated for images, documents and websites"),
	storageId: saneStringField().nullish().describe("Internal storage key of the retained content; `null` when nothing is stored"),
	uploadPartsReceived: zod.number().int().nullish().describe("Number of parts received so far for a multipart upload"),
	type: ASSET_TYPE_SCHEMA.describe("Asset type, detected from the content's MIME type"),
	metadata: zod.array(METADATA_ITEM_SCHEMA).nullish().meta(metaStore([docPropertyInfo({ description: "List of custom metadata items for the asset" })])),
	tags: zod.array(saneStringField()).nullish().meta(metaStore([docPropertyInfo({
		description: "Array of tags for the asset",
		placeholder: "[\"tag1\", \"tag2\"]"
	})])),
	report: CLASSIFICATION_REPORT_SCHEMA.nullish().describe("Moderation report, set once classification finishes. See [Report format](/docs/guides/classification-results)."),
	uploadStatus: zod.enum(["uploading", "completed"]).default("completed"),
	uploadUpdatedAt: zod.number().nullish(),
	classificationStatus: ASSET_CLASSIFICATION_STATUS_SCHEMA,
	classificationUpdatedAt: zod.number().nullish(),
	moderationStatus: ASSET_MODERATION_STATUS_SCHEMA,
	moderationAction: ASSET_MODERATION_ACTION_SCHEMA.nullish(),
	manualReviews: zod.array(ASSET_REVIEW_SCHEMA).default([]).meta(metaStore([backfill({ value: [] })])),
	reviewRevision: zod.number().int().default(0).meta(metaStore([backfill({ value: 0 })])),
	completedAt: zod.number().nullish(),
	contentStatus: ASSET_CONTENT_STATUS_SCHEMA,
	contentRemovalReason: ASSET_CONTENT_REMOVAL_REASON_SCHEMA.nullish(),
	contentUpdatedAt: zod.number().nullish(),
	safetyHold: ASSET_SAFETY_HOLD_SCHEMA.nullish(),
	copyrightHolds: zod.array(zod.string().uuid()).nullish(),
	extractedText: EXTRACTED_TEXT_SCHEMA.nullish().meta(metaStore([docPropertyInfo({ description: "Extracted text stored inline for small content or in R2 for larger content" })])),
	processingOptions: PROCESSING_OPTIONS_SCHEMA.describe("Processing options supplied when the asset was uploaded"),
	visibility: ASSET_VISIBILITY_SCHEMA.nullish().meta(metaStore([docPropertyInfo({
		description: "Visibility level of the asset",
		defaultValue: "private"
	})]))
}).meta(metaStore([docPropertyInfo({
	description: "An asset as stored",
	namedType: "StoredAsset"
})]));
const PUBLIC_PREVIEW_IMAGE_SCHEMA = PREVIEW_IMAGE_SCHEMA.omit({ id: true });
const epoch = (description) => zod.number().nullable().describe(`${description}, in milliseconds since the Unix epoch`);
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
	decision: ASSET_MODERATION_STATUS_SCHEMA.describe("The decision in force: pending, approved or rejected. A reviewer's decision takes precedence."),
	action: ASSET_MODERATION_ACTION_SCHEMA.nullable(),
	manualReviews: zod.array(ASSET_REVIEW_SCHEMA).describe("Review history, oldest first. Later applied reviews supersede earlier decisions."),
	categories: CLASSIFICATION_REPORT_SCHEMA.shape.categories.optional(),
	score: CLASSIFICATION_REPORT_SCHEMA.shape.score.optional(),
	timeline: CLASSIFICATION_REPORT_SCHEMA.shape.media,
	policy: CLASSIFICATION_REPORT_SCHEMA.shape.policy
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
	sizeInBytes: zod.number().nullable().describe("Size of the uploaded content in bytes"),
	checksums: CHECKSUMS_SCHEMA.nullable().describe("Digests of the uploaded content"),
	image: IMAGE_DATA_SCHEMA.nullable().describe("Image properties, for image assets"),
	previewImage: PUBLIC_PREVIEW_IMAGE_SCHEMA.nullable().describe("Browser-friendly preview generated for images, documents and websites"),
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
		id: "123e4567-e89b-42d3-a456-426614174000",
		projectId: "b35456f3-79d8-4893-b316-b0d7ae668004",
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
				decision: "approved",
				action: null,
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
			previewImage: null,
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
const MANUAL_DECISION_SCHEMA = zod.enum(["approved", "rejected"]);
zod.object({
	assetId: zod.string().uuid(),
	projectId: zod.string().uuid(),
	childProcessing: CHILD_PROCESSING_SCHEMA.nullish(),
	manualDecision: MANUAL_DECISION_SCHEMA.nullish()
});
//#endregion
//#region packages/shared/src/ProjectAccess.ts
const PROJECT_MEMBER_ROLE_SCHEMA = zod.enum([...ACCESS_ROLE_SCHEMA.options, "reviewer"]);
zod.object({
	id: primaryUuidField(),
	projectId: zod.string().uuid(),
	userId: zod.string(),
	role: PROJECT_MEMBER_ROLE_SCHEMA,
	grants: GRANTS_SCHEMA.default([]),
	createdAt: zod.number()
});
zod.object({
	id: primaryUuidField(),
	projectId: zod.string().uuid(),
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
//#endregion
//#region packages/shared/src/EventCatalog.ts
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
const ASSET_FLAGGED = defineEventType({
	id: "asset.flagged",
	name: "Asset flagged",
	description: "Automated moderation flagged the asset for a policy violation.",
	category: "moderation",
	severity: "high",
	notify: true,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		flaggedCategories: field(zod.array(zod.string()), {
			label: "Categories",
			description: "The matched parent policy categories. Inspect the asset's classification results for qualifier detail.",
			display: "list"
		}),
		moderationAction: field(ASSET_MODERATION_ACTION_SCHEMA.nullish(), {
			label: "Moderation action",
			description: "The action applied to the flagged content (`flag`, `hide` or `purge`).",
			display: "enum"
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		flaggedCategories: ["violence", "sexual"],
		moderationAction: "hide"
	}
});
const decidedByField = field(zod.enum(["automated", "reviewer"]), {
	label: "Decided by",
	description: "Who made the decision: `automated` moderation or a `reviewer` in the portal or through the API.",
	display: "enum",
	valueLabels: {
		automated: "Automated moderation",
		reviewer: "Reviewer"
	}
});
const decisionModerationActionField = field(ASSET_MODERATION_ACTION_SCHEMA.nullish(), {
	label: "Moderation action",
	description: "What the policy did with flagged content (`flag`, `hide` or `purge`), or `null` when nothing was flagged. A reviewer's decision keeps it.",
	display: "enum"
});
const ASSET_APPROVED = defineEventType({
	id: "asset.approved",
	name: "Asset approved",
	description: "The asset was approved, by automated moderation or by a reviewer.",
	category: "moderation",
	severity: "low",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		decidedBy: decidedByField,
		moderationAction: decisionModerationActionField,
		reviewAction: field(zod.enum([
			"approve",
			"hide",
			"purge"
		]).optional(), {
			label: "Reviewer action",
			description: "The action chosen by a reviewer.",
			display: "enum",
			valueLabels: {
				approve: "Approve",
				hide: "Hide",
				purge: "Purge"
			}
		}),
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
		moderationAction: null
	}
});
const ASSET_REJECTED = defineEventType({
	id: "asset.rejected",
	name: "Asset rejected",
	description: "The asset was rejected, by automated moderation or by a reviewer.",
	category: "moderation",
	severity: "high",
	notify: false,
	permission: "assets:read",
	fields: {
		assetName: assetNameField,
		assetType: assetTypeField,
		decidedBy: decidedByField,
		moderationAction: decisionModerationActionField,
		reviewAction: field(zod.enum([
			"approve",
			"hide",
			"purge"
		]).optional(), {
			label: "Reviewer action",
			description: "The action chosen by a reviewer.",
			display: "enum",
			valueLabels: {
				approve: "Approve",
				hide: "Hide",
				purge: "Purge"
			}
		}),
		reviewerUserId: reviewerUserIdField,
		reviewerName: reviewerNameField,
		note: field(zod.string().nullish(), {
			label: "Note",
			description: "The reviewer's reason for rejecting the asset, or `null`.",
			display: "text"
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		decidedBy: "reviewer",
		reviewerUserId: "user-123",
		reviewerName: "Sam Reviewer",
		note: "No usage rights for this photo"
	}
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
	description: "The project owner used their free upload allowance; new uploads are blocked.",
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
		ownerUserId: field(zod.string(), {
			label: "Owner ID",
			description: "ID of the project owner whose allowance was used.",
			display: "code",
			hidden: true,
			inAppOnly: true
		})
	},
	example: {
		limit: 100,
		used: 100,
		ownerUserId: "user-123"
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
		memberUserId: field(zod.string(), {
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
		memberUserId: "user-456",
		memberName: "alex@example.com",
		role: "editor",
		invitedByUserId: "user-123"
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
		connectorId: field(zod.string(), {
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
		connectorId: "connector-123",
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
			description: "The asset's status from automated moderation: `approved` or `rejected`.",
			display: "enum"
		})
	},
	example: {
		assetName: "beach.jpg",
		assetType: "image",
		automatedOutcome: "approved"
	}
});
const USAGE_SPEND_LIMIT_REACHED = defineEventType({
	id: "usage.spend-limit-reached",
	name: "Spend limit reached",
	description: "The project owner's spend limit for this billing period was reached; new uploads are paused.",
	category: "usage",
	severity: "high",
	notify: true,
	permission: "assets:read",
	fields: { resumesOn: field(zod.string().nullish(), {
		label: "Uploads resume",
		description: "The date uploads resume, as `YYYY-MM-DD` in UTC: the end of the billing period, or sooner if the owner raises the limit.",
		display: "text"
	}) },
	example: { resumesOn: "2026-11-01" }
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
		presetId: field(zod.string(), {
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
		presetId: "preset-123",
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
		memberUserId: "user-456",
		memberName: "alex@example.com",
		role: "editor",
		left: false,
		removedByUserId: "user-123"
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
		memberUserId: "user-456",
		memberName: "alex@example.com",
		previousRole: "viewer",
		role: "editor",
		changedByUserId: "user-123"
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
		invitedByUserId: "user-123"
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
		keyId: field(zod.string(), {
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
		keyId: "key-123",
		keyName: "Production server",
		role: "editor",
		createdByUserId: "user-123",
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
		keyId: field(zod.string(), {
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
		keyId: "key-123",
		keyName: "Production server",
		action: "revoked",
		revokedByUserId: "user-123",
		revokedByName: "alex@example.com"
	}
});
const appealFields = {
	appealId: field(zod.string().uuid(), {
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
	"asset.flagged": ASSET_FLAGGED,
	"asset.approved": ASSET_APPROVED,
	"asset.rejected": ASSET_REJECTED,
	"asset.failed": ASSET_FAILED,
	"asset.deleted": ASSET_DELETED,
	"asset.content-removed": ASSET_CONTENT_REMOVED,
	"asset.retried": ASSET_RETRIED,
	"asset.review-requested": ASSET_REVIEW_REQUESTED,
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
			appealId: "00000000-0000-4000-8000-000000000001",
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
			appealId: "00000000-0000-4000-8000-000000000001",
			subjectType: "post",
			subjectId: "post-1",
			decision: "overturned",
			action: "approved",
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
const factUrl = zod.string().refine((url) => getEventFactUrl({ url }) !== void 0, "Fact links must be portal paths or HTTP(S) URLs").optional();
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
//#endregion
//#region packages/shared/src/Event.ts
const EVENT_ASSET_SCHEMA = zod.object({
	id: zod.string().describe("Asset ID"),
	externalId: zod.string().nullish().describe("The asset's `externalId`, if you set one"),
	uploadPresetId: zod.string().nullish().describe("The upload preset used to create the asset, if any"),
	upload: zod.object({ status: zod.enum(["uploading", "completed"]) }),
	classification: zod.object({
		status: ASSET_CLASSIFICATION_STATUS_SCHEMA,
		moderation: zod.object({
			decision: ASSET_MODERATION_STATUS_SCHEMA,
			action: ASSET_MODERATION_ACTION_SCHEMA.nullable()
		})
	}),
	content: zod.object({ status: ASSET_CONTENT_STATUS_SCHEMA }).describe("Whether CalmLens held the asset's content when the event was created")
});
const EVENT_FIELDS = {
	id: primaryUuidField().describe("Unique event ID"),
	projectId: uuidField().describe("ID of the project the event belongs to"),
	userId: saneStringField().nullish().describe("ID of the user who caused the event, if any"),
	type: EVENT_TYPE_SCHEMA.describe("Event type. See [Event types](/docs/api/events#event-types)."),
	severity: EVENT_SEVERITY_SCHEMA.describe("Default severity of the event type"),
	title: saneStringField().describe("Short human-readable summary"),
	description: saneStringField({ type: "large" }).nullish().describe("Longer human-readable explanation"),
	assetId: uuidField().nullish().describe("ID of the asset the event is about, for asset events"),
	asset: EVENT_ASSET_SCHEMA.nullish().describe("Snapshot of the asset's moderation decision when the event was created, for asset events"),
	facts: EVENT_FACTS_SCHEMA.describe("Registered event facts. See [Event facts](/docs/api/events#event-facts)."),
	notify: zod.boolean().nullish().describe("Whether the event triggers in-app notifications"),
	createdAt: createdAtField().describe("When the event was created, in milliseconds since the Unix epoch"),
	updatedAt: updatedAtField().describe("When the event was last updated, in milliseconds since the Unix epoch"),
	readAt: zod.number().nullish().describe("When the event was marked as read in the portal, in milliseconds since the Unix epoch")
};
const EVENT_SCHEMA = zod.strictObject(EVENT_FIELDS).meta(metaStore([docPropertyInfo({
	description: "An event or alert in the system",
	namedType: "Event",
	example: {
		id: "123e4567-e89b-42d3-a456-426614174000",
		projectId: "b35456f3-79d8-4893-b316-b0d7ae668004",
		type: "asset.uploaded",
		severity: "low",
		title: "Product photo uploaded",
		assetId: "273e4567-e89b-42d3-a456-426614174001",
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
		id: "123e4567-e89b-42d3-a456-426614174000",
		projectId: "b35456f3-79d8-4893-b316-b0d7ae668004",
		type: "asset.uploaded",
		severity: "low",
		title: "Product photo uploaded",
		assetId: "273e4567-e89b-42d3-a456-426614174001",
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
//#endregion
//#region packages/shared/src/WebhookPayload.ts
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
	createdAt: zod.number().optional(),
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
//#endregion
export { WEBHOOK_DELIVERY_HEADER, WEBHOOK_EVENT_PAYLOAD_SCHEMA, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_SIGNATURE_TOLERANCE_SECONDS, WEBHOOK_TIMESTAMP_HEADER, createWebhookHeaders, toWebhookEventPayload };
