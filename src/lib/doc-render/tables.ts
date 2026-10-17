/** Spreadsheet-like grids (CSV, Excel) -> blocks for the shared layout engine. */
import type { Align, Block, Cell, Row, TableBlock } from "../word-to-pdf/model";

export interface GridCell {
  text: string;
  /** right-aligned numbers */
  num: boolean;
}

export interface Grid {
  rows: GridCell[][];
  /** column widths in spreadsheet characters, when the source says */
  colChars?: (number | undefined)[];
  /** the first row is a header, repeated on every page */
  header: boolean;
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
      return Math.min(Math.max(ch * charW * size + 10, 22), 320);
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

  const rows: Row[] = grid.rows.map((r, ri) => {
    const isHead = grid.header && ri === 0;
    const fill = isHead ? HEADER_FILL : opt.zebra && ri % 2 === (grid.header ? 0 : 1) ? ZEBRA_FILL : undefined;
    const cells: Cell[] = Array.from({ length: cols }, (_, c) => {
      const cell = r[c];
      const align: Align = cell?.num && !isHead ? "right" : isHead && cell?.num ? "right" : "left";
      return {
        header: isHead,
        colSpan: 1,
        rowSpan: 1,
        fill,
        blocks: [
          {
            kind: "para",
            inlines: cell?.text ? [{ kind: "text", text: cell.text, style: textStyle(size, isHead) }] : [],
            align,
            heading: 0,
            indent: 0,
          },
        ],
      };
    });
    return { header: isHead, cells };
  });
  const table: TableBlock = { kind: "table", rows };
  if (widths) {
    table.info = { grid: widths, widthPt: widths.reduce((a, b) => a + b, 0), borders: BORDER, fills: [] };
  }
  out.push(table);
  return out;
}
