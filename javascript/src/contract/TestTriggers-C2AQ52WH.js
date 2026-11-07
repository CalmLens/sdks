import { t as CLASSIFICATION_CATEGORIES } from "./ModerationCategories-CHFRoeWV.js";
import { r as timingSafeEqual, t as hmacSha256Hex } from "./CryptoUtils-B_x8lMIx.js";
import { i as msg, n as MODERATION_QUALIFIERS, r as getModerationQualifierInfo, t as TEST_REGIONAL_ACTIONS_SCHEMA } from "./TestRegionalActions-DPNhFf9c.js";
import * as z from "zod";
// packages/shared/src/TestImageGrid.ts
/**
* The visual encoding of test images (shared by images and video frames), independent of what the
* bytes mean. An odd N×N grid of square cells fills the image. Its outer ring alternates black and
* white (black corners), which locates the grid, sets the black and white reference levels and
* rejects ordinary pictures cheaply. Each interior cell, row by row, holds two bits as one of four
* Gray-coded luma levels, coloured in chroma only (which the reader ignores). The bytes carry
* Reed–Solomon parity, so a few damaged cells are corrected. Coarse levels and large cells survive
* video chroma subsampling and compression, lossy image formats and resizing, which lowest-bit
* encodings do not.
*
* SDKs port the painter byte for byte (the shared contract fixtures check it); only CalmLens reads.
*/
/**
* Target luma of the four data levels. The ring is pure black (0) and white (255); data levels
* stay inside them so every level has room for colour.
*/
const TEST_IMAGE_GRID_LEVELS = [
	72,
	128,
	184,
	240
];
const LEVEL_STEP = TEST_IMAGE_GRID_LEVELS[1] - TEST_IMAGE_GRID_LEVELS[0];
/** The neutral colour of grids without categories. */
const TEST_IMAGE_GRID_NEUTRAL = [
	144,
	152,
	160
];
/** BT.601 luma in integers; the reader uses the same formula. */
const luma = (r, g, b) => 77 * r + 150 * g + 29 * b >> 8;
/** Two-bit symbol → level, Gray coded so a one-level misread flips one bit. */
const SYMBOL_LEVEL = [
	0,
	1,
	3,
	2
];
const LEVEL_SYMBOL = [
	0,
	1,
	3,
	2
];
const MAX_BLOCK = 255;
const EXP = /* @__PURE__ */ new Uint8Array(512);
const LOG = /* @__PURE__ */ new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
	EXP[i] = x;
	LOG[x] = i;
	x <<= 1;
	if (x & 256) x ^= 285;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
