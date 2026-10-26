/**
 * The components' stylesheet, also shipped as `@calmlens/sdk/styles.css`. The React components
 * render it themselves (React hoists it into the head, on the server too); with Vue, Svelte or
 * the web components, import or link `@calmlens/sdk/styles.css` once. Nothing is added to the page
 * at runtime. Theme it with the `--calmlens-*` custom properties, or leave it out and style the
 * `calmlens-*` classes yourself.
 */
export const CALMLENS_STYLES = `
/* Zero specificity, so a page's own --calmlens-* values win even on the same element. */
:where(.calmlens-uploader, .calmlens-media) {
  --calmlens-accent: #635bff;
  --calmlens-accent-text: #fff;
  --calmlens-radius: 12px;
  --calmlens-border: color-mix(in srgb, currentColor 22%, transparent);
  --calmlens-surface: color-mix(in srgb, currentColor 4%, transparent);
  --calmlens-success: #12a26f;
  --calmlens-warning: #e8a317;
  --calmlens-danger: #e5484d;
  box-sizing: border-box;
  font: inherit;
}
.calmlens-uploader *, .calmlens-media * { box-sizing: border-box; }
.calmlens-uploader { display: grid; gap: 12px; }
.calmlens-dropzone {
  display: grid; justify-items: center; gap: 8px; padding: 28px 20px; text-align: center;
  border: 1.5px dashed var(--calmlens-border); border-radius: var(--calmlens-radius);
  background: var(--calmlens-surface); cursor: pointer;
  transition: border-color 150ms, background-color 150ms;
}
.calmlens-dropzone:hover, .calmlens-dropzone:focus-within {
  border-color: color-mix(in srgb, var(--calmlens-accent) 60%, transparent);
}
.calmlens-dropzone[data-dragging] {
  border-color: var(--calmlens-accent);
  background: color-mix(in srgb, var(--calmlens-accent) 10%, transparent);
}
.calmlens-dropzone[data-disabled] { cursor: not-allowed; border-style: dotted; background: none; }
.calmlens-dropzone__icon {
  display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%;
  color: var(--calmlens-accent); background: color-mix(in srgb, var(--calmlens-accent) 14%, transparent);
  transition: transform 150ms;
}
.calmlens-dropzone[data-dragging] .calmlens-dropzone__icon { transform: scale(1.1); }
.calmlens-dropzone__title { font-weight: 600; margin: 0; }
.calmlens-dropzone__hint { font-size: 0.875em; margin: 0; }
.calmlens-dropzone__input {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
.calmlens-button, .calmlens-icon-button { margin: 0; width: auto; text-transform: none; letter-spacing: normal; }
.calmlens-button {
  font: inherit; font-weight: 600; font-size: 0.875em; padding: 7px 14px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--calmlens-accent); background: var(--calmlens-accent); color: var(--calmlens-accent-text);
}
.calmlens-button:focus-visible, .calmlens-icon-button:focus-visible {
  outline: 2px solid var(--calmlens-accent); outline-offset: 2px;
}
.calmlens-button:disabled { cursor: not-allowed; border-style: dashed; background: none; color: inherit; border-color: var(--calmlens-border); }
.calmlens-button:hover:not(:disabled) { background: var(--calmlens-accent); filter: brightness(1.08); }
.calmlens-button[data-variant="outline"] { background: none; color: inherit; border-color: var(--calmlens-border); }
.calmlens-uploads { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.calmlens-upload {
  display: grid; grid-template-columns: 48px 1fr auto; align-items: center; gap: 12px; padding: 8px;
  border: 1px solid var(--calmlens-border); border-radius: var(--calmlens-radius);
  border-left: 4px solid var(--calmlens-border);
}
.calmlens-upload[data-outcome="accepted"] { border-left-color: var(--calmlens-success); }
.calmlens-upload[data-outcome="restricted"] { border-left-color: var(--calmlens-warning); }
.calmlens-upload[data-outcome="rejected"] { border-left-color: var(--calmlens-danger); }
.calmlens-upload__thumb {
  width: 48px; height: 48px; border-radius: 8px; object-fit: cover; display: grid; place-items: center;
  background: var(--calmlens-surface); font-size: 0.6875em; font-weight: 700; text-transform: uppercase; overflow: hidden;
}
.calmlens-upload[data-outcome="rejected"] img.calmlens-upload__thumb { filter: blur(6px); }
.calmlens-upload__body { min-width: 0; display: grid; gap: 4px; }
.calmlens-upload__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.calmlens-upload__size { font-weight: 400; font-size: 0.875em; margin-left: 6px; }
.calmlens-upload__message { font-size: 0.875em; margin: 0; }
.calmlens-progress {
  height: 4px; border-radius: 2px; overflow: hidden; background: var(--calmlens-border); position: relative;
}
.calmlens-progress__bar {
  position: absolute; inset: 0 auto 0 0; background: var(--calmlens-accent); border-radius: inherit;
  transition: width 150ms;
}
.calmlens-progress:not([aria-valuenow]) .calmlens-progress__bar {
  width: 35%; animation: calmlens-indeterminate 1.1s ease-in-out infinite;
}
@keyframes calmlens-indeterminate { from { left: -35%; } to { left: 100%; } }
.calmlens-upload__actions { display: flex; gap: 4px; align-items: center; }
.calmlens-icon-button {
  display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border-radius: 8px; cursor: pointer;
  border: 1px solid transparent; background: none; color: inherit;
}
.calmlens-icon-button:hover { background: var(--calmlens-surface); border-color: var(--calmlens-border); }
@media (prefers-reduced-motion: reduce) {
  .calmlens-progress__bar, .calmlens-dropzone, .calmlens-dropzone__icon, .calmlens-media__content { transition: none; }
  .calmlens-progress:not([aria-valuenow]) .calmlens-progress__bar { animation: none; left: 0; width: 100%; }
}

.calmlens-media {
  position: relative; display: block; overflow: hidden; margin: 0; border-radius: var(--calmlens-media-radius, 0);
  background: var(--calmlens-surface);
}
.calmlens-media__placeholder, .calmlens-media__content {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: var(--calmlens-fit, cover);
  object-position: var(--calmlens-position, center);
}
.calmlens-media:not([data-sized]) .calmlens-media__content { position: relative; height: auto; }
.calmlens-media:not([data-sized])[data-kind="gated"], .calmlens-media:not([data-sized])[data-kind="unavailable"],
.calmlens-media:not([data-sized])[data-state="error"] { min-height: 160px; }
.calmlens-media__placeholder { transform: scale(1.1); filter: blur(12px); }
.calmlens-media__content { opacity: 0; transition: opacity 250ms; }
.calmlens-media[data-state="loaded"] .calmlens-media__content { opacity: 1; }
.calmlens-media[data-kind="video"] .calmlens-media__content, .calmlens-media[data-kind="audio"] .calmlens-media__content { opacity: 1; }
.calmlens-media[data-kind="audio"] { background: none; }
.calmlens-media[data-kind="audio"] .calmlens-media__content { position: static; height: auto; }
.calmlens-media__notice {
  position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 6px;
  padding: 12px; text-align: center; color: #fff; background: rgba(0, 0, 0, 0.45);
}
.calmlens-media__notice p { margin: 0; display: flex; gap: 6px; align-items: center; }
/* Thumbnails keep the notice's icon and leave its text to screen readers. */
.calmlens-media[data-sized] { container-type: inline-size; }
@container (max-width: 119px) {
  .calmlens-media__label, .calmlens-media__notice > strong, .calmlens-media__notice > p:not(:has(svg)) {
    position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
  }
}
.calmlens-media__notice strong { font-weight: 600; }
.calmlens-media__notice .calmlens-button { margin-top: 4px; border-color: #fff; background: #fff; color: #111; }
.calmlens-media[data-state="error"] .calmlens-media__notice, .calmlens-media[data-kind="unavailable"] .calmlens-media__notice {
  color: inherit; background: var(--calmlens-surface);
}
`;

/** Identifies the stylesheet, so React adds it once however many components render. */
export const CALMLENS_STYLES_ID = "calmlens-styles";
