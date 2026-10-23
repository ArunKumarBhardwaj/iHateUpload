/** Spreadsheet-like grids (CSV, Excel) -> blocks for the shared layout engine. */
import type { Align, Block, Cell, Row, TableBlock } from "../word-to-pdf/model";
import type { CellStyle } from "./excel-styles";

export interface GridCell {
  text: string;
  /** right-aligned numbers */
  num: boolean;
  /** the source cell's own formatting (Excel) */
  style?: CellStyle;
  /** merged cells: the top-left cell carries the span, the rest are covered */
  colSpan?: number;
  rowSpan?: number;
  covered?: boolean;
}

export interface Grid {
  rows: GridCell[][];
  /** column widths in spreadsheet characters, when the source says */
  colChars?: (number | undefined)[];
  /** the first row is a header, repeated on every page */
  header: boolean;
  /** the sheet has its own fills and fonts: draw those instead of the default header and stripes */
  styled?: boolean;
  /** font size the source's cell sizes are relative to */
  baseSize?: number;
}

const NUM_RE = /^[-+(]?[$€£¥₹]?\s?\d[\d,.\s]*%?\)?$/;
export const looksNumeric = (t: string) => t.length < 24 && NUM_RE.test(t.trim());

/** Split delimited text into rows. Handles quotes, doubled quotes and embedded newlines. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const d = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"' && cur === "") quoted = true;
    else if (c === d) {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((c) => !c.trim())) rows.pop();
  return rows;
}

function detectDelimiter(src: string): string {
  const head = src.split(/\r?\n/).slice(0, 5).join("\n");
  let best = ",";
  let bestN = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const n = head.split(d).length;
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

export function csvToGrid(text: string): Grid {
  const rows = parseCsv(text).map((r) => r.map((t) => ({ text: t.trim(), num: looksNumeric(t) })));
  return { rows, header: true };
}

export interface CsvView {
  sort: { col: number; dir: "asc" | "desc" } | null;
  filter: string;
  hidden: number[];
}

const asNumber = (t: string): number | undefined => {
  const s = t.trim();
  if (!s || !looksNumeric(s)) return undefined;
  const n = Number(s.replace(/[^0-9.+-eE]/g, "").replace(/^\+/, ""));
  return Number.isFinite(n) ? n * (/^\(.*\)$/.test(s) ? -1 : 1) : undefined;
};

/** The rows a person sees after sorting, searching and hiding columns. Row 0 is the header and stays first. */
export function applyCsvView(rows: string[][], view: CsvView): string[][] {
  if (!rows.length) return rows;
  const hidden = new Set(view.hidden);
  const [head, ...body] = rows;
  const needle = view.filter.trim().toLowerCase();
  let out = needle ? body.filter((r) => r.some((c, i) => !hidden.has(i) && c.toLowerCase().includes(needle))) : body;
  const s = view.sort;
  if (s && s.col >= 0 && s.col < Math.max(...rows.map((r) => r.length))) {
    const dir = s.dir === "asc" ? 1 : -1;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    out = [...out].sort((a, b) => {
      const x = a[s.col] ?? "";
      const y = b[s.col] ?? "";
      if (!x.trim() || !y.trim()) return (x.trim() ? -1 : y.trim() ? 1 : 0); // empties last either way
      const nx = asNumber(x);
      const ny = asNumber(y);
      return (nx !== undefined && ny !== undefined ? nx - ny : collator.compare(x, y)) * dir;
    });
  }
  const keep = (r: string[]) => (hidden.size ? r.filter((_, i) => !hidden.has(i)) : r);
  return [keep(head), ...out.map(keep)];
}

export function csvToGridView(text: string, view: CsvView): Grid {
  const rows = applyCsvView(parseCsv(text), view).map((r) => r.map((t) => ({ text: t.trim(), num: looksNumeric(t) })));
  return { rows, header: true };
}

export interface TableOptions {
  fontSize: number;
  zebra: boolean;
  /** usable page width in points */
  width: number;
  fit: "shrink" | "wrap";
  /** title printed above the table */
  title?: string;
}

const HEADER_FILL = "E5E7EB";
const ZEBRA_FILL = "F5F6F8";
const BORDER = { color: "C4C8CF", width: 0.5 };

function textStyle(size: number, bold: boolean) {
  return { bold, italic: false, underline: false, strike: false, size, family: "sans" as const };
}

/** Blocks for one grid: optional title, then a table whose header row repeats on every page. */
export function gridToBlocks(grid: Grid, opt: TableOptions): Block[] {
  const out: Block[] = [];
  let size = opt.fontSize;
  const cols = Math.max(1, ...grid.rows.map((r) => r.length));

  let widths: number[] | undefined;
  if (grid.colChars?.length) {
    const charW = 0.55;
    widths = Array.from({ length: cols }, (_, c) => {
      const ch = grid.colChars?.[c] ?? 8.43;
      // + both cell paddings (5.4pt each) and a little slack so a word that fits in Excel isn't broken here
      return Math.min(Math.max(ch * charW * size + 14, 22), 320);
    });
    const total = widths.reduce((a, b) => a + b, 0);
    if (total > opt.width && opt.fit === "shrink") size = Math.max(5, size * (opt.width / total));
  }

  if (opt.title) {
    out.push({
      kind: "para",
      inlines: [{ kind: "text", text: opt.title, style: textStyle(Math.max(12, opt.fontSize * 1.5), true) }],
      align: "left",
      heading: 1,
      indent: 0,
      spacing: { before: 0, after: 8 },
    });
  }
  if (!grid.rows.length) {
    out.push({
      kind: "para",
      inlines: [{ kind: "text", text: "(no data)", style: { ...textStyle(size, false), italic: true } }],
      align: "left",
      heading: 0,
      indent: 0,
    });
    return out;
  }

  const styled = !!grid.styled;
  const base = grid.baseSize ?? 11;
  const rows: Row[] = grid.rows.map((r, ri) => {
    const isHead = grid.header && ri === 0;
    const auto = styled ? undefined : isHead ? HEADER_FILL : opt.zebra && ri % 2 === (grid.header ? 0 : 1) ? ZEBRA_FILL : undefined;
    const cells: Cell[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = r[c];
      if (cell?.covered) continue;
      const st = cell?.style;
      const align: Align = st?.align ?? (cell?.num ? "right" : "left");
      const cellSize = st?.size ? Math.max(4, Math.min(size * 3, (size * st.size) / base)) : size;
      cells.push({
        header: isHead,
        colSpan: cell?.colSpan ?? 1,
        rowSpan: cell?.rowSpan ?? 1,
        fill: st?.fill ?? auto,
        blocks: [
          {
            kind: "para",
            inlines: cell?.text
              ? [
                  {
                    kind: "text",
                    text: cell.text,
                    style: {
                      ...textStyle(cellSize, !!st?.bold || (isHead && !styled)),
                      italic: !!st?.italic,
                      underline: !!st?.underline,
                      strike: !!st?.strike,
                      color: st?.color,
                    },
                  },
                ]
              : [],
            align,
            heading: 0,
            indent: 0,
          },
        ],
      });
    }
    return { header: isHead, cells };
  });
  const table: TableBlock = { kind: "table", rows };
  if (widths) {
    table.info = { grid: widths, widthPt: widths.reduce((a, b) => a + b, 0), borders: BORDER, fills: [] };
  }
  out.push(table);
  return out;
}
