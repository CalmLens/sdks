declare const DATA_REGIONS: readonly ["aws-ap-southeast-1", "aws-eu-west-2", "aws-eu-central-1", "aws-us-east-2"];
type DataRegion = (typeof DATA_REGIONS)[number];
declare const DEFAULT_DATA_REGION: DataRegion;
export { DataRegion as n, DEFAULT_DATA_REGION as t };