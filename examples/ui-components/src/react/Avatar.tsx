import { CalmLensAppClient } from "calmlens/app";
import { useState } from "react";

// Builds public CDN URLs without a request or an API key.
const calmlens = new CalmLensAppClient({ uploadPresetId: "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P" });

type AvatarProps = { projectId: string; assetId?: string; status?: string; name: string };

export function Avatar({ projectId, assetId, status, name }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  if (!assetId || (status !== "allowed" && status !== "limited") || failed) {
    return (
      <span className="avatar" role="img" aria-label={name}>
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  const src = calmlens.cdn.getAssetUrl({
    projectId,
    assetId,
    resource: "rendered",
    lens: "avatar",
  });
  return <img className="avatar" src={src} alt={name} onError={() => setFailed(true)} />;
}
