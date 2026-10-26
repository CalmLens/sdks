/**
 * File-type icons for files without an image preview: a file outline in the family's colour with
 * the family's symbol and an extension label, drawn the same way by every framework. The symbols are
 * Tabler icons (MIT) as 24×24 stroke paths.
 */

export type FileIconFamily =
  | "documents"
  | "spreadsheets"
  | "presentations"
  | "images"
  | "audio"
  | "video"
  | "archives"
  | "code"
  | "data"
  | "design"
  | "applications"
  | "fonts"
  | "maps"
  | "games"
  | "system"
  | "security"
  | "unknown";

/** The families `getFileIcon` finds from a file's name and MIME type. */
export type UploadFileIconFamily = Exclude<
  FileIconFamily,
  "applications" | "maps" | "games" | "system" | "security" | "unknown"
>;

/** The file outline every family's icon is drawn on. */
export const FILE_ICON_OUTLINE =
  "M14 3v4a1 1 0 0 0 1 1h4 M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2";

/** The symbols of the families `getFileIcon` finds, which the upload widget draws. */
export const FILE_ICON_SYMBOLS: Record<UploadFileIconFamily, string> = {
  documents: "M4 6l16 0 M4 12l10 0 M4 18l14 0",
  spreadsheets:
    "M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14 M3 10h18 M10 3v18",
  presentations:
    "M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6 M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10 M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14 M4 20h14",
  images:
    "M15 8h.01 M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12 M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5 M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3",
  audio:
    "M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0 M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0 M9 17v-13h10v13 M9 8h10",
  video:
    "M15 10l4.553 -2.276a1 1 0 0 1 1.447 .894v6.764a1 1 0 0 1 -1.447 .894l-4.553 -2.276v-4 M3 8a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -8",
  archives:
    "M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2 M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10 M10 12l4 0",
  code: "M7 8l-4 4l4 4 M17 8l4 4l-4 4 M14 4l-4 16",
  data: "M4 6a8 3 0 1 0 16 0a8 3 0 1 0 -16 0 M4 6v6a8 3 0 0 0 16 0v-6 M4 12v6a8 3 0 0 0 16 0v-6",
  design:
    "M3 21v-4a4 4 0 1 1 4 4h-4 M21 3a16 16 0 0 0 -12.8 10.2 M21 3a16 16 0 0 1 -10.2 12.8 M10.6 9a9 9 0 0 1 4.4 4.4",
  fonts: "M4 20l3 0 M14 20l7 0 M6.9 15l6.9 0 M10.2 6.3l5.8 13.7 M5 20l6 -16l2 0l7 16",
};

/**
 * The symbols of the families only an app's own file detection finds, kept apart so the upload
 * widget doesn't bundle them.
 */
export const MORE_FILE_ICON_SYMBOLS: Record<
  Exclude<FileIconFamily, UploadFileIconFamily | "unknown">,
  string
> = {
  applications:
    "M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4 M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4 M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4 M14 7l6 0 M17 4l0 6",
  maps: "M3 7l6 -3l6 3l6 -3v13l-6 3l-6 -3l-6 3v-13 M9 4v13 M15 7v13",
  games:
    "M12 5h3.5a5 5 0 0 1 0 10h-5.5l-4.015 4.227a2.3 2.3 0 0 1 -3.923 -2.035l1.634 -8.173a5 5 0 0 1 4.904 -4.019h3.4 M14 15l4.07 4.284a2.3 2.3 0 0 0 3.925 -2.023l-1.6 -8.232 M8 9v2 M7 10h2 M14 10h2",
  system:
    "M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065 M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
  security:
    "M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3 M11 11a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M12 12l0 2.5",
};

export const FILE_ICON_COLORS: Record<FileIconFamily, string> = {
  documents: "#2563eb",
  spreadsheets: "#15803d",
  presentations: "#c2410c",
  images: "#7c3aed",
  audio: "#be185d",
  video: "#b91c1c",
  archives: "#a16207",
  code: "#0e7490",
  data: "#4338ca",
  design: "#a21caf",
  applications: "#475569",
  fonts: "#7c3aed",
  maps: "#15803d",
  games: "#c2410c",
  system: "#475569",
  security: "#0e7490",
  unknown: "#64748b",
};

