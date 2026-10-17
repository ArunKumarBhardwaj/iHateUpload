/**
 * Finds personal data in page text. Pure functions, no DOM, so every rule is
 * unit-tested. Checksums (Luhn, Verhoeff, mod-97) keep random digit runs out.
 */

export type PiiCategory =
  | "email"
  | "phone"
  | "card"
  | "aadhaar"
  | "pan"
  | "ifsc"
  | "account"
  | "iban"
  | "ssn"
  | "dob"
  | "custom";

export const PII_CATEGORIES: { id: PiiCategory; label: string }[] = [
  { id: "email", label: "Email addresses" },
  { id: "phone", label: "Phone numbers" },
  { id: "card", label: "Card numbers" },
  { id: "aadhaar", label: "Aadhaar" },
  { id: "pan", label: "PAN" },
  { id: "ifsc", label: "IFSC codes" },
  { id: "account", label: "Bank accounts" },
  { id: "iban", label: "IBAN" },
  { id: "ssn", label: "US SSN" },
  { id: "dob", label: "Dates of birth" },
  { id: "custom", label: "Your words" },
];

export type PiiMatch = {
  category: PiiCategory;
  start: number;
  end: number;
  text: string;
};

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** True when the last digit is a correct Verhoeff check digit. */
export function verhoeff(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(rev[i])]];
  }
  return c === 0;
}

/** The digit that makes `body + digit` pass `verhoeff`. */
export function verhoeffCheckDigit(body: string): number {
  let c = 0;
  const rev = body.split("").reverse();
  for (let i = 0; i < rev.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][Number(rev[i])]];
  }
  return VERHOEFF_INV[c];
}

export function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export function iban97(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const code = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

type Candidate = PiiMatch & { rank: number };

const RANK: Record<PiiCategory, number> = {
  custom: 0,
  card: 1,
  iban: 2,
  aadhaar: 3,
  ssn: 4,
  pan: 5,
  ifsc: 6,
  email: 7,
  dob: 8,
  account: 9,
  phone: 10,
};

const DATE =
  "(?:\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Za-z]{3,9},?\\s+\\d{4}|[A-Za-z]{3,9}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})";

const RE = {
  email: /(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g,
  cardRun: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g,
  amex: /(?<!\d)3[47]\d{2}[ -]?\d{6}[ -]?\d{5}(?!\d)/g,
  aadhaar: /(?<!\d)[2-9]\d{3}([ -]?)\d{4}\1\d{4}(?![ -]?\d)/g,
  pan: /(?<![A-Z0-9])[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z](?![A-Z0-9])/g,
  ifsc: /(?<![A-Z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Z0-9])/g,
  account:
    /(?:a\/c|acc(?:oun)?t)\b[\s\w.#:/-]{0,18}?[:#\s-]\s*(\d{9,18})(?!\d)/gi,
  iban: /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])/g,
  ssn: /(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/g,
  dob: new RegExp(
    `(?:\\bd\\.?\\s?o\\.?\\s?b\\b\\.?|date\\s+of\\s+birth|birth\\s*date|born(?:\\s+on)?)\\s*[:\\-]?\\s*(${DATE})`,
    "gi",
  ),
  phoneIn: /(?<![\w+])(?:(?:\+|00)91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g,
  phoneIntl:
    /(?<![\w+])\+(?!91\b)\d{1,3}[ .-]?(?:\(\d{1,4}\)[ .-]?)?\d{1,4}(?:[ .-]?\d{2,4}){1,4}(?!\d)/g,
  phoneUs:
    /(?<![\w+])(?:\+?1[ .-]?)?(?:\(\d{3}\)\s?|\d{3}[ .-])\d{3}[ .-]\d{4}(?!\d)/g,
};

const digitsOf = (s: string) => s.replace(/\D/g, "");

function each(
  re: RegExp,
  text: string,
  fn: (m: RegExpExecArray) => void,
) {
  const r = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text))) {
    if (m[0].length === 0) {
      r.lastIndex++;
      continue;
    }
    fn(m);
  }
}

function pushRange(
  out: Candidate[],
  category: PiiCategory,
  text: string,
  start: number,
  end: number,
) {
  out.push({ category, start, end, text: text.slice(start, end), rank: RANK[category] });
}

