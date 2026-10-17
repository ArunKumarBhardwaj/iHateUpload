/** Decides what a piece of table text is: a number, a date or plain text. Pure, no DOM. */

export type Typed =
  | { kind: "blank" }
  | { kind: "text"; text: string }
  | { kind: "number"; value: number; fmt: string }
  | { kind: "date"; value: number; fmt: string }
  /** A d/m/y or m/d/y date the whole column has yet to settle. */
  | { kind: "slash"; text: string; a: number; b: number; y: number; yearDigits: number };

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

function parseDate(s: string): Typed | null {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const v = excelSerial(+m[1], +m[2], +m[3]);
    return v === null ? null : { kind: "date", value: v, fmt: "yyyy-mm-dd" };
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m && monthOf(m[2])) {
    const v = excelSerial(+m[3], monthOf(m[2]), +m[1]);
    return v === null ? null : { kind: "date", value: v, fmt: isShort(m[2]) ? "d mmm yyyy" : "d mmmm yyyy" };
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && monthOf(m[1])) {
    const v = excelSerial(+m[3], monthOf(m[1]), +m[2]);
    return v === null ? null : { kind: "date", value: v, fmt: isShort(m[1]) ? "mmm d, yyyy" : "mmmm d, yyyy" };
  }
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
    return { kind: "slash", text: s, a: +m[1], b: +m[2], y, yearDigits: m[3].length };
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
  let symbol = "";
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
  const grouped = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(body);
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

const TEXT_HEADER = /\b(zip|postal|post\s*code|id|ids|code|phone|tel|fax|account|acct|ref|reference|sku|part|isbn|barcode|number|no\.?|#)\b/i;

/**
 * Types one column. Slash dates need the other rows to tell day first from month first,
 * and columns named like identifiers keep their digits as text.
 */
export function typeColumn(texts: string[], header?: string): Typed[] {
  const idLike = !!header && TEXT_HEADER.test(header);
  const typed = texts.map(parseCell);
  const slashes = typed.filter((t): t is Extract<Typed, { kind: "slash" }> => t.kind === "slash");
  let order: "dmy" | "mdy" | null = null;
  if (slashes.length) {
    const dayFirst = slashes.some((t) => t.a > 12);
    const monthFirst = slashes.some((t) => t.b > 12);
    if (dayFirst && !monthFirst) order = "dmy";
    else if (monthFirst && !dayFirst) order = "mdy";
  }
  return typed.map((t, i): Typed => {
    if (t.kind === "slash") {
      if (!order) return { kind: "text", text: t.text };
      const v = excelSerial(t.y, order === "dmy" ? t.b : t.a, order === "dmy" ? t.a : t.b);
      if (v === null) return { kind: "text", text: t.text };
      const year = t.yearDigits === 2 ? "yy" : "yyyy";
      return { kind: "date", value: v, fmt: order === "dmy" ? `dd/mm/${year}` : `mm/dd/${year}` };
    }
    if (idLike && t.kind === "number" && !/[.,%$€£¥₹()]/.test(texts[i])) return { kind: "text", text: texts[i].trim() };
    return t;
  });
}
