import { d as CLASSIFICATION_CATEGORIES, l as getTestInputTag } from "./TestTriggers-CfMMoMw_.js";
import "./CryptoUtils-B_x8lMIx.js";
// packages/shared/src/MediaTestTriggers.ts
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
async function generateMediaTestCode(signal, testInputKey) {
	if (!MEDIA_TEST_SIGNALS.includes(signal)) throw new RangeError("Unsupported media test signal");
	return `Calm Lens test ${[...await getTestInputTag("media", signal, testInputKey)].map((character) => HEX_WORDS[Number.parseInt(character, 16)]).join(" ")} ${signal.replace(/[.-]/g, " ")} end test`;
}
export { MEDIA_TEST_SIGNALS, generateMediaTestCode };
