/**
 * Smart split: finds where each document starts in a PDF that holds several,
 * like a stack of letters, invoices and statements scanned in one go. Every
 * page is scored for "a new document starts here" from what people use
 * themselves: page numbers, titles, letter greetings, running headers and
 * footers, reference numbers, page size and blank separator sheets. It runs on
 * the page text alone, so nothing leaves the browser.
 */

/** One line of page text; `y` is its top as a share of the page height (0 top, 1 bottom). */
export type PageLine = { text: string; y: number; size: number; /** Left edge as a share of the page width. */ x?: number };

export type PageInfo = {
  lines: PageLine[];
  width: number;
  height: number;
  /** No text and next to no ink: a separator sheet. */
  blank: boolean;
  /** Font names the page's text uses (text PDFs only; a scan has none). */
  fonts?: string[];
  /** The page is a picture of a page (its text, if any, came from OCR). */
  scanned?: boolean;
};

export type DocStart = {
  /** Zero-based page where the document starts. */
  page: number;
  /** A short name from the page: its title and any reference number. */
  label: string;
  /** Why the cut was made, in plain words. */
  reasons: string[];
  score: number;
};

export type SmartPlan = {
  starts: DocStart[];
  /** Zero-based blank separator pages, left out of every file. */
  blanks: number[];
  /** Every page after the first of a run, with its score, so near misses can be offered. */
  scored: { page: number; score: number; reasons: string[] }[];
};

/** A new document starts at a page that scores this much or more. */
export const CUT_SCORE = 2.5;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

type PageMark = { n: number; of?: number };

const MARKS: RegExp[] = [
  /\b(?:page|página|pagina|seite|pág\.?|p\.)\s*(\d{1,3})\s*(?:of|de|von|sur|di|\/)\s*(\d{1,3})\b/i,
  /^\s*(\d{1,3})\s*(?:of|\/)\s*(\d{1,3})\s*$/i,
  /\b(?:page|página|pagina|seite)\s+(\d{1,3})\b/i,
  /^\s*[-–—]\s*(\d{1,3})\s*[-–—]\s*$/,
];

/** The page's own page number, read from its first and last lines. */
export function pageMark(lines: PageLine[]): PageMark | null {
  const edge = [...lines.filter((l) => l.y > 0.85), ...lines.filter((l) => l.y < 0.12)];
  for (const re of MARKS) {
    for (const line of edge) {
      const m = line.text.match(re);
      if (m) {
        const n = Number(m[1]);
        const of = m[2] ? Number(m[2]) : undefined;
        if (n >= 1 && (!of || (of >= n && of < 1000))) return { n, of };
      }
    }
  }
  // A bare number alone at the foot of the page.
  const foot = lines.filter((l) => l.y > 0.88).at(-1);
  if (foot && /^\d{1,3}$/.test(foot.text.trim())) return { n: Number(foot.text.trim()) };
  return null;
}

const DOC_WORDS = [
  "invoice", "tax invoice", "receipt", "statement", "statement of account", "bank statement", "agreement", "contract",
  "service agreement", "lease", "memorandum", "memo", "letter", "report", "certificate", "application", "form",
  "policy", "minutes", "quotation", "quote", "estimate", "purchase order", "order confirmation", "bill", "notice",
  "resume", "résumé", "curriculum vitae", "cv", "prescription", "payslip", "pay slip", "delivery note", "packing slip",
  "credit note", "declaration", "affidavit", "newsletter", "proposal", "factura", "rechnung", "facture", "recibo",
];
const DOC_RE = new RegExp(`^(?:${DOC_WORDS.map((w) => w.replace(/ /g, "\\s+")).join("|")})\\b`, "i");

