import { CalmLensAppClient, CalmLensError } from "@calmlens/sdk/app";
import { type ChangeEvent, useState } from "react";

const MESSAGES: Record<string, string> = {
  uploading: "Uploading…",
  checking: "Checking your photo…",
  pending: "Uploaded. We'll show it once it has been checked.",
  allowed: "Uploaded.",
  limited: "Uploaded.",
  "age-restricted": "Uploaded. It will only be shown to people who can see sensitive content.",
  blocked: "This photo can't be used because it may break our community guidelines.",
  purged: "This photo can't be used because it breaks our community guidelines.",
  "upload-preset/too-large": "Choose a smaller photo.",
  "upload-preset/content-type-not-allowed": "Choose a JPEG, PNG or WebP photo.",
  failed: "We couldn't upload this photo. Please try again.",
};

type Upload = { assetId: string; status: string };

async function uploadPhoto(file: File, onStage: (stage: string) => void): Promise<Upload> {
  onStage("uploading");
  const response = await fetch("/api/upload-token", { method: "POST" });
  if (!response.ok) throw new Error("Upload refused");
  const { token } = await response.json();
  const client = new CalmLensAppClient({ uploadPresetId: "your-upload-preset-id", token });

  let asset = await client.assets.create({
    name: file.name,
    content: { data: file, type: file.type },
  });
  onStage("checking");
  for (let delay = 1000; asset.status === "pending" && delay <= 8000; delay *= 2) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    asset = await client.assets.retrieve({ assetId: asset.id });
  }
  return { assetId: asset.id, status: asset.status ?? "pending" };
}

export function PhotoUpload({ onUploaded }: { onUploaded: (upload: Upload) => void }) {
  const [stage, setStage] = useState<string | null>(null);
  const busy = stage === "uploading" || stage === "checking";

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const upload = await uploadPhoto(file, setStage);
      setStage(upload.status);
      if (upload.status !== "blocked" && upload.status !== "purged") onUploaded(upload);
    } catch (error) {
      const known = CalmLensError.isCalmLensError(error) && MESSAGES[error.code];
      setStage(known ? error.code : "failed");
    }
  }

  return (
    <div>
      <label>
        Photo <input type="file" accept="image/*" disabled={busy} onChange={handleChange} />
      </label>
      {stage && busy && <progress aria-label={MESSAGES[stage]} />}
      <p role="status">{stage ? MESSAGES[stage] : ""}</p>
    </div>
  );
}
