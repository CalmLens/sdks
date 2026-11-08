import * as z from "zod";
// packages/shared/src/Jurisdiction.ts
/**
* Jurisdictions with legal rules always apply to every project. An optional jurisdiction is a
* product standard rather than a legal floor: every project serves it unless it opts out.
*/
const JURISDICTIONS = {
	global: {
		name: "Global",
		ageCheckStandard: "any",
		optional: false
	},
	DE: {
		name: "Germany",
		ageCheckStandard: "any",
		optional: false
	},
	AT: {
		name: "Austria",
		ageCheckStandard: "any",
		optional: false
	},
	FR: {
		name: "France",
		ageCheckStandard: "any",
		optional: false
	},
	GB: {
		name: "United Kingdom",
		ageCheckStandard: "verified",
		optional: false
	},
	EU: {
		name: "European Union",
		ageCheckStandard: "verified",
		optional: true
	},
	AU: {
		name: "Australia",
		ageCheckStandard: "verified",
		optional: false
	},
	BR: {
		name: "Brazil",
		ageCheckStandard: "verified",
		optional: false
	}
};
const JURISDICTION_SCHEMA = z.enum(Object.keys(JURISDICTIONS));
Object.keys(JURISDICTIONS).filter((code) => !JURISDICTIONS[code].optional);
const OPTIONAL_JURISDICTIONS = Object.keys(JURISDICTIONS).filter((code) => JURISDICTIONS[code].optional);
z.enum(OPTIONAL_JURISDICTIONS).array().refine((codes) => new Set(codes).size === codes.length, { message: "jurisdiction/duplicate" });
const SERVED_JURISDICTIONS_SCHEMA = JURISDICTION_SCHEMA.array().min(1).refine((regions) => regions.includes("global") && new Set(regions).size === regions.length, { message: "jurisdiction/global-required-or-duplicate" });
const COUNTRIES = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));
const VIEWER_REGION_SCHEMA = z.enum([...COUNTRIES]).describe("Viewer's ISO 3166-1 alpha-2 country, supplied by your integration; not the proxy server's country. EU is not a viewer country.");
const EU_COUNTRIES = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" "));
/** Customer assertions used only for this CDN request. */
const VIEWER_CLAIMS_SCHEMA = z.object({
	region: VIEWER_REGION_SCHEMA.optional().describe("Viewer country. Defaults to the country of the connection reaching CalmLens; proxies should forward the viewer country explicitly."),
	ageConfirmed: z.boolean().optional().describe("Your platform's confirmation that the viewer passed its age check, so age-restricted content may be delivered. Defaults to false. Your platform confirms the viewer's age; CalmLens does not verify this claim. Anyone requesting an asset's URL, public or signed, can set it: a signed URL's signature does not cover viewer claims, so the claim is not an access control. To restrict who can load an age-restricted asset, make it private and issue signed URLs only to viewers who passed your age check.")
}).strict();
export { VIEWER_REGION_SCHEMA as a, VIEWER_CLAIMS_SCHEMA as i, JURISDICTION_SCHEMA as n, SERVED_JURISDICTIONS_SCHEMA as r, EU_COUNTRIES as t };
