import { CalmLensAsset } from "calmlens/react";

// Claims are optional customer assertions evaluated by the CDN.
// ageConfirmed stays false until your app completes the required age check.
export function RegionalPhoto({
  src,
  region,
  ageConfirmed,
}: {
  /** The asset URL: public, or signed by your server for a private asset. */
  src: string;
  region: string;
  ageConfirmed: boolean;
}) {
  return <CalmLensAsset src={src} viewerClaims={{ region, ageConfirmed }} alt="Uploaded photo" />;
}
