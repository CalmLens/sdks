/** Path data for the components' 24×24 stroke icons, so every framework draws the same ones. */
export const ICONS = {
  upload: "M12 16V4m0 0L7 9m5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  remove: "M18 6 6 18M6 6l12 12",
  retry: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  unavailable:
    "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 5 10 7a17 17 0 0 1-3.3 4.2M6.6 6.6C4.4 8 2.8 10.4 2 12c1 2 5 7 10 7a9.6 9.6 0 0 0 5.4-1.6",
} as const;

export type IconName = keyof typeof ICONS;

/** Attributes shared by every icon's `<svg>`. */
export const ICON_ATTRIBUTES = {
  width: "18",
  height: "18",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
} as const;
