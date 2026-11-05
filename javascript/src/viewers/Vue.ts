// Vue asset viewers (preview): `CalmLensImageViewer`, `CalmLensWebsiteViewer`,
// `CalmLensTextViewer`, `CalmLensDocumentViewer` and `CalmLensSpreadsheetViewer`. Each mounts the
// shared viewer from `calmlens/ui` into its element once it is in the page.

import { defineComponent, h, onBeforeUnmount, onMounted, type PropType, ref, watch } from "vue";
import type { ViewerClaims } from "../client/CalmLensTypes";
import type { GetSignedMediaUrl } from "../ui/Media";
import {
  ASSET_VIEWERS,
  type AssetViewer,
  type AssetViewerName,
  type PdfAssetOptions,
  type ViewerAsset,
  type ViewerMessages,
} from "../ui/viewers";

const optional = <T>(type: PropType<T>) => ({ type, default: undefined });

const viewer = <K extends AssetViewerName>(name: string, kind: K) =>
  defineComponent({
    name,
    props: {
      /** The asset to show, from the API. */
      asset: { type: Object as PropType<ViewerAsset>, required: true as const },
      getSignedUrl: optional(Function as PropType<GetSignedMediaUrl>),
      viewerClaims: optional(Object as PropType<ViewerClaims>),
      cdnBaseUrl: optional(String),
      label: optional(String),
      messages: optional(Object as PropType<Partial<ViewerMessages>>),
      /** Images: the `sizes` of a public image's responsive widths. */
      sizes: optional(String),
      /** Text and spreadsheets: text your app already has. */
      text: optional(String),
      /** Text and spreadsheets: reads the text yourself. */
      getText: optional(Function as PropType<() => Promise<string>>),
      /** Spreadsheets: rows shown at a time. */
      pageSize: optional(Number),
      /** Documents: where pdf.js loads its worker, fonts and decoders from. */
      pdf: optional(Object as PropType<PdfAssetOptions>),
    },
    setup(props) {
      const root = ref<HTMLElement>();
      let mounted: AssetViewer<never> | undefined;
      const options = () => ({ ...props }) as never;
      onMounted(() => {
        mounted = ASSET_VIEWERS[kind](root.value!, options()) as AssetViewer<never>;
      });
      // The viewer loads again only when what it shows changed.
      watch(options, (next) => mounted?.update(next));
      onBeforeUnmount(() => {
        mounted?.destroy();
        mounted = undefined;
      });
      // The viewer owns the element's children; Vue renders none.
      return () => h("div", { ref: root, class: "calmlens-viewer", "data-kind": kind });
    },
  });

/** Shows an image asset's rendered file, fitted to the element, over its placeholder. */
export const CalmLensImageViewer = viewer("CalmLensImageViewer", "image");
/** Shows a website asset's screenshot with a link to the original page. */
export const CalmLensWebsiteViewer = viewer("CalmLensWebsiteViewer", "website");
/** Shows a text asset's text, escaped, in a scrolling region. */
export const CalmLensTextViewer = viewer("CalmLensTextViewer", "text");
/** Shows a PDF, or a document rendered as one, a page at a time with pdf.js (loaded lazily). */
export const CalmLensDocumentViewer = viewer("CalmLensDocumentViewer", "document");
/** Shows a spreadsheet's sheets as tabs and paged tables, from its extracted text. */
export const CalmLensSpreadsheetViewer = viewer("CalmLensSpreadsheetViewer", "spreadsheet");
