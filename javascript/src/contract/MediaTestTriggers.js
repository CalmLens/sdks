import { t as CLASSIFICATION_CATEGORIES } from "./Classification-I_opp8t0.js";
//#region packages/shared/src/MediaTestTriggers.ts
const MEDIA_TEST_SIGNALS = [...CLASSIFICATION_CATEGORIES, "violence.graphic"];
const HEX_WORDS = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"alpha",
	"bravo",
	"charlie",
	"delta",
	"echo",
	"foxtrot"
];
/** Read this aloud, or render it as large, high-contrast text in a video frame. */
function generateMediaTestCode(signal, testInputKey) {
	if (!MEDIA_TEST_SIGNALS.includes(signal)) throw new Error("Unsupported media test signal");
	const suffix = testInputKey.toLowerCase();
	if (!/^[a-f0-9]{8}$/.test(suffix)) throw new Error("Expected an eight-character hexadecimal test input key");
	return `Calm Lens test ${[...suffix].map((character) => HEX_WORDS[Number.parseInt(character, 16)]).join(" ")} ${signal.replace(/[.-]/g, " ")} end test`;
}
//#endregion
export { MEDIA_TEST_SIGNALS, generateMediaTestCode };
