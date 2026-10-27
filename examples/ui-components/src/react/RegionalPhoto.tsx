import type { Asset } from "@calmlens/sdk/app";
import { CalmLensMedia } from "@calmlens/sdk/react";

// Your backend retrieves this asset with the same viewer region.
// ageConfirmed stays false until your app completes the required age check.
export function RegionalPhoto({
  asset,
  region,
  ageConfirmed,
}: {
  asset: Asset;
  region: string;
  ageConfirmed: boolean;
}) {
  return (
    <CalmLensMedia asset={asset} region={region} ageConfirmed={ageConfirmed} alt="Uploaded photo" />
  );
}