const div = (a, b) => a ? EXP[LOG[a] + 255 - LOG[b]] : 0;
/** g(x) = (x − α^0)(x − α^1)…(x − α^(parity−1)), highest coefficient first. */
const GENERATOR = (() => {
	let g = [1];
	for (let i = 0; i < 32; i++) {
		const next = new Array(g.length + 1).fill(0);
		for (let j = 0; j < g.length; j++) {
			next[j] ^= g[j];
			next[j + 1] ^= mul(g[j], EXP[i]);
		}
		g = next;
	}
	return g;
})();
/** Systematic encoding: the parity is data(x)·x^parity mod g(x). */
const rsEncode = (data) => {
	const parity = /* @__PURE__ */ new Uint8Array(32);
	for (const byte of data) {
		const factor = byte ^ parity[0];
		parity.copyWithin(0, 1);
		parity[31] = 0;
		if (factor) for (let j = 0; j < 32; j++) parity[j] ^= mul(GENERATOR[j + 1], factor);
	}
	return parity;
};
/** Corrects a codeword (data then parity) in place; false when it has too many errors. */
const rsDecode = (codeword) => {
	const n = codeword.length;
	const syndromes = new Array(32);
	let clean = true;
	for (let i = 0; i < 32; i++) {
		let s = 0;
		for (const byte of codeword) s = mul(s, EXP[i]) ^ byte;
		syndromes[i] = s;
		if (s) clean = false;
	}
	if (clean) return true;
	let locator = [1];
	let previous = [1];
	let length = 0;
	let shift = 1;
	let lastDiscrepancy = 1;
	for (let k = 0; k < 32; k++) {
		let discrepancy = syndromes[k];
		for (let i = 1; i <= length; i++) discrepancy ^= mul(locator[i] ?? 0, syndromes[k - i]);
		if (!discrepancy) {
			shift++;
			continue;
		}
		const scale = div(discrepancy, lastDiscrepancy);
		const next = locator.slice();
		for (let i = 0; i < previous.length; i++) next[i + shift] = (next[i + shift] ?? 0) ^ mul(scale, previous[i]);
		if (2 * length <= k) {
			previous = locator;
			length = k + 1 - length;
			lastDiscrepancy = discrepancy;
			shift = 1;
		} else shift++;
		locator = next;
	}
	if (2 * length > 32) return false;
	const positions = [];
	for (let j = 0; j < n; j++) {
		const inverse = EXP[(255 - (n - 1 - j) % 255) % 255];
		let value = 0;
		for (let i = locator.length - 1; i >= 0; i--) value = mul(value, inverse) ^ (locator[i] ?? 0);
		if (!value) positions.push(j);
	}
	if (positions.length !== length) return false;
	const evaluator = new Array(32).fill(0);
	for (let i = 0; i < 32; i++) for (let j = 0; j <= i && j < locator.length; j++) evaluator[i] ^= mul(locator[j], syndromes[i - j]);
	for (const j of positions) {
		const power = (n - 1 - j) % 255;
		const x = EXP[power];
		const inverse = EXP[(255 - power) % 255];
		let omega = 0;
		for (let i = evaluator.length - 1; i >= 0; i--) omega = mul(omega, inverse) ^ evaluator[i];
		let derivative = 0;
		for (let i = 1; i < locator.length; i += 2) derivative ^= mul(locator[i], EXP[LOG[inverse] * (i - 1) % 255]);
		if (!derivative) return false;
		codeword[j] ^= mul(x, div(omega, derivative));
	}
	for (let i = 0; i < 32; i++) {
		let s = 0;
		for (const byte of codeword) s = mul(s, EXP[i]) ^ byte;
		if (s) return false;
	}
	return true;
};
/**
* XORs stream byte i with (i·151 + 77) mod 256, so a uniform area (all codeword bytes equal, such
* as a dark interior inside a ring) never reads as the all-zero codeword.
*/
const whiten = (stream) => {
	for (let i = 0; i < stream.length; i++) stream[i] ^= i * 151 + 77 & 255;
};
/** Codeword bytes an N-cell grid holds, and how they split into Reed–Solomon blocks. */
const testImageGridLayout = (cells) => {
	const capacity = Math.floor((cells - 2) * (cells - 2) / 4);
	const blocks = Math.ceil(capacity / MAX_BLOCK);
	return {
		capacity,
		lengths: Array.from({ length: blocks }, (_, index) => Math.floor(capacity / blocks) + (index < capacity % blocks ? 1 : 0)),
		dataBytes: capacity - blocks * 32
	};
};
/** The smallest grid whose data bytes hold `length` bytes; undefined when none does. */
const testImageGridCells = (length) => {
	for (let cells = 15; cells <= 127; cells += 2) if (testImageGridLayout(cells).dataBytes >= length) return cells;
};
/**
* The colour of a data cell: `palette` blended between opposite corners (the first colour at the
* top left and bottom right, the last at the other two), in integers.
*/
const blendedColour = (palette, column, row, cells) => {
	const span = cells - 1;
	const denominator = span * span;
	const position = (column * (span - row) + (span - column) * row) * (palette.length - 1);
	const start = Math.floor(position / denominator);
	const remainder = position - start * denominator;
	const end = palette[Math.min(start + 1, palette.length - 1)];
	return palette[start].map((channel, index) => Math.floor((channel * (denominator - remainder) + end[index] * remainder) / denominator));
};
/**
* A cell's pixel: the colour's chroma (its difference from its own luma) on the level's luma,
* scaled by the largest s/16 that keeps every channel in 0–255. Truncating each scaled difference
* toward zero keeps the luma within about one step of the level.
*/
const testImageGridPixel = (colour, level) => {
	const target = TEST_IMAGE_GRID_LEVELS[level];
	const own = luma(colour[0], colour[1], colour[2]);
	const differences = colour.map((channel) => channel - own);
	for (let scale = 16;; scale--) {
		const pixel = differences.map((difference) => target + Math.sign(difference) * (Math.abs(difference) * scale >> 4));
		if (pixel.every((channel) => channel >= 0 && channel <= 255)) return pixel;
	}
};
/**
* Paints bytes as a grid, its data cells coloured by `palette` (TestTriggers.ts passes the
* scenario's category colours). Unused data bytes are padded with 0xEC, 0x11, …
*/
function paintTestImageGrid(data, palette = [TEST_IMAGE_GRID_NEUTRAL]) {
	const cells = testImageGridCells(data.length);
	if (!cells) throw new RangeError("Test scenario is too large for a test image");
	const { capacity, lengths, dataBytes } = testImageGridLayout(cells);
	const padded = new Uint8Array(dataBytes);
	padded.set(data);
	for (let i = data.length; i < dataBytes; i++) padded[i] = (i - data.length) % 2 ? 17 : 236;
	const codewords = [];
	let offset = 0;
	for (const length of lengths) {
		const block = padded.subarray(offset, offset + length - 32);
		offset += block.length;
		const codeword = new Uint8Array(length);
		codeword.set(block);
		codeword.set(rsEncode(block), block.length);
		codewords.push(codeword);
	}
	const stream = new Uint8Array(capacity);
	let position = 0;
	for (let i = 0; i < Math.max(...lengths); i++) for (const codeword of codewords) if (i < codeword.length) stream[position++] = codeword[i];
	whiten(stream);
	const pixels = [];
	for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
		if (x === 0 || y === 0 || x === cells - 1 || y === cells - 1) {
			const grey = (x + y) % 2 ? 255 : 0;
			pixels.push([
				grey,
				grey,
				grey
			]);
			continue;
		}
		const symbol = (y - 1) * (cells - 2) + x - 1;
		const byte = symbol >> 2;
		const level = byte < capacity ? SYMBOL_LEVEL[stream[byte] >> 6 - 2 * (symbol & 3) & 3] : 0;
		pixels.push(testImageGridPixel(blendedColour(palette, x, y, cells), level));
	}
	const cellSize = 2 * Math.floor(256 / cells);
	const width = cells * cellSize;
	const rgba = new Uint8Array(width * width * 4);
	for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) rgba.set([...pixels[Math.floor(y / cellSize) * cells + Math.floor(x / cellSize)], 255], (y * width + x) * 4);
	return {
		width,
		height: width,
		rgba
	};
}
/**
* Reads the bytes a grid carries, or undefined when the image holds no readable grid. The grid
* may be scaled (also unevenly) and surrounded by a uniform border, such as video letterboxing.
* Cost is bounded by sampling, not by the image size, so every video frame can be checked. Reading
* only samples cells: `matchesTestImageGrid` checks that nothing else is in the image.
*/
function readTestImageGrid({ width, height, rgba }) {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 30 || height < 30 || rgba.length !== width * height * 4) return;
	const lumaAt = (x, y) => {
		const offset = (y * width + x) * 4;
		return luma(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
	};
	const background = lumaAt(0, 0);
	const differs = (count, at) => {
		const step = Math.max(1, Math.floor(count / 128));
		let total = 0;
		let hits = 0;
		for (let i = 0; i < count; i += step, total++) if (Math.abs(at(i) - background) >= 80) hits++;
		return hits * 8 >= total;
	};
	let top = 0;
	while (top < height && !differs(width, (x) => lumaAt(x, top))) top++;
	let bottom = height - 1;
	while (bottom > top && !differs(width, (x) => lumaAt(x, bottom))) bottom--;
	let left = 0;
	while (left < width && !differs(height, (y) => lumaAt(left, y))) left++;
	let right = width - 1;
	while (right > left && !differs(height, (y) => lumaAt(right, y))) right--;
	const gridWidth = right - left + 1;
	const gridHeight = bottom - top + 1;
	if (gridWidth < 30 || gridHeight < 30) return;
	for (let cells = 15; cells <= 127 && gridWidth >= cells * 2 && gridHeight >= cells * 2; cells += 2) {
		const cellWidth = gridWidth / cells;
		const cellHeight = gridHeight / cells;
		const cell = (column, row) => {
			let sum = 0;
			for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) sum += lumaAt(Math.floor(left + (column + (dx + 3) / 9) * cellWidth), Math.floor(top + (row + (dy + 3) / 9) * cellHeight));
			return sum / 9;
		};
		const topEdge = Array.from({ length: cells }, (_, x) => [cell(x, 0), x % 2]);
		if (!ringMatches(topEdge)) continue;
		const samples = [...topEdge];
		for (let i = 1; i < cells; i++) samples.push([cell(cells - 1, i), (cells - 1 + i) % 2], [cell(0, i), i % 2]);
		for (let x = 1; x < cells - 1; x++) samples.push([cell(x, cells - 1), (x + cells - 1) % 2]);
		const reference = ringMatches(samples);
		if (!reference) continue;
		const { black, white } = reference;
		const { capacity, lengths } = testImageGridLayout(cells);
		const stream = new Uint8Array(capacity);
		for (let symbol = 0; symbol < capacity * 4; symbol++) {
			const interior = cells - 2;
			const scaled = (cell(symbol % interior + 1, Math.floor(symbol / interior) + 1) - black) / (white - black) * 255;
			const level = Math.min(3, Math.max(0, Math.round((scaled - TEST_IMAGE_GRID_LEVELS[0]) / LEVEL_STEP)));
			stream[symbol >> 2] |= LEVEL_SYMBOL[level] << 6 - 2 * (symbol & 3);
		}
		whiten(stream);
		const codewords = lengths.map((length) => new Uint8Array(length));
		let position = 0;
		for (let i = 0; i < Math.max(...lengths); i++) for (const codeword of codewords) if (i < codeword.length) codeword[i] = stream[position++];
		if (!codewords.every(rsDecode)) continue;
		return {
			data: new Uint8Array(codewords.flatMap((codeword) => [...codeword.subarray(0, codeword.length - 32)])),
			cells,
			left,
			top,
			gridWidth,
			gridHeight
		};
	}
}
/**
* Whether the whole image is the grid `expected` (painted from the bytes `found` read) on a
* uniform border: every pixel is opaque and, in each channel, within the tolerance of the colours
* of the repainted cells (or the border) near its place. "Near" is a few pixels, which absorbs
* the blur scaling and compression put on cell edges. Damage the reader's error correction
* repaired, an overlay and anything drawn in chroma alone all fail.
*/
function matchesTestImageGrid({ width, height, rgba }, found, expected) {
	const { cells, left, top, gridWidth, gridHeight } = found;
	if (rgba.length !== width * height * 4 || expected.width % cells) return false;
	const cellSize = expected.width / cells;
	if (cellSize < 1 || expected.height !== expected.width) return false;
	const colours = new Uint8Array(cells * cells * 3);
	for (let row = 0; row < cells; row++) for (let column = 0; column < cells; column++) {
		const offset = ((row * cellSize + (cellSize >> 1)) * expected.width + column * cellSize + (cellSize >> 1)) * 4;
		colours.set(expected.rgba.subarray(offset, offset + 3), (row * cells + column) * 3);
	}
	const border = [
		rgba[0],
		rgba[1],
		rgba[2]
	];
	const radius = 2 + Math.ceil(Math.max(gridWidth, gridHeight) / expected.width);
	const right = left + gridWidth - 1;
	const bottom = top + gridHeight - 1;
	const span = (from, to, start, end, size) => {
		const outside = from < start || to > end;
		if (to < start || from > end) return {
			outside,
			first: 0,
			last: -1
		};
		return {
			outside,
			first: Math.max(0, Math.floor((Math.max(from, start) - start) * cells / size)),
			last: Math.min(cells - 1, Math.floor((Math.min(to, end) - start) * cells / size))
		};
	};
	const columns = Array.from({ length: width }, (_, x) => span(x - radius, x + radius, left, right, gridWidth));
	const low = [
		0,
		0,
		0
	];
	const high = [
		0,
		0,
		0
	];
	for (let y = 0; y < height; y++) {
		const rows = span(y - radius, y + radius, top, bottom, gridHeight);
		for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			if (rgba[offset + 3] < 250) return false;
			const near = columns[x];
			low.fill(255);
			high.fill(0);
			const include = (r, g, b) => {
				low[0] = Math.min(low[0], r);
				low[1] = Math.min(low[1], g);
				low[2] = Math.min(low[2], b);
				high[0] = Math.max(high[0], r);
				high[1] = Math.max(high[1], g);
				high[2] = Math.max(high[2], b);
			};
			if (rows.outside || near.outside) include(border[0], border[1], border[2]);
			for (let row = rows.first; row <= rows.last; row++) for (let column = near.first; column <= near.last; column++) {
				const colour = (row * cells + column) * 3;
				include(colours[colour], colours[colour + 1], colours[colour + 2]);
			}
			for (let channel = 0; channel < 3; channel++) {
				const value = rgba[offset + channel];
				if (value < low[channel] - 40 || value > high[channel] + 40) return false;
			}
		}
	}
	return true;
}
const ringMatches = (samples) => {
	let black = 0;
	let white = 0;
	for (const [value, isWhite] of samples) isWhite ? white += value : black += value;
	const whites = samples.filter(([, isWhite]) => isWhite).length;
	black /= samples.length - whites;
	white /= whites;
	if (white - black < 64) return;
	const middle = (black + white) / 2;
	return samples.filter(([value, isWhite]) => value > middle !== Boolean(isWhite)).length * 16 <= samples.length ? {
		black,
		white
	} : void 0;
};
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
			qualifiers: ["violence-injury", "violence-graphic"]
		}] };
		default: return TEST_INPUT_SCHEMA.parse({ instances: [{
			category: signal,
			qualifiers: []
		}] });
	}
}
const getImageTestCategories = () => [...TEXT_CODE_SIGNALS];
/** Each detection list holds at most this many entries; 32 faces fit a test image. */
const TEST_DETECTIONS_MAX = 32;
/** Box values are integer basis points of the image width and height: 10000 is the full side. */
const TEST_DETECTION_BOX_MAX = 1e4;
/** Age presets and the range a custom estimate may use. */
const TEST_FACE_AGE_PRESETS = {
	adult: {
		low: 25,
		high: 35
	},
	minor: {
		low: 12,
		high: 16
	}
};
const TEST_FACE_AGE_MAX = 120;
const basisPoints = z.number().int().min(0).max(TEST_DETECTION_BOX_MAX);
const detectionShape = {
	box: z.tuple([
		basisPoints,
		basisPoints,
		basisPoints,
		basisPoints
	]),
	confidence: z.number().int().min(0).max(100).optional()
};
const fitsImage = ({ box: [left, top, width, height] }) => left + width <= 1e4 && top + height <= 1e4;
const BOX_MESSAGE = msg("A box must lie inside the image: left + width and top + height are at most 10000.");
const ageYears = z.number().int().min(0).max(120);
const TEST_DETECTED_PERSON_SCHEMA = z.object(detectionShape).strict().refine(fitsImage, BOX_MESSAGE);
const TEST_DETECTED_FACE_SCHEMA = z.object({
	...detectionShape,
	age: z.union([z.enum(["adult", "minor"]), z.object({
		low: ageYears,
		high: ageYears
	}).strict().refine(({ low, high }) => low <= high, msg("An age range's low must not be above its high."))]).optional()
}).strict().refine(fitsImage, BOX_MESSAGE);
/** Person and face detection results a test image reports instead of running detection. */
const TEST_DETECTIONS_SCHEMA = z.object({
	people: z.union([z.array(TEST_DETECTED_PERSON_SCHEMA).max(32), z.literal("unavailable")]).optional(),
	faces: z.union([z.array(TEST_DETECTED_FACE_SCHEMA).max(32), z.literal("unavailable")]).optional()
}).strict();
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
	})).max(128),
	detections: TEST_DETECTIONS_SCHEMA.optional()
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
	}] },
	oneFace: {
		instances: [],
		detections: {
			people: [{ box: [
				2500,
				1500,
				5e3,
				8500
			] }],
			faces: [{ box: [
				3500,
				2e3,
				3e3,
				3500
			] }]
		}
	},
	noFace: {
		instances: [],
		detections: {
			people: [],
			faces: []
		}
	},
	adultFace: {
		instances: [],
		detections: {
			people: [{ box: [
				2500,
				1500,
				5e3,
				8500
			] }],
			faces: [{
				box: [
					3500,
					2e3,
					3e3,
					3500
				],
				age: "adult"
			}]
		}
	},
	minorFace: {
		instances: [],
		detections: {
			people: [{ box: [
				2500,
				1500,
				5e3,
				8500
			] }],
			faces: [{
				box: [
					3500,
					2e3,
					3e3,
					3500
				],
				age: "minor"
			}]
		}
	},
	group: {
		instances: [],
		detections: {
			people: [
				{ box: [
					500,
					2e3,
					2800,
					8e3
				] },
				{ box: [
					3600,
					2e3,
					2800,
					8e3
				] },
				{ box: [
					6700,
					2e3,
					2800,
					8e3
				] }
			],
			faces: [
				{ box: [
					1200,
					2500,
					1400,
					2e3
				] },
				{ box: [
					4300,
					2500,
					1400,
					2e3
				] },
				{ box: [
					7400,
					2500,
					1400,
					2e3
				] }
			]
		}
	}
};
/** A code is valid for a day unless its maker chooses another expiry. */
const TEST_INPUT_DEFAULT_LIFETIME_SECONDS = 86400;
/**
* The longest a code may still have to run when CalmLens reads it: a code that expires later is
* never recognised, so a leaked one stops working within a week whatever its maker chose.
*/
const TEST_INPUT_MAX_LIFETIME_SECONDS = 604800;
/** Clock difference tolerated between the code's maker and CalmLens. */
const CLOCK_SKEW_SECONDS = 300;
const expiryOf = (options) => {
	const expiresAt = options?.expiresAt ?? Math.floor(Date.now() / 1e3) + 86400;
	if (!Number.isInteger(expiresAt) || expiresAt < 0 || expiresAt > 4294967295) throw new TypeError("Invalid test input expiry");
	return expiresAt;
};
/** Whether a code expiring at `expiresAt` (Unix seconds) is current at `now` (milliseconds). */
const isTestInputExpiryCurrent = (expiresAt, now) => {
	const seconds = Math.floor(now / 1e3);
	return expiresAt + CLOCK_SKEW_SECONDS >= seconds && expiresAt <= seconds + 604800 + CLOCK_SKEW_SECONDS;
};
/**
* A text code: the tag, then the signed payload, base64url of the expiry (four bytes, big-endian
* Unix seconds) followed by the scenario JSON. Text extracted from a document (a PDF, or a Word file
* converted to one) breaks a code that its layout wrapped: a line break between its parts, after a
* hyphen or anywhere in a long payload. Whitespace inside a code is layout, not content, so it is
* removed before the signature is checked.
*/
const WHOLE_CODE = /^<!calmlens-\s*test\s+([A-Za-z0-9_\s-]{33,16384})>$/;
const tag = async (payload, key) => (await hmacSha256Hex(key, `calmlens-test:v2:${payload}`)).slice(0, 32);
const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const fromBase64Url = (text) => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
/** The signed bytes: the expiry, then the scenario's canonical JSON (ASCII). */
const envelope = (scenario, expiresAt) => {
	const json = new TextEncoder().encode(JSON.stringify(TEST_INPUT_SCHEMA.parse(scenario)));
	const bytes = new Uint8Array(4 + json.length);
	new DataView(bytes.buffer).setUint32(0, expiresAt);
	bytes.set(json, 4);
	return bytes;
};
async function generateTestTextCode(scenario, key, options) {
	if (!/^[a-f0-9]{32}$/.test(key)) throw new TypeError("Invalid test input key");
	const payload = toBase64Url(envelope(typeof scenario === "string" ? testInputForSignal(scenario) : scenario, expiryOf(options)));
	if (payload.length > 8e3) throw new RangeError("Test scenario is too large");
	return `<!calmlens-test ${await tag(payload, key)} ${payload}>`;
}
/**
* The scenario a text declares when the whole text is one current code signed with `key`;
* surrounding text, a second code, an altered, expired or over-long-lived code all return
* undefined, so the text is moderated as ordinary content.
*/
async function detectTestTrigger(text, key, now = Date.now()) {
	if (!/^[a-f0-9]{32}$/.test(key)) return;
	const match = WHOLE_CODE.exec(text.trim());
	if (!match) return;
	const code = match[1].replace(/\s+/g, "");
	const signature = code.slice(0, 32);
	const payload = code.slice(32);
	if (!/^[a-f0-9]{32}$/.test(signature) || !payload || payload.length > 8e3 || !timingSafeEqual(signature, await tag(payload, key))) return;
	try {
		const bytes = fromBase64Url(payload);
		if (bytes.length < 5) return;
		if (!isTestInputExpiryCurrent(new DataView(bytes.buffer).getUint32(0), now)) return;
		const json = bytes.subarray(4);
		if (json.some((byte) => byte > 127)) return;
		const parsed = TEST_INPUT_SCHEMA.safeParse(JSON.parse(new TextDecoder().decode(json)));
		return parsed.success ? parsed.data : void 0;
	} catch {
		return;
	}
}
/** Category colours, in the portal's builder and in test images' chroma; they never decide findings. */
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
/**
* The text code's signed bytes as a grid (TestImageGrid.ts): the signed payload's length (two
* bytes, big-endian), the 16-byte tag, then the payload (the expiry and the scenario JSON). The
* reader rebuilds the text code, so images and text share one verification.
*/
async function paintTestImage(scenario, key, options) {
	const input = TEST_INPUT_SCHEMA.parse(typeof scenario === "string" ? testInputForSignal(scenario, "image") : scenario);
	const [, signature, payload] = (await generateTestTextCode(input, key, options)).slice(0, -1).split(" ");
	const signed = fromBase64Url(payload);
	const data = new Uint8Array(18 + signed.length);
	data.set([signed.length >> 8, signed.length & 255]);
	data.set(signature.match(/../g).map((hex) => Number.parseInt(hex, 16)), 2);
	data.set(signed, 18);
	return paintTestImageGrid(data, testImagePalette(input));
}
const testImagePalette = (input) => {
	const categories = [...new Set(input.instances.map((instance) => instance.category))];
	return categories.length ? categories.map((category) => TEST_INPUT_CATEGORY_COLORS[category]) : void 0;
};
/**
* The test input an image declares when the whole image is one of the project's current test
* images, also after video encoding and resizing: the grid, optionally on a uniform border. Every
* pixel must match the grid repainted from the bytes it carries (TestImageGrid.ts,
* `matchesTestImageGrid`), so nothing else can be drawn on or around it.
*/
async function detectTestImage(image, key, now = Date.now()) {
	if (!TEST_INPUT_KEY_PATTERN.test(key)) return;
	const grid = readTestImageGrid(image);
	if (!grid) return;
	const { data } = grid;
	const length = data[0] << 8 | data[1];
	if (length < 5 || 18 + length > data.length) return;
	const signed = data.subarray(18, 18 + length);
	const scenario = await detectTestTrigger(`<!calmlens-test ${[...data.subarray(2, 18)].map((byte) => byte.toString(16).padStart(2, "0")).join("")} ${toBase64Url(signed)}>`, key, now);
	if (!scenario) return;
	return matchesTestImageGrid(image, grid, paintTestImageGrid(data.subarray(0, 18 + length), testImagePalette(scenario))) ? scenario : void 0;
}
export { TEST_INPUT_DEFAULT_LIFETIME_SECONDS as a, TEST_INPUT_PRESETS as c, generateTestTextCode as d, getImageTestCategories as f, testInputForSignal as h, TEST_FACE_AGE_PRESETS as i, detectTestImage as l, paintTestImage as m, TEST_DETECTION_BOX_MAX as n, TEST_INPUT_KEY_PATTERN as o, getTestInputTag as p, TEST_FACE_AGE_MAX as r, TEST_INPUT_MAX_LIFETIME_SECONDS as s, TEST_DETECTIONS_MAX as t, detectTestTrigger as u };
