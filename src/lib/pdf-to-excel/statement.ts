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
};

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
  if (start === 0) return [{ ...c, text: text.trim() }];
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
  const out: Row[] = [];
  let open: { band: number; row: Row } | null = null;
  for (const r of rows) {
    const k = ys.findIndex((y, i) => i < ys.length - 1 && r.top + r.size * 0.3 > y && r.y < ys[i + 1]);
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

/**
 * Wrapped lines of one column, joined. Core-banking systems that cut every N characters split
 * words, so lines run straight on, unless the cut fell on a space: then the next line starts a
 * character in, or the line before ends a character short.
 */
function joinLines(lines: Chunk[][], cut: { width: number; left: number; char: number } | null): string {
  let out = "";
  lines.forEach((line, k) => {
    const text = lineString(line);
    if (!out) return (out = text);
    const prev = lines[k - 1];
    if (cut) {
      const indented = line[0].x0 - cut.left > cut.char * 0.5;
      const short = prev[prev.length - 1].x1 < cut.left + (cut.width - 0.5) * cut.char;
      out += indented || short ? ` ${text}` : text;
    } else if ((/[/\-@_:]$/.test(out) && !/\s[/\-]$/.test(out)) || /^[/\-@_]/.test(text)) out += text;
    else out += ` ${text}`;
  });
  return out.replace(/\s+/g, " ").trim();
}

/** Where and how wide the lines of a column are cut, when they are cut by count; else null. */
function cutOf(recs: Rec[], col: number): { width: number; left: number; char: number } | null {
  const lens: number[] = [];
  const texts = new Set<string>();
  const lefts: number[] = [];
  const chars: number[] = [];
  for (const r of recs) {
    const lines = r.lines[col];
    for (let k = 0; k < lines.length; k++) {
      const text = lineString(lines[k]);
      lefts.push(lines[k][0].x0);
      if (text.length >= 6) chars.push((lines[k][lines[k].length - 1].x1 - lines[k][0].x0) / text.length);
      if (k < lines.length - 1) {
        lens.push(text.length);
        texts.add(text);
      }
    }
  }
  // The same words wrapped the same way every time ("TRANSFER FROM") are not a cut.
  if (lens.length < 3 || texts.size < lens.length * 0.5) return null;
  const counts = new Map<number, number>();
  for (const l of lens) counts.set(l, (counts.get(l) ?? 0) + 1);
  const [mode] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  const hits = lens.filter((l) => l === mode || l === mode - 1).length;
  if (mode < 12 || hits < lens.length * 0.8 || counts.get(mode)! < lens.length * 0.5) return null;
  return { width: mode, left: Math.min(...lefts), char: median(chars) };
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
      if (start < 0) continue;
      y0 = rows[start].top - 2;
    } else continue;

    const dc = dateCol(layout.cols);
    const balanceCol = layout.cols.findIndex((c) => c.role === "balance");
    const sc = layout.cols.findIndex((c) => c.role === "serial");
    const textCol = (i: number) => !isMoney(layout!.cols[i].role) && layout!.cols[i].role !== "drcr";
    let last = rows[start - 1]?.y ?? rows[start]?.y ?? 0;
    let y1 = y0;
    let opened = false;
    let here = false;
    const gaps: number[] = [];
    for (let k = start; k < rows.length; k++) {
      const row = rows[k];
      // Running headers sit above the first transaction; below it the same words are data.
      if (!here && isFurniture(row)) continue;
      const text = row.chunks.map((c) => c.text).join(" ");
      const cells = place(row, layout);
      const dated = cells[dc].some((c) => DATE_START.test(c.text)) || (sc >= 0 && cells[sc].some((c) => /^\d+$/.test(c.text)) && cells[dc].length > 0);
      const gap = row.y - last;
      const limit = Math.max(row.size * 4.5, (pitch || row.size * 1.6) * 3.2);
      if (!dated && (END.test(text.trim()) || (opened && gap > limit))) break;
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
      } else break;
      if (opened && k > start) gaps.push(gap);
      last = row.y;
      y1 = row.bottom + 2;
    }
    if (gaps.length) pitch = median(gaps);
    if (opened || recs.some((r) => r.page === pageNumbers[p])) regions.set(pageNumbers[p], { y0, y1 });
    if (balanceCol < 0 && dc < 0) break;
  }
  if (!layout || !headerLabels || recs.length < 2) return null;
  return build(recs, layout, regions, pageNumbers);
}

function build(recs: Rec[], layout: Layout, regions: Map<number, { y0: number; y1: number }>, pageNumbers: number[]): Statement {
  const cols = layout.cols;
  const cuts = cols.map((_, i) => cutOf(recs, i));
  for (const r of recs) {
    r.cells = r.lines.map((lines, i) => {
      return [isMoney(cols[i].role) || cols[i].role === "drcr" ? lines.map(lineString).join(" ").trim() : joinLines(lines, cuts[i])];
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
  return { grid, regions, check, transactions: n, notes };
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
