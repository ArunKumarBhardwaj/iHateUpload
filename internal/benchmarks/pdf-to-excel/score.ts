/**
 * Scores a converted .xlsx against ground-truth tables. Every score is 0..1.
 *  - cells: F1 of cells that hold the same value in the same row and column after aligning rows
 *  - typed: of the truth cells that are numbers or dates, the share that came out as real numbers
 *  - tables: whether the number of table-like sheets is the number of truth tables
 */
import * as XLSX from "xlsx";

export type TruthCell = { text: string; cs?: number; shaded?: boolean };
export type TruthTable = { rows: TruthCell[][] };

export type OutCell = { v: string | number | null; num: boolean; z?: string };
export type OutSheet = { name: string; grid: OutCell[][] };

const EMPTY: OutCell = { v: null, num: false };

export function readSheets(bytes: Uint8Array): OutSheet[] {
  const wb = XLSX.read(bytes, { cellNF: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws["!ref"];
    const grid: OutCell[][] = [];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: OutCell[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          row.push(cell && cell.v !== undefined && cell.v !== "" ? { v: cell.v, num: cell.t === "n", z: cell.z } : EMPTY);
        }
        grid.push(row);
      }
    }
    return { name, grid };
  });
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** A number the way a person would read the text, or null. */
export function numberOf(text: string): { value: number; percent: boolean } | null {
  let s = squash(text).replace(/−/g, "-");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    neg = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/^[-+]\s*/, (m) => ((neg = neg || m.startsWith("-")), "")).replace(/^[$€£¥₹]\s*/, "");
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  }
  const percent = s.endsWith("%");
  if (percent) s = s.slice(0, -1);
  if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) && !/^(\d+(\.\d+)?|\.\d+)$/.test(s)) return null;
  // Leading zeros are identifiers.
  if (/^0\d/.test(s.replace(/,/g, ""))) return null;
  const value = Number(s.replace(/,/g, ""));
  return { value: neg ? -value : value, percent };
}

const serialToKey = (serial: number) => {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
};
const isDateFormat = (z?: string) => !!z && /[ymd]/i.test(z.replace(/"[^"]*"|\\./g, "")) && !/General/i.test(z);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Every year-month-day a piece of date text could mean. */
export function dateKeys(text: string): string[] {
  const s = squash(text);
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return [`${+m[3]}-${+m[1]}-${+m[2]}`, `${+m[3]}-${+m[2]}-${+m[1]}`];
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return [`${+m[1]}-${+m[2]}-${+m[3]}`];
  m = /^(\d{1,2}) ([A-Za-z]+),? (\d{4})$/.exec(s);
  if (m && MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) >= 0) return [`${+m[3]}-${MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1}-${+m[1]}`];
  m = /^([A-Za-z]+) (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) >= 0) return [`${+m[3]}-${MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1}-${+m[2]}`];
  return [];
}

const loose = (s: string) => squash(s).toLowerCase().replace(/[$€£,]/g, "");

/** Does this output cell hold what the truth text says? */
export function same(truth: string, out: OutCell): boolean {
  if (out.v === null) return squash(truth) === "";
  if (squash(truth) === "") return false;
  if (typeof out.v === "number") {
    if (isDateFormat(out.z)) return dateKeys(truth).includes(serialToKey(out.v));
    const t = numberOf(truth);
    if (!t) return false;
    const near = (x: number, y: number) => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(y));
    if (/%/.test(out.z ?? "")) return near(out.v * 100, t.value);
    return near(out.v, t.value) || (t.percent && near(out.v, t.value / 100));
  }
  const text = String(out.v);
  if (loose(text) === loose(truth)) return true;
  const a = numberOf(text);
  const b = numberOf(truth);
  return !!a && !!b && a.value === b.value && a.percent === b.percent;
}

/** What a truth table looks like as a plain grid of text; merged cells keep their text in the first column. */
export function truthGrid(table: TruthTable): string[][] {
  return table.rows.map((row) => row.flatMap((c) => [c.text, ...Array.from({ length: (c.cs ?? 1) - 1 }, () => "")]));
}

const filled = (c: OutCell) => c.v !== null;

/** Drop empty rows and empty edge columns. */
export function trim(grid: OutCell[][]): OutCell[][] {
  const rows = grid.filter((r) => r.some(filled));
  if (!rows.length) return [];
  const width = Math.max(...rows.map((r) => r.length));
  let lo = 0;
  let hi = width - 1;
  while (lo < hi && rows.every((r) => !filled(r[lo] ?? EMPTY))) lo++;
  while (hi > lo && rows.every((r) => !filled(r[hi] ?? EMPTY))) hi--;
  return rows.map((r) => Array.from({ length: hi - lo + 1 }, (_, i) => r[lo + i] ?? EMPTY));
}

