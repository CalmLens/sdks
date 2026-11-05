/** One cell of a spreadsheet's extracted text. */
export interface SpreadsheetCell {
  /** Zero-based column index: 0 is column `A`. */
  column: number;
  /** The column's letters, such as `A` or `AB`. */
  columnName: string;
  /** Whether the cell's column is hidden in the workbook. */
  hidden: boolean;
  /** The cell's value, then any `(formula: …)` and `(link: …)` notes. */
  text: string;
}

export interface SpreadsheetRow {
  /** The one-based row number in the sheet. */
  number: number;
  hidden: boolean;
  cells: SpreadsheetCell[];
}

export interface SpreadsheetSheet {
  name: string;
  hidden: boolean;
  /** The rows that have cells, in order. */
  rows: SpreadsheetRow[];
  /** The columns any row has a cell in, in order. */
  columns: { column: number; columnName: string; hidden: boolean }[];
  /** The sheet's comments and chart titles, one line each. */
  notes: string[];
}

const SHEET_LINE = /^# Sheet "((?:[^"\\]|\\.)*)"( \(hidden\))?$/;
const ROW_LINE = /^Row (\d+)( \(hidden\))?: (.*)$/;
// A cell starts with its column's letters, as in `B=` or `D (hidden)=`.
const CELL = /^([A-Z]{1,3})( \(hidden\))?=/;
const CELL_SEPARATOR = / \| (?=[A-Z]{1,3}(?: \(hidden\))?=)/;

/** A column's index from its letters: `A` is 0, `Z` 25 and `AA` 26. */
export const spreadsheetColumnIndex = (name: string): number =>
  [...name].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;

const unquote = (name: string) => name.replace(/\\(.)/g, "$1");

/**
 * Reads a spreadsheet's sheets from the text CalmLens extracts from it: a `# Sheet "name"` line
 * per sheet (marked `(hidden)` when it is), then a `Row 3: A=… | B=…` line per row that has cells,
 * then its comments and chart titles. A cell value that itself contains ` | B=` reads as two
 * cells. Text before the first sheet heading, as in a file that isn't a spreadsheet's text, reads
 * as one unnamed sheet's notes.
 */
export const parseSpreadsheetText = (text: string): SpreadsheetSheet[] => {
  const sheets: SpreadsheetSheet[] = [];
  let sheet: SpreadsheetSheet | undefined;
  const current = () => {
    if (!sheet) {
      sheet = { name: "", hidden: false, rows: [], columns: [], notes: [] };
      sheets.push(sheet);
    }
    return sheet;
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const heading = SHEET_LINE.exec(line);
    if (heading) {
      sheet = {
        name: unquote(heading[1]!),
        hidden: Boolean(heading[2]),
        rows: [],
        columns: [],
        notes: [],
      };
      sheets.push(sheet);
      continue;
    }
    const row = ROW_LINE.exec(line);
    const cells = row?.[3]?.split(CELL_SEPARATOR).map((part) => {
      const cell = CELL.exec(part);
      if (!cell) return undefined;
      const columnName = cell[1]!;
      return {
        column: spreadsheetColumnIndex(columnName),
        columnName,
        hidden: Boolean(cell[2]),
        text: part.slice(cell[0].length),
      };
    });
    if (row && cells?.every((cell) => cell !== undefined)) {
      current().rows.push({
        number: Number(row[1]),
        hidden: Boolean(row[2]),
        cells: cells as SpreadsheetCell[],
      });
    } else {
      current().notes.push(line);
    }
  }
  for (const { rows, columns } of sheets) {
    const seen = new Map<number, SpreadsheetSheet["columns"][number]>();
    for (const { cells } of rows) {
      for (const { column, columnName, hidden } of cells) {
        if (!seen.has(column)) seen.set(column, { column, columnName, hidden });
      }
    }
    columns.push(...[...seen.values()].sort((a, b) => a.column - b.column));
  }
  return sheets;
};

/** The rows of one page of a sheet, with their one-based positions among the sheet's rows. */
export const getSpreadsheetPage = (
  sheet: SpreadsheetSheet,
  page: number,
  pageSize: number,
): { rows: SpreadsheetRow[]; from: number; to: number; pages: number } => {
  const pages = Math.max(1, Math.ceil(sheet.rows.length / pageSize));
  const index = Math.min(Math.max(0, page), pages - 1);
  const rows = sheet.rows.slice(index * pageSize, (index + 1) * pageSize);
  return {
    rows,
    from: rows.length ? index * pageSize + 1 : 0,
    to: index * pageSize + rows.length,
    pages,
  };
};
