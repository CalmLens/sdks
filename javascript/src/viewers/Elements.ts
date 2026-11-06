// The asset viewers (preview) as custom elements: `<calmlens-image-viewer>`,
// `<calmlens-website-viewer>`, `<calmlens-text-viewer>`, `<calmlens-document-viewer>` and
// `<calmlens-spreadsheet-viewer>`. Like `<calmlens-asset>`, they render into the page (no shadow
// DOM), so `calmlens/styles.css` and your own CSS apply.

import {
  ASSET_VIEWERS,
  type AssetViewer,
  type AssetViewerName,
  type AssetViewerOptionsByKind,
  type PdfAssetOptions,
  type ViewerAsset,
  type ViewerMessages,
} from "../ui/viewers";

// SSR and workers have no custom elements; the classes are only defined where they can run.
const BaseElement = (
  typeof HTMLElement === "undefined" ? class {} : HTMLElement
) as typeof HTMLElement;

const PROPERTIES = ["asset", "onExpired", "getText", "text", "messages", "pdf"] as const;

/**
 * An asset viewer element. Set the `src` attribute to the asset URL (public or signed) and the
 * `asset` property to its display info or the asset from the API, and `onExpired` to refresh a
 * signed URL; other attributes: `label`, `viewer-claims` (JSON), `sizes` (images), `page-size`
 * (spreadsheets) and `initial-page` (documents). The `text` and `getText` properties supply text
 * and spreadsheet viewers' text, `messages` replaces their text and `pdf` sets where pdf.js loads
 * its files from.
 */
abstract class ViewerElement<K extends AssetViewerName> extends BaseElement {
  static observedAttributes = [
    "src",
    "label",
    "viewer-claims",
    "sizes",
    "page-size",
    "initial-page",
  ];

  protected abstract readonly kind: K;
  #viewer?: AssetViewer<AssetViewerOptionsByKind[K]>;
  #asset?: ViewerAsset;
  #onExpired?: () => string | Promise<string>;
  #getText?: () => Promise<string>;
  #text?: string;
  #messages?: Partial<ViewerMessages>;
  #pdf?: PdfAssetOptions;

  /** The asset to show, from the API. */
  get asset(): ViewerAsset | undefined {
    return this.#asset;
  }
  set asset(value: ViewerAsset | undefined) {
    this.#asset = value;
    this.#render();
  }

  /** Returns a fresh asset URL from your server once a signed one expires. */
  get onExpired(): (() => string | Promise<string>) | undefined {
    return this.#onExpired;
  }
  set onExpired(value: (() => string | Promise<string>) | undefined) {
    this.#onExpired = value;
    this.#render();
  }

  /** Reads a text or spreadsheet viewer's text yourself. */
  get getText(): (() => Promise<string>) | undefined {
    return this.#getText;
  }
  set getText(value: (() => Promise<string>) | undefined) {
    this.#getText = value;
    this.#render();
  }

  /** Text your app already has, for a text or spreadsheet viewer. */
  get text(): string | undefined {
    return this.#text;
  }
  set text(value: string | undefined) {
    this.#text = value;
    this.#render();
  }

  get messages(): Partial<ViewerMessages> | undefined {
    return this.#messages;
  }
  set messages(value: Partial<ViewerMessages> | undefined) {
    this.#messages = value;
    this.#render();
  }

  /** Where a document viewer's pdf.js loads its worker, fonts and decoders from. */
  get pdf(): PdfAssetOptions | undefined {
    return this.#pdf;
  }
  set pdf(value: PdfAssetOptions | undefined) {
    this.#pdf = value;
    this.#render();
  }

  connectedCallback() {
    // Properties set before the element was defined are plain own properties hiding the setters.
    const record = this as unknown as Record<string, unknown>;
    for (const name of PROPERTIES) {
      if (!Object.hasOwn(this, name)) continue;
      const value = record[name];
      delete record[name];
      record[name] = value;
    }
    this.#render();
  }

  attributeChangedCallback() {
    this.#render();
  }

  disconnectedCallback() {
    this.#viewer?.destroy();
    this.#viewer = undefined;
  }

  #render() {
    const src = this.getAttribute("src");
    if (!this.isConnected || !this.#asset || !src) return;
    const pageSize = this.getAttribute("page-size");
    const initialPage = this.getAttribute("initial-page");
    const claims = this.getAttribute("viewer-claims");
    const options = {
      src,
      asset: this.#asset,
      onExpired: this.#onExpired,
      getText: this.#getText,
      text: this.#text,
      messages: this.#messages,
      pdf: this.#pdf,
      label: this.getAttribute("label") ?? undefined,
      viewerClaims: claims ? JSON.parse(claims) : undefined,
      sizes: this.getAttribute("sizes") ?? undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      initialPage: initialPage ? Number(initialPage) : undefined,
    } as AssetViewerOptionsByKind[K];
    if (this.#viewer) this.#viewer.update(options);
    else
      this.#viewer = ASSET_VIEWERS[this.kind](this, options as never) as AssetViewer<
        AssetViewerOptionsByKind[K]
      >;
  }
}

/** `<calmlens-image-viewer>`: an image asset's rendered file, fitted to the element. */
export class CalmLensImageViewerElement extends ViewerElement<"image"> {
  protected readonly kind = "image";
}
/** `<calmlens-website-viewer>`: a website's screenshot and a link to the page. */
export class CalmLensWebsiteViewerElement extends ViewerElement<"website"> {
  protected readonly kind = "website";
}
/** `<calmlens-text-viewer>`: text, escaped, in a scrolling region. */
export class CalmLensTextViewerElement extends ViewerElement<"text"> {
  protected readonly kind = "text";
}
/** `<calmlens-document-viewer>`: a PDF a page at a time, with pdf.js loaded lazily. */
export class CalmLensDocumentViewerElement extends ViewerElement<"document"> {
  protected readonly kind = "document";
}
/** `<calmlens-spreadsheet-viewer>`: a spreadsheet's sheets as tabs and paged tables. */
export class CalmLensSpreadsheetViewerElement extends ViewerElement<"spreadsheet"> {
  protected readonly kind = "spreadsheet";
}

const ELEMENTS = {
  "calmlens-image-viewer": CalmLensImageViewerElement,
  "calmlens-website-viewer": CalmLensWebsiteViewerElement,
  "calmlens-text-viewer": CalmLensTextViewerElement,
  "calmlens-document-viewer": CalmLensDocumentViewerElement,
  "calmlens-spreadsheet-viewer": CalmLensSpreadsheetViewerElement,
} as const;

/** Defines the asset viewer elements, if they aren't defined yet. */
export const defineCalmLensViewerElements = (): void => {
  if (typeof customElements === "undefined") return;
  for (const [name, element] of Object.entries(ELEMENTS)) {
    if (!customElements.get(name)) customElements.define(name, element);
  }
};

defineCalmLensViewerElements();

declare global {
  interface HTMLElementTagNameMap {
    "calmlens-image-viewer": CalmLensImageViewerElement;
    "calmlens-website-viewer": CalmLensWebsiteViewerElement;
    "calmlens-text-viewer": CalmLensTextViewerElement;
    "calmlens-document-viewer": CalmLensDocumentViewerElement;
    "calmlens-spreadsheet-viewer": CalmLensSpreadsheetViewerElement;
  }
}
