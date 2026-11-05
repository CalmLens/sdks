import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/dom";
import type { ViewerAsset } from "../src/ui";
import { type MountedViewer, VIEWER_BINDINGS } from "./viewer-bindings";

const PROJECT_ID = "proj_8fK2mQx7Lp4NvB3tRz9Y";
const CDN = "https://cdn.calmlens.com/v1";
const publicUrl = (resource: string) => `${CDN}/assets/${PROJECT_ID}/a1/${resource}`;

/** Messages replaced with markers, so tests find controls without depending on the wording. */
const messages = {
  loading: "msg:loading",
  imageFailed: "msg:image-failed",
  openWebsite: "msg:open {host}",
  textFailed: "msg:text-failed",
  documentFailed: "msg:document-failed",
  openDocument: "msg:open-document",
  previousPage: "msg:previous-page",
  nextPage: "msg:next-page",
  pageNumber: "msg:page",
  pageStatus: "msg:page {page}/{count}",
  zoomIn: "msg:zoom-in",
  zoomOut: "msg:zoom-out",
  fitWidth: "msg:fit",
  zoomLevel: "{percent}",
  sheets: "msg:sheets",
  hiddenSheet: "msg:hidden {name}",
  previousRows: "msg:previous-rows",
  nextRows: "msg:next-rows",
  rowRange: "{from}-{to}/{count}",
};

const asset = (
  overrides: Partial<ViewerAsset> & { content?: ViewerAsset["content"] },
): ViewerAsset => ({
  id: "a1",
  projectId: PROJECT_ID,
  type: "image",
  classification: { moderation: { status: "allowed" } },
  ...overrides,
});

const imageAsset = asset({
  content: {
    status: "stored",
    rendered: { kind: "image", width: 1200, height: 800 },
    preview: { width: 1200, height: 800, thumbhash: null, averageColor: null },
  },
});

/** A `getSignedUrl` that signs each resource with a counter, so each fetch has its own URL. */
const signer = () => {
  let count = 0;
  return mock(async (resource: string) => `https://signed.example/${resource}?n=${++count}`);
};

/** Serves `fetch` from `respond`, recording each URL fetched. */
const serve = (respond: (url: string) => Response | Promise<Response>) => {
  const fetched: string[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    return respond(url);
  }) as unknown as typeof fetch;
  return fetched;
};

const browserFetch = globalThis.fetch;
let mounted: MountedViewer | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.fetch = browserFetch;
});

/** A PDF with one page per text, each showing its text. */
const makePdf = (pages: string[]): Uint8Array => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((text, i) => {
    const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
};

// happy-dom has no 2D canvas, so pdf.js draws into a context that accepts every call.
const getContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const canvas = this;
    const state: Record<PropertyKey, unknown> = { canvas };
    return new Proxy(state, {
      get: (target, key) => {
        if (key in target) return target[key];
        if (key === "getTransform") return () => new DOMMatrix();
        if (key === "measureText") return () => ({ width: 10 });
        if (key === "getImageData" || key === "createImageData") {
          return (width: number, height: number) => ({
            width,
            height,
            data: new Uint8ClampedArray(width * height * 4),
          });
        }
        return () => {};
      },
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    });
  } as unknown as typeof getContext;
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = getContext;
});

