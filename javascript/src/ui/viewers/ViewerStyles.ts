import { CALMLENS_THEME } from "../Theme";

/**
 * The asset viewers' styles, part of the components' stylesheet (`calmlens/styles.css`). A viewer
 * fills its element; give the element a height (an embed page's frame, or a box in your page),
 * or it takes the image's shape, or a default height for documents, text and spreadsheets. Set
 * `--calmlens-viewer-background` and `--calmlens-viewer-text` to match a page's own colours.
 */
export const VIEWER_STYLES = `
:where(.calmlens-viewer) {
  --calmlens-accent: ${CALMLENS_THEME.accent};
  --calmlens-accent-text: ${CALMLENS_THEME.accentText};
  --calmlens-radius: ${CALMLENS_THEME.radius}px;
  --calmlens-focus-width: 2px;
  --calmlens-focus-offset: 2px;
  --calmlens-border: color-mix(in srgb, currentColor 18%, transparent);
  --calmlens-surface: color-mix(in srgb, currentColor 4%, transparent);
  --calmlens-muted: color-mix(in srgb, currentColor 72%, transparent);
  --calmlens-focus-ring: var(--calmlens-accent);
  box-sizing: border-box;
  font: inherit;
}
.calmlens-viewer *, .calmlens-viewer *::before, .calmlens-viewer *::after { box-sizing: border-box; }
.calmlens-viewer { display: block; position: relative; width: 100%; height: 100%; }
.calmlens-viewer__frame {
  position: relative; display: flex; flex-direction: column; width: 100%; height: 100%;
  min-height: 0; overflow: hidden;
  /* An opaque surface of its own, so sticky headers and the toolbar cover what scrolls under them. */
  background: var(--calmlens-viewer-background, Canvas); color: var(--calmlens-viewer-text, CanvasText);
}
.calmlens-viewer:is([data-kind="text"], [data-kind="document"], [data-kind="spreadsheet"], [data-kind="website"]) > .calmlens-viewer__frame { min-height: 320px; }
.calmlens-viewer :focus-visible {
  outline: 2px solid var(--calmlens-focus-ring); outline-offset: -2px;
}
.calmlens-viewer__sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
.calmlens-viewer__notice {
  display: grid; place-content: center; justify-items: center; gap: 12px; flex: 1;
  padding: 24px 16px; text-align: center; color: var(--calmlens-muted);
}
.calmlens-viewer__notice p { margin: 0; max-width: 40ch; }
.calmlens-viewer__bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px;
  border-bottom: 1px solid var(--calmlens-border); background: var(--calmlens-viewer-background, Canvas);
}
.calmlens-viewer__bar .calmlens-button { min-width: 36px; min-height: 36px; }
.calmlens-viewer__spacer { flex: 1; }
.calmlens-viewer__link { text-decoration: none; overflow-wrap: anywhere; }
.calmlens-viewer__scroll { flex: 1; min-height: 0; overflow: auto; position: relative; }
/* Images fit inside the frame, keeping their shape; without a frame height, the box takes it. */
.calmlens-viewer[data-kind="image"] > .calmlens-viewer__frame { aspect-ratio: var(--calmlens-viewer-ratio, auto); max-height: 100%; }
.calmlens-viewer[data-kind="image"] > .calmlens-viewer__frame > img {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
}
.calmlens-viewer:not([data-kind="image"]) .calmlens-viewer__placeholder {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top;
}
.calmlens-viewer__placeholder { filter: blur(12px); transform: scale(1.05); }
.calmlens-viewer__image { opacity: 0; transition: opacity 250ms; }
.calmlens-viewer[data-state="loaded"] .calmlens-viewer__image { opacity: 1; }
.calmlens-viewer[data-kind="website"] .calmlens-viewer__image { position: relative; display: block; width: 100%; height: auto; }
.calmlens-viewer__text {
  margin: 0 auto; padding: 20px 24px; max-width: 75ch; white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: inherit; font-size: 1rem; line-height: 1.6;
}
.calmlens-viewer__pages { flex: 1; min-height: 0; overflow: auto; padding: 16px; text-align: center; }
.calmlens-viewer__page { display: inline-block; position: relative; vertical-align: top; }
.calmlens-viewer__page canvas { display: block; background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 0.2); }
.calmlens-viewer__page-field { width: 4.5em; min-height: 36px; padding: 4px 6px; font: inherit; border: 1px solid var(--calmlens-border); border-radius: calc(var(--calmlens-radius) / 2); background: transparent; color: inherit; }
.calmlens-viewer__zoom { min-width: 4ch; text-align: center; font-variant-numeric: tabular-nums; }
.calmlens-viewer__sheets { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.calmlens-viewer__tabs {
  display: flex; gap: 2px; overflow-x: auto; padding: 6px 8px 0; border-bottom: 1px solid var(--calmlens-border);
}
.calmlens-viewer__tab {
  padding: 6px 12px; border: 1px solid transparent; border-bottom: 0; border-radius: 6px 6px 0 0;
  background: none; color: inherit; font: inherit; white-space: nowrap; cursor: pointer;
}
.calmlens-viewer__tab[aria-selected="true"] { border-color: var(--calmlens-border); background: var(--calmlens-viewer-background, Canvas); font-weight: 600; }
.calmlens-viewer__tab[data-hidden], .calmlens-viewer__table [data-hidden] { font-style: italic; }
.calmlens-viewer__panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.calmlens-viewer__table { flex: 1; min-height: 0; overflow: auto; }
.calmlens-viewer__table table { border-collapse: collapse; font-size: 0.875rem; font-variant-numeric: tabular-nums; }
.calmlens-viewer__table th, .calmlens-viewer__table td {
  padding: 4px 8px; border: 1px solid var(--calmlens-border); text-align: left; vertical-align: top;
  max-width: 40ch; overflow-wrap: anywhere; white-space: pre-wrap;
}
.calmlens-viewer__table thead th { position: sticky; top: 0; z-index: 1; }
.calmlens-viewer__table th { background: var(--calmlens-viewer-background, Canvas); font-weight: 600; color: var(--calmlens-muted); }
.calmlens-viewer__table tbody th { position: sticky; left: 0; text-align: right; }
.calmlens-viewer__corner { background: var(--calmlens-viewer-background, Canvas); }
.calmlens-viewer__tag { margin-left: 6px; font-size: 0.75em; font-weight: 400; }
.calmlens-viewer__pager {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px;
  border-top: 1px solid var(--calmlens-border);
}
.calmlens-viewer__pager p { margin: 0; }
.calmlens-viewer__empty { margin: 0; padding: 24px 16px; color: var(--calmlens-muted); }
.calmlens-viewer__notes { padding: 8px 16px; border-top: 1px solid var(--calmlens-border); font-size: 0.875rem; }
.calmlens-viewer__notes ul { margin: 0; padding-left: 1.25em; }
`;