// The families of the files people commonly upload, by extension. Anything else falls back to its
// MIME type's top-level type, then to a plain file.
const EXTENSION_FAMILIES: Partial<Record<UploadFileIconFamily, string>> = {
  documents: "pdf doc docx odt rtf txt md epub pages",
  spreadsheets: "xls xlsx ods csv tsv numbers",
  presentations: "ppt pptx odp key",
  archives: "zip rar 7z tar gz tgz bz2 xz",
  code: "js ts jsx tsx html css py rb go rs java php c cpp h sh",
  data: "json xml yaml yml sql sqlite db",
  design: "psd ai sketch fig xd",
  fonts: "ttf otf woff woff2",
};

const MIME_FAMILIES: Record<string, UploadFileIconFamily> = {
  image: "images",
  audio: "audio",
  video: "video",
  font: "fonts",
  text: "documents",
};

/** A file's icon family and the extension its label shows, such as `pdf`. */
export const getFileIcon = (file: { name: string; type: string }) => {
  const dot = file.name.lastIndexOf(".");
  const suffix = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  // Only plain extensions reach the label, which the components write as SVG markup.
  const extension = /^[a-z0-9]{1,8}$/.test(suffix) ? suffix : "";
  const listed = Object.entries(EXTENSION_FAMILIES).find(([, extensions]) =>
    ` ${extensions} `.includes(` ${extension} `),
  )?.[0] as UploadFileIconFamily | undefined;
  const family: UploadFileIconFamily | "unknown" =
    (extension ? listed : undefined) ??
    MIME_FAMILIES[file.type.split("/")[0] ?? ""] ??
    (file.type === "application/pdf" ? "documents" : "unknown");
  return { family, extension };
};

/**
 * Where each part of the icon goes in its 24×24 box: the symbol inside the outline, above a band
 * holding the extension. Icons 32 pixels or smaller leave the band out and centre the symbol.
 */
export const getFileIconLayout = (size: number) => {
  const compact = size <= 32;
  return {
    compact,
    symbol: compact
      ? { x: 6, y: 10, width: 11, height: 10 }
      : { x: 6.5, y: 6.5, width: 8.5, height: 7 },
    // Tabler draws in a 24-unit box; keep the outline 1.5 screen pixels wide.
    outlineStroke: (1.5 * 24) / Math.max(size, 24),
    /** The band and its label, in a half-scale group: `transform="scale(0.5)"`. */
    band: { x: 3, y: 29, width: 39, height: 14, rx: 3 },
    label: { x: 22.5, y: 38.9 },
  };
};

/** The label's font size, and a squeezed width for long extensions. */
export const getFileIconLabel = (extension: string) => ({
  text: extension.toUpperCase() || "FILE",
  fontSize: extension.length > 4 ? 7 : 9,
  textLength: extension.length > 5 ? 33 : undefined,
});

/**
 * The icon as SVG markup, for the components to insert as it is. `extension` must come from
 * `getFileIcon`, which keeps only letters and digits.
 */
export const renderFileIconSvg = (
  { family, extension }: { family: UploadFileIconFamily | "unknown"; extension: string },
  size: number,
): string => {
  const tint = FILE_ICON_COLORS[family];
  const { compact, symbol, outlineStroke, band, label } = getFileIconLayout(size);
  const text = getFileIconLabel(extension);
  const symbolSvg =
    family === "unknown"
      ? ""
      : `<svg x="${symbol.x}" y="${symbol.y}" width="${symbol.width}" height="${symbol.height}" viewBox="0 0 24 24" stroke-width="1.5"><path d="${FILE_ICON_SYMBOLS[family]}"/></svg>`;
  const bandSvg = compact
    ? ""
    : `<g transform="scale(0.5)" stroke="none"><rect x="${band.x}" y="${band.y}" width="${band.width}" height="${band.height}" rx="${band.rx}" fill="${tint}"/><text x="${label.x}" y="${label.y}" text-anchor="middle" fill="#fff" font-family="ui-monospace, monospace" font-size="${text.fontSize}" font-weight="700"${text.textLength ? ` textLength="${text.textLength}" lengthAdjust="spacingAndGlyphs"` : ""}>${text.text}</text></g>`;
  return `<svg class="calmlens-file-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${tint}" stroke-width="${outlineStroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${FILE_ICON_OUTLINE}"/>${symbolSvg}${bandSvg}</svg>`;
};
