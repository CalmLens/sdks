import type { ViewerClaims } from "../../client/CalmLensTypes";
import type { GetSignedMediaUrl, MediaAsset } from "../Media";
import type { ViewerMessages } from "./ViewerMessages";

/**
 * The parts of an asset, as the API or a webhook returns it, that the asset viewers read. Assets
 * from `CalmLensServerClient` fit as they are.
 */
export interface ViewerAsset extends MediaAsset {
  name?: string | null;
  /** A website's page address, linked from the website viewer. */
  externalUrl?: string | null;
  content?:
    | (NonNullable<MediaAsset["content"]> & {
        /** MIME type of the uploaded file, which tells spreadsheets from other documents. */
        format?: string | null;
        /** The text extracted from the content, inline when it is small. */
        extractedText?:
          | { type: "string"; content: string }
          | { type: "document"; id: string }
          | null;
      })
    | null;
}

/**
 * Which viewer shows an asset: `image` (the rendered image), `website` (its screenshot and a link
 * to the page), `text` (its text), `document` (a PDF, or a document or presentation rendered as
 * one), `spreadsheet` (its sheets), `media` (video and audio, which `CalmLensMedia` plays) or
 * `none` when there is nothing to show yet.
 */
export type AssetViewerKind =
  | "image"
  | "website"
  | "text"
  | "document"
  | "spreadsheet"
  | "media"
  | "none";

/** Spreadsheet MIME types, as `content.format` reports them (compared lower-cased). */
const SPREADSHEET_FORMATS = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

/** Whether a MIME type is a spreadsheet's. */
export const isSpreadsheetFormat = (format: string | null | undefined): boolean =>
  Boolean(format && SPREADSHEET_FORMATS.has(format.split(";")[0]!.trim().toLowerCase()));

/** The viewer that shows an asset, from its type and `content.rendered.kind`. */
export const getAssetViewerKind = (asset: ViewerAsset): AssetViewerKind => {
  const kind = asset.content?.rendered?.kind;
  if (asset.type === "website") return "website";
  if (kind === "video" || kind === "audio") return "media";
  if (kind === "pdf") return "document";
  if (kind === "image") return "image";
  if (asset.type === "multimedia-document" && isSpreadsheetFormat(asset.content?.format)) {
    return "spreadsheet";
  }
  if (asset.type === "plaintext-document") return "text";
  return "none";
};

/** The options every asset viewer takes. */
export interface ViewerOptions {
  /** The asset to show, from the API. */
  asset: ViewerAsset;
  /**
   * Fetches a signed URL for one of a private asset's resources from your server, as
   * `CalmLensMedia`'s does. A viewer asks once per resource it shows, and again when a URL it
   * loaded stops working, such as once it has expired. Without it, the viewers use public CDN URLs.
   */
  getSignedUrl?: GetSignedMediaUrl;
  /** Optional viewer assertions, added to public CDN URLs. */
  viewerClaims?: ViewerClaims;
  /** The CDN base URL, for local development. */
  cdnBaseUrl?: string;
  /** The viewer's accessible name, such as the asset's title. Images use it as their `alt`. */
  label?: string;
  /** Replaces some or all of the text the viewer shows. */
  messages?: Partial<ViewerMessages>;
}

/** Where the text and spreadsheet viewers read their text. */
export interface ViewerTextOptions {
  /** Text your app already has, shown instead of reading it. */
  text?: string;
  /**
   * Reads the text yourself, such as a large spreadsheet's from its text child asset. Without
   * `text` or `getText`, the viewer shows `content.extractedText` when it is inline, and otherwise
   * reads a text asset's `original` file.
   */
  getText?: () => Promise<string>;
}

export interface ImageViewerOptions extends ViewerOptions {
  /** The `sizes` attribute of a public image's responsive widths. Defaults to `100vw`. */
  sizes?: string;
}

export type WebsiteViewerOptions = ViewerOptions;

export type TextViewerOptions = ViewerOptions & ViewerTextOptions;

export interface SpreadsheetViewerOptions extends ViewerOptions, ViewerTextOptions {
  /** Rows shown at a time. Defaults to 100. */
  pageSize?: number;
}

/** Where pdf.js finds the files it loads, for an app that serves them itself. */
export interface PdfAssetOptions {
  /**
   * The URL your app serves pdf.js's worker at (`pdfjs-dist/build/pdf.worker.min.mjs` of the
   * version the SDK depends on), so documents are read off the main thread. Without it, the
   * viewer imports the worker module lazily and reads documents on the main thread.
   */
  workerSrc?: string;
  /** The URL of pdf.js's `standard_fonts/` folder, for documents that don't embed their fonts. */
  standardFontDataUrl?: string;
  /** The URL of pdf.js's `cmaps/` folder, for documents in CJK and other non-Latin encodings. */
  cMapUrl?: string;
  /** The URL of pdf.js's `wasm/` folder, for JPEG 2000 and JBIG2 images. */
  wasmUrl?: string;
}

export interface DocumentViewerOptions extends ViewerOptions {
  /** Where pdf.js loads its worker, fonts and decoders from. */
  pdf?: PdfAssetOptions;
}
