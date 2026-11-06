import { CalmLensAppClient } from "calmlens/app";

// Builds public CDN URLs without a request or an API key.
const calmlens = new CalmLensAppClient({ uploadPresetId: "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P" });

export function renderAvatar(container, { projectId, assetId, status, name }) {
  const fallback = () => {
    const initial = document.createElement("span");
    initial.className = "avatar";
    initial.setAttribute("role", "img");
    initial.setAttribute("aria-label", name);
    initial.textContent = name.charAt(0).toUpperCase();
    container.replaceChildren(initial);
  };
  if (!assetId || (status !== "allowed" && status !== "limited")) return fallback();

  const img = document.createElement("img");
  img.className = "avatar";
  img.src = calmlens.cdn.getAssetUrl({
    projectId,
    assetId,
    resource: "rendered",
    lens: "avatar",
  });
  img.alt = name;
  img.addEventListener("error", fallback);
  container.replaceChildren(img);
}
