// The asset viewers (preview): text, document (PDF) and spreadsheet viewers, framework-free so
// every binding mounts the same ones. `CalmLensAsset` mounts them and renders images, websites,
// video and audio itself.

import { createDocumentViewer } from "./DocumentViewer";
import { createSpreadsheetViewer, createTextViewer } from "./TextViewers";
import type {
  DocumentViewerOptions,
  SpreadsheetViewerOptions,
  TextViewerOptions,
} from "./ViewerAsset";
import type { AssetViewer } from "./ViewerBase";

export { createDocumentViewer } from "./DocumentViewer";
export { loadPdfJs } from "./PdfLoader";
export type { SpreadsheetCell, SpreadsheetRow, SpreadsheetSheet } from "./Spreadsheet";
export { getSpreadsheetPage, parseSpreadsheetText, spreadsheetColumnIndex } from "./Spreadsheet";
export { createSpreadsheetViewer, createTextViewer } from "./TextViewers";
export type {
  AssetViewerKind,
  DocumentViewerOptions,
  PdfAssetOptions,
  SpreadsheetViewerOptions,
  TextViewerOptions,
  ViewerAsset,
  ViewerOptions,
  ViewerTextOptions,
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
  text: createTextViewer,
  document: createDocumentViewer,
  spreadsheet: createSpreadsheetViewer,
};
