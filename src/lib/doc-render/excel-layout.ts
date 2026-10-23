/**
 * Excel sheet -> blocks laid out the way Excel prints it: the sheet's own column widths, row heights,
 * fonts, borders and alignment at the page setup's scale, with text that doesn't wrap overflowing
 * into empty neighbours or clipped, as Excel does.
 */
import type { Align, Block, Cell, Family, Inline, Row, TableBlock } from "../word-to-pdf/model";
import type { PageSpec } from "../word-to-pdf/page";
import type { PageSetup } from "./excel-styles";
import { PAPER } from "./flow";
import type { Grid, GridCell } from "./tables";

/** Pixels per width unit: the maximum digit width of Excel's default fonts (Calibri 11, Arial 10). */
const PX_PER_UNIT = 7;
export const columnPt = (width: number) => width * PX_PER_UNIT * 0.75;

/** Excel's cell padding (about 2px each side) and the gridline colour it prints. */
const PAD_X = 1.5;
const PAD_Y = 0.5;
const GRIDLINE = { color: "BFBFBF", width: 0.25 };

/** Average advance of a character as a fraction of the font size, for overflow decisions. */
const CHAR_EM: Record<Family, number> = { sans: 0.52, serif: 0.48, mono: 0.6, carlito: 0.47, caladea: 0.48 };
const SPACE_EM = 0.278;

/** OOXML paperSize codes for the sizes the page builder knows; the rest print on A4. */
const PAPER_CODE: Record<number, string> = { 1: "letter", 2: "letter", 5: "legal", 8: "a3", 9: "a4", 10: "a4", 11: "a5" };
const A5 = { width: 419.53, height: 595.28 };

/** The page the sheet's setup asks for. */
export function sheetPageSpec(setup: PageSetup): PageSpec {
  const name = PAPER_CODE[setup.paperSize ?? 9] ?? "a4";
  const p = name === "a5" ? A5 : PAPER[name];
  const [width, height] = setup.landscape ? [p.height, p.width] : [p.width, p.height];
  // Excel's default "Normal" margins: 0.7in sides, 0.75in top and bottom
  const m = setup.margins ?? { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75 };
  const pt = (inches: number) => Math.max(0, Math.min(inches, 4)) * 72;
  return { width, height, margin: { left: pt(m.left), right: pt(m.right), top: pt(m.top), bottom: pt(m.bottom) } };
}

/** Print scale: the setup's percentage or fit-to-page, never wider than the page (columns don't split). */
export function sheetScale(grid: Grid, spec: PageSpec): number {
  const sheet = grid.sheet;
  if (!sheet) return 1;
  const w = sheet.colWidths.reduce((a, b) => a + columnPt(b), 0);
  const h = sheet.rowHeights.reduce((a, b) => a + b, 0);
  const availW = spec.width - spec.margin.left - spec.margin.right;
  const availH = spec.height - spec.margin.top - spec.margin.bottom;
  const st = sheet.setup;
  let s: number;
  if (st.fitToPage) {
    // OOXML defaults both to 1; 0 means "automatic" in that direction
    const fw = st.fitToWidth ?? 1;
    const fh = st.fitToHeight ?? 1;
    s = Math.min(1, fw > 0 && w > 0 ? (availW * fw) / w : 1, fh > 0 && h > 0 ? (availH * fh) / h : 1);
  } else {
    s = Math.max(10, Math.min(400, st.scale ?? 100)) / 100;
  }
  if (w * s > availW && w > 0) s = availW / w;
  return s;
}

const style = (size: number, family: Family, cell: GridCell | undefined, bold = false) => {
  const st = cell?.style;
  return {
    bold: bold || !!st?.bold,
    italic: !!st?.italic,
    underline: !!st?.underline,
    strike: !!st?.strike,
    color: st?.color,
    size,
    family: st?.family ?? family,
  };
};

/** Leading spaces in a cell push its text right, as they do in Excel. */
function leading(cell: GridCell): number {
  const raw = cell.raw ?? cell.text;
  return raw.length - raw.trimStart().length;
}

