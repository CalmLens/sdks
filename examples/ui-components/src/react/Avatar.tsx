import { getAssetUrl } from "@calmlens/sdk/app";
import { useState } from "react";

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
  const src = getAssetUrl({
    projectId,
    assetIdentifier: assetId,
    resource: "rendered",
    lens: "avatar",
  });
  return <img className="avatar" src={src} alt={name} onError={() => setFailed(true)} />;
}
