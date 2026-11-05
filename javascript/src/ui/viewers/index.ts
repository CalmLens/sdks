// The asset viewers (preview): image, website, text, document (PDF) and spreadsheet viewers,
// framework-free so every binding mounts the same ones. Video and audio are `CalmLensMedia`'s.

import { createDocumentViewer } from "./DocumentViewer";
import { createImageViewer, createWebsiteViewer } from "./ImageViewers";
import { createSpreadsheetViewer, createTextViewer } from "./TextViewers";
import type {
  DocumentViewerOptions,
  ImageViewerOptions,
  SpreadsheetViewerOptions,
  TextViewerOptions,
  WebsiteViewerOptions,
} from "./ViewerAsset";
import type { AssetViewer } from "./ViewerBase";

export { createDocumentViewer } from "./DocumentViewer";
export { createImageViewer, createWebsiteViewer } from "./ImageViewers";
export { loadPdfJs } from "./PdfLoader";
export type { SpreadsheetCell, SpreadsheetRow, SpreadsheetSheet } from "./Spreadsheet";
export { getSpreadsheetPage, parseSpreadsheetText, spreadsheetColumnIndex } from "./Spreadsheet";
export { createSpreadsheetViewer, createTextViewer } from "./TextViewers";
export type {
  AssetViewerKind,
  DocumentViewerOptions,
  ImageViewerOptions,
  PdfAssetOptions,
  SpreadsheetViewerOptions,
  TextViewerOptions,
  ViewerAsset,
  ViewerOptions,
  ViewerTextOptions,
  WebsiteViewerOptions,
} from "./ViewerAsset";
export { getAssetViewerKind, isSpreadsheetFormat } from "./ViewerAsset";
export type { AssetViewer, ViewerState } from "./ViewerBase";
export type { ViewerMessages } from "./ViewerMessages";
export {
  DEFAULT_VIEWER_MESSAGES,
  formatViewerMessage,
  resolveViewerMessages,
} from "./ViewerMessages";
export { VIEWER_STYLES } from "./ViewerStyles";

/** Each viewer's options, by the kind of viewer `getAssetViewerKind` names. */
export interface AssetViewerOptionsByKind {
  image: ImageViewerOptions;
  website: WebsiteViewerOptions;
  text: TextViewerOptions;
  document: DocumentViewerOptions;
  spreadsheet: SpreadsheetViewerOptions;
}

export type AssetViewerName = keyof AssetViewerOptionsByKind;

/** Mounts each viewer, by kind, for the bindings. */
export const ASSET_VIEWERS: {
  [K in AssetViewerName]: (
    root: HTMLElement,
    options: AssetViewerOptionsByKind[K],
  ) => AssetViewer<AssetViewerOptionsByKind[K]>;
} = {
  image: createImageViewer,
  website: createWebsiteViewer,
  text: createTextViewer,
  document: createDocumentViewer,
  spreadsheet: createSpreadsheetViewer,
};
