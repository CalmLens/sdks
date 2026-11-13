import { loadPdfJs, openPdfDocument, type PdfDocument } from "./PdfLoader";
import type { DocumentViewerOptions } from "./ViewerAsset";
import { type AssetViewer, el, ViewerBase, viewerId } from "./ViewerBase";
import { formatViewerMessage } from "./ViewerMessages";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.25;

type RenderTask = { cancel(): void; promise: Promise<unknown> };

/**
 * Shows a PDF (a PDF asset, or a document or presentation CalmLens rendered as one) a page at a
 * time with pdf.js, which loads only when a document is shown: page buttons and a page number
 * field, zoom and fit to width, a link that opens the PDF itself, and keys for each. Each page's
 * text is in the page for screen readers. A document pdf.js can't open falls back to the link.
 */
class DocumentViewer extends ViewerBase<DocumentViewerOptions> {
  #document?: PdfDocument;
  #url?: string;
  #page = 1;
  /** A fixed zoom, or `undefined` to fit the page to the viewer's width. */
  #zoom?: number;
  #scale = 1;
  #renderTask?: RenderTask;
  #renders = 0;
  #recovering = false;
  #resize?: ResizeObserver;
  #controls?: {
    previous: HTMLButtonElement;
    next: HTMLButtonElement;
    page: HTMLInputElement;
    count: HTMLElement;
    zoomOut: HTMLButtonElement;
    zoomIn: HTMLButtonElement;
    zoomLevel: HTMLElement;
    fit: HTMLButtonElement;
    open: HTMLAnchorElement;
    pages: HTMLElement;
    sheet: HTMLElement;
    canvas: HTMLCanvasElement;
    text: HTMLElement;
    status: HTMLElement;
  };

  constructor(root: HTMLElement) {
    super(root, "document");
  }

  protected describe({ asset, pdf, initialPage }: DocumentViewerOptions) {
    return [asset.content?.rendered?.kind, pdf, initialPage];
  }

  /** Opens the document, asking once for a fresh asset URL when it fails, as an expired one does. */
  async #open(signal: AbortSignal): Promise<PdfDocument> {
    let url = this.#url ?? (await this.urls.get("rendered"));
    for (;;) {
      try {
        const document = await openPdfDocument(url, this.options.pdf);
        this.urls.loaded("rendered");
        return document;
      } catch (error) {
        if (signal.aborted) throw error;
        const fresh = this.urls.refresh("rendered");
        if (!fresh) throw error;
        url = await fresh;
        this.#url = url;
      }
    }
  }

  protected async load(signal: AbortSignal) {
    this.#close();
    this.#url = undefined;
    this.frame.replaceChildren(this.loadingNotice());
    // The URL comes first, so the fallback can link to it whatever fails next; pdf.js downloads
    // before the document opens, so a failure to load it isn't taken for an expired URL.
    this.#url = await this.urls.get("rendered");
    await loadPdfJs(this.options.pdf);
    const document = await this.#open(signal);
    if (signal.aborted) {
      void document.loadingTask.destroy();
      return;
    }
    signal.addEventListener("abort", () => this.#close(document));
    this.#document = document;
    this.#page = Math.min(
      Math.max(1, Math.trunc(this.options.initialPage ?? 1) || 1),
      document.numPages,
    );
    this.#zoom = undefined;
    this.#build();
    await this.#render(signal);
  }

  #build() {
    const { messages } = this;
    const button = (label: string, symbol: string, attributes: Record<string, string> = {}) =>
      el(
        "button",
        {
          type: "button",
          class: "calmlens-button",
          "aria-label": label,
          title: label,
          ...attributes,
        },
        [el("span", { "aria-hidden": "true" }, [symbol])],
      );
    const pagesId = viewerId("document");
    const pageField = viewerId("page");
    const previous = button(messages.previousPage, "‹");
    const next = button(messages.nextPage, "›");
    const page = el("input", {
      id: pageField,
      type: "number",
      inputmode: "numeric",
      min: 1,
      class: "calmlens-viewer__page-field",
    });
    const count = el("span");
    const zoomOut = button(messages.zoomOut, "−");
    const zoomIn = button(messages.zoomIn, "+");
    const zoomLevel = el("span", { class: "calmlens-viewer__zoom" });
    const fit = button(messages.fitWidth, "↔", { "aria-pressed": "true" });
    const open = el(
      "a",
      {
        class: "calmlens-button calmlens-viewer__link",
        href: this.#url,
        target: "_blank",
        rel: "noopener noreferrer",
      },
      [messages.openDocument],
    );
    const canvas = el("canvas", { "aria-hidden": "true" });
    const text = el("div", { class: "calmlens-viewer__sr" });
    const sheet = el("div", { class: "calmlens-viewer__page", role: "group" }, [canvas, text]);
    const pages = el(
      "div",
      {
        id: pagesId,
        class: "calmlens-viewer__pages",
        role: "region",
        "aria-label": this.options.label || messages.documentLabel,
        tabindex: 0,
      },
      [sheet],
    );
    const status = el("p", { class: "calmlens-viewer__sr", role: "status" });
    const toolbar = el(
      "div",
      {
        class: "calmlens-viewer__bar",
        role: "toolbar",
        "aria-label": messages.documentControls,
        "aria-controls": pagesId,
      },
      [
        previous,
        el("label", { for: pageField, class: "calmlens-viewer__page-label" }, [
          messages.pageNumber,
        ]),
        page,
        count,
        el("span", { class: "calmlens-viewer__spacer" }),
        zoomOut,
        zoomLevel,
        zoomIn,
        fit,
        open,
      ],
    );
    previous.addEventListener("click", () => this.#go(this.#page - 1));
    next.addEventListener("click", () => this.#go(this.#page + 1));
    toolbar.insertBefore(next, count.nextSibling);
    page.addEventListener("change", () => this.#go(Number(page.value)));
    page.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      // The number input can also commit a change as Enter's default action.
      event.preventDefault();
      // Safari can report the IME confirmation as key code 229 after compositionend.
      if (!event.isComposing && event.keyCode !== 229) this.#go(Number(page.value));
    });
    zoomOut.addEventListener("click", () => this.#setZoom(this.#scale / ZOOM_STEP));
    zoomIn.addEventListener("click", () => this.#setZoom(this.#scale * ZOOM_STEP));
    fit.addEventListener("click", () => this.#setZoom(undefined));
    pages.addEventListener("keydown", (event) => this.#onKey(event));
    this.#controls = {
      previous,
      next,
      page,
      count,
      zoomOut,
      zoomIn,
      zoomLevel,
      fit,
      open,
      pages,
      sheet,
      canvas,
      text,
      status,
    };
    this.frame.replaceChildren(toolbar, pages, status);
    if (typeof ResizeObserver !== "undefined") {
      let width = 0;
      this.#resize = new ResizeObserver(([entry]) => {
        const next = Math.round(entry?.contentRect.width ?? 0);
        if (next === width) return;
        width = next;
        if (this.#zoom === undefined) void this.#render();
      });
      this.#resize.observe(pages);
    }
  }

  #onKey(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const actions: Record<string, () => void> = {
      PageDown: () => this.#go(this.#page + 1),
      ArrowRight: () => this.#go(this.#page + 1),
      PageUp: () => this.#go(this.#page - 1),
      ArrowLeft: () => this.#go(this.#page - 1),
      Home: () => this.#go(1),
      End: () => this.#go(this.#document?.numPages ?? 1),
      "+": () => this.#setZoom(this.#scale * ZOOM_STEP),
      "=": () => this.#setZoom(this.#scale * ZOOM_STEP),
      "-": () => this.#setZoom(this.#scale / ZOOM_STEP),
      "0": () => this.#setZoom(undefined),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  #go(page: number) {
    const count = this.#document?.numPages ?? 1;
    const target = Number.isFinite(page)
      ? Math.min(Math.max(1, Math.round(page)), count)
      : this.#page;
    if (target === this.#page) {
      // Put back a page number that was out of range.
      if (this.#controls) this.#controls.page.value = String(this.#page);
      return;
    }
    this.#page = target;
    void this.#render();
  }

  #setZoom(zoom: number | undefined) {
    this.#zoom = zoom === undefined ? undefined : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    void this.#render();
  }

  /** Draws the current page and puts its text, number and zoom in the controls. */
  async #render(signal?: AbortSignal): Promise<void> {
    const document = this.#document;
    const controls = this.#controls;
    if (!document || !controls) return;
    const render = ++this.#renders;
    this.#renderTask?.cancel();
    const pageNumber = this.#page;
    const { messages } = this;
    const pageLabel = formatViewerMessage(messages.pageStatus, {
      page: pageNumber,
      count: document.numPages,
    });
    controls.page.value = String(pageNumber);
    controls.page.max = String(document.numPages);
    controls.count.textContent = formatViewerMessage(messages.pageCount, {
      count: document.numPages,
    });
    controls.previous.disabled = pageNumber <= 1;
    controls.next.disabled = pageNumber >= document.numPages;
    controls.fit.setAttribute("aria-pressed", String(this.#zoom === undefined));
    controls.sheet.setAttribute("aria-label", pageLabel);
    try {
      const page = await document.getPage(pageNumber);
      if (render !== this.#renders) return;
      const natural = page.getViewport({ scale: 1 });
      const available = controls.pages.clientWidth - 32;
      const scale = this.#zoom ?? (available > 0 ? available / natural.width : 1);
      this.#scale = scale;
      controls.zoomLevel.textContent = formatViewerMessage(messages.zoomLevel, {
        percent: Math.round(scale * 100),
      });
      controls.zoomOut.disabled = scale <= MIN_ZOOM;
      controls.zoomIn.disabled = scale >= MAX_ZOOM;
      const viewport = page.getViewport({ scale });
      const ratio = (typeof devicePixelRatio === "number" && devicePixelRatio) || 1;
      const { canvas } = controls;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const task = page.render({
        canvas,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      this.#renderTask = task;
      // A render cancelled for the next one rejects; only the current render's outcome counts.
      task.promise.catch(() => {});
      const content = await page.getTextContent();
      if (render !== this.#renders) return;
      controls.text.textContent = content.items
        .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : ""))
        .join("");
      await task.promise;
      if (render !== this.#renders) return;
      this.#recovering = false;
      controls.status.textContent = pageLabel;
      this.state = "loaded";
    } catch (error) {
      if (render !== this.#renders || signal?.aborted) return;
      if ((error as { name?: string })?.name === "RenderingCancelledException") return;
      // Pages load as they are shown, so a URL that expired since the document opened fails
      // here: open the document again from a fresh URL, at the same page.
      const fresh = this.#recovering ? undefined : this.urls.refresh("rendered");
      if (!fresh) return this.fail();
      this.#recovering = true;
      try {
        const url = await fresh;
        const reopened = await openPdfDocument(url, this.options.pdf);
        this.urls.loaded("rendered");
        this.#url = url;
        controls.open.href = url;
        void this.#document?.loadingTask.destroy();
        this.#document = reopened;
        await this.#render(signal);
      } catch {
        this.fail();
      }
    }
  }

  #close(document = this.#document) {
    this.#renderTask?.cancel();
    this.#renderTask = undefined;
    this.#resize?.disconnect();
    this.#resize = undefined;
    this.#controls = undefined;
    if (document) void document.loadingTask.destroy();
    if (document === this.#document) this.#document = undefined;
  }

  protected fail() {
    this.#close();
    this.state = "error";
    const link =
      this.#url &&
      el(
        "a",
        {
          class: "calmlens-button calmlens-viewer__link",
          href: this.#url,
          target: "_blank",
          rel: "noopener noreferrer",
        },
        [this.messages.openDocument],
      );
    this.frame.replaceChildren(this.notice(this.messages.documentFailed, link));
  }

  destroy() {
    this.#close();
    super.destroy();
  }
}

/** Shows a PDF, or a document rendered as one, in `root`. */
export const createDocumentViewer = (
  root: HTMLElement,
  options: DocumentViewerOptions,
): AssetViewer<DocumentViewerOptions> => {
  const viewer = new DocumentViewer(root);
  viewer.update(options);
  return viewer;
};