/** Labelled reference numbers on the page: invoice no., account no., policy no. and the like. */
const ID_RE =
  /\b(invoice|receipt|order|account|acct|policy|reference|ref|statement|contract|agreement|claim|case|po|customer|form)\s*(?:no\.?|number|num\.?|#|nº|n°)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/]*\d[A-Z0-9\-/]*)/gi;

export function pageIds(lines: PageLine[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const line of lines) {
    for (const m of line.text.matchAll(ID_RE)) {
      const label = m[1].toLowerCase().replace(/^acct$/, "account").replace(/^ref$/, "reference");
      if (!ids.has(label) && m[2].length >= 3) ids.set(label, m[2].toUpperCase());
    }
  }
  return ids;
}

/** The running header or footer line, numbers blanked, so "Page 2" and "Page 3" match. */
function edgeKey(lines: PageLine[], top: boolean): string | null {
  const band = top ? lines.filter((l) => l.y < 0.1) : lines.filter((l) => l.y > 0.9);
  if (!band.length) return null;
  const key = norm(band.map((l) => l.text).join(" ")).replace(/\d+/g, "#").replace(/[^\p{L}#]+/gu, " ").trim();
  return key.replace(/#/g, "").trim().length >= 4 ? key : null;
}

const words = (s: string) => new Set(norm(s).split(/[^\p{L}]+/u).filter((w) => w.length > 2));
function similar(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size);
}

function medianSize(lines: PageLine[]) {
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  return sizes[Math.floor((sizes.length - 1) / 2)] ?? 10;
}

/** The page's title: a document word near the top, else its biggest line near the top. */
export function pageTitle(lines: PageLine[]): { text: string; docWord: boolean } | null {
  const top = lines.filter((l) => l.y < 0.5 && l.text.trim().length >= 2);
  const docLine = top.find((l) => DOC_RE.test(l.text.trim()) && l.text.trim().split(/\s+/).length <= 7);
  if (docLine) return { text: docLine.text.trim(), docWord: true };
  const body = medianSize(lines);
  const big = top.filter((l) => l.size >= body * 1.35 && /\p{L}{3}/u.test(l.text)).sort((a, b) => b.size - a.size)[0];
  return big ? { text: big.text.trim(), docWord: false } : null;
}

const bodyLines = (lines: PageLine[]) => lines.filter((l) => l.y >= 0.08 && l.y <= 0.92 && !MARKS.some((re) => re.test(l.text)));

/** A short file name for a document from its first page: title plus a reference number. */
export function docLabel(page: PageInfo): string {
  const title = pageTitle(page.lines)?.text ?? page.lines.find((l) => /\p{L}{3}/u.test(l.text))?.text ?? "Document";
  const ids = pageIds(page.lines);
  const id = [...ids.values()][0];
  const short = title.replace(/\s+/g, " ").slice(0, 48).trim();
  return id && !short.toUpperCase().includes(id) ? `${short} ${id}` : short;
}

/** How strongly page `i` looks like the first page of a new document, with the reasons. */
export function scoreStart(pages: PageInfo[], i: number, docFirst: number): { score: number; reasons: string[] } {
  const page = pages[i];
  const prev = pages[i - 1];
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, why?: string) => {
    score += points;
    if (why && points > 0) reasons.push(why);
  };

  const mark = pageMark(page.lines);
  const prevMark = pageMark(prev.lines);
  if (mark?.n === 1) add(3, mark.of ? `says page 1 of ${mark.of}` : "says page 1");
  else if (mark && prevMark && mark.n === prevMark.n + 1 && (!mark.of || !prevMark.of || mark.of === prevMark.of)) add(-5);
  else if (mark && mark.n > 1) add(-2);
  // The page before said it was the last of its document.
  if (prevMark?.of && prevMark.n === prevMark.of) add(2, `page ${i} was the last of ${prevMark.of}`);
  if (prevMark?.of && prevMark.n < prevMark.of && !(mark?.n === 1)) add(-3);

  // Words that open the page are a title; further down they may be a section heading.
  const title = pageTitle(page.lines);
  const opens = title && page.lines.find((l) => /\p{L}{2}/u.test(l.text))?.text.trim() === title.text;
  if (title && /\b(continued|cont'?d|cont\.)|\(cont/i.test(title.text)) add(-2.5);
  else if (title?.docWord) add(opens ? 2.5 : 2, `starts with "${title.text.slice(0, 40)}"`);
  else if (title) add(opens ? 1.5 : 1, `big heading "${title.text.slice(0, 40)}"`);

  const top = page.lines.filter((l) => l.y < 0.55);
  if (top.some((l) => /^(dear|to whom it may concern|hello|hi)\b/i.test(l.text.trim()))) add(1.5, "letter greeting");

  const head = edgeKey(page.lines, true);
  const prevHead = edgeKey(prev.lines, true);
  const foot = edgeKey(page.lines, false);
  const prevFoot = edgeKey(prev.lines, false);
  const same = (a: string | null, b: string | null) => !!a && !!b && (a === b || similar(a, b) >= 0.8);
  if (same(head, prevHead) || same(foot, prevFoot)) add(-2.5);
  else if ((head && prevHead) || (foot && prevFoot)) add(1, "header or footer changes");

  const ids = pageIds(page.lines);
  const before = new Map<string, string>();
  for (let k = docFirst; k < i; k++) for (const [key, value] of pageIds(pages[k].lines)) if (!before.has(key)) before.set(key, value);
  let shared = false;
  let changed: string | null = null;
  for (const [key, value] of ids) {
    if (!before.has(key)) continue;
    if (before.get(key) === value) shared = true;
    else changed ??= `${key} ${value}`;
  }
  if (changed && !shared) add(3, `new ${changed}`);
  else if (shared) add(-2);

  const dw = Math.abs(page.width - prev.width) / prev.width;
  const dh = Math.abs(page.height - prev.height) / prev.height;
  if (dw > 0.1 && dh > 0.1) add(2, "page size changes");
  else if (dw > 0.03 || dh > 0.03) add(1.5, "page size changes");

  // Layout: documents differ in body text size, typeface and margins; pages of one document do not.
  const body = bodyLines(page.lines);
  const prevBody = bodyLines(prev.lines);
  if (body.length >= 3 && prevBody.length >= 3) {
    const a = medianSize(body);
    const b = medianSize(prevBody);
    if (Math.max(a, b) / Math.min(a, b) > 1.18) add(1, "text size changes");
    const left = (ls: PageLine[]) => {
      const xs = ls.map((l) => l.x).filter((x): x is number => x !== undefined).sort((m, n) => m - n);
      return xs.length ? xs[Math.floor(xs.length / 4)] : undefined;
    };
    const la = left(body);
    const lb = left(prevBody);
    if (la !== undefined && lb !== undefined && Math.abs(la - lb) > 0.05) add(0.5, "margins change");
  }
  if (page.fonts?.length && prev.fonts?.length) {
    const mine = new Set(page.fonts);
    const both = prev.fonts.filter((f) => mine.has(f)).length;
    if (both === 0) add(1.5, "different fonts");
    else if (both === mine.size && both === new Set(prev.fonts).size) add(-1);
  }

  // A page of a line or two with no title is the end of the page before spilling over.
  const wordy = page.lines.filter((l) => /\p{L}{2}/u.test(l.text)).length;
  if (wordy >= 1 && wordy <= 2 && !title) add(-2);

  // One document is scanned or typed throughout; a switch between the two is a different source.
  if (!!page.scanned !== !!prev.scanned) add(1.5, page.scanned ? "a scanned page after typed ones" : "a typed page after scanned ones");

  // The page before closed with a sign-off.
  const closing = bodyLines(prev.lines).slice(-6);
  if (closing.some((l) => /^(yours (sincerely|faithfully|truly)|sincerely|kind regards|best regards|warm regards|regards|thank you for your business|authori[sz]ed signature)\b/i.test(l.text.trim()))) {
    add(1, `page ${i} ends with a sign-off`);
  }

  // A sentence carried over from the page before.
  const last = bodyLines(prev.lines).at(-1)?.text.trim() ?? "";
  const first = bodyLines(page.lines)[0]?.text.trim() ?? "";
  if (/[\p{Ll},;]$/u.test(last) && /^\p{Ll}/u.test(first)) add(-1.5);

  return { score, reasons };
}

/** Where each document starts. Blank sheets end the document before them and are left out. */
export function findDocuments(pages: PageInfo[]): SmartPlan {
  const blanks = pages.flatMap((p, i) => (p.blank ? [i] : []));
  const starts: DocStart[] = [];
  const scored: SmartPlan["scored"] = [];
  let docFirst = -1;
  let afterBlank = false;
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].blank) {
      afterBlank = docFirst >= 0;
      continue;
    }
    if (docFirst < 0) {
      starts.push({ page: i, label: docLabel(pages[i]), reasons: ["first page"], score: Infinity });
      docFirst = i;
      afterBlank = false;
      continue;
    }
    // Compare with the last page that has content, skipping blank sheets.
    const view = pages.slice(0, i + 1).filter((p, k) => !p.blank || k === i);
    const at = view.length - 1;
    const first = pages.slice(0, docFirst).filter((p) => !p.blank).length;
    const { score, reasons } = scoreStart(view, at, first);
    const total = score + (afterBlank ? 1.5 : 0);
    if (afterBlank) reasons.unshift("after a blank page");
    scored.push({ page: i, score: total, reasons });
    if (total >= CUT_SCORE) {
      starts.push({ page: i, label: docLabel(pages[i]), reasons, score: total });
      docFirst = i;
    }
    afterBlank = false;
  }
  return { starts, blanks, scored };
}

/** A page the finder nearly cut at, offered as an extra cut the person can switch on. */
export const MAYBE_SCORE = 1;

export type SmartChoice = {
  /** Detected starts switched off (merged into the document before). */
  off: number[];
  /** Near misses switched on. */
  on: number[];
  /** Leave blank separator sheets out of the files. */
  dropBlank: boolean;
};

export type SmartDoc = { label: string; pages: number[]; reasons: string[] };

/** The files to make: each document's pages, in order. */
export function smartDocs(plan: SmartPlan, pages: PageInfo[], choice: SmartChoice): SmartDoc[] {
  const cuts = new Map<number, { label: string; reasons: string[] }>();
  plan.starts.forEach((s, i) => {
    if (i === 0 || !choice.off.includes(s.page)) cuts.set(s.page, { label: s.label, reasons: s.reasons });
  });
  for (const page of choice.on) {
    const near = plan.scored.find((s) => s.page === page);
    if (near && page < pages.length) cuts.set(page, { label: docLabel(pages[page]), reasons: near.reasons });
  }
  const order = [...cuts.keys()].sort((a, b) => a - b);
  const blank = new Set(choice.dropBlank ? plan.blanks : []);
  return order
    .map((first, i) => {
      const end = (order[i + 1] ?? pages.length) - 1;
      const list: number[] = [];
      for (let p = i === 0 ? 0 : first; p <= end; p++) if (!blank.has(p)) list.push(p);
      return { ...cuts.get(first)!, pages: list };
    })
    .filter((d) => d.pages.length);
}

/** Near misses worth offering, best first. */
export function maybeCuts(plan: SmartPlan) {
  const taken = new Set(plan.starts.map((s) => s.page));
  return plan.scored.filter((s) => s.score >= MAYBE_SCORE && !taken.has(s.page)).sort((a, b) => b.score - a.score);
}

/** Groups pdf.js-style text items (top-left y in points) into lines. */
export function linesFromItems(
  items: { str: string; x: number; y: number; size: number }[],
  pageHeight: number,
  pageWidth?: number,
): PageLine[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; size: number; parts: { x: number; s: string }[] }[] = [];
  for (const item of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(line.y - item.y) <= Math.max(2, item.size * 0.4)) {
      line.parts.push({ x: item.x, s: item.str });
      line.size = Math.max(line.size, item.size);
    } else lines.push({ y: item.y, size: item.size, parts: [{ x: item.x, s: item.str }] });
  }
  return lines.map((l) => ({
    text: l.parts.sort((a, b) => a.x - b.x).map((p) => p.s.trim()).join(" ").replace(/\s+/g, " "),
    y: Math.max(0, Math.min(1, (l.y - l.size) / pageHeight)),
    size: l.size,
    x: pageWidth ? Math.min(...l.parts.map((p) => p.x)) / pageWidth : undefined,
  }));
}
