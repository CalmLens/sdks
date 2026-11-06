import { appendAssetLocation } from "../../client/CalmLensCdn";
import type { CdnTransform } from "../../client/CalmLensTypes";
import type { ViewerOptions } from "./ViewerAsset";

/** The resources the viewers show. */
export type ViewerResource = "original" | "rendered" | "preview";

/** The CDN's error code in a refused response, if it sent one. */
const responseCode = async (response: Response): Promise<string | undefined> => {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The CDN URLs a viewer loads: resource paths beneath the asset URL (`src`), public or signed,
 * with the viewer claims that say something. When a URL stops working (`refresh`), as an expired
 * signed one does, it asks `onExpired` once for a fresh asset URL, and again only after that one
 * has worked (`loaded`), so a URL that keeps failing ends in the viewer's fallback. Without
 * `onExpired` nothing is refreshed.
 */
export class ViewerUrls {
  #options: ViewerOptions;
  #src: string;
  #given: string;
  #refreshing = false;

  constructor(options: ViewerOptions) {
    this.#options = options;
    this.#src = options.src;
    this.#given = options.src;
  }

  /** Uses the latest options: a new `src` replaces any refreshed one; callbacks may change freely. */
  set options(options: ViewerOptions) {
    this.#options = options;
    if (options.src !== this.#given) {
      this.#given = options.src;
      this.#src = options.src;
    }
  }

  /** The asset URL in use: `src`, or the fresh one `onExpired` returned. */
  get src(): string {
    return this.#src;
  }

  /** A resource's URL beneath the asset URL. The placeholder is never age-gated, so it needs no age claim. */
  url(resource: ViewerResource | "placeholder", transform?: CdnTransform): string {
    const { viewerClaims } = this.#options;
    return appendAssetLocation(this.#src, {
      resource,
      transform,
      viewerClaims:
        resource === "placeholder" && viewerClaims ? { region: viewerClaims.region } : viewerClaims,
    });
  }

  /** The URL to load the resource from. */
  get(resource: ViewerResource): Promise<string> {
    return Promise.resolve(this.url(resource));
  }

  /**
   * A fresh URL after the last one failed to load, or `undefined` when there is no `onExpired` or
   * the fresh URL already asked for failed too.
   */
  refresh(resource: ViewerResource): Promise<string> | undefined {
    const { onExpired } = this.#options;
    if (!onExpired || this.#refreshing) return undefined;
    this.#refreshing = true;
    return Promise.resolve()
      .then(() => onExpired())
      .then((src) => {
        if (typeof src !== "string" || !src) throw new Error("onExpired returned no asset URL");
        this.#src = src;
        return this.url(resource);
      });
  }

  /** Records that the resource's URL worked, so a later failure may refresh it again. */
  loaded(_resource: ViewerResource): void {
    this.#refreshing = false;
  }

  /** Tells the viewer's owner that the CDN refused the asset to this viewer. */
  unavailable(): void {
    this.#options.onUnavailable?.();
  }
}

/**
 * Fetches a resource as text, asking for a fresh asset URL once when the response fails, as an
 * expired signed one does. A refusal with `asset/not-available` ends at once: the asset can't be
 * shown to this viewer.
 */
export const fetchViewerText = async (
  urls: ViewerUrls,
  resource: ViewerResource,
  signal: AbortSignal,
): Promise<string> => {
  let url = await urls.get(resource);
  for (;;) {
    let response: Response | undefined;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (signal.aborted) throw error;
    }
    if (response?.ok) {
      urls.loaded(resource);
      return await response.text();
    }
    if (response && (await responseCode(response)) === "asset/not-available") {
      urls.unavailable();
      throw new Error(`The ${resource} resource is not available`);
    }
    const fresh = urls.refresh(resource);
    if (!fresh) throw new Error(`Could not load the ${resource} resource`);
    url = await fresh;
  }
};
