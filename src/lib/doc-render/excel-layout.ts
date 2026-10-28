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
  // a pageSetup without paperSize means Letter, the format's default (Excel leaves it out then);
  // with no pageSetup at all, the printer settings saved with the sheet, else A4
  const code = setup.paperSize ?? (setup.hasPageSetup ? 1 : (setup.printerPaper ?? 9));
  const name = PAPER_CODE[code] ?? "a4";
  const p = name === "a5" ? A5 : PAPER[name];
  const [width, height] = setup.landscape ? [p.height, p.width] : [p.width, p.height];
  // Excel's default "Normal" margins: 0.7in sides, 0.75in top and bottom
  const m = setup.margins ?? { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75 };
  const pt = (inches: number) => Math.max(0, Math.min(inches, 4)) * 72;
  return { width, height, margin: { left: pt(m.left), right: pt(m.right), top: pt(m.top), bottom: pt(m.bottom) } };
}

/** Print scale: the setup's percentage or fit-to-page. Columns that don't fit go on further pages. */
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

type Piece = { text: string; style: ReturnType<typeof style> };

/**
 * A cell's text as styled pieces, without its leading and trailing spaces: one piece in the cell's
 * font, or one per rich-text run (a run's own font replaces the cell's, as in Excel).
 */
function pieces(cell: GridCell, size: number, scale: number, family: Family): Piece[] {
  const base = style(size, family, cell);
  if (!cell.runs) return cell.text ? [{ text: cell.text, style: base }] : [];
  const out: Piece[] = cell.runs.map((r) => ({
    text: r.text,
    style: r.style
      ? { ...r.style, size: r.style.size ? r.style.size * scale : size, color: r.style.color, family: r.style.family }
      : base,
  }));
  // trim the cell's outer spaces across run boundaries
  while (out.length && !out[0].text.trimStart()) out.shift();
  while (out.length && !out[out.length - 1].text.trimEnd()) out.pop();
  if (out.length) {
    out[0] = { ...out[0], text: out[0].text.trimStart() };
    const last = out.length - 1;
    out[last] = { ...out[last], text: out[last].text.trimEnd() };
  }
  return out;
}

