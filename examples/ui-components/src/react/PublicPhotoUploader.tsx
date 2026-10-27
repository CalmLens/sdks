import { type CalmLensUpload, CalmLensUploader } from "@calmlens/sdk/react";

export function PublicPhotoUploader({
  onUploaded,
}: {
  onUploaded: (upload: CalmLensUpload) => void;
}) {
  return (
    <CalmLensUploader
      uploadPresetId="preset_4Lk8Qw2Xm9Rt5Vb3Nc7P"
      accept="image/*"
      maxFileSize={10 * 1024 * 1024}
      onUploaded={onUploaded}
    />
  );
}
