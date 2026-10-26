import { type CalmLensUpload, CalmLensUploader } from "@calmlens/sdk/react";

export function PublicPhotoUploader({
  onUploaded,
}: {
  onUploaded: (upload: CalmLensUpload) => void;
}) {
  return (
    <CalmLensUploader
      uploadPresetId="your-upload-preset-id"
      accept="image/*"
      maxFileSize={10 * 1024 * 1024}
      onUploaded={onUploaded}
    />
  );
}
