/**
 * Bank statements. The generic table finder looks for rules and aligned blocks; statements beat it
 * because a narration wraps over several lines, many have no rules at all, a header may only be
 * printed on page one, and amounts carry Dr/Cr. This reader finds the header row by its words
 * (Date, Narration, Withdrawal, Deposit, Balance ...), takes the columns from it, starts a
 * transaction at each date, folds wrapped lines into it, follows the table over pages, and then
 * checks every running balance. Pure: works on page inputs, no DOM.
 */
import { parseCell } from "./cells";
import type { Grid, GridCellData } from "./grid";
import type { PageInput, TextItem } from "../pdf-to-word/lines";

export type Role = "date" | "valueDate" | "narration" | "ref" | "debit" | "credit" | "amount" | "drcr" | "balance" | "serial" | "other";

type Chunk = { text: string; x0: number; x1: number; y: number; size: number; bold: boolean };
type Row = { y: number; top: number; bottom: number; size: number; chunks: Chunk[] };
type Column = { label: string; role: Role; x0: number; x1: number };
type Layout = { cols: Column[]; bounds: number[] };
type Rec = { page: number; cells: string[][]; lines: Chunk[][][]; y: number };

export type BalanceCheck = { checked: number; failed: number[]; direction: "up" | "down" | null };
export type Statement = {
  grid: Grid;
  /** Per page, the band the transactions took, so the generic finder leaves it alone. */
  regions: Map<number, { y0: number; y1: number }>;
  check: BalanceCheck;
  transactions: number;
  notes: string[];
  /** The bank's own summary box (opening, counts, totals, closing), as a small table. */
  summary?: Grid;
  /**
   * Everything around the transactions, once: what the first page says above the table (account
   * holder, account number, period) as label and value, the bank's summary, the lines after it.
   */
  details?: Grid;
};

/** The figures a statement's summary box gives, by what they mean. */
type Summary = { page: number; y0: number; y1: number; labels: string[]; values: string[] };

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Items to chunks: pieces of text on one baseline that touch, then split on wide runs of spaces. */
export function rowsOf(items: TextItem[]): Row[] {
  const clean = items.filter((i) => i.str.trim() && Number.isFinite(i.x) && Number.isFinite(i.y)).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: { y: number; size: number; items: TextItem[] }[] = [];
  for (const it of clean) {
    const size = it.size > 0 ? it.size : 8;
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 0.35 * Math.max(r.size, size));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, size, items: [it] });
  }
  return rows
    .map((r) => {
      const chunks: Chunk[] = [];
      for (const it of r.items.sort((a, b) => a.x - b.x)) {
        const size = it.size > 0 ? it.size : 8;
        const last = chunks[chunks.length - 1];
        const gap = last ? it.x - last.x1 : Infinity;
        // Up to a wide space apart is one piece (Courier spaces are 0.6 em); columns sit further apart.
        if (last && gap < 0.7 * size && !/\s{2,}$/.test(last.text)) {
          last.text += gap > 0.12 * size && !/\s$/.test(last.text) && !/^\s/.test(it.str) ? ` ${it.str}` : it.str;
          last.x1 = Math.max(last.x1, it.x + it.w);
          last.bold &&= it.bold;
        } else chunks.push({ text: it.str, x0: it.x, x1: it.x + it.w, y: it.y, size, bold: it.bold });
      }
      const split = chunks.flatMap((c) => splitOnSpaces(c, /\s{2,}/));
      return { y: r.y, top: r.y - r.size, bottom: r.y + r.size * 0.25, size: r.size, chunks: split.filter((c) => c.text.trim()) };
    })
    .filter((r) => r.chunks.length)
    .sort((a, b) => a.y - b.y);
}

/** Cuts a chunk at whitespace matching re, placing each piece by its share of the characters. */
function splitOnSpaces(c: Chunk, re: RegExp): Chunk[] {
  const text = c.text;
  const per = (c.x1 - c.x0) / Math.max(1, text.length);
  const out: Chunk[] = [];
  let start = 0;
  const g = new RegExp(re.source, "g");
  for (let m = g.exec(text); m; m = g.exec(text)) {
    if (m.index > start) out.push(piece(c, text, start, m.index, per));
    start = m.index + m[0].length;
  }
  if (start === 0) {
    // A piece printed with a leading space starts where its first letter does.
    const lead = text.length - text.trimStart().length;
    return [{ ...c, text: text.trim(), x0: c.x0 + lead * per }];
  }
  if (start < text.length) out.push(piece(c, text, start, text.length, per));
  return out;
}
const piece = (c: Chunk, text: string, a: number, b: number, per: number): Chunk => ({
  ...c,
  text: text.slice(a, b).trim(),
  x0: c.x0 + a * per,
  x1: c.x0 + b * per,
});