export function sheetToBlocks(grid: Grid, spec: PageSpec, title?: string): Block[] {
  const sheet = grid.sheet;
  if (!sheet) return [];
  const out: Block[] = [];
  const scale = sheetScale(grid, spec);
  const base = sheet.baseSize * scale;
  const family = sheet.baseFamily;
  const colW = sheet.colWidths.map((w) => columnPt(w) * scale);
  const sizeOf = (c: GridCell | undefined) => (c?.style?.size ?? sheet.baseSize) * scale;
  const em = (c: GridCell | undefined) => CHAR_EM[c?.style?.family ?? family] * (c?.style?.bold ? 1.08 : 1);
  // combining marks (Devanagari matras, accents) take no width of their own
  const textWidth = (c: GridCell) => sizeOf(c) * (leading(c) * SPACE_EM + c.text.replace(/\p{M}/gu, "").length * em(c));

  if (title) {
    out.push({
      kind: "para",
      inlines: [{ kind: "text", text: title, style: { ...style(Math.max(12, base * 1.4), family, undefined, true) } }],
      align: "left",
      heading: 1,
      indent: 0,
      spacing: { before: 0, after: 8 },
    });
  }
  if (!grid.rows.length) return out;

  // Excel draws one-line text past its cell into empty cells to the right and cuts it off at the
  // first neighbour with content: span the overflow here; the layout cuts what still doesn't fit.
  const rows = grid.rows.map((r) => r.map((c) => ({ ...c })));
  for (const r of rows) {
    for (let c = 0; c < r.length; c++) {
      const cell = r[c];
      if (!cell.text || cell.covered || cell.style?.wrap || cell.num) continue;
      const align = cell.style?.align;
      if (align && align !== "left") continue;
      const span = cell.colSpan ?? 1;
      let have = colW.slice(c, c + span).reduce((a, b) => a + b, 0);
      const need = textWidth(cell) + PAD_X * 2;
      if (need <= have) continue;
      let next = c + span;
      if ((cell.rowSpan ?? 1) === 1) {
        while (need > have && next < r.length && !r[next].text && !r[next].covered && (r[next].colSpan ?? 1) === 1) {
          have += colW[next];
          next++;
        }
      }
      if (next > c + span) {
        for (let k = c + span; k < next; k++) r[k].covered = true;
        // the cell keeps its own left edge and takes the right edge of the last cell it covers
        const right = r[next - 1].style?.border?.right;
        cell.colSpan = next - c;
        cell.style = { ...cell.style, border: { ...cell.style?.border, right } };
      }
    }
  }

  const table: TableBlock = {
    kind: "table",
    rows: rows.map((r, ri): Row => {
      const header = sheet.titleRows.includes(ri);
      const cells: Cell[] = [];
      r.forEach((cell) => {
        if (cell.covered) return;
        const st = cell.style;
        const size = sizeOf(cell);
        const text = cell.text;
        const indent = text ? leading(cell) * SPACE_EM * size : 0;
        const inlines: Inline[] = [];
        if (text) {
          const lines = st?.wrap ? text.split(/\r?\n/) : [text.replace(/\s*\r?\n\s*/g, " ")];
          // trailing blank lines make Excel cells no taller than their row height
          while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
          lines.forEach((line, i) => {
            if (i) inlines.push({ kind: "br" });
            if (line) inlines.push({ kind: "text", text: line, style: style(size, family, cell) });
          });
        }
        const align: Align = st?.align ?? (cell.num ? "right" : "left");
        const b = st?.border;
        cells.push({
          header,
          colSpan: cell.colSpan ?? 1,
          rowSpan: cell.rowSpan ?? 1,
          fill: st?.fill,
          edges: b ? { top: b.top, right: b.right, bottom: b.bottom, left: b.left } : undefined,
          valign: st?.valign ?? "bottom",
          blocks: [
            { kind: "para", inlines, align, heading: 0, indent: Math.min(indent, 240), spacing: { before: 0, after: 0 }, oneLine: !st?.wrap },
          ],
        });
      });
      return { header, cells, minHeight: (sheet.rowHeights[ri] ?? 15) * scale };
    }),
    info: {
      grid: colW,
      widthPt: colW.reduce((a, b) => a + b, 0),
      borders: sheet.setup.gridLines ? GRIDLINE : null,
      fills: [],
      pad: { x: PAD_X, y: PAD_Y },
    },
  };
  out.push(table);
  return out;
}
