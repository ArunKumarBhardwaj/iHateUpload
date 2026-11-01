/** Decides what a piece of table text is: a number, a date or plain text. Pure, no DOM. */

export type Typed =
  | { kind: "blank" }
  | { kind: "text"; text: string }
  | { kind: "number"; value: number; fmt: string }
  | { kind: "date"; value: number; fmt: string }
  /** A d/m/y or m/d/y date the whole column has yet to settle. */
  | { kind: "slash"; text: string; a: number; b: number; y: number; yearDigits: number; sep: string };

const CURRENCY = "$€£¥₹";

/** Days from 1899-12-30, which is how Excel counts. */
export function excelSerial(y: number, m: number, d: number): number | null {
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86400000) + 25569;
}

const FULL = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** 1..12 for a month name or its usual short form, else 0. */
function monthOf(word: string): number {
  const w = word.toLowerCase();
  const k = FULL.findIndex((f) => f === w || (w.length >= 3 && f.startsWith(w) && w.length <= 4));
  return k + 1;
}
const isShort = (word: string) => word.length <= 4;

const twoDigitYear = (y: string) => (y.length === 2 ? +y + (+y < 70 ? 2000 : 1900) : +y);

function parseDate(s: string): Typed | null {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const v = excelSerial(+m[1], +m[2], +m[3]);
    return v === null ? null : { kind: "date", value: v, fmt: "yyyy-mm-dd" };
  }
  m = /^(\d{4})([/.])(\d{1,2})\2(\d{1,2})$/.exec(s);
  if (m) {
    const v = excelSerial(+m[1], +m[3], +m[4]);
    return v === null ? null : { kind: "date", value: v, fmt: `yyyy${m[2]}mm${m[2]}dd` };
  }
  // 1 Apr 2024, 01-Apr-24, 01/APR/2024, 5 March, 2026
  m = /^(\d{1,2})([-\s/.])([A-Za-z]{3,9})\.?,?\2?\s*(\d{4}|\d{2})$/.exec(s);
  if (m && monthOf(m[3]) && (m[2] === " " || s.split(m[2]).length === 3)) {
    const v = excelSerial(twoDigitYear(m[4]), monthOf(m[3]), +m[1]);
    const day = /^0\d/.test(m[1]) ? "dd" : "d";
    const sep = m[2] === " " ? " " : m[2];
    return v === null ? null : { kind: "date", value: v, fmt: `${day}${sep}${isShort(m[3]) ? "mmm" : "mmmm"}${sep}${m[4].length === 2 ? "yy" : "yyyy"}` };
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && monthOf(m[1])) {
    const v = excelSerial(+m[3], monthOf(m[1]), +m[2]);
    return v === null ? null : { kind: "date", value: v, fmt: isShort(m[1]) ? "mmm d, yyyy" : "mmmm d, yyyy" };
  }
  m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{2}|\d{4})$/.exec(s);
  if (m) {
    return { kind: "slash", text: s, a: +m[1], b: +m[3], y: twoDigitYear(m[4]), yearDigits: m[4].length, sep: m[2] };
  }
  return null;
}

function decimalsFmt(decimals: number, grouped: boolean): string {
  const whole = grouped ? "#,##0" : "0";
  return decimals > 0 ? `${whole}.${"0".repeat(decimals)}` : whole;
}

export function parseCell(raw: string): Typed {
  const s = raw.replace(/ /g, " ").trim();
  if (!s) return { kind: "blank" };
  const date = parseDate(s);
  if (date) return date;

  let body = s;
  let negative = false;
  let parens = false;
  if (/^\(.*\)$/.test(body)) {
    parens = true;
    negative = true;
    body = body.slice(1, -1).trim();
  }
  if (body.endsWith("-") && !body.startsWith("-")) {
    negative = true;
    body = body.slice(0, -1).trim();
  }
  // Bank statements: "12,345.00 Cr", "1,500.00(Dr)", "CR 2,000.00". Dr is money out.
  const side = /^(.*?\d)\s*\(?\s*(cr|dr)\.?\s*\)?$/i.exec(body) ?? /^\(?(cr|dr)\.?\)?\s+(.*\d)$/i.exec(body);
  if (side) {
    const [num, tag] = /\d/.test(side[1]) ? [side[1], side[2]] : [side[2], side[1]];
    if (tag.toLowerCase() === "dr") negative = !negative;
    body = num.trim();
  }
  let symbol = "";
  const rupee = /^(?:inr|rs\.?)\s*/i.exec(body);
  if (rupee && /\d/.test(body[rupee[0].length] ?? "")) body = "₹" + body.slice(rupee[0].length);
  const sign = /^([-+−])\s*/.exec(body);
  if (sign) {
    if (sign[1] !== "+") negative = true;
    body = body.slice(sign[0].length);
  }
  if (body && CURRENCY.includes(body[0])) {
    symbol = body[0];
    body = body.slice(1).trim();
    const again = /^([-+−])\s*/.exec(body);
    if (again) {
      if (again[1] !== "+") negative = true;
      body = body.slice(again[0].length);
    }
  }
  let percent = false;
  if (body.endsWith("%")) {
    percent = true;
    body = body.slice(0, -1).trim();
  }
  if (percent && symbol) return { kind: "text", text: s };

  // European style: 1.234,56
  const european = /^\d{1,3}(\.\d{3})+,\d+$/.test(body);
  if (european) body = body.replace(/\./g, "").replace(",", ".");
  // 123,456.78 or the Indian 1,23,456.78
  const grouped = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(body) || /^\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/.test(body);
  if (!european && !grouped && !/^(\d+(\.\d+)?|\.\d+)$/.test(body)) return { kind: "text", text: s };
  if (grouped) body = body.replace(/,/g, "");
  const intPart = body.split(".")[0];
  // Leading zeros and long digit runs are identifiers, not quantities.
  if (!body.includes(".") && !percent && /^0\d/.test(intPart)) return { kind: "text", text: s };
  if (!grouped && intPart.length >= 11) return { kind: "text", text: s };
  if (intPart.length > 15) return { kind: "text", text: s };

  const decimals = body.includes(".") ? body.split(".")[1].length : 0;
  let value = Number(body);
  if (!Number.isFinite(value)) return { kind: "text", text: s };
  if (percent) {
    value = Math.round((value / 100) * 1e10) / 1e10;
    if (negative) value = -value;
    return { kind: "number", value, fmt: `${decimalsFmt(decimals, false)}%` };
  }
  if (negative) value = -value;
  const base = decimalsFmt(decimals, grouped || european || !!symbol);
  const pos = symbol ? `"${symbol}"${base}` : base;
  return { kind: "number", value, fmt: parens ? `${pos}_);\\(${pos}\\)` : pos };
}

