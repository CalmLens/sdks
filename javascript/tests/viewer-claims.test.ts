import { describe, expect, test } from "bun:test";
import {
  EU_COUNTRIES,
  parseViewerClaims,
  VIEWER_COUNTRIES,
} from "../src/client/CalmLensViewerClaims";
import {
  EU_COUNTRIES as API_EU_COUNTRIES,
  VIEWER_CLAIMS_SCHEMA,
  VIEWER_REGION_SCHEMA,
} from "../src/contract/Jurisdiction.js";

describe("viewer claims without zod", () => {
  test("take the same countries as the API", () => {
    expect([...VIEWER_COUNTRIES].sort()).toEqual([...VIEWER_REGION_SCHEMA.options].sort());
    expect([...EU_COUNTRIES].sort()).toEqual([...API_EU_COUNTRIES].sort());
  });

  test("accept and refuse what the API's schema does", () => {
    const values: unknown[] = [
      {},
      { region: "DE" },
      { ageConfirmed: true },
      { ageConfirmed: false, region: "GB" },
      { region: "EU" },
      { region: "de" },
      { region: 49 },
      { ageConfirmed: "yes" },
      { region: "DE", extra: 1 },
      [],
      null,
      "DE",
    ];
    for (const value of values) {
      const parsed = VIEWER_CLAIMS_SCHEMA.safeParse(value);
      const claims = parseViewerClaims(value);
      expect(claims, JSON.stringify(value)).toEqual(parsed.success ? parsed.data : undefined);
      if (claims) expect(JSON.stringify(claims)).toBe(JSON.stringify(parsed.data));
    }
  });
});
