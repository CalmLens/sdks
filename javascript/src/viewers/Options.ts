import type { AssetViewerName, AssetViewerOptionsByKind } from "../ui/viewers";

/** Every option an asset viewer reads; the bindings pass anything else to the element. */
export const VIEWER_OPTION_NAMES = [
  "src",
  "asset",
  "onExpired",
  "onUnavailable",
  "viewerClaims",
  "label",
  "messages",
  "sizes",
  "text",
  "getText",
  "pageSize",
  "pdf",
  "initialPage",
] as const;

const OPTION_NAMES: ReadonlySet<string> = new Set(VIEWER_OPTION_NAMES);

/** Splits a binding's props into the viewer's options and the element's own attributes. */
export const splitViewerProps = <K extends AssetViewerName, P extends AssetViewerOptionsByKind[K]>(
  props: P,
): { options: AssetViewerOptionsByKind[K]; rest: Omit<P, keyof AssetViewerOptionsByKind[K]> } => {
  const options: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    (OPTION_NAMES.has(name) ? options : rest)[name] = value;
  }
  return {
    options: options as unknown as AssetViewerOptionsByKind[K],
    rest: rest as Omit<P, keyof AssetViewerOptionsByKind[K]>,
  };
};