type Slash = Extract<Typed, { kind: "slash" }>;

/** When every day is 12 or less, the order that keeps the rows in date order (up or down) is the right one. */
function sequenceOrder(slashes: Slash[]): "dmy" | "mdy" | null {
  if (slashes.length < 3) return null;
  const fits = (order: "dmy" | "mdy") => {
    const v = slashes.map((t) => excelSerial(t.y, order === "dmy" ? t.b : t.a, order === "dmy" ? t.a : t.b));
    if (v.some((x) => x === null)) return false;
    const n = v as number[];
    return n.every((x, i) => i === 0 || x >= n[i - 1]) || n.every((x, i) => i === 0 || x <= n[i - 1]);
  };
  const dmy = fits("dmy");
  const mdy = fits("mdy");
  return dmy === mdy ? null : dmy ? "dmy" : "mdy";
}

const TEXT_HEADER = /\b(zip|postal|post\s*code|id|ids|code|phone|tel|fax|account|acct|ref|reference|sku|part|isbn|barcode|number|no\.?|#)\b/i;

/**
 * Types one column. Slash dates need the other rows to tell day first from month first,
 * and columns named like identifiers keep their digits as text.
 */
export function typeColumn(texts: string[], header?: string, fallbackOrder?: "dmy" | "mdy"): Typed[] {
  const idLike = !!header && TEXT_HEADER.test(header);
  const typed = texts.map(parseCell);
  const slashes = typed.filter((t): t is Slash => t.kind === "slash");
  let order: "dmy" | "mdy" | null = null;
  if (slashes.length) {
    const dayFirst = slashes.some((t) => t.a > 12);
    const monthFirst = slashes.some((t) => t.b > 12);
    if (dayFirst && !monthFirst) order = "dmy";
    else if (monthFirst && !dayFirst) order = "mdy";
  }
  order ??= sequenceOrder(slashes) ?? fallbackOrder ?? null;
  return typed.map((t, i): Typed => {
    if (t.kind === "slash") {
      if (!order) return { kind: "text", text: t.text };
      const v = excelSerial(t.y, order === "dmy" ? t.b : t.a, order === "dmy" ? t.a : t.b);
      if (v === null) return { kind: "text", text: t.text };
      const year = t.yearDigits === 2 ? "yy" : "yyyy";
      return { kind: "date", value: v, fmt: order === "dmy" ? `dd${t.sep}mm${t.sep}${year}` : `mm${t.sep}dd${t.sep}${year}` };
    }
    if (idLike && t.kind === "number" && !/[.,%$€£¥₹()]/.test(texts[i])) return { kind: "text", text: texts[i].trim() };
    return t;
  });
}

/** What a column holds, as the person can set it. "auto" lets the text decide. */
export type ColType = "auto" | "text" | "number" | "date" | "currency" | "percent";

const decimalsOf = (fmt: string) => /\.(0+)/.exec(fmt)?.[1].length ?? 0;
const asText = (t: string): Typed => (t.trim() ? { kind: "text", text: t } : { kind: "blank" });

/** Type a column the way the person asked. Cells that do not fit the type stay text. */
export function typeAs(texts: string[], type: ColType, header?: string, dateOrder?: "dmy" | "mdy"): Typed[] {
  if (type === "auto") return typeColumn(texts, header, dateOrder);
  if (type === "text") return texts.map(asText);
  if (type === "date") {
    return typeColumn(texts, undefined, dateOrder ?? "mdy").map((t, i) => (t.kind === "date" ? t : asText(texts[i])));
  }
  return texts.map((raw): Typed => {
    // Asked for a number, a code like 00123 is the number 123.
    const t = /^\s*\d+\s*$/.test(raw) ? { kind: "number" as const, value: Number(raw), fmt: "0" } : parseCell(raw);
    if (t.kind !== "number") return asText(raw);
    if (type === "number") return t;
    if (type === "currency") return t.fmt.includes('"') ? t : { ...t, fmt: `"$"#,##0.${"0".repeat(Math.max(2, decimalsOf(t.fmt)))}` };
    if (t.fmt.includes("%")) return t;
    const d = decimalsOf(t.fmt);
    return { kind: "number", value: Math.round((t.value / 100) * 1e10) / 1e10, fmt: `0${d ? "." + "0".repeat(d) : ""}%` };
  });
}
