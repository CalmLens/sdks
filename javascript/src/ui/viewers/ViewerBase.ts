import type { ViewerOptions } from "./ViewerAsset";
import { resolveViewerMessages, type ViewerMessages } from "./ViewerMessages";
import { ViewerUrls } from "./ViewerUrls";

type Child = Node | string | false | null | undefined;

/** Creates an element with attributes (`false` and `undefined` leave one out) and children. */
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number | boolean | undefined> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
};

let ids = 0;
/** A document-unique ID for ARIA references. */
export const viewerId = (name: string): string => `calmlens-${name}-${++ids}`;

/** A viewer mounted into an element, which it owns the children of. */
export interface AssetViewer<O extends ViewerOptions = ViewerOptions> {
  /** Shows new options, loading again only when what is shown changed. */
  update(options: O): void;
  /** Stops loading and empties the element. */
  destroy(): void;
}

export type ViewerState = "loading" | "loaded" | "error";

/**
 * What every viewer shares: the element's class and state, its URLs, its messages, and a load
 * that runs again (cancelling the last) only when the options change what is shown. Functions in
 * the options, such as `getSignedUrl`, may change on every render without loading again.
 */
export abstract class ViewerBase<O extends ViewerOptions> implements AssetViewer<O> {
  protected readonly root: HTMLElement;
  /** The viewer's content box inside `root`, which fills it whatever `root`'s own display is. */
  protected readonly frame: HTMLElement;
  protected options!: O;
  protected messages!: ViewerMessages;
  protected urls!: ViewerUrls;
  #key?: string;
  #abort?: AbortController;

  /** Call `update` with the first options once constructed. */
  constructor(root: HTMLElement, kind: string) {
    this.root = root;
    root.classList.add("calmlens-viewer");
    root.dataset.kind = kind;
    this.frame = el("div", { class: "calmlens-viewer__frame" });
    root.replaceChildren(this.frame);
  }

  /** What the viewer shows, beyond the asset's identity: a change loads it again. */
  protected abstract describe(options: O): unknown;

  /** Loads and renders what the options show; stops when `signal` aborts. */
  protected abstract load(signal: AbortSignal): void | Promise<void>;

  update(options: O): void {
    this.options = options;
    if (this.urls) this.urls.options = options;
    const { asset, cdnBaseUrl, viewerClaims, label, messages } = options;
    const key = JSON.stringify([
      asset.projectId,
      asset.id,
      cdnBaseUrl,
      viewerClaims,
      label,
      messages,
      this.describe(options),
    ]);
    if (key === this.#key) return;
    this.#key = key;
    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;
    this.messages = resolveViewerMessages(messages);
    this.urls = new ViewerUrls(options);
    this.state = "loading";
    void (async () => {
      try {
        await this.load(abort.signal);
      } catch {
        if (!abort.signal.aborted) this.fail();
      }
    })();
  }

  destroy(): void {
    this.#abort?.abort();
    this.#abort = undefined;
    this.#key = undefined;
    this.root.replaceChildren();
    this.frame.replaceChildren();
  }

  protected set state(state: ViewerState) {
    this.root.dataset.state = state;
    this.root.setAttribute("aria-busy", String(state === "loading"));
  }

  /** Shows the viewer's failure notice, with any fallback link. */
  protected abstract fail(): void;

  /** A notice in place of the content, announced to screen readers. */
  protected notice(message: string, ...children: Child[]): HTMLElement {
    return el("div", { class: "calmlens-viewer__notice", role: "status" }, [
      el("p", {}, [message]),
      ...children,
    ]);
  }

  /** The loading notice, shown until the content arrives. */
  protected loadingNotice(): HTMLElement {
    return el("div", { class: "calmlens-viewer__notice", role: "status" }, [
      el("p", {}, [this.messages.loading]),
    ]);
  }
}
