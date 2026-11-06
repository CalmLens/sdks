// Mounts the document, text and spreadsheet viewers for `CalmLensAsset` in every web binding.

import type { AssetOptions, AssetSession, AssetView } from "./Asset";
import { ASSET_VIEWERS, type AssetViewer } from "./viewers";
import type { ViewerOptions } from "./viewers/ViewerAsset";
import type { ViewerState } from "./viewers/ViewerBase";

/** The kinds of view `CalmLensAsset` shows through a viewer module. */
export type MountedViewerKind = Extract<AssetView["kind"], "document" | "text" | "spreadsheet">;

export const isMountedViewerKind = (kind: AssetView["kind"]): kind is MountedViewerKind =>
  kind === "document" || kind === "text" || kind === "spreadsheet";

/**
 * The viewer options for `CalmLensAsset`'s options: the asset URL in use, the info, and the
 * session's refresh and unavailable notice, so the viewer follows the same asset URL.
 */
export const getMountedViewerOptions = (
  options: AssetOptions & { alt?: string },
  session: AssetSession,
): ViewerOptions & Record<string, unknown> => {
  const { src, info } = session.state;
  return {
    src: src!,
    asset: info!,
    viewerClaims: options.viewerClaims,
    label: options.alt,
    onExpired: options.onExpired ? () => session.refresh() : undefined,
    onUnavailable: () => session.unavailable(),
    pdf: options.document?.pdf,
    initialPage: options.document?.initialPage,
    pageSize: options.spreadsheet?.pageSize,
    getText: options.spreadsheet?.getText,
  };
};

/**
 * Keeps the viewer for a document, text or spreadsheet view mounted in `root`, replacing it when
 * the kind changes and destroying it when there is none. `onState` reports each state the viewer
 * reaches (`loading`, `loaded`, `error`).
 */
export class AssetViewerMount {
  #root?: HTMLElement;
  #kind?: MountedViewerKind;
  #viewer?: AssetViewer<never>;
  #observer?: MutationObserver;
  #onState?: (state: ViewerState) => void;

  update(
    root: HTMLElement | null | undefined,
    kind: MountedViewerKind | undefined,
    options: ViewerOptions & Record<string, unknown>,
    onState?: (state: ViewerState) => void,
  ): void {
    this.#onState = onState;
    if (!root || !kind) {
      this.destroy();
      return;
    }
    if (root !== this.#root || kind !== this.#kind) {
      this.destroy();
      this.#root = root;
      this.#kind = kind;
      if (typeof MutationObserver !== "undefined") {
        this.#observer = new MutationObserver(() => {
          const state = root.dataset.state as ViewerState | undefined;
          if (state) this.#onState?.(state);
        });
        this.#observer.observe(root, { attributes: true, attributeFilter: ["data-state"] });
      }
      this.#viewer = ASSET_VIEWERS[kind](root, options as never) as AssetViewer<never>;
      return;
    }
    this.#viewer?.update(options as never);
  }

  destroy(): void {
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#viewer?.destroy();
    this.#viewer = undefined;
    this.#root = undefined;
    this.#kind = undefined;
  }
}