describe.each(VIEWER_BINDINGS)("$name asset viewers", (binding) => {
  describe("image", () => {
    it("loads the rendered image from the signed URL and refreshes it once it expires", async () => {
      const getSignedUrl = signer();
      mounted = binding.mount("image", {
        asset: imageAsset,
        getSignedUrl,
        label: "A harbour",
        messages,
      });
      const view = within(mounted.container);
      const image = await waitFor(() => {
        const found = view.getByRole("img", { name: "A harbour" });
        expect(found.getAttribute("src")).toBe("https://signed.example/rendered?n=1");
        return found;
      });
      expect(getSignedUrl.mock.calls).toEqual([["rendered"]]);
      expect(mounted.container.querySelector("[aria-busy]")?.getAttribute("aria-busy")).toBe(
        "true",
      );

      // An expired signature fails to load: the viewer asks for a fresh URL once.
      image.dispatchEvent(new Event("error"));
      await waitFor(() =>
        expect(image.getAttribute("src")).toBe("https://signed.example/rendered?n=2"),
      );
      image.dispatchEvent(new Event("load"));
      await waitFor(() =>
        expect(mounted!.container.querySelector("[aria-busy]")?.getAttribute("aria-busy")).toBe(
          "false",
        ),
      );

      // After the fresh URL worked, a later expiry refreshes again.
      image.dispatchEvent(new Event("error"));
      await waitFor(() =>
        expect(image.getAttribute("src")).toBe("https://signed.example/rendered?n=3"),
      );
      // A fresh URL that fails too ends in the failure notice, without asking again.
      image.dispatchEvent(new Event("error"));
      await waitFor(() => expect(view.getByRole("status").textContent).toBe(messages.imageFailed));
      expect(getSignedUrl).toHaveBeenCalledTimes(3);
      expect(view.queryByRole("img", { name: "A harbour" })).toBeNull();
    });

    it("loads a public image from the CDN, with the viewer's claims", async () => {
      mounted = binding.mount("image", {
        asset: imageAsset,
        label: "A harbour",
        viewerClaims: { region: "GB" },
      });
      const image = await waitFor(() =>
        within(mounted!.container).getByRole("img", { name: "A harbour" }),
      );
      await waitFor(() =>
        expect(image.getAttribute("src")).toBe(
          `${publicUrl("rendered")}?viewerClaims=${encodeURIComponent(JSON.stringify({ region: "GB" }))}`,
        ),
      );
    });
  });

  describe("website", () => {
    const website = (externalUrl: string) =>
      asset({
        type: "website",
        externalUrl,
        content: {
          status: "stored",
          rendered: { kind: "image", width: 1280, height: 4000 },
          preview: null,
        },
      });

    it("shows the signed screenshot and links to the original page", async () => {
      const getSignedUrl = signer();
      mounted = binding.mount("website", {
        asset: website("https://news.example.org/story?id=7"),
        getSignedUrl,
        label: "Story",
        messages,
      });
      const view = within(mounted.container);
      const link = view.getByRole("link", { name: "msg:open news.example.org" });
      expect(link.getAttribute("href")).toBe("https://news.example.org/story?id=7");
      expect(link.getAttribute("rel")?.split(" ")).toContain("noopener");
      await waitFor(() =>
        expect(view.getByRole("img", { name: "Story" }).getAttribute("src")).toBe(
          "https://signed.example/rendered?n=1",
        ),
      );
      // The screenshot scrolls in a region keyboards can reach.
      expect(view.getByRole("region", { name: "Story" }).tabIndex).toBe(0);
    });

    it("never links to an address that isn't a web page", async () => {
      const script = ["javascript", "alert(1)"].join(":");
      mounted = binding.mount("website", { asset: website(script), messages });
      await waitFor(() => within(mounted!.container).getByRole("img"));
      expect(within(mounted.container).queryByRole("link")).toBeNull();
    });
  });

  describe("text", () => {
    const hostile = `Line one\n<img src=x onerror="window.__viewerInjected = true"><script>window.__viewerInjected = true</script>\n<b>not bold</b>`;

    it("shows text as text, never as markup", async () => {
      mounted = binding.mount("text", {
        asset: asset({
          type: "plaintext-document",
          content: {
            status: "stored",
            rendered: null,
            preview: null,
            extractedText: { type: "string", content: hostile },
          },
        }),
        label: "Notes",
      });
      const region = await waitFor(() =>
        within(mounted!.container).getByRole("region", { name: "Notes" }),
      );
      expect(region.textContent).toBe(hostile);
      expect(region.querySelector("img, script, b")).toBeNull();
      expect((window as { __viewerInjected?: boolean }).__viewerInjected).toBeUndefined();
      expect(region.tabIndex).toBe(0);
    });

    it("reads a text asset's original file, refreshing an expired signed URL", async () => {
      const getSignedUrl = signer();
      const fetched = serve((url) =>
        url.endsWith("n=1")
          ? new Response("expired", { status: 403 })
          : new Response("Hello <i>there</i>"),
      );
      mounted = binding.mount("text", {
        asset: asset({
          type: "plaintext-document",
          content: {
            status: "stored",
            rendered: null,
            preview: null,
            extractedText: { type: "document", id: "doc_1" },
          },
        }),
        getSignedUrl,
        label: "Notes",
      });
      const region = await waitFor(() =>
        within(mounted!.container).getByRole("region", { name: "Notes" }),
      );
      expect(region.textContent).toBe("Hello <i>there</i>");
      expect(region.querySelector("i")).toBeNull();
      expect(getSignedUrl.mock.calls).toEqual([["original"], ["original"]]);
      expect(fetched).toEqual([
        "https://signed.example/original?n=1",
        "https://signed.example/original?n=2",
      ]);
    });

    it("shows the failure notice when no text can be read", async () => {
      const getSignedUrl = signer();
      serve(() => new Response("gone", { status: 404 }));
      mounted = binding.mount("text", {
        asset: asset({
          type: "plaintext-document",
          content: { status: "stored", rendered: null, preview: null },
        }),
        getSignedUrl,
        messages,
      });
      await waitFor(() =>
        expect(within(mounted!.container).getByRole("status").textContent).toBe(
          messages.textFailed,
        ),
      );
      expect(getSignedUrl).toHaveBeenCalledTimes(2);
    });
  });

  describe("document", () => {
    const bytes = makePdf(["Hello one", "Hello two", "Hello three"]);
    // pdf.js takes over the buffers it reads, so each response gets its own copy.
    const pdf = () => new Response(bytes.slice());
    const pdfAsset = asset({
      type: "multimedia-document",
      content: {
        status: "stored",
        rendered: { kind: "pdf", width: null, height: null },
        preview: null,
      },
    });
    const page = (container: HTMLElement, number: number) =>
      within(container).getByRole("group", { name: `msg:page ${number}/3` });

    it("renders the PDF's pages and moves between them", async () => {
      const fetched = serve(pdf);
      mounted = binding.mount("document", { asset: pdfAsset, label: "Report", messages });
      const view = within(mounted.container);
      await waitFor(() => expect(view.getByRole("status").textContent).toBe("msg:page 1/3"), {
        timeout: 15000,
      });
      expect(page(mounted.container, 1).textContent).toContain("Hello one");
      expect(fetched).toEqual([publicUrl("rendered")]);
      const previous = view.getByRole("button", {
        name: messages.previousPage,
      }) as HTMLButtonElement;
      const next = view.getByRole("button", { name: messages.nextPage }) as HTMLButtonElement;
      const field = view.getByRole("spinbutton", { name: messages.pageNumber }) as HTMLInputElement;
      expect(previous.disabled).toBe(true);
      expect(field.value).toBe("1");

      next.click();
      await waitFor(() => expect(page(mounted!.container, 2).textContent).toContain("Hello two"));
      expect(field.value).toBe("2");
      expect(previous.disabled).toBe(false);

      fireEvent.change(field, { target: { value: "3" } });
      await waitFor(() => expect(page(mounted!.container, 3).textContent).toContain("Hello three"));
      expect(next.disabled).toBe(true);

      // Keys move through the document from its pages region.
      const pages = view.getByRole("region", { name: "Report" });
      expect(pages.tabIndex).toBe(0);
      fireEvent.keyDown(pages, { key: "Home" });
      await waitFor(() => expect(page(mounted!.container, 1).textContent).toContain("Hello one"));
      fireEvent.keyDown(pages, { key: "PageDown" });
      await waitFor(() => expect(page(mounted!.container, 2).textContent).toContain("Hello two"));

      // Zoom leaves fit-to-width, and fitting again turns it back on.
      const fit = view.getByRole("button", { name: messages.fitWidth });
      expect(fit.getAttribute("aria-pressed")).toBe("true");
      view.getByRole("button", { name: messages.zoomIn }).click();
      await waitFor(() => expect(fit.getAttribute("aria-pressed")).toBe("false"));
      fit.click();
      await waitFor(() => expect(fit.getAttribute("aria-pressed")).toBe("true"));

      expect(view.getByRole("link", { name: messages.openDocument }).getAttribute("href")).toBe(
        publicUrl("rendered"),
      );
    }, 30000);

    it("refreshes an expired signed URL before showing the document", async () => {
      const getSignedUrl = signer();
      serve((url) => (url.endsWith("n=1") ? new Response("expired", { status: 403 }) : pdf()));
      mounted = binding.mount("document", {
        asset: pdfAsset,
        getSignedUrl,
        label: "Report",
        messages,
      });
      await waitFor(() => expect(page(mounted!.container, 1).textContent).toContain("Hello one"), {
        timeout: 15000,
      });
      expect(getSignedUrl.mock.calls).toEqual([["rendered"], ["rendered"]]);
      expect(
        within(mounted.container)
          .getByRole("link", { name: messages.openDocument })
          .getAttribute("href"),
      ).toBe("https://signed.example/rendered?n=2");
    }, 30000);

    it("falls back to a link to the PDF when it can't be rendered", async () => {
      const getSignedUrl = signer();
      serve(() => new Response("not a pdf"));
      mounted = binding.mount("document", {
        asset: pdfAsset,
        getSignedUrl,
        label: "Report",
        messages,
      });
      const view = within(mounted.container);
      await waitFor(
        () => expect(view.getByRole("status").textContent).toContain(messages.documentFailed),
        {
          timeout: 15000,
        },
      );
      expect(view.getByRole("link", { name: messages.openDocument }).getAttribute("href")).toBe(
        "https://signed.example/rendered?n=2",
      );
      expect(view.queryByRole("button", { name: messages.nextPage })).toBeNull();
      expect(getSignedUrl).toHaveBeenCalledTimes(2);
    }, 30000);
  });

  describe("spreadsheet", () => {
    const rows = Array.from(
      { length: 250 },
      (_, index) => `Row ${index + 1}: A=r${index + 1} | C=${index * 2}`,
    );
    const text = [
      '# Sheet "Orders"',
      ...rows,
      "",
      '# Sheet "Secret \\"x\\"" (hidden)',
      "Row 4 (hidden): B=<b>bold</b><script>window.__sheetInjected = true</script> | D (hidden)=y",
      "Comment B4 (Ann): Check this",
      "",
    ].join("\n");
    const spreadsheet = asset({
      type: "multimedia-document",
      content: {
        status: "stored",
        format: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        rendered: null,
        preview: null,
      },
    });

    it("shows a tab per sheet and pages through a sheet's rows", async () => {
      const getText = mock(async () => text);
      mounted = binding.mount("spreadsheet", {
        asset: spreadsheet,
        getText,
        pageSize: 100,
        messages,
      });
      const view = within(mounted.container);
      const tabs = await waitFor(() => view.getAllByRole("tab"));
      view.getByRole("tablist", { name: messages.sheets });
      expect(tabs.map((tab) => tab.textContent)).toEqual(["Orders", 'msg:hidden Secret "x"']);
      expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
      const panel = view.getByRole("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0]!.id);
      expect(tabs[0]!.getAttribute("aria-controls")).toBe(panel.id);

      const bodyRows = () => within(panel).getAllByRole("row").slice(1);
      const rowHeader = (row: HTMLElement) => within(row).getByRole("rowheader").textContent;
      expect(bodyRows()).toHaveLength(100);
      expect(rowHeader(bodyRows()[0]!)).toBe("1");
      expect(
        within(panel)
          .getAllByRole("columnheader")
          .map((header) => header.textContent),
      ).toEqual(["A", "C"]);
      expect(within(panel).getByRole("status").textContent).toBe("1-100/250");
      const previous = within(panel).getByRole("button", {
        name: messages.previousRows,
      }) as HTMLButtonElement;
      expect(previous.disabled).toBe(true);

      within(panel).getByRole("button", { name: messages.nextRows }).click();
      expect(rowHeader(bodyRows()[0]!)).toBe("101");
      within(panel).getByRole("button", { name: messages.nextRows }).click();
      expect(bodyRows()).toHaveLength(50);
      expect(within(panel).getByRole("status").textContent).toBe("201-250/250");
      expect(
        (within(panel).getByRole("button", { name: messages.nextRows }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(getText).toHaveBeenCalledTimes(1);

      // Arrow keys move between sheets; each keeps its own page.
      fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
      expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
      expect(document.activeElement).toBe(tabs[1]!);
      fireEvent.keyDown(tabs[1]!, { key: "ArrowRight" });
      expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
      expect(within(panel).getByRole("status").textContent).toBe("201-250/250");
    });

    it("shows cell text as text, never as markup", async () => {
      mounted = binding.mount("spreadsheet", { asset: spreadsheet, text, messages });
      const view = within(mounted.container);
      const tabs = await waitFor(() => view.getAllByRole("tab"));
      tabs[1]!.click();
      const panel = view.getByRole("tabpanel");
      const [, row] = within(panel).getAllByRole("row");
      const cells = within(row!).getAllByRole("cell");
      expect(cells.map((cell) => cell.textContent)).toEqual([
        "<b>bold</b><script>window.__sheetInjected = true</script>",
        "y",
      ]);
      expect(panel.querySelector("table b, table script")).toBeNull();
      expect((window as { __sheetInjected?: boolean }).__sheetInjected).toBeUndefined();
      expect(within(panel).getByRole("listitem").textContent).toBe("Comment B4 (Ann): Check this");
    });

    it("reads the sheets from a text asset's inline text", async () => {
      mounted = binding.mount("spreadsheet", {
        asset: asset({
          type: "plaintext-document",
          content: {
            status: "stored",
            rendered: null,
            preview: null,
            extractedText: { type: "string", content: '# Sheet "Only"\nRow 2: B=two\n' },
          },
        }),
        messages,
      });
      const view = within(mounted.container);
      const cell = await waitFor(() => view.getByRole("cell", { name: "two" }));
      // One sheet needs no tabs.
      expect(view.queryByRole("tablist")).toBeNull();
      expect(within(cell.closest("tr")!).getByRole("rowheader").textContent).toBe("2");
    });
  });
});
