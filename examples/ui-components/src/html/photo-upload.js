import { CalmLensAppClient, CalmLensError } from "@calmlens/sdk/app";

const MESSAGES = {
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

async function uploadPhoto(file, onStage) {
  onStage("uploading");
  const response = await fetch("/api/upload-token", { method: "POST" });
  if (!response.ok) throw new Error("Upload refused");
  const { token } = await response.json();
  const client = new CalmLensAppClient({ uploadPresetId: "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P", token });

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

export function mountPhotoUpload(container, { onUploaded }) {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
  const label = document.createElement("label");
  label.append("Photo ", input);
  const progress = document.createElement("progress");
  progress.hidden = true;
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  container.replaceChildren(label, progress, message);

  const show = (stage) => {
    const busy = stage === "uploading" || stage === "checking";
    input.disabled = busy;
    progress.hidden = !busy;
    progress.setAttribute("aria-label", MESSAGES[stage]);
    message.textContent = MESSAGES[stage];
  };

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const upload = await uploadPhoto(file, show);
      show(upload.status);
      if (upload.status !== "blocked" && upload.status !== "purged") onUploaded(upload);
    } catch (error) {
      const known = CalmLensError.isCalmLensError(error) && MESSAGES[error.code];
      show(known ? error.code : "failed");
    }
  });
}
