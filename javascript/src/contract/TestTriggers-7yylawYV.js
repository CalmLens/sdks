//#region packages/shared/src/TestTriggers.ts
const TEST_IMAGE_PALETTES = {
	sexual: [
		[
			255,
			20,
			147,
			255
		],
		[
			255,
			105,
			180,
			255
		],
		[
			199,
			21,
			133,
			255
		],
		[
			255,
			69,
			0,
			255
		]
	],
	violence: [
		[
			139,
			0,
			0,
			255
		],
		[
			220,
			20,
			60,
			255
		],
		[
			178,
			34,
			34,
			255
		],
		[
			255,
			0,
			0,
			255
		]
	],
	harassment: [
		[
			180,
			83,
			9,
			255
		],
		[
			217,
			119,
			6,
			255
		],
		[
			245,
			158,
			11,
			255
		],
		[
			251,
			191,
			36,
			255
		]
	],
	hate: [
		[
			30,
			64,
			175,
			255
		],
		[
			37,
			99,
			235,
			255
		],
		[
			59,
			130,
			246,
			255
		],
		[
			96,
			165,
			250,
			255
		]
	],
	"criminal-activity": [
		[
			6,
			95,
			70,
			255
		],
		[
			5,
			150,
			105,
			255
		],
		[
			16,
			185,
			129,
			255
		],
		[
			52,
			211,
			153,
			255
		]
	],
	"self-harm": [
		[
			75,
			0,
			130,
			255
		],
		[
			138,
			43,
			226,
			255
		],
		[
			72,
			61,
			139,
			255
		],
		[
			147,
			112,
			219,
			255
		]
	]
};
/** A project's test input key: eight hexadecimal characters only its members can see. */
const TEST_INPUT_KEY_PATTERN = /^[a-f0-9]{8}$/;
const TEXT_CODE_SIGNALS = [
	"harassment",
	"hate",
	"criminal-activity",
	"sexual.involving-minors"
];
/**
* The text code that CalmLens classifies as `category` for the project with this test input key.
* @returns The code, or an empty string for a category without a text code
*/
const generateTestTextCode = (category, testInputKey) => TEXT_CODE_SIGNALS.includes(category) ? `<!calmlens-test ${testInputKey} ${category}>` : "";
const TEST_TRIGGER_PATTERN = /<!calmlens-test\s+([a-f0-9]{8})\s+(harassment|hate|criminal-activity|sexual\.involving-minors)\s*>/gi;
/**
* The test signals in `text` whose codes carry the project's test input key. Codes with another
* key are ignored, so a code can only be used by the project it belongs to.
*/
const detectTestTrigger = (text, testInputKey) => {
	const signals = [];
	for (const [, key, signal] of text.matchAll(TEST_TRIGGER_PATTERN)) {
		if (key.toLowerCase() !== testInputKey.toLowerCase()) continue;
		const testSignal = signal.toLowerCase();
		if (!signals.includes(testSignal)) signals.push(testSignal);
	}
	return {
		isTestTrigger: signals.length > 0,
		signals
	};
};
/** Sixteen cells encode two bits each using the category's four existing colours. */
const getTestImageKeyCells = (width, height) => {
	return Array.from({ length: 16 }, (_, index) => {
		const column = index % 4;
		const row = Math.floor(index / 4);
		const x = Math.floor(column * width / 4);
		const y = Math.floor(row * height / 4);
		return {
			x,
			y,
			width: Math.floor((column + 1) * width / 4) - x,
			height: Math.floor((row + 1) * height / 4) - y
		};
	});
};
const getTestImageKeyColors = (signal, testInputKey) => {
	const colors = TEST_IMAGE_PALETTES[signal];
	if (!colors || !TEST_INPUT_KEY_PATTERN.test(testInputKey)) throw new Error("Invalid image test signal or key");
	return [...testInputKey].flatMap((character) => {
		const value = Number.parseInt(character, 16);
		return [colors[value >> 2], colors[value & 3]];
	});
};
/**
* Gets all test trigger categories that support images
*/
const getImageTestCategories = () => {
	return Object.keys(TEST_IMAGE_PALETTES);
};
/** Paint a full-image 4×4 grid as RGBA pixels; callers choose their image encoder. */
const paintTestImage = (signal, testInputKey, width = 512, height = width) => {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 24 || height < 24) throw new RangeError("Test image dimensions must be integers of at least 24 pixels");
	const colors = getTestImageKeyColors(signal, testInputKey);
	const rgba = new Uint8Array(width * height * 4);
	getTestImageKeyCells(width, height).forEach((cell, index) => {
		for (let y = cell.y; y < cell.y + cell.height; y++) for (let x = cell.x; x < cell.x + cell.width; x++) rgba.set(colors[index], (y * width + x) * 4);
	});
	return rgba;
};
/** Decode the project key from pixels, tolerating resizing and lossy compression. */
const detectTestImage = (image, testInputKey) => {
	const { width, height, rgba } = image;
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 24 || height < 24 || rgba.length !== width * height * 4 || !TEST_INPUT_KEY_PATTERN.test(testInputKey)) return void 0;
	const cells = getTestImageKeyCells(width, height);
	for (const category of getImageTestCategories()) {
		const colors = getTestImageKeyColors(category, testInputKey);
		if (cells.every((cell, index) => {
			const sample = [
				0,
				0,
				0
			];
			let count = 0;
			for (let y = cell.y + Math.ceil(cell.height / 4); y < cell.y + cell.height * 3 / 4; y++) for (let x = cell.x + Math.ceil(cell.width / 4); x < cell.x + cell.width * 3 / 4; x++) {
				const offset = (y * width + x) * 4;
				if (rgba[offset + 3] < 250) return false;
				for (let c = 0; c < 3; c++) sample[c] += rgba[offset + c];
				count++;
			}
			const distances = TEST_IMAGE_PALETTES[category].map((color) => sample.reduce((sum, value, c) => sum + (value / count - color[c]) ** 2, 0));
			const nearest = distances.indexOf(Math.min(...distances));
			return distances[nearest] <= 900 && TEST_IMAGE_PALETTES[category][nearest] === colors[index];
		})) return category;
	}
};
//#endregion
export { generateTestTextCode as a, getTestImageKeyColors as c, detectTestTrigger as i, paintTestImage as l, TEST_INPUT_KEY_PATTERN as n, getImageTestCategories as o, detectTestImage as r, getTestImageKeyCells as s, TEST_IMAGE_PALETTES as t };
