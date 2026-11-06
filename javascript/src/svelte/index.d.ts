import type { Component, Snippet } from "svelte";
import type {
  AssetProps,
  CalmLensUpload as CoreCalmLensUpload,
  UploadControllerOptions as CoreUploadControllerOptions,
  UploaderProps as CoreUploaderProps,
  UploadItem as CoreUploadItem,
  UploadSnapshot as CoreUploadSnapshot,
  DocumentViewerOptions,
  ImageViewerOptions,
  SpreadsheetViewerOptions,
  TextViewerOptions,
  UploadController,
  UploadFile,
  WebsiteViewerOptions,
} from "../ui.js";

// The browser's files are `File`s, so the upload types default to `File` here.
export type UploadItem<F extends UploadFile = File> = CoreUploadItem<F>;
export type CalmLensUpload<F extends UploadFile = File> = CoreCalmLensUpload<F>;
export type UploadSnapshot<F extends UploadFile = File> = CoreUploadSnapshot<F>;
export type UploadControllerOptions<F extends UploadFile = File> = CoreUploadControllerOptions<F>;
export type UploaderProps<F extends UploadFile = File> = CoreUploaderProps<F>;
/** Creates an upload queue for the components, such as one a form starts on submit. */
export declare const createUploadController: <F extends UploadFile = File>(
  options: UploadControllerOptions<F>,
) => UploadController<F>;

/**
 * A drop zone and file list that uploads through an upload preset, shows each file's progress
 * and moderation decision, and reports finished uploads to `onUploaded`.
 */
export declare const CalmLensUploader: Component<UploaderProps>;

/**
 * Shows any asset from its asset URL (public or signed), natively in the page: images, websites,
 * video and audio with their adaptive stream, documents, text and spreadsheets, or a preview still
 * or file icon. It reads `{src}/info` once mounted, unless `info` is given. Age-restricted content
 * stays behind its blurred placeholder and a reveal button; content the CDN refuses shows the
 * unavailable notice. `renderUnavailable` and `renderAgeGate` snippets replace the notices.
 */
export declare const CalmLensAsset: Component<
  AssetProps & {
    renderUnavailable?: Snippet;
    renderAgeGate?: Snippet<[{ placeholderUrl?: string; confirm?: () => void }]>;
  }
>;

/** Shows an image asset's rendered file, fitted to the element, over its placeholder (preview). */
export declare const CalmLensImageViewer: Component<ImageViewerOptions>;
/** Shows a website asset's screenshot with a link to the original page (preview). */
export declare const CalmLensWebsiteViewer: Component<WebsiteViewerOptions>;
/** Shows a text asset's text, escaped, in a scrolling region (preview). */
export declare const CalmLensTextViewer: Component<TextViewerOptions>;
/** Shows a PDF, or a document rendered as one, a page at a time with pdf.js (preview). */
export declare const CalmLensDocumentViewer: Component<DocumentViewerOptions>;
/** Shows a spreadsheet's sheets as tabs and paged tables, from its extracted text (preview). */
export declare const CalmLensSpreadsheetViewer: Component<SpreadsheetViewerOptions>;

export * from "../ui.js";