export type TableScore = { matched: number; truthCells: number; outCells: number; f1: number; typed: number; typedOf: number; sheet: string };

/** Best alignment of one truth table against one sheet: rows in order, columns shifted by up to two. */
export function scoreTable(table: TruthTable, sheet: OutSheet): TableScore {
  const truth = truthGrid(table);
  const out = trim(sheet.grid);
  const tCells = truth.flat().filter((t) => squash(t) !== "").length;
  const oCells = out.flat().filter(filled).length;
  let best = { matched: 0, typed: 0, typedOf: 0 };
  for (let shift = -2; shift <= 2; shift++) {
    const hit = (i: number, j: number) => {
      let n = 0;
      for (let c = 0; c < truth[i].length; c++) {
        const cell = out[j][c + shift];
        if (cell && squash(truth[i][c]) !== "" && same(truth[i][c], cell)) n++;
      }
      return n;
    };
    // Monotone row alignment that maximises matching cells.
    const T = truth.length;
    const O = out.length;
    const dp: number[][] = Array.from({ length: T + 1 }, () => Array<number>(O + 1).fill(0));
    const pick: ("t" | "o" | "m")[][] = Array.from({ length: T + 1 }, () => Array<"t" | "o" | "m">(O + 1).fill("t"));
    for (let i = 1; i <= T; i++) {
      for (let j = 1; j <= O; j++) {
        const m = dp[i - 1][j - 1] + hit(i - 1, j - 1);
        let v = m;
        let p: "t" | "o" | "m" = "m";
        if (dp[i - 1][j] > v) {
          v = dp[i - 1][j];
          p = "t";
        }
        if (dp[i][j - 1] > v) {
          v = dp[i][j - 1];
          p = "o";
        }
        dp[i][j] = v;
        pick[i][j] = p;
      }
    }
    let typed = 0;
    let typedOf = 0;
    let i = T;
    let j = O;
    const mapped = new Map<number, number>();
    while (i > 0 && j > 0) {
      const p = pick[i][j];
      if (p === "m") {
        mapped.set(i - 1, j - 1);
        i--;
        j--;
      } else if (p === "t") i--;
      else j--;
    }
    for (let r = 0; r < T; r++) {
      for (let c = 0; c < truth[r].length; c++) {
        const t = truth[r][c];
        if (squash(t) === "" || !(numberOf(t) || dateKeys(t).length)) continue;
        typedOf++;
        const jr = mapped.get(r);
        const cell = jr === undefined ? undefined : out[jr][c + shift];
        if (cell && cell.num && same(t, cell)) typed++;
      }
    }
    if (dp[T][O] > best.matched || (dp[T][O] === best.matched && typed > best.typed)) best = { matched: dp[T][O], typed, typedOf };
  }
  const f1 = tCells + oCells === 0 ? 1 : (2 * best.matched) / (tCells + oCells);
  return { matched: best.matched, truthCells: tCells, outCells: oCells, f1, typed: best.typed, typedOf: best.typedOf, sheet: sheet.name };
}

/** A sheet that holds a table: at least three rows and two columns of content. */
export function tableLike(sheet: OutSheet): boolean {
  const g = trim(sheet.grid);
  const wide = g.filter((r) => r.filter(filled).length >= 2);
  return g.length >= 3 && wide.length >= 3 && !/^text$/i.test(sheet.name);
}

export type DocScore = {
  cells: number;
  typed: number | null;
  tablesOut: number;
  tablesTruth: number;
  tablesOk: boolean;
  perTable: TableScore[];
};

export function scoreWorkbook(truth: TruthTable[], sheets: OutSheet[]): DocScore {
  const perTable = truth.map((t) => {
    let best: TableScore | null = null;
    for (const s of sheets) {
      const sc = scoreTable(t, s);
      if (!best || sc.f1 > best.f1) best = sc;
    }
    return best ?? { matched: 0, truthCells: 1, outCells: 0, f1: 0, typed: 0, typedOf: 0, sheet: "" };
  });
  const cells = perTable.length ? perTable.reduce((a, t) => a + t.f1, 0) / perTable.length : 1;
  const typedOf = perTable.reduce((a, t) => a + t.typedOf, 0);
  const tablesOut = sheets.filter(tableLike).length;
  return {
    cells,
    typed: typedOf ? perTable.reduce((a, t) => a + t.typed, 0) / typedOf : null,
    tablesOut,
    tablesTruth: truth.length,
    tablesOk: tablesOut === truth.length,
    perTable,
  };
}
