/**
 * Conditional formatting, worked out from the cells' values as Excel does when it prints: the red
 * fails on a marksheet, the shaded absences in an attendance register, a colour scale on totals.
 *
 * Rules apply in priority order: a rule's look fills what higher-priority rules left unset, and
 * "stop if true" ends the list for that cell. Formula rules go through a small evaluator that knows
 * references, comparisons, arithmetic and the functions such rules use; a rule it can't evaluate is
 * left out rather than guessed.
 */
import type { CfRule, CfStyle, Cfvo, CondFormat } from "./excel-styles";

/** A cell's value: number, text, boolean, an error ("#N/A"), or undefined when blank. */
export type CellValue = number | string | boolean | { error: string } | undefined;

export interface CfResult {
  style: CfStyle;
  /** a data bar: the share of the cell's width it fills, and its colour */
  bar?: { frac: number; color: string };
}

const isErr = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v;
const key = (r: number, c: number) => `${r},${c}`;

/** Days since 1899-12-30, Excel's date serial, for today. */
function todaySerial(now: Date): number {
  return Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

// ---- formulas -----------------------------------------------------------------------------------

type Tok = { t: "num"; v: number } | { t: "bool"; v: boolean } | { t: "str"; v: string } | { t: "ref"; v: string } | { t: "fn"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  const s = src.replace(/^=/, "");
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let v = "";
      i++;
      while (i < s.length) {
        if (s[i] === '"' && s[i + 1] === '"') {
          v += '"';
          i += 2;
        } else if (s[i] === '"') break;
        else v += s[i++];
      }
      i++;
      out.push({ t: "str", v });
      continue;
    }
    const num = /^(\d+\.?\d*(?:E[+-]?\d+)?%?|\.\d+)/i.exec(s.slice(i));
    // a number, unless it is the row part of a reference like $C3 (handled below)
    if (num && !/[A-Z$]/i.test(s[i - 1] ?? "")) {
      let v = Number(num[1].replace(/%$/, ""));
      if (num[1].endsWith("%")) v /= 100;
      out.push({ t: "num", v });
      i += num[1].length;
      continue;
    }
    const ref = /^(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)(?![A-Z0-9_(])/i.exec(s.slice(i));
    if (ref) {
      out.push({ t: "ref", v: ref[1].toUpperCase() });
      i += ref[1].length;
      continue;
    }
    const name = /^([A-Z][A-Z0-9_.]*)\s*\(/i.exec(s.slice(i));
    if (name) {
      out.push({ t: "fn", v: name[1].toUpperCase() });
      i += name[0].length;
      continue;
    }
    const word = /^(TRUE|FALSE)(?![A-Z0-9_(])/i.exec(s.slice(i));
    if (word) {
      out.push({ t: "bool", v: word[1].toUpperCase() === "TRUE" });
      i += word[1].length;
      continue;
    }
    const op = /^(<>|<=|>=|[=<>+\-*/&^(),])/.exec(s.slice(i));
    if (op) {
      out.push({ t: "op", v: op[1] });
      i += op[1].length;
      continue;
    }
    // sheet references, names, array constants: not supported
    return null;
  }
  return out;
}

type Val = number | string | boolean | { error: string } | undefined | Val[];

interface Env {
  /** the cell the rule is evaluated for, and the top-left cell its relative references are written against */
  r: number;
  c: number;
  r0: number;
  c0: number;
  get(r: number, c: number): CellValue;
  today: number;
}

const colNum = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** A reference shifted from the rule's anchor cell to the cell being evaluated. */
function resolveRef(ref: string, env: Env): { r: number; c: number } {
  const m = /^(\$?)([A-Z]{1,3})(\$?)(\d+)$/.exec(ref) as RegExpExecArray;
  let c = colNum(m[2]);
  let r = Number(m[4]) - 1;
  if (!m[1]) c += env.c - env.c0;
  if (!m[3]) r += env.r - env.r0;
  return { r, c };
}

const toNum = (v: Val): number | { error: string } => {
  if (isErr(v)) return v;
  if (Array.isArray(v)) return toNum(v[0]);
  if (v === undefined || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : { error: "#VALUE!" };
};
const toStr = (v: Val): string => {
  if (Array.isArray(v)) return toStr(v[0]);
  if (v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (isErr(v)) return v.error;
  return String(v);
};
const truthy = (v: Val): boolean => {
  if (Array.isArray(v)) return truthy(v[0]);
  if (typeof v === "string") return v.toUpperCase() === "TRUE";
  const n = toNum(v);
  return !isErr(n) && n !== 0;
};
const flat = (args: Val[]): Val[] => args.flatMap((a) => (Array.isArray(a) ? flat(a) : [a]));

/** Excel's comparison: numbers before text before booleans; text without regard to case. */
function compare(a: Val, b: Val): number {
  const rank = (v: Val) => (typeof v === "boolean" ? 2 : typeof v === "string" ? 1 : 0);
  const x = Array.isArray(a) ? a[0] : a === undefined ? (typeof b === "string" ? "" : 0) : a;
  const y = Array.isArray(b) ? b[0] : b === undefined ? (typeof x === "string" ? "" : 0) : b;
  if (rank(x) !== rank(y)) return rank(x) - rank(y);
  if (typeof x === "string") return x.toLowerCase().localeCompare(String(y).toLowerCase());
  return Number(x) - Number(y);
}

/** Criteria as COUNTIF reads them: ">=33", "A", "<>", 5. */
function matchesCriteria(v: Val, crit: Val): boolean {
  if (typeof crit === "number") return typeof v === "number" ? v === crit : toStr(v) === String(crit);
  const s = toStr(crit);
  const m = /^(<=|>=|<>|=|<|>)?(.*)$/.exec(s) as RegExpExecArray;
  const op = m[1] ?? "=";
  const raw = m[2];
  const n = Number(raw);
  const target: Val = raw !== "" && Number.isFinite(n) ? n : raw;
  if (typeof target === "string" && (op === "=" || op === "<>")) {
    const re = new RegExp(`^${target.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
    const hit = re.test(toStr(v));
    return op === "=" ? hit : !hit;
  }
  const cmp = compare(v, target);
  return op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : op === ">=" ? cmp >= 0 : op === "<>" ? cmp !== 0 : cmp === 0;
}

class Parser {
  private i = 0;
  constructor(
    private toks: Tok[],
    private env: Env,
  ) {}
  private peek() {
    return this.toks[this.i];
  }
  private isOp(v: string) {
    const t = this.peek();
    return t?.t === "op" && t.v === v;
  }
  parse(): Val {
    const v = this.comparison();
    if (this.i !== this.toks.length) throw new Error("trailing");
    return v;
  }
  private comparison(): Val {
    let a = this.concat();
    for (;;) {
      const t = this.peek();
      if (t?.t !== "op" || !["=", "<>", "<", ">", "<=", ">="].includes(t.v)) return a;
      this.i++;
      const b = this.concat();
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      const c = compare(a, b);
      a = t.v === "=" ? c === 0 : t.v === "<>" ? c !== 0 : t.v === "<" ? c < 0 : t.v === ">" ? c > 0 : t.v === "<=" ? c <= 0 : c >= 0;
    }
  }
  private concat(): Val {
    let a = this.additive();
    while (this.isOp("&")) {
      this.i++;
      a = toStr(a) + toStr(this.additive());
    }
    return a;
  }
  private additive(): Val {
    let a = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.toks[this.i++] as { v: string }).v;
      const x = toNum(a);
      const y = toNum(this.term());
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      a = op === "+" ? x + y : x - y;
    }
    return a;
  }
  private term(): Val {
    let a = this.power();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.toks[this.i++] as { v: string }).v;
      const x = toNum(a);
      const y = toNum(this.power());
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      if (op === "/" && y === 0) return { error: "#DIV/0!" };
      a = op === "*" ? x * y : x / y;
    }
    return a;
  }
  private power(): Val {
    let a = this.unary();
    while (this.isOp("^")) {
      this.i++;
      const x = toNum(a);
      const y = toNum(this.unary());
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      a = x ** y;
    }
    return a;
  }
  private unary(): Val {
    if (this.isOp("-")) {
      this.i++;
      const x = toNum(this.unary());
      return isErr(x) ? x : -x;
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.primary();
  }
  private primary(): Val {
    const t = this.toks[this.i++];
    if (!t) throw new Error("end");
    if (t.t === "num" || t.t === "str" || t.t === "bool") return t.v;
    if (t.t === "ref") return this.ref(t.v);
    if (t.t === "op" && t.v === "(") {
      const v = this.comparison();
      if (!this.isOp(")")) throw new Error(")");
      this.i++;
      return v;
    }
    if (t.t === "fn") {
      const args: Val[] = [];
      const raw: Tok[][] = [];
      if (!this.isOp(")")) {
        for (;;) {
          const start = this.i;
          args.push(this.comparison());
          raw.push(this.toks.slice(start, this.i));
          if (this.isOp(",")) {
            this.i++;
            continue;
          }
          break;
        }
      }
      if (!this.isOp(")")) throw new Error(")");
      this.i++;
      return this.call(t.v, args, raw);
    }
    throw new Error("token");
  }
  private ref(v: string): Val {
    const [a, b] = v.split(":");
    const s = resolveRef(a, this.env);
    if (!b) return this.env.get(s.r, s.c);
    const e = resolveRef(b, this.env);
    const out: Val[] = [];
    for (let r = Math.min(s.r, e.r); r <= Math.max(s.r, e.r); r++) for (let c = Math.min(s.c, e.c); c <= Math.max(s.c, e.c); c++) out.push(this.env.get(r, c));
    return out;
  }
  private call(name: string, args: Val[], raw: Tok[][]): Val {
    const env = this.env;
    const n = (i: number) => toNum(args[i]);
    const nums = () => flat(args).filter((v): v is number => typeof v === "number");
    switch (name) {
      case "ROW":
      case "COLUMN": {
        const ref = raw[0]?.[0];
        const at = ref?.t === "ref" ? resolveRef(ref.v.split(":")[0], env) : { r: env.r, c: env.c };
        return name === "ROW" ? at.r + 1 : at.c + 1;
      }
      case "MOD": {
        const a = n(0);
        const b = n(1);
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        return b === 0 ? { error: "#DIV/0!" } : a - b * Math.floor(a / b);
      }
      case "AND":
        return flat(args).every(truthy);
      case "OR":
        return flat(args).some(truthy);
      case "NOT":
        return !truthy(args[0]);
      case "IF":
        return truthy(args[0]) ? args[1] : (args[2] ?? false);
      case "ISBLANK":
        return args[0] === undefined;
      case "ISNUMBER":
        return typeof args[0] === "number";
      case "ISTEXT":
        return typeof args[0] === "string";
      case "ISERROR":
      case "ISNA":
        return isErr(args[0]);
      case "LEN":
        return toStr(args[0]).length;
      case "LEFT":
      case "RIGHT": {
        const s = toStr(args[0]);
        const k = args[1] === undefined ? 1 : Number(toNum(args[1]));
        return name === "LEFT" ? s.slice(0, k) : s.slice(Math.max(0, s.length - k));
      }
      case "MID": {
        const s = toStr(args[0]);
        return s.substr(Number(toNum(args[1])) - 1, Number(toNum(args[2])));
      }
      case "UPPER":
        return toStr(args[0]).toUpperCase();
      case "LOWER":
        return toStr(args[0]).toLowerCase();
      case "TRIM":
        return toStr(args[0]).trim().replace(/ +/g, " ");
      case "EXACT":
        return toStr(args[0]) === toStr(args[1]);
      case "SEARCH":
      case "FIND": {
        const hay = toStr(args[1]);
        const at = name === "SEARCH" ? hay.toLowerCase().indexOf(toStr(args[0]).toLowerCase()) : hay.indexOf(toStr(args[0]));
        return at < 0 ? { error: "#VALUE!" } : at + 1;
      }
      case "ABS": {
        const a = n(0);
        return isErr(a) ? a : Math.abs(a);
      }
      case "INT": {
        const a = n(0);
        return isErr(a) ? a : Math.floor(a);
      }
      case "ROUND": {
        const a = n(0);
        const d = args[1] === undefined ? 0 : Number(toNum(args[1]));
        return isErr(a) ? a : Math.round(a * 10 ** d) / 10 ** d;
      }
      case "SUM":
        return nums().reduce((s, v) => s + v, 0);
      case "AVERAGE": {
        const v = nums();
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : { error: "#DIV/0!" };
      }
      case "MIN":
        return nums().length ? Math.min(...nums()) : 0;
      case "MAX":
        return nums().length ? Math.max(...nums()) : 0;
      case "COUNT":
        return nums().length;
      case "COUNTA":
        return flat(args).filter((v) => v !== undefined && v !== "").length;
      case "COUNTIF":
        return flat([args[0]]).filter((v) => matchesCriteria(v, args[1])).length;
      case "MEDIAN": {
        const v = nums().sort((a, b) => a - b);
        if (!v.length) return { error: "#NUM!" };
        const mid = Math.floor(v.length / 2);
        return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
      }
      case "LARGE":
      case "SMALL": {
        const v = flat([args[0]]).filter((x): x is number => typeof x === "number").sort((a, b) => (name === "LARGE" ? b - a : a - b));
        const k = Number(toNum(args[1]));
        return k >= 1 && k <= v.length ? v[k - 1] : { error: "#NUM!" };
      }
      case "RANK":
      case "RANK.EQ": {
        const x = n(0);
        if (isErr(x)) return x;
        const v = flat([args[1]]).filter((y): y is number => typeof y === "number");
        const asc = args[2] !== undefined && truthy(args[2]);
        return 1 + v.filter((y) => (asc ? y < x : y > x)).length;
      }
      case "SUMIF":
      case "AVERAGEIF": {
        const range = flat([args[0]]);
        const vals = flat([args[2] ?? args[0]]);
        const hit = vals.filter((_, i) => matchesCriteria(range[i], args[1])).filter((v): v is number => typeof v === "number");
        if (name === "SUMIF") return hit.reduce((a, b) => a + b, 0);
        return hit.length ? hit.reduce((a, b) => a + b, 0) / hit.length : { error: "#DIV/0!" };
      }
      case "COUNTIFS": {
        const ranges = args.filter((_, i) => i % 2 === 0).map((a) => flat([a]));
        const crits = args.filter((_, i) => i % 2 === 1);
        return (ranges[0] ?? []).filter((_, i) => ranges.every((r, k) => matchesCriteria(r[i], crits[k]))).length;
      }
      case "ISEVEN":
      case "ISODD": {
        const x = n(0);
        if (isErr(x)) return x;
        return (Math.abs(Math.trunc(x)) % 2 === 0) === (name === "ISEVEN");
      }
      case "VALUE": {
        const x = toNum(args[0]);
        return x;
      }
      case "DAY":
      case "MONTH":
      case "YEAR": {
        const x = n(0);
        if (isErr(x)) return x;
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(x) * 86400000);
        return name === "DAY" ? d.getUTCDate() : name === "MONTH" ? d.getUTCMonth() + 1 : d.getUTCFullYear();
      }
      case "DATE": {
        const [y, m, d] = [n(0), n(1), n(2)];
        if (isErr(y) || isErr(m) || isErr(d)) return { error: "#VALUE!" };
        return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
      }
      case "TODAY":
        return env.today;
      case "WEEKDAY": {
        const d = n(0);
        if (isErr(d)) return d;
        // serial 1 (1900-01-01) was a Sunday in Excel's calendar
        const sun0 = (((Math.floor(d) - 1) % 7) + 7) % 7;
        const type = args[1] === undefined ? 1 : Number(toNum(args[1]));
        return type === 2 ? ((sun0 + 6) % 7) + 1 : type === 3 ? (sun0 + 6) % 7 : sun0 + 1;
      }
      default:
        throw new Error(`function ${name}`);
    }
  }
}

/** A formula's value for one cell, or undefined when the formula isn't one this evaluator knows. */
export function evaluate(formula: string, env: Env): Val | undefined {
  const toks = tokenize(formula);
  if (!toks) return undefined;
  try {
    return new Parser(toks, env).parse();
  } catch {
    return undefined;
  }
}

// ---- rules ---------------------------------------------------------------------------------------

function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return [0, 2, 4]
    .map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** A colour scale's or data bar's threshold over the range's numbers. */
function threshold(v: Cfvo, nums: number[], env: Env): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const p = Number(v.val);
  switch (v.type) {
    case "min":
      return min;
    case "max":
      return max;
    case "num":
      return Number.isFinite(p) ? p : min;
    case "percent":
      return min + ((max - min) * (Number.isFinite(p) ? p : 0)) / 100;
    case "percentile": {
      if (!sorted.length) return 0;
      const k = ((Number.isFinite(p) ? p : 50) / 100) * (sorted.length - 1);
      const lo = Math.floor(k);
      return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (k - lo);
    }
    case "formula": {
      const r = evaluate(v.val ?? "", env);
      const n = toNum(r ?? 0);
      return isErr(n) ? min : n;
    }
    default:
      return min;
  }
}

function inRanges(cf: CondFormat, r: number, c: number) {
  return cf.ranges.some((g) => r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1);
}

/**
 * Conditional formatting for the cells of a sheet, keyed "row,col" (0-based sheet coordinates).
 * `get` reads any cell's value, `cells` lists the cells that will print.
 */
export function applyConditional(
  formats: CondFormat[],
  get: (r: number, c: number) => CellValue,
  cells: { r: number; c: number }[],
  now = new Date(),
  /** the last row and column with content: rules on whole columns or the whole sheet stop there */
  used?: { r1: number; c1: number },
): Map<string, CfResult> {
  const out = new Map<string, CfResult>();
  const today = todaySerial(now);
  const rules = formats.flatMap((cf) => cf.rules.map((rule) => ({ cf, rule }))).sort((a, b) => a.rule.priority - b.rule.priority);
  // per-format statistics, computed once
  const stats = new Map<CondFormat, { nums: number[]; counts: Map<string, number> }>();
  const statsOf = (cf: CondFormat) => {
    let s = stats.get(cf);
    if (s) return s;
    const nums: number[] = [];
    const counts = new Map<string, number>();
    for (const g of cf.ranges) {
      // ranges may be whole columns or the whole sheet; only look at cells that can have values
      const r1 = Math.min(g.r1, used?.r1 ?? g.r0 + 100000);
      const c1 = Math.min(g.c1, used?.c1 ?? g.c0 + 1000);
      for (let r = g.r0; r <= r1; r++) {
        for (let c = g.c0; c <= c1; c++) {
          const v = get(r, c);
          if (typeof v === "number") nums.push(v);
          if (v !== undefined && v !== "" && !isErr(v)) {
            const k = typeof v === "string" ? v.toLowerCase() : String(v);
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
        }
      }
    }
    s = { nums, counts };
    stats.set(cf, s);
    return s;
  };
  for (const { r, c } of cells) {
    const v = get(r, c);
    const res: CfResult = { style: {} };
    let any = false;
    for (const { cf, rule } of rules) {
      if (!inRanges(cf, r, c)) continue;
      const first = cf.ranges[0];
      const env: Env = { r, c, r0: first.r0, c0: first.c0, get, today };
      if (rule.scale && typeof v === "number") {
        const { nums } = statsOf(cf);
        const pts = rule.scale.cfvo.map((x) => threshold(x, nums, env));
        const cols = rule.scale.colors;
        let fill = cols[cols.length - 1];
        if (v <= pts[0]) fill = cols[0];
        else {
          for (let i = 1; i < pts.length; i++) {
            if (v <= pts[i]) {
              const span = pts[i] - pts[i - 1];
              fill = mix(cols[i - 1], cols[i], span > 0 ? (v - pts[i - 1]) / span : 1);
              break;
            }
          }
        }
        if (fill && res.style.fill === undefined) res.style.fill = fill;
        any = true;
        continue;
      }
      if (rule.bar && typeof v === "number") {
        const { nums } = statsOf(cf);
        const lo = threshold(rule.bar.cfvo[0] ?? { type: "min" }, nums, env);
        const hi = threshold(rule.bar.cfvo[1] ?? { type: "max" }, nums, env);
        const t = hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 1;
        // Excel's default bar runs from 10% to 90% of the cell
        res.bar ??= { frac: 0.1 + 0.8 * t, color: rule.bar.color };
        any = true;
        continue;
      }
      if (!rule.style || !matches(rule, v, env, cf, statsOf)) continue;
      for (const [k, val] of Object.entries(rule.style) as [keyof CfStyle, never][]) if (res.style[k] === undefined) res.style[k] = val;
      any = true;
      if (rule.stopIfTrue) break;
    }
    if (any) out.set(key(r, c), res);
  }
  return out;
}

function matches(rule: CfRule, v: CellValue, env: Env, cf: CondFormat, statsOf: (cf: CondFormat) => { nums: number[]; counts: Map<string, number> }): boolean {
  const text = isErr(v) ? v.error : v === undefined ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
  switch (rule.type) {
    case "cellIs": {
      // a blank cell counts as 0 (or empty text), so "less than 33" marks blanks too, as in Excel
      const ops = rule.formulas.map((f) => evaluate(f, env));
      if (ops.some((o) => o === undefined || isErr(o))) return false;
      const [a, b] = ops as Val[];
      const cmp = compare(v, a);
      switch (rule.operator) {
        case "lessThan":
          return cmp < 0;
        case "lessThanOrEqual":
          return cmp <= 0;
        case "greaterThan":
          return cmp > 0;
        case "greaterThanOrEqual":
          return cmp >= 0;
        case "equal":
          return cmp === 0;
        case "notEqual":
          return cmp !== 0;
        case "between":
        case "notBetween": {
          const lo = compare(a, b) <= 0 ? a : b;
          const hi = lo === a ? b : a;
          const inside = compare(v, lo) >= 0 && compare(v, hi) <= 0;
          return rule.operator === "between" ? inside : !inside;
        }
        default:
          return false;
      }
    }
    case "expression": {
      const res = rule.formulas[0] ? evaluate(rule.formulas[0], env) : undefined;
      return res !== undefined && !isErr(res) && truthy(res);
    }
    case "containsText":
      return !!rule.text && text.toLowerCase().includes(rule.text.toLowerCase());
    case "notContainsText":
      return !!rule.text && !text.toLowerCase().includes(rule.text.toLowerCase());
    case "beginsWith":
      return !!rule.text && text.toLowerCase().startsWith(rule.text.toLowerCase());
    case "endsWith":
      return !!rule.text && text.toLowerCase().endsWith(rule.text.toLowerCase());
    case "containsBlanks":
      return !text.trim();
    case "notContainsBlanks":
      return !!text.trim();
    case "containsErrors":
      return isErr(v);
    case "notContainsErrors":
      return !isErr(v);
    case "duplicateValues":
    case "uniqueValues": {
      if (v === undefined || v === "" || isErr(v)) return false;
      const n = statsOf(cf).counts.get(typeof v === "string" ? v.toLowerCase() : String(v)) ?? 0;
      return rule.type === "duplicateValues" ? n > 1 : n === 1;
    }
    case "top10": {
      if (typeof v !== "number") return false;
      const sorted = [...statsOf(cf).nums].sort((a, b) => (rule.bottom ? a - b : b - a));
      const k = rule.percent ? Math.max(1, Math.floor((sorted.length * (rule.rank ?? 10)) / 100)) : (rule.rank ?? 10);
      const edge = sorted[Math.min(k, sorted.length) - 1];
      return edge !== undefined && (rule.bottom ? v <= edge : v >= edge);
    }
    case "aboveAverage": {
      if (typeof v !== "number") return false;
      const nums = statsOf(cf).nums;
      const avg = nums.reduce((s, x) => s + x, 0) / (nums.length || 1);
      if (rule.aboveAverage === false) return rule.equalAverage ? v <= avg : v < avg;
      return rule.equalAverage ? v >= avg : v > avg;
    }
    default:
      // timePeriod, iconSet and the like are left out
      return false;
  }
}
