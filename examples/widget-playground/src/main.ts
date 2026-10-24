// The playground shell: framework tabs, settings and sample files. Each tab mounts the same demo
// written with that framework's components.
import { playground } from "./playground";

const FRAMEWORKS = {
  react: () => import("./react/main"),
  vue: () => import("./vue/main"),
  svelte: () => import("./svelte/main"),
  elements: () => import("./elements"),
} as const;
type Framework = keyof typeof FRAMEWORKS;

const app = document.getElementById("app") as HTMLElement;
const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-framework]")];
let unmount: (() => void) | undefined;

const show = async (framework: Framework) => {
  for (const tab of tabs)
    tab.setAttribute("aria-selected", String(tab.dataset.framework === framework));
  unmount?.();
  unmount = undefined;
  const { mount } = await FRAMEWORKS[framework]();
  unmount = mount(app);
  history.replaceState(null, "", `#${framework}`);
};

for (const tab of tabs)
  tab.addEventListener("click", () => show(tab.dataset.framework as Framework));
const initial = location.hash.slice(1);
void show(initial in FRAMEWORKS ? (initial as Framework) : "react");

const mode = document.getElementById("mode") as HTMLElement;
const { config } = playground.get();
mode.textContent = config.mode === "mock" ? "Mock API" : "Live project";
mode.dataset.mode = config.mode;
document.getElementById("mock-help")?.toggleAttribute("hidden", config.mode !== "mock");

const canView = document.getElementById("can-view") as HTMLInputElement;
const multiple = document.getElementById("multiple") as HTMLInputElement;
playground.subscribe((state) => {
  canView.checked = state.canView;
  multiple.checked = state.multiple;
});
canView.addEventListener("change", () => playground.set({ canView: canView.checked }));
multiple.addEventListener("change", () => playground.set({ multiple: multiple.checked }));
document.getElementById("clear")?.addEventListener("click", () => playground.set({ items: [] }));

// Sample buttons drop a file on the current uploader, through the same handler as a real drop.
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-sample]")) {
  button.addEventListener("click", async () => {
    const name = button.dataset.sample ?? "";
    const blob = await (await fetch(`/samples/${name}`)).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], name, { type: blob.type }));
    app
      .querySelector(".calmlens-dropzone")
      ?.dispatchEvent(
        new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
  });
}
