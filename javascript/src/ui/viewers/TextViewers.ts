import { getSpreadsheetPage, parseSpreadsheetText, type SpreadsheetSheet } from "./Spreadsheet";
import type {
  SpreadsheetViewerOptions,
  TextViewerOptions,
  ViewerOptions,
  ViewerTextOptions,
} from "./ViewerAsset";
import { type AssetViewer, el, ViewerBase, viewerId } from "./ViewerBase";
import { formatViewerMessage } from "./ViewerMessages";
import { fetchViewerText, type ViewerUrls } from "./ViewerUrls";

/**
 * The text to show: `text`, then `getText`, then the inline `content.extractedText`, then a text
 * asset's `original` file.
 */
const readText = async (
  { asset, text, getText }: ViewerOptions & ViewerTextOptions,
  urls: ViewerUrls,
  signal: AbortSignal,
): Promise<string> => {
  if (text !== undefined) return text;
  if (getText) return await getText();
  const extracted = asset.content?.extractedText;
  if (extracted?.type === "string") return extracted.content;
  if (asset.type === "plaintext-document") return await fetchViewerText(urls, "original", signal);
  throw new Error("The asset has no text to show");
};

const describeText = ({ asset, text }: ViewerOptions & ViewerTextOptions) => [
  asset.type,
  asset.content?.extractedText,
  text,
];

/**
 * Shows text, such as a text asset's: always as text, never as markup, wrapped to the element's
 * width in a focusable region that scrolls.
 */
class TextViewer extends ViewerBase<TextViewerOptions> {
  constructor(root: HTMLElement) {
    super(root, "text");
  }

  protected describe(options: TextViewerOptions) {
    return describeText(options);
  }

  protected async load(signal: AbortSignal) {
    this.frame.replaceChildren(this.loadingNotice());
    const text = await readText(this.options, this.urls, signal);
    if (signal.aborted) return;
    const content = el("pre", { class: "calmlens-viewer__text", dir: "auto" });
    // Text nodes keep markup inert: nothing in the text is ever parsed as HTML.
    content.textContent = text;
    this.frame.replaceChildren(
      el(
        "div",
        {
          class: "calmlens-viewer__scroll",
          role: "region",
          "aria-label": this.options.label || this.messages.textLabel,
          tabindex: 0,
        },
        [content],
      ),
    );
    this.state = "loaded";
  }

  protected fail() {
    this.state = "error";
    this.frame.replaceChildren(this.notice(this.messages.textFailed));
  }
}

/**
 * Shows a spreadsheet's sheets, read from the text CalmLens extracts: a tab per sheet and a table
 * of its cells, a page of rows at a time. Cell text is always shown as text.
 */
class SpreadsheetViewer extends ViewerBase<SpreadsheetViewerOptions> {
  #sheets: SpreadsheetSheet[] = [];
  #selected = 0;
  /** The page each sheet shows, by sheet index. */
  #pages: number[] = [];
  #panel?: HTMLElement;
  #tabs: HTMLButtonElement[] = [];

  constructor(root: HTMLElement) {
    super(root, "spreadsheet");
  }

  protected describe(options: SpreadsheetViewerOptions) {
    return [...describeText(options), options.pageSize];
  }

