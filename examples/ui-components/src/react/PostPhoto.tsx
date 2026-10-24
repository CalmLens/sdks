import type { AssetModerationStatus } from "@calmlens/sdk/app";
import { CalmLensMedia } from "@calmlens/sdk/react";

type PostPhotoProps = {
  projectId: string;
  assetId: string;
  status: AssetModerationStatus;
  alt: string;
  /** Width divided by height, which you store when the image is uploaded. */
  aspectRatio: number;
  canView: boolean;
  onReveal: () => void;
};

export function PostPhoto({
  projectId,
  assetId,
  status,
  alt,
  aspectRatio,
  canView,
  onReveal,
}: PostPhotoProps) {
  return (
    <CalmLensMedia
      projectId={projectId}
      assetId={assetId}
      status={status}
      canView={canView}
      onReveal={onReveal}
      alt={alt}
      aspectRatio={aspectRatio}
      widths={[400, 800]}
      sizes="(min-width: 768px) 50vw, 100vw"
    />
  );
}
