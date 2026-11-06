import { placeholderHashToDataURL } from "../../contract/PlaceholderHashDecode.js";
import type { ImageViewerOptions, ViewerAsset, WebsiteViewerOptions } from "./ViewerAsset";
import { type AssetViewer, el, ViewerBase } from "./ViewerBase";
import { formatViewerMessage } from "./ViewerMessages";
import type { ViewerUrls } from "./ViewerUrls";

/** Widths offered for a public image, so the browser fetches the smallest that fills the frame. */
const IMAGE_WIDTHS = [320, 640, 960, 1280, 1920, 2560];

/** The blurred placeholder shown while the image loads: the stored ThumbHash, or the CDN's. */
const placeholderFor = (asset: ViewerAsset, urls: ViewerUrls): string | undefined => {
  const hash = asset.content?.preview?.thumbhash;
  if (hash) {
    try {
      return placeholderHashToDataURL(hash);
    } catch {}
  }
  // The CDN draws placeholders from the image or the preview still, publicly for every asset.
  return asset.content?.rendered || asset.content?.preview ? urls.url("placeholder") : undefined;
};

/**
 * Loads the rendered image into `image` at responsive widths, asking once for a fresh asset URL
 * when it fails to load (as an expired signed one does).
 */
const loadRenderedImage = async (
  urls: ViewerUrls,
  image: HTMLImageElement,
  { sizes, width }: { sizes: string; width?: number | null },
  signal: AbortSignal,
  done: (outcome: "loaded" | "error") => void,
) => {
  // Widths are selectors beneath the asset URL, which a signed URL serves as freely as a public one.
  const widths = IMAGE_WIDTHS.filter((candidate) => !width || candidate < width);
  const setSources = (src: string) => {
    if (widths.length) {
      image.srcset = [...widths, ...(width ? [width] : [])]
        .map((candidate) => `${urls.url("rendered", { width: candidate })} ${candidate}w`)
        .join(", ");
      image.sizes = sizes;
    }
    image.src = src;
  };
  image.addEventListener("load", () => {
    urls.loaded("rendered");
    done("loaded");
  });
  image.addEventListener("error", () => {
    const fresh = urls.refresh("rendered");
    if (!fresh) return done("error");
    fresh.then(
      (url) => {
        if (!signal.aborted) setSources(url);
      },
      () => done("error"),
    );
  });
  const url = await urls.get("rendered");
  if (!signal.aborted) setSources(url);
};

/**
 * Shows an image asset's rendered file, fitted inside the element (the whole frame, for an embed
 * page), over its blurred placeholder until it loads.
 */
class ImageViewer extends ViewerBase<ImageViewerOptions> {
  constructor(root: HTMLElement) {
    super(root, "image");
  }

  protected describe({ asset, sizes }: ImageViewerOptions) {
    return [asset.content?.rendered, asset.content?.preview?.thumbhash, sizes];
  }

  protected async load(signal: AbortSignal) {
    const { asset, label = "", sizes = "100vw" } = this.options;
    const rendered = asset.content?.rendered;
    if (rendered?.width && rendered.height) {
      this.root.style.setProperty(
        "--calmlens-viewer-ratio",
        `${rendered.width} / ${rendered.height}`,
      );
    }
    const placeholderUrl = placeholderFor(asset, this.urls);
    const placeholder =
      placeholderUrl &&
      el("img", {
        class: "calmlens-viewer__placeholder",
        src: placeholderUrl,
        alt: "",
        "aria-hidden": "true",
      });
    const image = el("img", {
      class: "calmlens-viewer__image",
      alt: label,
      width: rendered?.width ?? undefined,
      height: rendered?.height ?? undefined,
      decoding: "async",
    });
    this.frame.replaceChildren(...[placeholder, image].filter((node) => !!node));
    await loadRenderedImage(
      this.urls,
      image,
      { sizes, width: rendered?.width },
      signal,
      (outcome) => {
        if (signal.aborted) return;
        if (outcome === "error") return this.fail();
        this.state = "loaded";
        if (placeholder) placeholder.remove();
      },
    );
  }

  protected fail() {
    this.state = "error";
    this.frame.replaceChildren(this.notice(this.messages.imageFailed));
  }
}

/** The page's address, if it is a web address the viewer may link to. */
const websiteUrl = (asset: ViewerAsset): URL | undefined => {
  if (!asset.externalUrl) return undefined;
  try {
    const url = new URL(asset.externalUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Shows a website asset: a link to the original page, then its screenshot at the element's width,
 * scrolling down the page.
 */
class WebsiteViewer extends ViewerBase<WebsiteViewerOptions> {
  constructor(root: HTMLElement) {
    super(root, "website");
  }

  protected describe({ asset }: WebsiteViewerOptions) {
    return [asset.content?.rendered, asset.content?.preview?.thumbhash, asset.externalUrl];
  }

  #link() {
    const url = websiteUrl(this.options.asset);
    return url
      ? el("div", { class: "calmlens-viewer__bar" }, [
          el(
            "a",
            {
              class: "calmlens-button calmlens-viewer__link",
              href: url.href,
              target: "_blank",
              rel: "noopener noreferrer nofollow",
            },
            [formatViewerMessage(this.messages.openWebsite, { host: url.host })],
          ),
        ])
      : undefined;
  }

  protected async load(signal: AbortSignal) {
    const { asset, label } = this.options;
    const rendered = asset.content?.rendered;
    if (!rendered) return this.fail();
    const name = label || this.messages.websiteLabel;
    const placeholderUrl = placeholderFor(asset, this.urls);
    const placeholder =
      placeholderUrl &&
      el("img", {
        class: "calmlens-viewer__placeholder",
        src: placeholderUrl,
        alt: "",
        "aria-hidden": "true",
      });
    const image = el("img", {
      class: "calmlens-viewer__image",
      alt: name,
      width: rendered.width ?? undefined,
      height: rendered.height ?? undefined,
      decoding: "async",
    });
    // A screenshot is often taller than the frame, so it scrolls; the region is focusable so
    // keyboards can scroll it too.
    const page = el(
      "div",
      { class: "calmlens-viewer__scroll", role: "region", "aria-label": name, tabindex: 0 },
      [placeholder, image],
    );
    this.frame.replaceChildren(...[this.#link(), page].filter((node) => !!node));
    await loadRenderedImage(
      this.urls,
      image,
      { sizes: "100vw", width: rendered.width },
      signal,
      (outcome) => {
        if (signal.aborted) return;
        if (outcome === "error") return this.fail();
        this.state = "loaded";
        if (placeholder) placeholder.remove();
      },
    );
  }

  protected fail() {
    this.state = "error";
    // The page itself stays reachable when its screenshot isn't.
    this.frame.replaceChildren(
      ...[this.#link(), this.notice(this.messages.imageFailed)].filter((node) => !!node),
    );
  }
}

/** Shows an image asset's rendered file in `root`. */
export const createImageViewer = (
  root: HTMLElement,
  options: ImageViewerOptions,
): AssetViewer<ImageViewerOptions> => {
  const viewer = new ImageViewer(root);
  viewer.update(options);
  return viewer;
};

/** Shows a website asset's screenshot and a link to the page in `root`. */
export const createWebsiteViewer = (
  root: HTMLElement,
  options: WebsiteViewerOptions,
): AssetViewer<WebsiteViewerOptions> => {
  const viewer = new WebsiteViewer(root);
  viewer.update(options);
  return viewer;
};