  get #pageSize() {
    const size = this.options.pageSize;
    return size && Number.isSafeInteger(size) && size > 0 ? size : 100;
  }

  protected async load(signal: AbortSignal) {
    this.frame.replaceChildren(this.loadingNotice());
    const text = await readText(this.options, this.urls, signal);
    if (signal.aborted) return;
    this.#sheets = parseSpreadsheetText(text);
    this.#selected = 0;
    this.#pages = this.#sheets.map(() => 0);
    if (!this.#sheets.length)
      this.#sheets = [{ name: "", hidden: false, rows: [], columns: [], notes: [] }];
    const tablist = el("div", {
      class: "calmlens-viewer__tabs",
      role: "tablist",
      "aria-label": this.messages.sheets,
    });
    const panelId = viewerId("sheet");
    this.#tabs = this.#sheets.map((sheet, index) => {
      const tab = el(
        "button",
        {
          type: "button",
          role: "tab",
          id: viewerId("sheet-tab"),
          "aria-controls": panelId,
          class: "calmlens-viewer__tab",
          "data-hidden": sheet.hidden,
        },
        [
          sheet.hidden
            ? formatViewerMessage(this.messages.hiddenSheet, { name: sheet.name })
            : sheet.name || String(index + 1),
        ],
      );
      tab.addEventListener("click", () => this.#select(index));
      tab.addEventListener("keydown", (event) => this.#onTabKey(event, index));
      return tab;
    });
    tablist.append(...this.#tabs);
    this.#panel = el("div", {
      class: "calmlens-viewer__panel",
      role: "tabpanel",
      id: panelId,
      tabindex: 0,
    });
    const label = this.options.label || this.messages.spreadsheetLabel;
    this.frame.replaceChildren(
      el("div", { class: "calmlens-viewer__sheets", role: "group", "aria-label": label }, [
        // One sheet needs no tabs to choose it.
        this.#sheets.length > 1 && tablist,
        this.#panel,
      ]),
    );
    this.#select(0);
    this.state = "loaded";
  }

  #onTabKey(event: KeyboardEvent, index: number) {
    const last = this.#tabs.length - 1;
    const target =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    if (target === undefined) return;
    event.preventDefault();
    this.#select(target);
    this.#tabs[target]?.focus();
  }

  #select(index: number) {
    this.#selected = index;
    this.#tabs.forEach((tab, tabIndex) => {
      tab.setAttribute("aria-selected", String(tabIndex === index));
      tab.tabIndex = tabIndex === index ? 0 : -1;
    });
    const tab = this.#tabs[index];
    if (tab) this.#panel?.setAttribute("aria-labelledby", tab.id);
    else
      this.#panel?.setAttribute(
        "aria-label",
        this.#sheets[index]?.name || this.messages.spreadsheetLabel,
      );
    this.#renderSheet();
  }

  #renderSheet() {
    const panel = this.#panel;
    const sheet = this.#sheets[this.#selected];
    if (!panel || !sheet) return;
    const { messages } = this;
    const page = getSpreadsheetPage(sheet, this.#pages[this.#selected] ?? 0, this.#pageSize);
    const children: (Node | undefined)[] = [];
    if (sheet.rows.length) {
      const header = el("tr", {}, [
        el("td", { class: "calmlens-viewer__corner" }),
        ...sheet.columns.map(({ columnName, hidden }) =>
          el("th", { scope: "col", "data-hidden": hidden }, [
            columnName,
            hidden && el("span", { class: "calmlens-viewer__tag" }, [messages.hidden]),
          ]),
        ),
      ]);
      const body = page.rows.map((row) => {
        const cells = new Map(row.cells.map((cell) => [cell.column, cell.text]));
        return el("tr", { "data-hidden": row.hidden }, [
          el("th", { scope: "row", "data-hidden": row.hidden }, [
            String(row.number),
            row.hidden && el("span", { class: "calmlens-viewer__tag" }, [messages.hidden]),
          ]),
          ...sheet.columns.map(({ column }) => {
            const cell = el("td");
            // Cell text is set as text, so markup in a cell is shown, never parsed.
            cell.textContent = cells.get(column) ?? "";
            return cell;
          }),
        ]);
      });
      children.push(
        el("div", { class: "calmlens-viewer__table" }, [
          el("table", {}, [el("thead", {}, [header]), el("tbody", {}, body)]),
        ]),
      );
    } else {
      children.push(el("p", { class: "calmlens-viewer__empty" }, [messages.emptySheet]));
    }
    if (page.pages > 1) {
      const pageIndex = Math.min(this.#pages[this.#selected] ?? 0, page.pages - 1);
      const go = (offset: number) => {
        this.#pages[this.#selected] = pageIndex + offset;
        this.#renderSheet();
        // Keep the focus on the pager after it was re-rendered.
        panel
          .querySelector<HTMLButtonElement>(`[data-pager="${offset < 0 ? "previous" : "next"}"]`)
          ?.focus();
      };
      const previous = el(
        "button",
        {
          type: "button",
          class: "calmlens-button",
          "data-pager": "previous",
          disabled: pageIndex === 0,
        },
        [messages.previousRows],
      );
      const next = el(
        "button",
        {
          type: "button",
          class: "calmlens-button",
          "data-pager": "next",
          disabled: pageIndex === page.pages - 1,
        },
        [messages.nextRows],
      );
      previous.addEventListener("click", () => go(-1));
      next.addEventListener("click", () => go(1));
      children.push(
        el("div", { class: "calmlens-viewer__pager" }, [
          previous,
          el("p", { role: "status" }, [
            formatViewerMessage(messages.rowRange, {
              from: page.from,
              to: page.to,
              count: sheet.rows.length,
            }),
          ]),
          next,
        ]),
      );
    }
    if (sheet.notes.length) {
      const notes = el("ul");
      for (const note of sheet.notes) {
        const item = el("li");
        item.textContent = note;
        notes.append(item);
      }
      children.push(
        el("section", { class: "calmlens-viewer__notes", "aria-label": messages.sheetNotes }, [
          notes,
        ]),
      );
    }
    panel.replaceChildren(...children.filter((node) => node !== undefined));
  }

  protected fail() {
    this.state = "error";
    this.frame.replaceChildren(this.notice(this.messages.spreadsheetFailed));
  }
}

/** Shows text in `root`. */
export const createTextViewer = (
  root: HTMLElement,
  options: TextViewerOptions,
): AssetViewer<TextViewerOptions> => {
  const viewer = new TextViewer(root);
  viewer.update(options);
  return viewer;
};

/** Shows a spreadsheet's sheets in `root`. */
export const createSpreadsheetViewer = (
  root: HTMLElement,
  options: SpreadsheetViewerOptions,
): AssetViewer<SpreadsheetViewerOptions> => {
  const viewer = new SpreadsheetViewer(root);
  viewer.update(options);
  return viewer;
};
