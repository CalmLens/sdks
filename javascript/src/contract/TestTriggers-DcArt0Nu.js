import { r as timingSafeEqual, t as hmacSha256Hex } from "./CryptoUtils-B_x8lMIx.js";
import { a as msg, i as CLASSIFICATION_CATEGORIES, n as MODERATION_QUALIFIERS, r as getModerationQualifierInfo, t as TEST_REGIONAL_ACTIONS_SCHEMA } from "./TestRegionalActions-DfPCKG4S.js";
import * as z from "zod";
// packages/shared/src/TestTriggers.ts
/** A project's test input key: 32 hexadecimal characters only its members can see. */
const TEST_INPUT_KEY_PATTERN = /^[a-f0-9]{32}$/;
const TEXT_CODE_SIGNALS = [
	...CLASSIFICATION_CATEGORIES,
	"sexual.involving-minors",
	"harassment.insult",
	"sexual.adult",
	"hate.regional-symbol"
];
/** A 128-bit, domain-separated tag; published samples never contain the project key. */
const getTestInputTag = async (kind, signal, testInputKey) => {
	if (!TEST_INPUT_KEY_PATTERN.test(testInputKey)) throw new TypeError("Invalid test input key");
	return (await hmacSha256Hex(testInputKey, `calmlens-test:${kind}:${signal}`)).slice(0, 32);
};
/** Category shortcuts are presets in the same instance-based format. */
function testInputForSignal(signal, kind = "text") {
	switch (signal) {
		case "harassment.insult": return TEST_INPUT_PRESETS.limited;
		case "sexual.adult": return kind === "image" ? TEST_INPUT_PRESETS.adultImage : TEST_INPUT_PRESETS.adultText;
		case "hate.regional-symbol": return TEST_INPUT_PRESETS.germany;
		case "sexual.involving-minors": return { instances: [{
			category: "sexual",
			qualifiers: ["sexual-minors"]
		}] };
		case "violence.graphic": return { instances: [{
			category: "violence",
			qualifiers: ["violence-graphic"]
		}] };
		default: return TEST_INPUT_SCHEMA.parse({ instances: [{
			category: signal,
			qualifiers: []
		}] });
	}
}
const getImageTestCategories = () => [...TEXT_CODE_SIGNALS];
/** Each row is one qualifying instance. Unselected qualifiers are explicitly absent. */
const TEST_INPUT_SCHEMA = z.object({
	regionalActions: TEST_REGIONAL_ACTIONS_SCHEMA.optional(),
	unassessedCategories: z.array(z.enum(CLASSIFICATION_CATEGORIES)).max(CLASSIFICATION_CATEGORIES.length).optional(),
	instances: z.array(z.object({
		category: z.enum(CLASSIFICATION_CATEGORIES),
		score: z.number().min(0).max(1).optional(),
		action: z.enum([
			"allow",
			"limit",
			"age-restrict",
			"block"
		]).optional(),
		qualifiers: z.array(z.enum(MODERATION_QUALIFIERS)).max(64)
	}).strict().superRefine((instance, context) => {
		if (new Set(instance.qualifiers).size !== instance.qualifiers.length || instance.qualifiers.some((q) => getModerationQualifierInfo(q).category !== instance.category || "fromInput" in getModerationQualifierInfo(q))) context.addIssue({
			code: "custom",
			message: "Choose unique content qualifiers from this category; input-type facts are automatic."
		});
	})).max(128)
}).strict().superRefine((scenario, context) => {
	if (scenario.instances.some((instance) => instance.action !== void 0) && scenario.instances.some((instance) => instance.action === void 0)) context.addIssue({
		code: "custom",
		message: msg("Set an action for every instance or omit all actions.")
	});
	const missing = scenario.unassessedCategories ?? [];
	if (new Set(missing).size !== missing.length || scenario.instances.some((instance) => missing.includes(instance.category))) context.addIssue({
		code: "custom",
		message: msg("An unassessed category cannot also have assessed instances.")
	});
});
const TEST_INPUT_PRESETS = {
	clean: { instances: [] },
	limited: { instances: [{
		category: "harassment",
		qualifiers: ["harassment-abuse"]
	}] },
	adultImage: { instances: [{
		category: "sexual",
		qualifiers: ["sexual-pornographic-media"]
	}] },
	adultText: { instances: [{
		category: "sexual",
		qualifiers: ["sexual-explicit-language"]
	}] },
	regionalDelivery: {
		instances: [],
		regionalActions: [
			{
				region: "DE",
				action: "block"
			},
			{
				region: "GB",
				action: "age-restrict"
			},
			{
				region: "FR",
				action: "limit"
			}
		]
	},
	germany: { instances: [{
		category: "hate",
		qualifiers: ["hate-symbol", "hate-nazi-symbols-public-display"]
	}] },
	mixed: { instances: [{
		category: "harassment",
		qualifiers: ["harassment-abuse", "harassment-documentary"]
	}, {
		category: "harassment",
		qualifiers: ["harassment-threat"]
	}] }
};
const pattern = /<!calmlens-test ([a-f0-9]{32}) ([A-Za-z0-9_-]+)>/g;
const tag = async (payload, key) => (await hmacSha256Hex(key, `calmlens-test:v1:${payload}`)).slice(0, 32);
async function generateTestTextCode(scenario, key) {
	if (!/^[a-f0-9]{32}$/.test(key)) throw new TypeError("Invalid test input key");
	const payload = btoa(JSON.stringify(TEST_INPUT_SCHEMA.parse(typeof scenario === "string" ? testInputForSignal(scenario) : scenario))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
	if (payload.length > 8e3) throw new RangeError("Test scenario is too large");
	return `<!calmlens-test ${await tag(payload, key)} ${payload}>`;
}
async function detectTestTrigger(text, key) {
	if (!/^[a-f0-9]{32}$/.test(key)) return;
	const matches = [...text.matchAll(pattern)];
	if (matches.length !== 1) return;
	const [, signature, payload] = matches[0];
	if (payload.length > 8e3 || !timingSafeEqual(signature, await tag(payload, key))) return;
	try {
		const parsed = TEST_INPUT_SCHEMA.safeParse(JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/"))));
		return parsed.success ? parsed.data : void 0;
	} catch {
		return;
	}
}
/** Category colours are decorative; authenticated instance data determines classification. */
const TEST_INPUT_CATEGORY_COLORS = {
	sexual: [
		232,
		80,
		160
	],
	violence: [
		224,
		56,
		64
	],
	"self-harm": [
		24,
		168,
		152
	],
	harassment: [
		240,
		128,
		48
	],
	hate: [
		144,
		80,
		216
	],
	"criminal-activity": [
		224,
		184,
		40
	],
	"personal-information": [
		48,
		128,
		224
	],
	profanity: [
		136,
		192,
		48
	]
};
/** One byte per 4px cell, stored in the low RGB bits to preserve the category colour. */
async function paintTestImage(scenario, key) {
	const input = TEST_INPUT_SCHEMA.parse(typeof scenario === "string" ? testInputForSignal(scenario, "image") : scenario);
	const bytes = new TextEncoder().encode(await generateTestTextCode(input, key));
	const palette = input.instances.length ? [...new Set(input.instances.map((instance) => instance.category))].map((category) => TEST_INPUT_CATEGORY_COLORS[category]) : [[
		144,
		152,
		160
	]];
	const data = new Uint8Array([
		67,
		76,
		84,
		83,
		2,
		bytes.length >> 8,
		bytes.length & 255,
		...bytes
	]);
	const cells = Math.ceil(Math.sqrt(data.length));
	const width = cells * 4;
	const height = width;
	const rgba = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		const row = Math.floor(i / width / 4);
		const cell = row * cells + Math.floor(i % width / 4);
		const value = data[cell % data.length];
		const x = cell % cells / (cells - 1);
		const y = row / (cells - 1);
		const position = (x * (1 - y) + (1 - x) * y) * (palette.length - 1);
		const start = Math.floor(position);
		const blend = position - start;
		const shade = (value * 73 + 41 & 255) / 255;
		const color = palette[start].map((channel, index) => {
			const mixed = channel + (palette[Math.min(start + 1, palette.length - 1)][index] - channel) * blend;
			return Math.round(mixed * (.65 + shade * .2) + 38 * shade);
		});
		rgba.set([
			color[0] & 248 | value >> 5,
			color[1] & 248 | value >> 2 & 7,
			color[2] & 252 | value & 3,
			255
		], i * 4);
	}
	return {
		width,
		height,
		rgba
	};
}
async function detectTestImage(image, key) {
	if (!Number.isSafeInteger(image.width) || image.width < 4 || image.width % 4 !== 0 || image.height !== image.width || image.height > 512 || image.rgba.length !== image.width * image.height * 4) return;
	const legacy = image.rgba[0] === 67 && image.rgba[1] === 188 && image.rgba[2] === 123;
	const bytes = [];
	for (let y = 0; y < image.height; y += 4) for (let x = 0; x < image.width; x += 4) {
		const offset = (y * image.width + x) * 4;
		const red = image.rgba[offset];
		const green = image.rgba[offset + 1];
		const blue = image.rgba[offset + 2];
		const value = legacy ? red : (red & 7) << 5 | (green & 7) << 2 | blue & 3;
		if (legacy && (green !== 255 - red || blue !== 123)) return;
		for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
			const pos = ((y + dy) * image.width + x + dx) * 4;
			if (image.rgba[pos] !== red || image.rgba[pos + 1] !== green || image.rgba[pos + 2] !== blue || image.rgba[pos + 3] !== 255) return;
		}
		bytes.push(value);
	}
	if (bytes.slice(0, 5).join() !== `67,76,84,83,${legacy ? 1 : 2}`) return;
	const length = bytes[5] << 8 | bytes[6];
	if (length > bytes.length - 7) return;
	return detectTestTrigger(new TextDecoder().decode(new Uint8Array(bytes.slice(7, 7 + length))), key);
}
export { generateTestTextCode as a, paintTestImage as c, detectTestTrigger as i, testInputForSignal as l, TEST_INPUT_PRESETS as n, getImageTestCategories as o, detectTestImage as r, getTestInputTag as s, TEST_INPUT_KEY_PATTERN as t };
