import type { Asset } from "@calmlens/sdk/app";
import { CalmLensMedia } from "@calmlens/sdk/react";

// Claims are optional customer assertions evaluated by the CDN.
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
    <CalmLensMedia asset={asset} viewerClaims={{ region, ageConfirmed }} alt="Uploaded photo" />
  );
}
