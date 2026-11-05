import { describe, expect, it } from "bun:test";
import {
  getAssetViewerKind,
  getSpreadsheetPage,
  parseSpreadsheetText,
  spreadsheetColumnIndex,
  type ViewerAsset,
} from "../src/ui";

const asset = (type: string, content: ViewerAsset["content"]): ViewerAsset => ({
  id: "a1",
  projectId: "p1",
  type,
  content,
});

describe("getAssetViewerKind", () => {
  const rendered = (kind: "image" | "video" | "audio" | "pdf") => ({
    kind,
    width: null,
    height: null,
  });

  it("picks the viewer from the asset's type and rendered file", () => {
    expect(getAssetViewerKind(asset("image", { rendered: rendered("image") }))).toBe("image");
    expect(getAssetViewerKind(asset("website", { rendered: rendered("image") }))).toBe("website");
    expect(getAssetViewerKind(asset("website", { rendered: null }))).toBe("website");
    expect(getAssetViewerKind(asset("video", { rendered: rendered("video") }))).toBe("media");
    expect(getAssetViewerKind(asset("audio", { rendered: rendered("audio") }))).toBe("media");
    expect(getAssetViewerKind(asset("multimedia-document", { rendered: rendered("pdf") }))).toBe(
      "document",
    );
    expect(getAssetViewerKind(asset("plaintext-document", { rendered: null }))).toBe("text");
    expect(getAssetViewerKind(asset("file", { rendered: null }))).toBe("none");
    expect(getAssetViewerKind(asset("image", { rendered: null }))).toBe("none");
  });

  it("tells spreadsheets from other documents by their format", () => {
    const sheet = (format: string) => asset("multimedia-document", { rendered: null, format });
    expect(getAssetViewerKind(sheet("application/vnd.oasis.opendocument.spreadsheet"))).toBe(
      "spreadsheet",
    );
    expect(getAssetViewerKind(sheet("application/vnd.ms-excel.sheet.macroEnabled.12"))).toBe(
      "spreadsheet",
    );
    expect(getAssetViewerKind(sheet("application/vnd.ms-excel; charset=binary"))).toBe(
      "spreadsheet",
    );
    // A document whose PDF isn't rendered yet has nothing to show.
    expect(getAssetViewerKind(sheet("application/msword"))).toBe("none");
  });
});

describe("parseSpreadsheetText", () => {
  // The format the document processor writes (spreadsheet.rs).
  const text = [
    '# Sheet "Q3"',
    "Row 1: A=Name | B=line one line two",
    "Row 13 (hidden): A=secret",
    "Row 14: D (hidden)=x | AA=7 (formula: =3+4)",
    "",
    '# Sheet "Notes \\"x\\"" (hidden)',
    "Row 2: B=a | b | C=c",
    "Comment B2 (Bob): Looks wrong",
    'Chart "Revenue": Series A, Series B',
    "",
  ].join("\n");

  it("reads sheets, rows, cells and their hidden markers", () => {
    const [q3, notes] = parseSpreadsheetText(text);
    expect(q3).toEqual({
      name: "Q3",
      hidden: false,
      rows: [
        {
          number: 1,
          hidden: false,
          cells: [
            { column: 0, columnName: "A", hidden: false, text: "Name" },
            { column: 1, columnName: "B", hidden: false, text: "line one line two" },
          ],
        },
        {
          number: 13,
          hidden: true,
          cells: [{ column: 0, columnName: "A", hidden: false, text: "secret" }],
        },
        {
          number: 14,
          hidden: false,
          cells: [
            { column: 3, columnName: "D", hidden: true, text: "x" },
            { column: 26, columnName: "AA", hidden: false, text: "7 (formula: =3+4)" },
          ],
        },
      ],
      columns: [
        { column: 0, columnName: "A", hidden: false },
        { column: 1, columnName: "B", hidden: false },
        { column: 3, columnName: "D", hidden: true },
        { column: 26, columnName: "AA", hidden: false },
      ],
      notes: [],
    });
    expect(notes?.name).toBe('Notes "x"');
    expect(notes?.hidden).toBe(true);
    // A separator only starts a cell when a column name follows it.
    expect(notes?.rows[0]?.cells.map((cell) => [cell.columnName, cell.text])).toEqual([
      ["B", "a | b"],
      ["C", "c"],
    ]);
    expect(notes?.notes).toEqual([
      "Comment B2 (Bob): Looks wrong",
      'Chart "Revenue": Series A, Series B',
    ]);
  });

  it("keeps text that isn't a spreadsheet's as notes", () => {
    expect(parseSpreadsheetText("Just some text\nRow one: nothing")).toEqual([
      {
        name: "",
        hidden: false,
        rows: [],
        columns: [],
        notes: ["Just some text", "Row one: nothing"],
      },
    ]);
  });

  it("numbers columns as spreadsheets do", () => {
    expect(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"].map(spreadsheetColumnIndex)).toEqual([
      0, 25, 26, 51, 52, 701, 702,
    ]);
  });
});

describe("getSpreadsheetPage", () => {
  const [sheet] = parseSpreadsheetText(
    Array.from({ length: 5 }, (_, index) => `Row ${index + 1}: A=${index + 1}`).join("\n"),
  );

  it("pages a sheet's rows, clamping the page to the sheet", () => {
    const page = (index: number) => {
      const { rows, ...rest } = getSpreadsheetPage(sheet!, index, 2);
      return { numbers: rows.map((row) => row.number), ...rest };
    };
    expect(page(0)).toEqual({ numbers: [1, 2], from: 1, to: 2, pages: 3 });
    expect(page(2)).toEqual({ numbers: [5], from: 5, to: 5, pages: 3 });
    expect(page(9)).toEqual({ numbers: [5], from: 5, to: 5, pages: 3 });
    expect(page(-1)).toEqual({ numbers: [1, 2], from: 1, to: 2, pages: 3 });
  });
});
