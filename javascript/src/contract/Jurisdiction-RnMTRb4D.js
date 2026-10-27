import * as z from "zod";
const JURISDICTION_SCHEMA = z.enum(Object.keys({
	global: {
		name: "Global",
		ageCheckStandard: "any"
	},
	DE: {
		name: "Germany",
		ageCheckStandard: "any"
	},
	AT: {
		name: "Austria",
		ageCheckStandard: "any"
	},
	FR: {
		name: "France",
		ageCheckStandard: "any"
	},
	GB: {
		name: "United Kingdom",
		ageCheckStandard: "verified"
	},
	EU: {
		name: "European Union",
		ageCheckStandard: "verified"
	},
	AU: {
		name: "Australia",
		ageCheckStandard: "verified"
	},
	BR: {
		name: "Brazil",
		ageCheckStandard: "verified"
	}
}));
const SERVED_JURISDICTIONS_SCHEMA = JURISDICTION_SCHEMA.array().min(1).refine((regions) => regions.includes("global") && new Set(regions).size === regions.length, { message: "jurisdiction/global-required-or-duplicate" });
const COUNTRIES = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));
const VIEWER_REGION_SCHEMA = z.enum([...COUNTRIES]).describe("Viewer's ISO 3166-1 alpha-2 country, supplied by your integration; not the proxy server's country. EU is not a viewer country.");
const EU_COUNTRIES = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" "));
const REGIONAL_DELIVERY_SCHEMA = z.object({
	region: VIEWER_REGION_SCHEMA,
	action: z.enum([
		"limit",
		"age-restrict",
		"block",
		"purge"
	]).nullable(),
	rule: z.string().optional(),
	category: z.enum([
		"sexual",
		"violence",
		"self-harm",
		"harassment",
		"hate",
		"criminal-activity",
		"personal-information",
		"profanity"
	]).optional(),
	ageCheckStandard: z.enum(["any", "verified"])
}).strict();
export { SERVED_JURISDICTIONS_SCHEMA as i, JURISDICTION_SCHEMA as n, REGIONAL_DELIVERY_SCHEMA as r, EU_COUNTRIES as t };
