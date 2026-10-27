// State the framework demos share, so switching tabs keeps the gallery and settings.
import type { AssetModerationStatus } from "@calmlens/sdk/app";
import type { CalmLensUpload } from "@calmlens/sdk/ui";

export type PlaygroundConfig = {
  mode: "mock" | "live";
  projectId: string;
  uploadPresetId: string;
  /** Set in mock mode, where the dev server answers the upload API and CDN. */
  baseUrl?: string;
  cdnBaseUrl?: string;
};

export type GalleryItem = {
  assetId: string;
  status?: AssetModerationStatus;
  name: string;
  type: "image" | "video" | "audio";
  /** Width divided by height, which a real app stores with the upload. */
  aspectRatio?: number;
  framework: string;
};

export type PlaygroundState = {
  config: PlaygroundConfig;
  items: GalleryItem[];
  /** Your app's own decision: whether this viewer may see age-restricted media. */
  canView: boolean;
  multiple: boolean;
};

const response = await fetch("/api/config");
const config = (await response.json()) as PlaygroundConfig;
if (config.mode === "mock") {
  config.baseUrl = new URL("/mock-api/v1", location.origin).href;
  config.cdnBaseUrl = new URL("/mock-cdn/v1", location.origin).href;
}

let state: PlaygroundState = { config, items: [], canView: false, multiple: true };
const listeners = new Set<(state: PlaygroundState) => void>();

export const playground = {
  get: () => state,
  /** Calls `listener` now and after each change, like a Svelte store. */
  subscribe(listener: (state: PlaygroundState) => void) {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  },
  set(changes: Partial<PlaygroundState>) {
    state = { ...state, ...changes };
    for (const listener of listeners) listener(state);
  },
  /** Adds a finished upload to the gallery, measuring images the way your app would. */
  async addUpload(upload: CalmLensUpload, framework: string) {
    const kind = upload.file.type.split("/")[0];
    const type = kind === "video" || kind === "audio" ? kind : "image";
    let aspectRatio: number | undefined = type === "video" ? 16 / 9 : undefined;
    // Browser uploads are Blobs; other platforms' files can't be measured here.
    if (type === "image" && upload.file instanceof Blob) {
      const bitmap = await createImageBitmap(upload.file).catch(() => undefined);
      if (bitmap) aspectRatio = bitmap.width / bitmap.height;
      bitmap?.close();
    }
    const item: GalleryItem = {
      assetId: upload.assetId,
      status: upload.status,
      name: upload.file.name,
      type,
      aspectRatio,
      framework,
    };
    playground.set({
      items: [item, ...state.items.filter((other) => other.assetId !== item.assetId)],
    });
  },
  /** Your app's age check would run here; the playground just asks. */
  reveal() {
    if (confirm("Show sensitive media to this viewer?")) playground.set({ canView: true });
  },
};

export const ACCEPT = "image/*,video/*,audio/*";
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const GALLERY_WIDTHS = [320, 640];
export const GALLERY_SIZES = "(min-width: 960px) 300px, (min-width: 600px) 45vw, 90vw";
