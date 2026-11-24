// packages/shared/src/DataRegion.ts
const DEFAULT_DATA_REGION = "aws-eu-west-2";
/**
* The character an asset ID starts with (after `asset_`) to say the region it lives in: the asset
* table computes each row's region from it (`AssetTable`), so an ID is only ever in one region and
* a lookup by ID goes straight there. A code is never reused for another region.
*/
const ASSET_ID_REGION_CODES = {
	"aws-ap-southeast-1": "a",
	"aws-eu-west-2": "e",
	"aws-eu-central-1": "f",
	"aws-us-east-2": "u"
};
new Map(Object.entries(ASSET_ID_REGION_CODES).map(([region, code]) => [code, region]));
export { DEFAULT_DATA_REGION as n, ASSET_ID_REGION_CODES as t };