export function roleOf(label: string): Role {
  const l = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (/\bdr\s*\/\s*cr\b|\bcr\s*\/\s*dr\b|^(txn |tran )?type$|^d\/c$/.test(l)) return "drcr";
  if (/bal/.test(l)) return "balance";
  if (/value/.test(l) && /date|dt/.test(l)) return "valueDate";
  if (/withdraw|debit|paid out|money out|\bdr\b/.test(l)) return "debit";
  if (/deposit|credit|paid in|money in|\bcr\b/.test(l)) return "credit";
  if (/amount|\bamt\b/.test(l)) return "amount";
  if (/date|^dt\.?$|\bdt\b/.test(l)) return "date";
  if (/chq|cheque|check|\bref|instrument|utr/.test(l)) return "ref";
  if (/narration|description|particular|remark|details|transaction|txn/.test(l)) return "narration";
  if (/^(s\.? ?no|sr\.? ?no|sl\.? ?no|#|no)\.?$/.test(l)) return "serial";
  return "other";
}

const DATE_START = /^(\d{1,2}[-/. ](\d{1,2}|[A-Za-z]{3,9})\b|\d{4}-\d{2}-\d{2}|[A-Za-z]{3} \d{1,2},)/;
const OPENING = /opening balance|balance b\/?f|brought forward|balance forward|b\/f/i;
const END = /^(closing balance|statement summary|summary|grand total|total\b|end of statement|\*{3}|page\s*(no\.?)?\s*:?\s*\d+(\s*of\s*\d+)?$|this is a (computer|system) generated)/i;

/**
 * In a ruled table each cell may hold several lines, centred or not, so the rows between two
 * full-width rules are one row of the table.
 */
function banded(rows: Row[], rules: PageInput["rules"], width: number): Row[] {
  const ys = rules
    .filter((r) => Math.abs(r.y1 - r.y0) < 1.5 && r.x1 - r.x0 >= width * 0.4)
    .map((r) => (r.y0 + r.y1) / 2)
    .sort((a, b) => a - b)
    .filter((y, i, all) => i === 0 || y - all[i - 1] > 1.5);
  if (ys.length < 4) return rows;
  const bandOf = (r: Row) => ys.findIndex((y, i) => i < ys.length - 1 && r.top + r.size * 0.3 > y && r.y < ys[i + 1]);
  // A box around the whole table (address boxes above it make the page look ruled) holds many
  // transactions; a band with two rows that start with a date is not one row of a ruled table.
  const dated = new Map<number, number>();
  for (const r of rows) if (DATE_START.test(r.chunks[0].text)) dated.set(bandOf(r), (dated.get(bandOf(r)) ?? 0) + 1);
  const out: Row[] = [];
  let open: { band: number; row: Row } | null = null;
  for (const r of rows) {
    const b = bandOf(r);
    const k = (dated.get(b) ?? 0) >= 2 ? -1 : b;
    if (k >= 0 && open && open.band === k) {
      open.row.chunks.push(...r.chunks);
      open.row.bottom = Math.max(open.row.bottom, r.bottom);
      continue;
    }
    const row = { ...r, chunks: [...r.chunks] };
    out.push(row);
    open = k >= 0 ? { band: k, row } : null;
  }
  return out;
}

/** The chunks of one cell, one array per printed line, top to bottom. */
function visualLines(cs: Chunk[]): Chunk[][] {
  const lines: Chunk[][] = [];
  for (const c of [...cs].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    const line = lines.find((l) => Math.abs(l[0].y - c.y) <= 0.35 * c.size);
    if (line) line.push(c);
    else lines.push([c]);
  }
  return lines;
}

/** Clusters header chunks spread over up to three rows into columns by overlap. */
function headerColumns(rows: Row[]): Column[] {
  const chunks = rows.flatMap((r) => r.chunks).sort((a, b) => a.x0 - b.x0);
  const groups: Chunk[][] = [];
  for (const c of chunks) {
    const g = groups.find((g) => g.some((o) => c.x0 < o.x1 + 1 && c.x1 > o.x0 - 1));
    if (g) g.push(c);
    else groups.push([c]);
  }
  return groups
    .map((g) => {
      const label = g.sort((a, b) => a.y - b.y || a.x0 - b.x0).map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
      return { label, role: roleOf(label), x0: Math.min(...g.map((c) => c.x0)), x1: Math.max(...g.map((c) => c.x1)) };
    })
    .sort((a, b) => a.x0 - b.x0);
}

function goodHeader(cols: Column[]): boolean {
  const roles = new Set(cols.map((c) => c.role));
  const dated = roles.has("date") || roles.has("valueDate");
  const money = roles.has("debit") || roles.has("credit") || roles.has("amount");
  const known = cols.filter((c) => c.role !== "other").length;
  // A running balance, a Dr/Cr column or both Debit and Credit: an invoice's Date | Item | Amount is not a statement.
  const ledger = roles.has("balance") || roles.has("drcr") || (roles.has("debit") && roles.has("credit"));
  return dated && money && ledger && known >= 3 && known >= cols.length * 0.6;
}

/** The first band of one to three rows that reads as a statement header. */
function findHeader(rows: Row[]): { at: number; end: number; cols: Column[] } | null {
  for (let i = 0; i < rows.length; i++) {
    for (let n = 1; n <= 3 && i + n <= rows.length; n++) {
      const band = rows.slice(i, i + n);
      if (n > 1 && band[n - 1].y - band[n - 2].y > band[0].size * 2.2) break;
      const cols = headerColumns(band);
      if (cols.length >= 3 && goodHeader(cols)) return { at: i, end: i + n, cols };
    }
  }
  return null;
}

const isMoney = (role: Role) => role === "debit" || role === "credit" || role === "amount" || role === "balance";

/** Column edges: first from the header alone, then moved into the gaps the data leaves. */
function layoutFor(cols: Column[], data: Row[], rules: PageInput["rules"]): Layout {
  const n = cols.length;
  let bounds = [-Infinity];
  for (let i = 1; i < n; i++) bounds.push((cols[i - 1].x1 + cols[i].x0) / 2);
  bounds.push(Infinity);

  // Vertical rules through the header give exact edges.
  const verticals = rules.filter((r) => Math.abs(r.x1 - r.x0) < 1.5 && r.y1 - r.y0 > 8).map((r) => r.x0);
  if (verticals.length >= n - 1) {
    for (let i = 1; i < n; i++) {
      const between = verticals.filter((x) => x >= cols[i - 1].x1 - 1 && x <= cols[i].x0 + 1);
      if (between.length) bounds[i] = median(between);
    }
    return { cols, bounds };
  }

  const owner = (c: Chunk) => {
    for (let i = 0; i < n; i++) if (c.x0 >= bounds[i] - 0.5 && c.x1 <= bounds[i + 1] + 0.5) return i;
    return -1;
  };
  const right = Array.from({ length: n }, () => -Infinity);
  const left = Array.from({ length: n }, () => Infinity);
  for (const r of data) {
    for (const c of r.chunks) {
      const i = owner(c);
      if (i < 0) continue;
      right[i] = Math.max(right[i], c.x1);
      left[i] = Math.min(left[i], c.x0);
    }
  }
  const next = [...bounds];
  for (let i = 1; i < n; i++) {
    const lo = Math.max(right[i - 1], cols[i - 1].x1);
    const hi = Math.min(left[i], cols[i].x0);
    if (!(lo < hi)) continue;
    // A left-aligned column starts where its text starts; a right-aligned one ends where it ends.
    next[i] = isMoney(cols[i].role) ? (lo + hi) / 2 : hi - 0.5;
  }
  bounds = next;
  return { cols, bounds };
}

/** Each chunk into a column; a chunk across an edge is cut at the space nearest it. */
function place(row: Row, layout: Layout): Chunk[][] {
  const { bounds } = layout;
  const n = layout.cols.length;
  const out: Chunk[][] = Array.from({ length: n }, () => []);
  const overlap = (c: Chunk, i: number) => Math.max(0, Math.min(c.x1, bounds[i + 1]) - Math.max(c.x0, bounds[i]));
  for (const c of row.chunks) {
    const width = Math.max(0.1, c.x1 - c.x0);
    let best = 0;
    for (let i = 1; i < n; i++) if (overlap(c, i) > overlap(c, best)) best = i;
    if (overlap(c, best) >= width - 0.5 * c.size || !/\s/.test(c.text)) {
      out[best].push(c);
      continue;
    }
    const words = splitOnSpaces(c, /\s+/);
    let cur: Chunk | null = null;
    let col = -1;
    for (const w of words) {
      const mid = (w.x0 + w.x1) / 2;
      const i = Math.max(0, bounds.findIndex((b, k) => k < n && mid >= b && mid < bounds[k + 1]));
      if (cur && i === col) {
        cur.text += ` ${w.text}`;
        cur.x1 = w.x1;
      } else {
        if (cur) out[col].push(cur);
        cur = { ...w };
        col = i;
      }
    }
    if (cur) out[col].push(cur);
  }
  return out;
}

/** "12,345.00 Cr" to a signed number; Dr is money out. Null when it is not an amount. */
export function amountOf(text: string): { value: number; side?: "dr" | "cr" } | null {
  let s = text.replace(/\s+/g, " ").trim();
  if (!s || s === "-" || s === "--") return null;
  let side: "dr" | "cr" | undefined;
  const tag = /^(.*?\d)\s*\(?\s*(cr|dr)\.?\s*\)?$/i.exec(s);
  if (tag) {
    side = tag[2].toLowerCase() as "dr" | "cr";
    s = tag[1];
  }
  const t = parseCell(s);
  if (t.kind !== "number") return null;
  return { value: t.value, side };
}

const money = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

type Cut = { width: number; left: number };
type Logical = { text: string; lead: boolean };

/** Where most lines of a column start. */
function commonLeft(lines: Chunk[][]): number {
  const counts = new Map<number, number>();
  for (const l of lines) {
    const x = Math.round(l[0].x0 * 2) / 2;
    counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

/**
 * The lines the bank's system wrote, before the PDF wrapped them again to fit the cell. HDFC
 * cuts narration every 40 characters, then word-wraps a piece too wide for the cell and starts
 * the wrapped part half a character left of the column; a piece that began with a space starts
 * one space right.
 */
function logicalLines(lines: Chunk[][], left: number): Logical[] {
  const out: Logical[] = [];
  for (const line of lines) {
    const text = lineString(line);
    const x = line[0].x0;
    const size = line[0].size;
    const last = out[out.length - 1];
    if (last && x < left - 0.25 * size) last.text += ` ${text}`;
    else out.push({ text, lead: x > left + 0.15 * size && x < left + 1.2 * size });
  }
  return out;
}
const logicalLength = (l: Logical) => l.text.length + (l.lead ? 1 : 0);

/**
 * Wrapped lines of one column, joined. Core-banking systems that cut every N characters split
 * words, so lines run straight on, unless the cut fell on a space: then the next line starts a
 * space in, or the line before ends a character short.
 */
function joinLines(lines: Chunk[][], cut: Cut | null, role: Role): string {
  let out = "";
  if (cut) {
    logicalLines(lines, cut.left).forEach((l, k, all) => {
      if (!k) out = l.text;
      else out += l.lead || logicalLength(all[k - 1]) < cut.width ? ` ${l.text}` : l.text;
    });
    return out.replace(/\s+/g, " ").trim();
  }
  lines.forEach((line) => {
    const text = lineString(line);
    if (!out) return (out = text);
    // A reference too long for its cell carries on below: "HDFCR52026100166" then "282512".
    if (role === "ref" && /^[A-Za-z0-9]+$/.test(text) && /[A-Za-z0-9]{8}$/.test(out) && !/\s/.test(out)) out += text;
    else if ((/[/\-@_:]$/.test(out) && !/\s[/\-]$/.test(out)) || /^[/\-@_]/.test(text)) out += text;
    else out += ` ${text}`;
  });
  return out.replace(/\s+/g, " ").trim();
}

/** Where and how wide the lines of a column are cut, when they are cut by count; else null. */
function cutOf(recs: Rec[], col: number): Cut | null {
  const left = commonLeft(recs.flatMap((r) => r.lines[col]));
  const lens: number[] = [];
  const texts = new Set<string>();
  for (const r of recs) {
    const lines = logicalLines(r.lines[col], left);
    for (let k = 0; k < lines.length - 1; k++) {
      lens.push(logicalLength(lines[k]));
      texts.add(lines[k].text);
    }
  }
  // The same words wrapped the same way every time ("TRANSFER FROM") are not a cut.
  if (lens.length < 3 || texts.size < lens.length * 0.5) return null;
  const counts = new Map<number, number>();
  for (const l of lens) counts.set(l, (counts.get(l) ?? 0) + 1);
  const [mode] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  const hits = lens.filter((l) => l === mode || l === mode - 1).length;
  if (mode < 12 || hits < lens.length * 0.8 || counts.get(mode)! < lens.length * 0.5) return null;
  return { width: mode, left };
}

const lineString = (line: Chunk[]) => line.map((c) => c.text).join(" ");

function dateCol(cols: Column[]): number {
  const i = cols.findIndex((c) => c.role === "date");
  return i >= 0 ? i : cols.findIndex((c) => c.role === "valueDate");
}

/** Repeated top and bottom lines, digits aside: running headers, footers, page numbers. */
function furnitureKeys(pages: Row[][], heights: number[]): Set<string> {
  const seen = new Map<string, number>();
  const key = (r: Row) => r.chunks.map((c) => c.text).join(" ").replace(/\d+/g, "#").toLowerCase();
  pages.forEach((rows, p) => {
    const keys = new Set(rows.filter((r) => r.y < heights[p] * 0.12 || r.y > heights[p] * 0.9).map(key));
    for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1);
  });
  return new Set([...seen].filter(([, n]) => n >= 2).map(([k]) => k));
}

/** Walks the pages, building one record per transaction. */
export function detectStatement(inputs: PageInput[], pageNumbers: number[]): Statement | null {
  const pages = inputs.map((p) => banded(rowsOf(p.items), p.rules, p.width));
  const furniture = furnitureKeys(pages, inputs.map((p) => p.height));
  const isFurniture = (r: Row) => furniture.has(r.chunks.map((c) => c.text).join(" ").replace(/\d+/g, "#").toLowerCase());
  const recs: Rec[] = [];
  const regions = new Map<number, { y0: number; y1: number }>();
  let layout: Layout | null = null;
  let headerLabels: Column[] | null = null;
  let pitch = 0;
  let summary: Summary | undefined;

  for (let p = 0; p < pages.length; p++) {
    const rows = pages[p];
    const head = findHeader(rows);
    let start: number;
    let y0: number;
    if (head) {
      if (headerLabels && head.cols.length !== headerLabels.length) {
        // A different table (a summary, say) after the statement: stop here.
        if (recs.length) break;
      }
      const data = rows.slice(head.end).filter((r) => !isFurniture(r));
      layout = layoutFor(head.cols, data.slice(0, 80), inputs[p].rules);
      headerLabels ??= head.cols;
      start = head.end;
      y0 = rows[head.at].top - 2;
    } else if (layout && recs.length) {
      // No header on this page: carry the columns over, from the first row with a date in place.
      const dc = dateCol(layout.cols);
      start = rows.findIndex((r) => !isFurniture(r) && place(r, layout!)[dc].some((c) => DATE_START.test(c.text)));
      if (start < 0) {
        // The summary box may sit alone on the page after the last transaction.
        const found = summary ? null : summaryOf(rows.filter((r) => !isFurniture(r)), pageNumbers[p]);
        if (found) {
          summary = found;
          regions.set(pageNumbers[p], { y0: found.y0, y1: found.y1 });
          break;
        }
        continue;
      }
      y0 = rows[start].top - 2;
    } else continue;

    const dc = dateCol(layout.cols);
    const balanceCol = layout.cols.findIndex((c) => c.role === "balance");
    const sc = layout.cols.findIndex((c) => c.role === "serial");
    const textCol = (i: number) => !isMoney(layout!.cols[i].role) && layout!.cols[i].role !== "drcr";
    let last = rows[start - 1]?.y ?? rows[start]?.y ?? 0;
    let y1 = y0;
    // When the table is drawn in a box, a line below the box's sides is page footer, not data.
    const firstY = rows[start]?.y ?? 0;
    const sides = inputs[p].rules.filter((r) => Math.abs(r.x1 - r.x0) < 1.5 && r.y1 - r.y0 > 40 && r.y0 <= firstY && r.y1 >= firstY);
    const boxBottom = sides.length ? Math.max(...sides.map((r) => r.y1)) : Infinity;
    let opened = false;
    let here = false;
    const gaps: number[] = [];
    let stop = rows.length;
    for (let k = start; k < rows.length; k++) {
      const row = rows[k];
      // Running headers sit above the first transaction; below it the same words are data.
      if (!here && isFurniture(row)) continue;
      const text = row.chunks.map((c) => c.text).join(" ");
      const cells = place(row, layout);
      const dated = cells[dc].some((c) => DATE_START.test(c.text)) || (sc >= 0 && cells[sc].some((c) => /^\d+$/.test(c.text)) && cells[dc].length > 0);
      const gap = row.y - last;
      const limit = Math.max(row.size * 4.5, (pitch || row.size * 1.6) * 3.2);
      if (!dated && (END.test(text.trim()) || (opened && gap > limit) || row.top > boxBottom)) {
        stop = k;
        break;
      }
      const amounts = cells.some((cs, i) => isMoney(layout!.cols[i].role) && cs.some((c) => amountOf(c.text)));
      const opening = !dated && OPENING.test(text) && amounts;
      const onlyText = cells.every((cs, i) => !cs.length || textCol(i));
      if (dated || opening) {
        recs.push({ page: pageNumbers[p], y: row.y, cells: [], lines: cells.map(visualLines) });
        opened = true;
        here = true;
      } else if (recs.length && onlyText && (opened || gap < row.size * 3)) {
        const r = recs[recs.length - 1];
        cells.forEach((cs, i) => r.lines[i].push(...visualLines(cs)));
      } else if (!opened) {
        continue;
      } else {
        stop = k;
        break;
      }
      if (opened && k > start) gaps.push(gap);
      last = row.y;
      y1 = row.bottom + 2;
    }
    if (gaps.length) pitch = median(gaps);
    if (opened || recs.some((r) => r.page === pageNumbers[p])) regions.set(pageNumbers[p], { y0, y1 });
    if (balanceCol < 0 && dc < 0) break;
    // The bank's summary box right under the last transaction ends the statement.
    if (recs.length && stop < rows.length) {
      const found = summaryOf(rows.slice(stop, stop + 8), pageNumbers[p]);
      if (found) {
        summary = found;
        const band = regions.get(pageNumbers[p]);
        regions.set(pageNumbers[p], { y0: band?.y0 ?? found.y0, y1: Math.max(band?.y1 ?? 0, found.y1) });
        break;
      }
    }
  }
  if (!layout || !headerLabels || recs.length < 2) return null;
  const out = build(recs, layout, regions, pageNumbers, summary);
  const key = (r: Row) => r.chunks.map((c) => c.text).join(" ").replace(/\s+/g, " ").toLowerCase();
  const p0 = pageNumbers.indexOf(recs[0].page);
  const top = regions.get(recs[0].page)?.y0 ?? 0;
  // Every page repeats the account block, so it reads as page furniture; on the first page it is the point.
  // Lines as printed: a box round the address must not merge its lines into one.
  const plain = inputs.map((p) => rowsOf(p.items));
  const above = plain[p0].filter((r) => r.y < top && !/^page\b/i.test(key(r)) && !(isFurniture(r) && r.y > inputs[p0].height * 0.5));
  const seen = new Set(above.map(key));
  const lastPage = recs[recs.length - 1].page;
  const after: Row[] = [];
  plain.forEach((rows, p) => {
    const page = pageNumbers[p];
    if (page < lastPage) return;
    const from = summary && summary.page === page ? summary.y1 : page === lastPage ? (regions.get(page)?.y1 ?? 0) : -Infinity;
    for (const r of rows) if (r.y > from && !isFurniture(r) && !seen.has(key(r))) after.push(r);
  });
  out.details = detailsGrid(fieldsOf(above, inputs[p0].width), out.summary, fieldsOf(after, inputs[p0].width), recs[0].page);
  return out;
}

/**
 * "Label : value" pairs and plain lines, the left half of the page first, then the right.
 * A value that wraps carries on in the rows under it, starting where it started.
 */
export function fieldsOf(rows: Row[], width: number): string[][] {
  const out: string[][] = [];
  for (const left of [true, false]) {
    let open: { cells: string[]; x: number; y: number } | null = null;
    for (const r of rows) {
      const cs = r.chunks.filter((c) => (c.x0 < width * 0.5) === left);
      let inRow: string[] | null = null;
      let line: string[] | null = null;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        const t = c.text.trim();
        const next = cs[i + 1];
        const m = /^([^:]{1,40}?)\s*:\s*(.*)$/.exec(t);
        if (next && /^:/.test(next.text) && !t.includes(":")) {
          inRow = [t, next.text.replace(/^:\s*/, "").trim()];
          out.push(inRow);
          open = { cells: inRow, x: next.x0, y: r.y };
          line = null;
          i++;
        } else if (m && /[A-Za-z]/.test(m[1]) && !/https?$/i.test(m[1])) {
          inRow = [m[1].trim(), m[2].trim()];
          out.push(inRow);
          const per = (c.x1 - c.x0) / Math.max(1, t.length);
          open = { cells: inRow, x: c.x0 + (t.length - m[2].length) * per, y: r.y };
          line = null;
        } else if (inRow) {
          inRow[1] = `${inRow[1]} ${t}`.trim();
        } else if (open && !line && Math.abs(c.x0 - open.x) < 1.5 * c.size && r.y - open.y < r.size * 1.7) {
          open.cells[1] = `${open.cells[1]} ${t}`.trim();
          open.y = r.y;
        } else if (line) {
          line[0] = `${line[0]} ${t}`;
        } else {
          line = [t];
          out.push(line);
          open = null;
        }
      }
    }
  }
  return out;
}

function detailsGrid(before: string[][], summary: Grid | undefined, after: string[][], page: number): Grid | undefined {
  const rows: GridCellData[][] = [];
  const cell = (text: string, bold = false): GridCellData => ({ text, bold, borders: {}, rowSpan: 1, colSpan: 1 });
  const pairs = (list: string[][]) => list.forEach((r) => rows.push(r.length > 1 ? [cell(r[0], true), cell(r[1])] : [cell(r[0])]));
  pairs(before);
  if (summary) {
    if (rows.length) rows.push([]);
    rows.push([cell(summary.heading ?? "Summary", true)]);
    summary.rows.forEach((r, k) => rows.push(r.map((c) => ({ ...c, bold: k === 0, borders: {} }))));
  }
  if (after.length && rows.length) rows.push([]);
  pairs(after);
  if (!rows.length) return undefined;
  const width = Math.max(2, ...rows.map((r) => r.length));
  for (const r of rows) while (r.length < width) r.push(cell(""));
  return {
    page,
    y0: 0,
    y1: 0,
    xs: Array.from({ length: width + 1 }, (_, i) => i),
    rows,
    bordered: false,
    rowPitch: 12,
    name: "Account details",
    headerRows: 0,
    aside: "details",
  };
}

const SUMMARY_WORD = /opening|closing|debit|credit|withdrawal|deposit|count|total|balance|\bdr\b|\bcr\b/i;

/** A row of summary labels with a row of figures under it: "Opening Balance  Dr Count ... Closing Bal". */
function summaryOf(rows: Row[], page: number): Summary | null {
  for (let i = 0; i + 1 < rows.length; i++) {
    const head = rows[i];
    const under = rows[i + 1];
    if (head.chunks.length < 3 || head.chunks.filter((c) => SUMMARY_WORD.test(c.text)).length < 3) continue;
    if (under.y - head.y > head.size * 2.5) continue;
    const values = head.chunks.map(() => "");
    for (const v of under.chunks) {
      const mid = (v.x0 + v.x1) / 2;
      let best = 0;
      head.chunks.forEach((h, k) => {
        if (Math.abs((h.x0 + h.x1) / 2 - mid) < Math.abs((head.chunks[best].x0 + head.chunks[best].x1) / 2 - mid)) best = k;
      });
      values[best] = values[best] ? `${values[best]} ${v.text}` : v.text;
    }
    if (values.filter((v) => amountOf(v)).length < 3) continue;
    const title = i > 0 && /summary/i.test(rows[i - 1].chunks.map((c) => c.text).join(" ")) ? rows[i - 1] : head;
    return { page, y0: title.top - 2, y1: under.bottom + 2, labels: head.chunks.map((c) => c.text), values };
  }
  return null;
}

/** What the summary says, checked against the transactions read. Returns a sentence, or null when it has nothing to check. */
function checkSummary(s: Summary, rows: { debit: number; credit: number; balance: number | null }[], direction: BalanceCheck["direction"]): { ok: boolean; text: string } | null {
  const find = (re: RegExp, not?: RegExp) => {
    const i = s.labels.findIndex((l) => re.test(l) && !(not && not.test(l)));
    return i >= 0 ? amountOf(s.values[i])?.value : undefined;
  };
  const opening = find(/opening|b\/?f|brought/i);
  const closing = find(/closing|c\/?f|carried/i);
  const drCount = find(/(dr|debit|withdrawal)s?\s*(count|no)|no\.? of (dr|debit|withdrawal)/i);
  const crCount = find(/(cr|credit|deposit)s?\s*(count|no)|no\.? of (cr|credit|deposit)/i);
  const debits = find(/debit|withdrawal|\bdr\b/i, /count|no\.? of/i);
  const credits = find(/credit|deposit|\bcr\b/i, /count|no\.? of/i);
  const ours = {
    drCount: rows.filter((r) => r.debit).length,
    crCount: rows.filter((r) => r.credit).length,
    debits: rows.reduce((a, r) => a + r.debit, 0),
    credits: rows.reduce((a, r) => a + r.credit, 0),
  };
  const ordered = direction === "down" ? [...rows].reverse() : rows;
  const first = ordered[0];
  const lastBal = ordered[ordered.length - 1]?.balance;
  const same = (a: number | undefined, b: number | null | undefined) => a === undefined || b === null || b === undefined || Math.abs(a - b) < 0.011;
  const misses: string[] = [];
  if (!same(drCount, ours.drCount)) misses.push(`${drCount} debits, we read ${ours.drCount}`);
  if (!same(crCount, ours.crCount)) misses.push(`${crCount} credits, we read ${ours.crCount}`);
  if (!same(debits, ours.debits)) misses.push(`debits of ${money(debits!)}, we read ${money(ours.debits)}`);
  if (!same(credits, ours.credits)) misses.push(`credits of ${money(credits!)}, we read ${money(ours.credits)}`);
  if (opening !== undefined && first?.balance != null && !same(opening - first.debit + first.credit, first.balance)) misses.push(`an opening balance of ${money(opening)} that the first row does not follow from`);
  if (!same(closing, lastBal)) misses.push(`a closing balance of ${money(closing!)}, the last row shows ${money(lastBal!)}`);
  const checked = [drCount, crCount, debits, credits, opening, closing].filter((v) => v !== undefined).length;
  if (!checked) return null;
  if (misses.length) return { ok: false, text: `The bank's summary says ${misses.join("; ")}. Check the rows against the PDF.` };
  const parts: string[] = [];
  if (debits !== undefined) parts.push(`debits ${money(debits)}`);
  if (credits !== undefined) parts.push(`credits ${money(credits)}`);
  if (closing !== undefined) parts.push(`closing balance ${money(closing)}`);
  return { ok: true, text: `The totals match the bank's summary${parts.length ? ` (${parts.join(", ")})` : ""}.` };
}

function build(recs: Rec[], layout: Layout, regions: Map<number, { y0: number; y1: number }>, pageNumbers: number[], summary?: Summary): Statement {
  const cols = layout.cols;
  const cuts = cols.map((_, i) => cutOf(recs, i));
  for (const r of recs) {
    r.cells = r.lines.map((lines, i) => {
      return [isMoney(cols[i].role) || cols[i].role === "drcr" ? lines.map(lineString).join(" ").trim() : joinLines(lines, cuts[i], cols[i].role)];
    });
  }

  const idx = (role: Role) => cols.findIndex((c) => c.role === role);
  const amountI = idx("amount");
  const drcrI = idx("drcr");
  const debitI = idx("debit");
  const creditI = idx("credit");
  const balanceI = idx("balance");
  // One Amount column (with Dr/Cr beside it or on it) becomes Debit and Credit.
  const splitAmount = amountI >= 0 && debitI < 0 && creditI < 0;

  type Out = { label: string; get: (r: Rec, i: number) => string; role: Role };
  const out: Out[] = [];
  const parsed = recs.map((r) => {
    const cell = (i: number) => (i >= 0 ? r.cells[i][0] : "");
    const bal = amountOf(cell(balanceI));
    let debit = 0;
    let credit = 0;
    if (splitAmount) {
      const a = amountOf(cell(amountI));
      const tag = cell(drcrI).trim().toLowerCase();
      const side = a?.side ?? (/^d/.test(tag) ? "dr" : /^c/.test(tag) ? "cr" : a && a.value < 0 ? "dr" : undefined);
      if (a) {
        if (side === "dr") debit = Math.abs(a.value);
        else if (side === "cr") credit = Math.abs(a.value);
        else credit = a.value; // settled by the balance below
      }
    } else {
      const d = amountOf(cell(debitI));
      const c = amountOf(cell(creditI));
      debit = d ? Math.abs(d.value) : 0;
      credit = c ? Math.abs(c.value) : 0;
    }
    const balance = bal ? (bal.side === "dr" ? -Math.abs(bal.value) : bal.value) : null;
    return { debit, credit, balance, sideKnown: !splitAmount || !!amountOf(cell(amountI))?.side || !!cell(drcrI) };
  });

  // Amounts with no side say which way they went through the balance.
  for (let i = 1; i < parsed.length; i++) {
    const p = parsed[i];
    const prev = parsed[i - 1].balance;
    if (p.sideKnown || p.balance === null || prev === null) continue;
    const amount = p.credit;
    if (Math.abs(prev - amount - p.balance) < 0.005) {
      p.debit = amount;
      p.credit = 0;
    }
  }

  const check = checkBalances(parsed);

  cols.forEach((c, i) => {
    if (splitAmount && i === drcrI) return;
    if (splitAmount && i === amountI) {
      out.push({ label: "Debit", role: "debit", get: (_r, k) => (parsed[k].debit ? money(parsed[k].debit) : "") });
      out.push({ label: "Credit", role: "credit", get: (_r, k) => (parsed[k].credit ? money(parsed[k].credit) : "") });
      return;
    }
    if (c.role === "debit") return out.push({ label: c.label, role: c.role, get: (_r, k) => (parsed[k].debit ? money(parsed[k].debit) : "") });
    if (c.role === "credit") return out.push({ label: c.label, role: c.role, get: (_r, k) => (parsed[k].credit ? money(parsed[k].credit) : "") });
    if (c.role === "balance") return out.push({ label: c.label, role: c.role, get: (_r, k) => (parsed[k].balance === null ? "" : money(parsed[k].balance!)) });
    out.push({ label: c.label, role: c.role, get: (r) => r.cells[i][0] });
  });

  const failed = new Set(check.failed);
  const head: GridCellData[] = out.map((o) => ({ text: o.label, bold: true, borders: { bottom: true }, rowSpan: 1, colSpan: 1 }));
  const body = recs.map((r, k) =>
    out.map((o): GridCellData => ({
      text: o.get(r, k),
      bold: false,
      borders: {},
      rowSpan: 1,
      colSpan: 1,
      fill: failed.has(k) && o.role === "balance" ? "FDE2E1" : undefined,
    })),
  );
  const first = recs[0].page;
  const pages = [...new Set(recs.map((r) => r.page))];
  const dateTexts = body.map((row) => row[out.findIndex((o) => o.role === "date" || o.role === "valueDate")]?.text ?? "");
  const grid: Grid = {
    page: first,
    y0: regions.get(first)?.y0 ?? 0,
    y1: regions.get(first)?.y1 ?? 0,
    xs: Array.from({ length: out.length + 1 }, (_, i) => i),
    rows: [head, ...body],
    bordered: false,
    rowPitch: 12,
    name: "Transactions",
    headerRows: 1,
    colTypes: out.map((o) => (o.role === "ref" || o.role === "narration" || o.role === "serial" ? "text" : "auto")),
    dateOrder: dateOrderOf(dateTexts),
    statement: true,
    rowPages: [first, ...recs.map((r) => r.page)],
  };

  const notes: string[] = [];
  const span = pages.length > 1 ? `pages ${pages[0]}–${pages[pages.length - 1]}` : `page ${pages[0]}`;
  const n = recs.length;
  if (check.checked >= 2 && check.failed.length === 0) {
    notes.push(`Bank statement: ${n} transactions from ${span}. Every running balance adds up.`);
  } else if (check.failed.length) {
    const rows = check.failed.slice(0, 6).map((k) => k + 2).join(", ");
    notes.push(
      `Bank statement: ${n} transactions from ${span}. The balance does not add up on ${check.failed.length} row${check.failed.length === 1 ? "" : "s"} (${rows}${check.failed.length > 6 ? " …" : ""}), marked red. Check them against the PDF.`,
    );
  } else notes.push(`Bank statement: ${n} transactions from ${span}.`);
  void pageNumbers;
  let summaryGrid: Grid | undefined;
  if (summary) {
    const verdict = checkSummary(summary, parsed, check.direction);
    if (verdict) notes[0] = `${notes[0]} ${verdict.text}`;
    const cell = (text: string, bold: boolean): GridCellData => ({ text, bold, borders: bold ? { bottom: true } : {}, rowSpan: 1, colSpan: 1 });
    summaryGrid = {
      page: summary.page,
      y0: summary.y0,
      y1: summary.y1,
      xs: Array.from({ length: summary.labels.length + 1 }, (_, i) => i),
      rows: [summary.labels.map((l) => cell(l, true)), summary.values.map((v) => cell(v, false))],
      bordered: false,
      rowPitch: 12,
      name: "Summary",
      heading: "Statement summary",
      headerRows: 1,
      aside: "summary",
    };
  }
  return { grid, regions, check, transactions: n, notes, summary: summaryGrid };
}

/** Each balance should be the one before it, less debits, plus credits. Statements may run newest first. */
export function checkBalances(rows: { debit: number; credit: number; balance: number | null }[]): BalanceCheck {
  const run = (dir: "up" | "down") => {
    const failed: number[] = [];
    let checked = 0;
    for (let i = 1; i < rows.length; i++) {
      const [older, newer] = dir === "up" ? [rows[i - 1], rows[i]] : [rows[i], rows[i - 1]];
      const at = dir === "up" ? i : i - 1;
      if (older.balance === null || newer.balance === null) continue;
      checked++;
      if (Math.abs(older.balance - newer.debit + newer.credit - newer.balance) > 0.011) failed.push(at);
    }
    return { failed, checked };
  };
  const up = run("up");
  const down = run("down");
  if (!up.checked) return { checked: 0, failed: [], direction: null };
  return down.failed.length < up.failed.length ? { ...down, direction: "down" } : { ...up, direction: "up" };
}

/** dmy unless the column itself says otherwise. */
function dateOrderOf(texts: string[]): "dmy" | "mdy" {
  let dmy = 0;
  let mdy = 0;
  for (const t of texts) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/.exec(t.trim());
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? "mdy" : "dmy";
}
