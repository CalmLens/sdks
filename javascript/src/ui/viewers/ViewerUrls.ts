import type { CdnTransform, SignedCdnResource } from "../../client/CalmLensTypes";
import { getAssetUrl } from "../../client/CalmLensUtils";
import type { ViewerOptions } from "./ViewerAsset";

/** The resources the viewers show. */
export type ViewerResource = Extract<SignedCdnResource, "original" | "rendered" | "preview">;

/**
 * The CDN URLs a viewer loads. With `getSignedUrl` it asks for one signed URL per resource and
 * keeps it; after a URL stops working (`refresh`) it asks once for a fresh one, and again only
 * after that one has worked (`loaded`), so a URL that keeps failing ends in the viewer's fallback.
 * Without `getSignedUrl` it builds public CDN URLs, which are never refreshed.
 */
export class ViewerUrls {
  #options: ViewerOptions;
  #signed = new Map<ViewerResource, Promise<string>>();
  #refreshing = new Set<ViewerResource>();

  constructor(options: ViewerOptions) {
    this.#options = options;
  }

  /** Uses the latest options' `getSignedUrl`, which apps often recreate on every render. */
  set options(options: ViewerOptions) {
    this.#options = options;
  }

  /** Whether URLs come from `getSignedUrl`. */
  get signed(): boolean {
    return Boolean(this.#options.getSignedUrl);
  }

  /** A public CDN URL for the resource, with the viewer claims that say something. */
  publicUrl(resource: ViewerResource | "placeholder", transform?: CdnTransform): string {
    const { asset, cdnBaseUrl, viewerClaims } = this.#options;
    const region = viewerClaims?.region;
    const ageConfirmed = viewerClaims?.ageConfirmed === true && resource !== "placeholder";
    return getAssetUrl({
      projectId: asset.projectId,
      assetIdentifier: asset.id,
      cdnBaseUrl,
      resource,
      transform,
      viewerClaims:
        region || ageConfirmed
          ? { ...(region ? { region } : {}), ...(ageConfirmed ? { ageConfirmed } : {}) }
          : undefined,
    });
  }

  /** The URL to load the resource from. */
  get(resource: ViewerResource): Promise<string> {
    const { getSignedUrl } = this.#options;
    if (!getSignedUrl) return Promise.resolve(this.publicUrl(resource));
    let url = this.#signed.get(resource);
    if (!url) {
      url = this.#sign(resource);
      this.#signed.set(resource, url);
    }
    return url;
  }

  /**
   * A fresh URL after the last one failed to load, or `undefined` when there is no `getSignedUrl`
   * or the fresh URL already asked for failed too.
   */
  refresh(resource: ViewerResource): Promise<string> | undefined {
    if (!this.#options.getSignedUrl || this.#refreshing.has(resource)) return undefined;
    this.#refreshing.add(resource);
    const url = this.#sign(resource);
    this.#signed.set(resource, url);
    return url;
  }

  /** Records that the resource's URL worked, so a later failure may refresh it again. */
  loaded(resource: ViewerResource): void {
    this.#refreshing.delete(resource);
  }

  async #sign(resource: ViewerResource): Promise<string> {
    const url = await this.#options.getSignedUrl!(resource);
    if (typeof url !== "string" || !url) throw new Error(`No signed URL for ${resource}`);
    return url;
  }
}

/**
 * Fetches a resource as text, asking for a fresh signed URL once when the response fails, as an
 * expired signature does.
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
    const fresh = urls.refresh(resource);
    if (!fresh) throw new Error(`Could not load the ${resource} resource`);
    url = await fresh;
  }
};
