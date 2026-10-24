import { type CalmLensUpload, CalmLensUploader } from "@calmlens/sdk/react";

export function PhotoUploader({ onUploaded }: { onUploaded: (upload: CalmLensUpload) => void }) {
  return (
    <CalmLensUploader
      uploadPresetId="your-upload-preset-id"
      tokenUrl="/api/upload-token"
      accept="image/*"
      maxFileSize={10 * 1024 * 1024}
      multiple
      onUploaded={onUploaded}
    />
  );
}
