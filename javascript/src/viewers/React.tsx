"use client";
// React asset viewers (preview): `CalmLensTextViewer`, `CalmLensDocumentViewer` and
// `CalmLensSpreadsheetViewer`. Each mounts the shared viewer from `calmlens/ui` into its element
// once it is in the page.

import { type CSSProperties, type HTMLAttributes, useEffect, useRef } from "react";
import { CALMLENS_STYLES, CALMLENS_STYLES_ID } from "../ui/Styles";
import {
  ASSET_VIEWERS,
  type AssetViewer,
  type AssetViewerName,
  type AssetViewerOptionsByKind,
  type DocumentViewerOptions,
  type SpreadsheetViewerOptions,
  type TextViewerOptions,
} from "../ui/viewers";
import { splitViewerProps } from "./Options";

type ElementProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  /** Leaves out the stylesheet the viewers render, so you can style the `calmlens-*` classes. */
  unstyled?: boolean;
  className?: string;
  style?: CSSProperties;
};

export type CalmLensTextViewerProps = TextViewerOptions & ElementProps;
export type CalmLensDocumentViewerProps = DocumentViewerOptions & ElementProps;
export type CalmLensSpreadsheetViewerProps = SpreadsheetViewerOptions & ElementProps;

/** Mounts a viewer into the element after it renders, and shows each render's options. */
function Viewer<K extends AssetViewerName>({
  kind,
  props,
}: {
  kind: K;
  props: AssetViewerOptionsByKind[K] & ElementProps;
}) {
  const { options, rest } = splitViewerProps<K, typeof props>(props);
  const { unstyled, className, ...attributes } = rest as ElementProps;
  const root = useRef<HTMLDivElement>(null);
  const viewer = useRef<AssetViewer<AssetViewerOptionsByKind[K]>>(undefined);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const mounted = ASSET_VIEWERS[kind](root.current!, latest.current);
    viewer.current = mounted;
    return () => {
      mounted.destroy();
      viewer.current = undefined;
    };
  }, [kind]);
  // Every render: the viewer loads again only when what it shows changed.
  useEffect(() => viewer.current?.update(options));

  return (
    <>
      {unstyled ? null : (
        <style href={CALMLENS_STYLES_ID} precedence="calmlens">
          {CALMLENS_STYLES}
        </style>
      )}
      {/* The viewer owns the element's children; React renders none. */}
      <div
        {...attributes}
        ref={root}
        className={className ? `calmlens-viewer ${className}` : "calmlens-viewer"}
        data-kind={kind}
      />
    </>
  );
}

/** Shows a text asset's text, escaped, in a scrolling region. */
export function CalmLensTextViewer(props: CalmLensTextViewerProps) {
  return <Viewer kind="text" props={props} />;
}

/** Shows a PDF, or a document rendered as one, a page at a time with pdf.js (loaded lazily). */
export function CalmLensDocumentViewer(props: CalmLensDocumentViewerProps) {
  return <Viewer kind="document" props={props} />;
}

/** Shows a spreadsheet's sheets as tabs and paged tables, from its extracted text. */
export function CalmLensSpreadsheetViewer(props: CalmLensSpreadsheetViewerProps) {
  return <Viewer kind="spreadsheet" props={props} />;
}