/** Text whose first letter is right-to-left (Urdu, Arabic, Hebrew), which General alignment sets right. */
const RTL_START = /^[^\p{L}]*[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;

/** The alignment a cell gets when it sets none (General): numbers right, TRUE/FALSE centred, text by its direction. */
function generalAlign(cell: GridCell, rtlSheet: boolean): Align {
  if (cell.centred) return "center";
  if (cell.num) return rtlSheet ? "left" : "right";
  return RTL_START.test(cell.text) || rtlSheet ? "right" : "left";
}

/** A right-to-left sheet as it prints: column A on the right, each cell's left and right edges swapped. */
function mirrored(rows: GridCell[][]): GridCell[][] {
  return rows.map((r) => {
    const n = r.length;
    const out: GridCell[] = r.map(() => ({ text: "", num: false, covered: true }));
    r.forEach((cell, c) => {
      if (cell.covered) return;
      const span = cell.colSpan ?? 1;
      const b = cell.style?.border;
      out[n - c - span] = b ? { ...cell, style: { ...cell.style, border: { ...b, left: b.right, right: b.left } } } : cell;
    });
    // covered cells that belong to merges from rows above keep their place, mirrored
    r.forEach((cell, c) => {
      if (cell.covered && !out[n - 1 - c].text && out[n - 1 - c].covered) out[n - 1 - c] = { ...cell };
    });
    return out;
  });
}

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
  // combining marks (Devanagari matras, accents) take no width of their own
  const chars = (t: string) => t.replace(/\p{M}/gu, "").length;
  const textWidth = (c: GridCell) =>
    sizeOf(c) * (leading(c) + 3 * (c.style?.indent ?? 0)) * SPACE_EM +
    pieces(c, sizeOf(c), scale, family).reduce(
      (w, p) => w + (p.style.size ?? 10) * chars(p.text) * CHAR_EM[p.style.family] * (p.style.bold ? 1.08 : 1),
      0,
    );

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

  // columns that print on one page across; Excel prints the next band of columns after all the
  // rows of this one (down, then over)
  const availW = spec.width - spec.margin.left - spec.margin.right;
  const rtl = !!sheet.setup.rtl;
  let bands: [number, number][] = [];
  for (let a = 0; a < colW.length; ) {
    let b = a + 1;
    let w = colW[a];
    while (b < colW.length && !sheet.breakCols.includes(b) && w + colW[b] <= availW + 0.01) w += colW[b++];
    bands.push([a, b]);
    a = b;
  }
  // a right-to-left sheet prints column A on the right: the same bands, mirrored, first band first
  if (rtl) {
    colW.reverse();
    bands = bands.map(([a, b]) => [colW.length - b, colW.length - a]);
  }

  // Excel draws one-line text past its cell into empty neighbours (right for left-aligned text, left
  // for right-aligned, both ways for centred) and cuts it at the first neighbour with content: span
  // the overflow here; the layout cuts what still doesn't fit.
  const rows = (rtl ? mirrored(grid.rows) : grid.rows).map((r) => r.map((c) => ({ ...c })));
  const empty = (c: GridCell | undefined) => !!c && !c.text && !c.covered && (c.colSpan ?? 1) === 1 && (c.rowSpan ?? 1) === 1;
  for (const r of rows) {
    for (let c = 0; c < r.length; c++) {
      const cell = r[c];
      const st = cell.style;
      if (!cell.text || cell.covered || st?.wrap || st?.shrink || st?.repeat || st?.rotate || cell.num || cell.centred) continue;
      if ((cell.rowSpan ?? 1) > 1) continue;
      const align = st?.align ?? generalAlign(cell, rtl);
      if (align === "justify") continue;
      const span = cell.colSpan ?? 1;
      const [lo, hi] = bands.find(([a, b]) => c >= a && c < b) ?? [0, r.length];
      let have = colW.slice(c, c + span).reduce((a, b) => a + b, 0);
      const need = textWidth(cell) + PAD_X * 2;
      if (need <= have) continue;
      let first = c;
      let next = c + span;
      if (align === "left") {
        while (need > have && next < hi && empty(r[next])) have += colW[next++];
      } else if (align === "right") {
        while (need > have && first > lo && empty(r[first - 1])) have += colW[--first];
      } else {
        // centred: grows evenly both ways while both neighbours are free
        while (need > have && first > lo && next < hi && empty(r[first - 1]) && empty(r[next])) have += colW[--first] + colW[next++];
      }
      if (first === c && next === c + span) continue;
      // the text keeps its cell's look; the outer edges come from the cells it now covers
      const left = first < c ? r[first].style?.border?.left : st?.border?.left;
      const right = next > c + span ? r[next - 1].style?.border?.right : st?.border?.right;
      // each cell keeps its own fill under the text that runs over it
      const fills = r.slice(first, next).map((k, i) => (first + i >= c && first + i < c + span ? st?.fill : k.style?.fill));
      const moved: GridCell = {
        ...cell,
        colSpan: next - first,
        style: { ...st, fill: undefined, border: { ...st?.border, left, right } },
        colFills: fills.some(Boolean) ? fills : undefined,
      };
      for (let k = first; k < next; k++) r[k] = { ...r[k], covered: true, text: "" };
      r[first] = moved;
      c = next - 1;
    }
  }

  const cellOf = (cell: GridCell, header: boolean, colSpan: number): Cell => {
    const st = cell.style;
    const size = sizeOf(cell);
    const text = cell.text;
    const align: Align = st?.align ?? generalAlign(cell, rtl);
    const stacked = st?.rotate === "stacked";
    const indent = text ? (leading(cell) * SPACE_EM + (align === "left" ? 3 * (st?.indent ?? 0) * SPACE_EM : 0)) * size : 0;
    const inlines: Inline[] = [];
    if (text) {
      for (const piece of pieces(cell, size, scale, family)) {
        const pieceStyle = cell.fmtColor ? { ...piece.style, color: cell.fmtColor } : piece.style;
        // stacked text: one letter (grapheme) per line
        const lines = stacked
          ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(piece.text.replace(/\s+/g, ""))].map((g) => g.segment)
          : st?.wrap
            ? piece.text.split(/\r?\n/)
            : [piece.text.replace(/\s*\r?\n\s*/g, " ")];
        lines.forEach((line, i) => {
          if (i) inlines.push({ kind: "br" });
          if (line) inlines.push({ kind: "text", text: line, style: pieceStyle });
        });
      }
      // trailing blank lines make Excel cells no taller than their row height
      while (inlines.length && inlines[inlines.length - 1].kind === "br") inlines.pop();
    }
    const b = st?.border;
    const oneLine = !st?.wrap && !stacked;
    return {
      header,
      colSpan,
      rowSpan: cell.rowSpan ?? 1,
      fill: st?.fill,
      edges: b ? { top: b.top, right: b.right, bottom: b.bottom, left: b.left } : undefined,
      valign: st?.valign ?? "bottom",
      rotate: typeof st?.rotate === "number" ? st.rotate : undefined,
      bar: cell.bar,
      colFills: cell.colFills,
      // an empty cell has no line of text, so it never makes its row taller than Excel's
      blocks: inlines.length
        ? [
            {
              kind: "para",
              inlines,
              align: stacked ? "center" : align,
              heading: 0,
              indent: Math.min(indent, 240),
              spacing: { before: 0, after: 0 },
              oneLine,
              fit: st?.shrink ? "shrink" : cell.num && oneLine ? (cell.general ? "round" : "hash") : undefined,
              repeat: st?.repeat || undefined,
              slack: st?.wrap ? 0.02 : undefined,
            },
          ]
        : [],
    };
  };

  // pictures: x scales with the columns; y is placed by row so it follows rows that grew
  const heights = sheet.rowHeights;
  const rowOf = (y: number) => {
    let r = 0;
    let top = 0;
    if (y < 0) return { row: 0, dy: y * scale };
    while (r < heights.length - 1 && top + heights[r] <= y) top += heights[r++];
    return { row: r, dy: (y - top) * scale };
  };
  const xs = [0];
  for (const w of colW) xs.push(xs[xs.length - 1] + w);

  // a band of columns with nothing to show (no text, fill, border or picture) prints no page, as in Excel
  const sheetW0 = xs[xs.length - 1];
  const inked = (a: number, b: number) =>
    rows.some((r) => r.slice(a, b).some((c) => c.text || c.style?.fill || c.style?.border || c.colFills?.some(Boolean))) ||
    sheet.pictures.some((p) => {
      const x = rtl ? sheetW0 / scale - p.x - p.w : p.x;
      return x * scale < xs[b] && (x + p.w) * scale > xs[a];
    });
  bands = bands.filter(([a, b]) => inked(a, b));
  bands.forEach(([a, b], bi) => {
    if (bi) out.push({ kind: "pagebreak" });
    const bandW = xs[b] - xs[a];
    const table: TableBlock = {
      kind: "table",
      rows: rows.map((r, ri): Row => {
        const header = sheet.titleRows.includes(ri);
        const cells: Cell[] = [];
        for (let c = a; c < b; c++) {
          const cell = r[c];
          if (cell.covered) {
            // a merge that starts in an earlier band continues here as an empty box
            if (c !== a) continue;
            let o = c - 1;
            while (o >= 0 && r[o].covered) o--;
            const origin = o >= 0 ? r[o] : undefined;
            if (!origin || o + (origin.colSpan ?? 1) <= c) continue;
            const span = Math.min(o + (origin.colSpan ?? 1), b) - c;
            cells.push({ ...cellOf({ ...origin, text: "", runs: undefined }, header, span) });
            c += span - 1;
            continue;
          }
          cells.push(cellOf(cell, header, Math.min(cell.colSpan ?? 1, b - c)));
        }
        return {
          header,
          cells,
          minHeight: (sheet.rowHeights[ri] ?? 15) * scale,
          exactHeight: true,
          autoFit: sheet.autoRows?.[ri] || undefined,
          breakBefore: sheet.breakRows.includes(ri) || undefined,
        };
      }),
      info: {
        grid: colW.slice(a, b),
        widthPt: bandW,
        borders: sheet.setup.gridLines ? GRIDLINE : null,
        fills: [],
        pad: { x: PAD_X, y: PAD_Y },
        offsetX: sheet.setup.centerH ? Math.max(0, (availW - bandW) / 2) : undefined,
      },
    };
    const sheetW = xs[xs.length - 1];
    table.pictures = sheet.pictures
      .map((p) => (rtl ? { ...p, x: sheetW / scale - p.x - p.w } : p))
      .filter((p) => p.x * scale < xs[b] && (p.x + p.w) * scale > xs[a])
      .map((p) => ({
        inlines: [{ kind: "image", data: p.data, mime: p.mime, width: p.w * scale, height: p.h * scale }],
        x: p.x * scale - xs[a],
        w: p.w * scale,
        top: rowOf(p.y),
        bottom: rowOf(p.y + p.h),
      }));
    out.push(table);
  });
  return out;
}
