import { getAssetUrl } from "@calmlens/sdk/app";

export function renderAvatar(container, { projectId, assetId, status, name }) {
  const fallback = () => {
    const initial = document.createElement("span");
    initial.className = "avatar";
    initial.setAttribute("role", "img");
    initial.setAttribute("aria-label", name);
    initial.textContent = name.charAt(0).toUpperCase();
    container.replaceChildren(initial);
  };
  if (!assetId || status !== "allowed") return fallback();

  const img = document.createElement("img");
  img.className = "avatar";
  img.src = getAssetUrl({
    projectId,
    assetIdentifier: assetId,
    resource: "rendered",
    lens: "avatar",
  });
  img.alt = name;
  img.addEventListener("error", fallback);
  container.replaceChildren(img);
}
