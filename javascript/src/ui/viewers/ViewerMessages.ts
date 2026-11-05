/**
 * The text the asset viewers show, keyed by name. `{name}` placeholders are filled in when shown.
 * Pass some or all of them as `messages` to change or translate them.
 */
export interface ViewerMessages {
  loading: string;
  /** An image that can't be loaded. */
  imageFailed: string;
  /** The website viewer's link to the original page; `{host}` is the page's host name. */
  openWebsite: string;
  /** The website screenshot's accessible name when no `label` is set. */
  websiteLabel: string;
  textLabel: string;
  textFailed: string;
  documentLabel: string;
  documentControls: string;
  documentFailed: string;
  openDocument: string;
  previousPage: string;
  nextPage: string;
  pageNumber: string;
  /** After the page number field; `{count}` is the number of pages. */
  pageCount: string;
  /** Each page's accessible name, also announced when the page changes. */
  pageStatus: string;
  zoomIn: string;
  zoomOut: string;
  fitWidth: string;
  /** `{percent}` is the zoom level, such as 125. */
  zoomLevel: string;
  spreadsheetLabel: string;
  spreadsheetFailed: string;
  sheets: string;
  /** A hidden sheet's tab; `{name}` is the sheet's name. */
  hiddenSheet: string;
  hidden: string;
  emptySheet: string;
  previousRows: string;
  nextRows: string;
  /** The rows a sheet shows; `{from}`, `{to}` and `{count}` are row positions and the total. */
  rowRange: string;
  /** The sheet's comments and chart titles, below its table. */
  sheetNotes: string;
}

export const DEFAULT_VIEWER_MESSAGES: ViewerMessages = {
  loading: "Loading…",
  imageFailed: "This image can't be shown.",
  openWebsite: "Open {host}",
  websiteLabel: "Website screenshot",
  textLabel: "Text",
  textFailed: "This text can't be shown.",
  documentLabel: "Document",
  documentControls: "Document controls",
  documentFailed: "This document can't be shown here.",
  openDocument: "Open PDF",
  previousPage: "Previous page",
  nextPage: "Next page",
  pageNumber: "Page",
  pageCount: "of {count}",
  pageStatus: "Page {page} of {count}",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fitWidth: "Fit to width",
  zoomLevel: "{percent}%",
  spreadsheetLabel: "Spreadsheet",
  spreadsheetFailed: "This spreadsheet can't be shown.",
  sheets: "Sheets",
  hiddenSheet: "{name} (hidden)",
  hidden: "Hidden",
  emptySheet: "This sheet is empty.",
  previousRows: "Previous rows",
  nextRows: "Next rows",
  rowRange: "Rows {from}–{to} of {count}",
  sheetNotes: "Comments and charts",
};

/** The default messages with your replacements. */
export const resolveViewerMessages = (overrides?: Partial<ViewerMessages>): ViewerMessages => ({
  ...DEFAULT_VIEWER_MESSAGES,
  ...overrides,
});

/** Fills a message's `{name}` placeholders. */
export const formatViewerMessage = (
  message: string,
  values: Record<string, string | number>,
): string =>
  message.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
