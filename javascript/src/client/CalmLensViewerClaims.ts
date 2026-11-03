// Viewer countries and claims for CDN URLs, written without zod so `calmlens/app` loads in a
// browser with no other packages, as through an import map. tests/viewer-claims.test.ts checks
// them against the API's VIEWER_CLAIMS_SCHEMA and EU_COUNTRIES.

import type { ViewerClaims } from "./CalmLensTypes";

/** The ISO 3166-1 alpha-2 countries a viewer's `region` can be. EU is not a viewer country. */
export const VIEWER_COUNTRIES: ReadonlySet<string> = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  ),
);

/** The European Union's member countries, which the `EU` jurisdiction covers. */
export const EU_COUNTRIES: ReadonlySet<string> = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" "),
);

/**
 * The claims to send, with `region` and `ageConfirmed` in that order, or `undefined` when the
 * value isn't an object of only a viewer country `region` and a boolean `ageConfirmed`.
 */
export const parseViewerClaims = (value: unknown): ViewerClaims | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { region, ageConfirmed, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length) return undefined;
  if (region !== undefined && (typeof region !== "string" || !VIEWER_COUNTRIES.has(region)))
    return undefined;
  if (ageConfirmed !== undefined && typeof ageConfirmed !== "boolean") return undefined;
  return {
    ...(region !== undefined && { region }),
    ...(ageConfirmed !== undefined && { ageConfirmed }),
  } as ViewerClaims;
};