function customRegexes(custom: string): RegExp[] {
  const out: RegExp[] = [];
  for (const raw of custom.split(/[\n,]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const asRegex = /^\/(.+)\/([a-z]*)$/.exec(line);
    try {
      if (asRegex) {
        const flags = asRegex[2].includes("g") ? asRegex[2] : asRegex[2] + "g";
        out.push(new RegExp(asRegex[1], flags));
      } else {
        out.push(new RegExp(line.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "gi"));
      }
    } catch {
      // A broken pattern is skipped; the rest still run.
    }
  }
  return out;
}

export type DetectOptions = {
  /** Which categories to look for. Omit for all. */
  categories?: Set<PiiCategory>;
  /** Words (one per line or comma) or /regex/flags. */
  custom?: string;
};

export function detectPii(text: string, options: DetectOptions = {}): PiiMatch[] {
  const want = (c: PiiCategory) => !options.categories || options.categories.has(c);
  const found: Candidate[] = [];

  if (want("custom") && options.custom) {
    for (const re of customRegexes(options.custom)) {
      each(re, text, (m) => pushRange(found, "custom", text, m.index, m.index + m[0].length));
    }
  }
  if (want("email")) {
    each(RE.email, text, (m) => pushRange(found, "email", text, m.index, m.index + m[0].length));
  }
  if (want("card")) {
    const add = (m: RegExpExecArray) => {
      const d = digitsOf(m[0]);
      if (d.length >= 13 && d.length <= 19 && luhn(d)) {
        pushRange(found, "card", text, m.index, m.index + m[0].length);
      }
    };
    each(RE.cardRun, text, add);
    each(RE.amex, text, add);
  }
  if (want("aadhaar")) {
    each(RE.aadhaar, text, (m) => {
      if (verhoeff(digitsOf(m[0]))) {
        pushRange(found, "aadhaar", text, m.index, m.index + m[0].length);
      }
    });
  }
  if (want("pan")) {
    each(RE.pan, text, (m) => pushRange(found, "pan", text, m.index, m.index + m[0].length));
  }
  if (want("ifsc")) {
    each(RE.ifsc, text, (m) => pushRange(found, "ifsc", text, m.index, m.index + m[0].length));
  }
  if (want("account")) {
    each(RE.account, text, (m) => {
      const at = m.index + m[0].lastIndexOf(m[1]);
      pushRange(found, "account", text, at, at + m[1].length);
    });
  }
  if (want("iban")) {
    each(RE.iban, text, (m) => {
      const tokens = m[0].split(" ");
      for (let n = tokens.length; n >= 1; n--) {
        const candidate = tokens.slice(0, n).join(" ");
        if (candidate.length >= 15 && iban97(candidate)) {
          pushRange(found, "iban", text, m.index, m.index + candidate.length);
          return;
        }
      }
    });
  }
  if (want("ssn")) {
    each(RE.ssn, text, (m) => pushRange(found, "ssn", text, m.index, m.index + m[0].length));
  }
  if (want("dob")) {
    each(RE.dob, text, (m) => {
      const at = m.index + m[0].lastIndexOf(m[1]);
      pushRange(found, "dob", text, at, at + m[1].length);
    });
  }
  if (want("phone")) {
    const add = (m: RegExpExecArray) => {
      const n = digitsOf(m[0]).length;
      if (n >= 10 && n <= 15) {
        pushRange(found, "phone", text, m.index, m.index + m[0].length);
      }
    };
    each(RE.phoneIn, text, add);
    each(RE.phoneIntl, text, add);
    each(RE.phoneUs, text, add);
  }

  found.sort((a, b) => a.rank - b.rank || a.start - b.start);
  const kept: Candidate[] = [];
  for (const c of found) {
    if (kept.some((k) => c.start < k.end && k.start < c.end)) continue;
    kept.push(c);
  }
  return kept
    .sort((a, b) => a.start - b.start)
    .map(({ category, start, end, text: t }) => ({ category, start, end, text: t }));
}

/** A run of text with its place on the page, in 0..1 ratios, origin top-left. */
export type TextSpan = { text: string; x: number; y: number; w: number; h: number };

export type PageText = {
  text: string;
  parts: { spanIndex: number; start: number; end: number; line: number }[];
  spans: TextSpan[];
};

/** Joins spans into one string; same-line neighbours get a space, new lines a newline. */
export function spansToPageText(spans: TextSpan[]): PageText {
  let text = "";
  let line = 0;
  const parts: PageText["parts"] = [];
  spans.forEach((span, spanIndex) => {
    if (!span.text) return;
    const prev = spans[spanIndex - 1];
    if (prev && parts.length > 0) {
      const h = Math.max(prev.h, span.h, 1e-6);
      const sameLine = Math.abs(span.y + span.h / 2 - (prev.y + prev.h / 2)) < h * 0.6;
      if (sameLine) {
        const gap = span.x - (prev.x + prev.w);
        const endsSpace = /\s$/.test(prev.text) || /^\s/.test(span.text);
        text += gap < h * 0.12 && !endsSpace ? "" : endsSpace ? "" : " ";
      } else {
        text += "\n";
        line++;
      }
    }
    const start = text.length;
    text += span.text;
    parts.push({ spanIndex, start, end: text.length, line });
  });
  return { text, parts, spans };
}

export type RatioRect = { x: number; y: number; w: number; h: number };

/** Boxes (one per line) covering a match, padded so no half letter survives. */
export function matchBoxes(page: PageText, match: PiiMatch): RatioRect[] {
  const perLine = new Map<number, RatioRect>();
  for (const part of page.parts) {
    const a = Math.max(match.start, part.start);
    const b = Math.min(match.end, part.end);
    if (a >= b) continue;
    const span = page.spans[part.spanIndex];
    const len = Math.max(1, part.end - part.start);
    const charW = span.w / len;
    let x0 = span.x + (charW * (a - part.start));
    let x1 = span.x + (charW * (b - part.start));
    x0 -= charW * (a > part.start ? 0.7 : 0.15);
    x1 += charW * (b < part.end ? 0.7 : 0.15);
    const y0 = span.y - span.h * 0.06;
    const y1 = span.y + span.h * 1.06;
    const prev = perLine.get(part.line);
    if (prev) {
      const px1 = prev.x + prev.w;
      const py1 = prev.y + prev.h;
      const nx0 = Math.min(prev.x, x0);
      const nx1 = Math.max(px1, x1);
      const ny0 = Math.min(prev.y, y0);
      const ny1 = Math.max(py1, y1);
      perLine.set(part.line, { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0 });
    } else {
      perLine.set(part.line, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  return [...perLine.values()].map((r) => {
    const x = Math.max(0, r.x);
    const y = Math.max(0, r.y);
    return {
      x,
      y,
      w: Math.min(1 - x, r.w - (x - r.x)),
      h: Math.min(1 - y, r.h - (y - r.y)),
    };
  });
}
