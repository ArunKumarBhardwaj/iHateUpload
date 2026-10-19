import {
  decodePDFRawStream,
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRawStream,
  PDFRef,
  StandardFonts,
} from "@cantoo/pdf-lib";

/** Rectangle in the page's own space (PDF points, origin bottom-left). */
export type UserRect = { x0: number; y0: number; x1: number; y1: number };

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const MAX_FORM_DEPTH = 6;

function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

// ---------- lexer with source offsets ----------

type Tok =
  | { t: "num"; v: number; s: number; e: number }
  | { t: "name"; v: string; s: number; e: number }
  | { t: "str"; bytes: Uint8Array; s: number; e: number }
  | { t: "arr"; items: Tok[]; s: number; e: number }
  | { t: "op"; v: string; s: number; e: number }
  | { t: "other"; s: number; e: number };

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function hexVal(c: number) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}

function lex(b: Uint8Array): Tok[] {
  let i = 0;
  const n = b.length;

  function literal(): Tok {
    const s = i;
    const out: number[] = [];
    let depth = 0;
    for (; i < n; i++) {
      const c = b[i];
      if (c === 0x5c) {
        const d = b[++i];
        if (d === 0x6e) out.push(10);
        else if (d === 0x72) out.push(13);
        else if (d === 0x74) out.push(9);
        else if (d === 0x62) out.push(8);
        else if (d === 0x66) out.push(12);
        else if (d >= 48 && d <= 55) {
          let v = d - 48;
          for (let k = 0; k < 2 && b[i + 1] >= 48 && b[i + 1] <= 55; k++) {
            v = v * 8 + (b[++i] - 48);
          }
          out.push(v & 255);
        } else if (d === 13) {
          if (b[i + 1] === 10) i++;
        } else if (d === 10) {
          /* line continuation */
        } else out.push(d);
      } else if (c === 0x28) {
        if (depth++ > 0) out.push(c);
      } else if (c === 0x29) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    i++;
    return { t: "str", bytes: Uint8Array.from(out), s, e: i };
  }

  function hex(): Tok {
    const s = i;
    i++;
    const nibbles: number[] = [];
    while (i < n && b[i] !== 0x3e) {
      const v = hexVal(b[i]);
      if (v >= 0) nibbles.push(v);
      i++;
    }
    i++;
    if (nibbles.length % 2) nibbles.push(0);
    const bytes = new Uint8Array(nibbles.length / 2);
    for (let k = 0; k < bytes.length; k++) bytes[k] = nibbles[2 * k] * 16 + nibbles[2 * k + 1];
    return { t: "str", bytes, s, e: i };
  }

  function array(): Tok {
    const s = i;
    i++;
    const items: Tok[] = [];
    while (i < n && b[i] !== 0x5d) {
      const tok = next();
      if (!tok) break;
      items.push(tok);
    }
    i++;
    return { t: "arr", items, s, e: i };
  }

  function dict(): Tok {
    const s = i;
    i += 2;
    let depth = 1;
    while (i < n && depth > 0) {
      if (b[i] === 0x3c && b[i + 1] === 0x3c) {
        depth++;
        i += 2;
      } else if (b[i] === 0x3e && b[i + 1] === 0x3e) {
        depth--;
        i += 2;
      } else if (b[i] === 0x28) {
        literal();
      } else i++;
    }
    return { t: "other", s, e: i };
  }

  function next(): Tok | null {
    while (i < n) {
      if (WS.has(b[i])) i++;
      else if (b[i] === 0x25) {
        while (i < n && b[i] !== 10 && b[i] !== 13) i++;
      } else break;
    }
    if (i >= n) return null;
    const c = b[i];
    if (c === 0x28) return literal();
    if (c === 0x3c) return b[i + 1] === 0x3c ? dict() : hex();
    if (c === 0x5b) return array();
    if (c === 0x5d || c === 0x7b || c === 0x7d || c === 0x3e || c === 0x29) {
      const s = i;
      i += c === 0x3e && b[i + 1] === 0x3e ? 2 : 1;
      return { t: "other", s, e: i };
    }
    const s = i;
    i++;
    while (i < n && !WS.has(b[i]) && !DELIM.has(b[i])) i++;
    const word = String.fromCharCode(...b.subarray(s, i));
    if (c === 0x2f) return { t: "name", v: word.slice(1), s, e: i };
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      return { t: "num", v: Number(word), s, e: i };
    }
    if (word === "BI") {
      // Skip the inline image whole so its bytes never read as operators.
      while (i < n) {
        if (
          b[i] === 0x49 &&
          b[i + 1] === 0x44 &&
          WS.has(b[i + 2])
        ) {
          i += 3;
          break;
        }
        i++;
      }
      while (i < n) {
        if (b[i] === 0x45 && b[i + 1] === 0x49 && WS.has(b[i - 1]) && (i + 2 >= n || WS.has(b[i + 2]))) {
          i += 2;
          break;
        }
        i++;
      }
      return { t: "other", s, e: i };
    }
    return { t: "op", v: word, s, e: i };
  }

  const out: Tok[] = [];
  for (let tok = next(); tok; tok = next()) out.push(tok);
  return out;
}

// ---------- fonts ----------

type FontInfo = {
  twoByte: boolean;
  /** Glyph width in 1/1000 text-space units. */
  width: (code: number) => number;
};

let scratch: Promise<PDFDocument> | null = null;
const stdFonts = new Map<string, Awaited<ReturnType<PDFDocument["embedFont"]>>>();

function standardName(base: string): StandardFonts {
  const n = base.replace(/^[A-Z]{6}\+/, "").toLowerCase();
  const bold = /bold|black|heavy|demi/.test(n);
  const italic = /italic|oblique/.test(n);
  if (/courier|mono|consolas/.test(n)) {
    return bold
      ? italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold
      : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
  }
  if (/times|serif|georgia|garamond|palatino|minion|cambria/.test(n) && !/sans/.test(n)) {
    return bold
      ? italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold
      : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
  }
  return bold
    ? italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold
    : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
}

/** Widths for the standard-14 family a BaseFont resembles, from a scratch doc. */
async function standardWidths(base: string): Promise<(code: number) => number> {
  const name = standardName(base);
  scratch ??= PDFDocument.create();
  const doc = await scratch;
  let font = stdFonts.get(name);
  if (!font) {
    font = await doc.embedFont(name);
    stdFonts.set(name, font);
  }
  const f = font;
  const cache = new Map<number, number>();
  return (code) => {
    let w = cache.get(code);
    if (w === undefined) {
      try {
        w = f.widthOfTextAtSize(String.fromCharCode(code), 1000);
      } catch {
        w = 500;
      }
      cache.set(code, w);
    }
    return w;
  };
}

function num(doc: PDFDocument, obj: unknown): number | undefined {
  const v = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

async function buildFont(doc: PDFDocument, dict: PDFDict): Promise<FontInfo> {
  const subtype = dict.get(PDFName.of("Subtype"));
  if (subtype === PDFName.of("Type0")) {
    const desc = dict.lookup(PDFName.of("DescendantFonts"));
    const cid =
      desc instanceof PDFArray ? desc.lookupMaybe(0, PDFDict) : undefined;
    const dw = (cid && num(doc, cid.get(PDFName.of("DW")))) ?? 1000;
    const widths = new Map<number, number>();
    const w = cid?.lookup(PDFName.of("W"));
    if (w instanceof PDFArray) {
      const items = w.asArray().map((o) => (o instanceof PDFRef ? doc.context.lookup(o) : o));
      for (let k = 0; k < items.length; ) {
        const first = items[k];
        const second = items[k + 1];
        if (first instanceof PDFNumber && second instanceof PDFArray) {
          const start = first.asNumber();
          second.asArray().forEach((o, idx) => {
            const v = num(doc, o);
            if (v !== undefined) widths.set(start + idx, v);
          });
          k += 2;
        } else if (
          first instanceof PDFNumber &&
          second instanceof PDFNumber &&
          items[k + 2] instanceof PDFNumber
        ) {
          const to = second.asNumber();
          const v = (items[k + 2] as PDFNumber).asNumber();
          if (to - first.asNumber() < 70000) {
            for (let c = first.asNumber(); c <= to; c++) widths.set(c, v);
          }
          k += 3;
        } else break;
      }
    }
    return { twoByte: true, width: (code) => widths.get(code) ?? dw };
  }

  const baseObj = dict.lookup(PDFName.of("BaseFont"));
  const base = baseObj instanceof PDFName ? baseObj.decodeText() : "Helvetica";
  const first = num(doc, dict.get(PDFName.of("FirstChar"))) ?? 0;
  const arr = dict.lookup(PDFName.of("Widths"));
  const descriptor = dict.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
  const missing = (descriptor && num(doc, descriptor.get(PDFName.of("MissingWidth")))) ?? 0;
  let scale = 1;
  if (subtype === PDFName.of("Type3")) {
    const fm = dict.lookup(PDFName.of("FontMatrix"));
    const a = fm instanceof PDFArray ? num(doc, fm.get(0)) : undefined;
    scale = (a ?? 0.001) * 1000;
  }
  if (arr instanceof PDFArray) {
    const list = arr.asArray().map((o) => num(doc, o) ?? 0);
    const fallback = await standardWidths(base);
    return {
      twoByte: false,
      width: (code) => {
        const idx = code - first;
        if (idx >= 0 && idx < list.length) return list[idx] * scale;
        return missing || fallback(code);
      },
    };
  }
  return { twoByte: false, width: await standardWidths(base) };
}

// ---------- interpreter ----------

type Edit = { s: number; e: number; text: string };

type TextState = {
  font: FontInfo | null;
  size: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  rise: number;
};

function inRect(x: number, y: number, rects: UserRect[]) {
  return rects.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
}

function hexOf(bytes: number[]) {
  return `<${bytes.map((v) => v.toString(16).padStart(2, "0")).join("")}>`;
}

function fmt(n: number) {
  return String(Math.round(n * 1000) / 1000);
}

async function stripStream(
  doc: PDFDocument,
  bytes: Uint8Array,
  resources: PDFDict | undefined,
  start: Matrix,
  rects: UserRect[],
  depth: number,
  formHits: Array<{ ref: PDFRef; stream: PDFRawStream; matrix: Matrix; resources: PDFDict | undefined }>,
): Promise<{ bytes: Uint8Array; removed: number }> {
  const toks = lex(bytes);
  console.log("DBG", toks.length, rects.length, new TextDecoder().decode(bytes.slice(0, 60)));
  const edits: Edit[] = [];
  let removed = 0;

  const fontDicts = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
  const fontCache = new Map<string, FontInfo | null>();
  const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);

  async function fontFor(name: string) {
    if (fontCache.has(name)) return fontCache.get(name) ?? null;
    let info: FontInfo | null = null;
    const dict = fontDicts?.lookupMaybe(PDFName.of(name), PDFDict);
    if (dict) {
      try {
        info = await buildFont(doc, dict);
      } catch {
        info = null;
      }
    }
    fontCache.set(name, info);
    return info;
  }

  let ctm = start;
  const gstack: Array<{ ctm: Matrix; ts: TextState }> = [];
  let ts: TextState = { font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let operands: Tok[] = [];

  const nums = (count: number) => {
    const tail = operands.slice(-count);
    return tail.length === count && tail.every((o) => o.t === "num")
      ? tail.map((o) => (o as { v: number }).v)
      : null;
  };

  /** Processes one shown string; returns tokens to emit and advances Tm. */
  function show(bytesIn: Uint8Array, out: string[]) {
    const font = ts.font;
    if (!font || ts.size === 0) {
      return false;
    }
    const step = font.twoByte ? 2 : 1;
    let keep: number[] = [];
    let changed = false;
    const flush = () => {
      if (keep.length) out.push(hexOf(keep));
      keep = [];
    };
    for (let k = 0; k + step <= bytesIn.length; k += step) {
      const code = step === 2 ? (bytesIn[k] << 8) | bytesIn[k + 1] : bytesIn[k];
      const w = font.width(code);
      const space = step === 1 && code === 32 ? ts.tw : 0;
      const advance = ((w / 1000) * ts.size + ts.tc + space) * ts.th;
      const trm = mul([ts.size * ts.th, 0, 0, ts.size, 0, ts.rise], mul(tm, ctm));
      const cx = (w / 2000) * trm[0] + 0.3 * trm[2] + trm[4];
      const cy = (w / 2000) * trm[1] + 0.3 * trm[3] + trm[5];
      if (w > 0 && inRect(cx, cy, rects)) {
        flush();
        out.push(fmt((-advance * 1000) / (ts.size * ts.th)));
        removed++;
        changed = true;
      } else {
        for (let j = 0; j < step; j++) keep.push(bytesIn[k + j]);
      }
      tm = mul([1, 0, 0, 1, advance, 0], tm);
    }
    flush();
    return changed;
  }

  for (const tok of toks) {
    if (tok.t !== "op") {
      operands.push(tok);
      continue;
    }
    const op = tok.v;
    switch (op) {
      case "q":
        gstack.push({ ctm, ts: { ...ts } });
        break;
      case "Q": {
        const top = gstack.pop();
        if (top) {
          ctm = top.ctm;
          ts = top.ts;
        }
        break;
      }
      case "cm": {
        const m = nums(6);
        if (m) ctm = mul(m as Matrix, ctm);
        break;
      }
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "Tf": {
        const name = operands.at(-2);
        const size = operands.at(-1);
        if (name?.t === "name" && size?.t === "num") {
          ts.font = await fontFor(name.v);
          ts.size = size.v;
        }
        break;
      }
      case "Tc":
        ts.tc = nums(1)?.[0] ?? ts.tc;
        break;
      case "Tw":
        ts.tw = nums(1)?.[0] ?? ts.tw;
        break;
      case "Tz":
        ts.th = (nums(1)?.[0] ?? 100) / 100;
        break;
      case "TL":
        ts.tl = nums(1)?.[0] ?? ts.tl;
        break;
      case "Ts":
        ts.rise = nums(1)?.[0] ?? ts.rise;
        break;
      case "Td":
      case "TD": {
        const m = nums(2);
        if (m) {
          if (op === "TD") ts.tl = -m[1];
          tlm = mul([1, 0, 0, 1, m[0], m[1]], tlm);
          tm = tlm;
        }
        break;
      }
      case "Tm": {
        const m = nums(6);
        if (m) {
          tm = m as Matrix;
          tlm = tm;
        }
        break;
      }
      case "T*":
        tlm = mul([1, 0, 0, 1, 0, -ts.tl], tlm);
        tm = tlm;
        break;
      case "Tj": {
        const s = operands.at(-1);
        if (s?.t === "str") {
          const out: string[] = [];
          if (show(s.bytes, out)) {
            edits.push({ s: s.s, e: tok.e, text: `[${out.join(" ")}] TJ` });
          }
        }
        break;
      }
      case "'":
      case '"': {
        const s = operands.at(-1);
        if (op === '"') {
          const m = operands.slice(-3, -1);
          if (m.length === 2 && m.every((o) => o.t === "num")) {
            ts.tw = (m[0] as { v: number }).v;
            ts.tc = (m[1] as { v: number }).v;
          }
        }
        tlm = mul([1, 0, 0, 1, 0, -ts.tl], tlm);
        tm = tlm;
        if (s?.t === "str") {
          const out: string[] = [];
          if (show(s.bytes, out)) {
            const first = op === '"' ? (operands.at(-3) ?? s) : s;
            const setters =
              op === '"'
                ? `${fmt(ts.tw)} Tw ${fmt(ts.tc)} Tc `
                : "";
            edits.push({
              s: first.s,
              e: tok.e,
              text: `${setters}T* [${out.join(" ")}] TJ`,
            });
          }
        }
        break;
      }
      case "TJ": {
        const arr = operands.at(-1);
        if (arr?.t === "arr") {
          const out: string[] = [];
          let changed = false;
          for (const item of arr.items) {
            if (item.t === "num") {
              out.push(fmt(item.v));
              tm = mul([1, 0, 0, 1, (-item.v / 1000) * ts.size * ts.th, 0], tm);
            } else if (item.t === "str") {
              if (show(item.bytes, out)) changed = true;
              else if (ts.font && ts.size !== 0) {
                /* show() already pushed the kept bytes */
              } else out.push(hexOf([...item.bytes]));
            }
          }
          if (changed) {
            edits.push({ s: arr.s, e: tok.e, text: `[${out.join(" ")}] TJ` });
          }
        }
        break;
      }
      case "Do": {
        const name = operands.at(-1);
        if (name?.t === "name" && xobjects && depth < MAX_FORM_DEPTH) {
          const ref = xobjects.get(PDFName.of(name.v));
          const target = ref instanceof PDFRef ? doc.context.lookup(ref) : null;
          if (
            ref instanceof PDFRef &&
            target instanceof PDFRawStream &&
            target.dict.get(PDFName.of("Subtype")) === PDFName.of("Form")
          ) {
            const m = target.dict.lookup(PDFName.of("Matrix"));
            let fm: Matrix = IDENTITY;
            if (m instanceof PDFArray && m.size() === 6) {
              const v = m.asArray().map((o) => num(doc, o) ?? NaN);
              if (!v.some(Number.isNaN)) fm = v as Matrix;
            }
            formHits.push({
              ref,
              stream: target,
              matrix: mul(fm, ctm),
              resources:
                target.dict.lookupMaybe(PDFName.of("Resources"), PDFDict) ?? resources,
            });
          }
        }
        break;
      }
      default:
        break;
    }
    operands = [];
  }

  if (edits.length === 0) return { bytes, removed };
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  let pos = 0;
  for (const edit of edits) {
    parts.push(bytes.subarray(pos, edit.s), enc.encode(edit.text));
    pos = edit.e;
  }
  parts.push(bytes.subarray(pos));
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const merged = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    merged.set(p, at);
    at += p.length;
  }
  return { bytes: merged, removed };
}

function chunksOf(doc: PDFDocument, contents: unknown): Uint8Array[] {
  const v = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  if (v instanceof PDFRawStream) {
    try {
      return [decodePDFRawStream(v).decode()];
    } catch {
      return [];
    }
  }
  if (v instanceof PDFContentStream) return [v.getUnencodedContents()];
  if (v instanceof PDFArray) return v.asArray().flatMap((o) => chunksOf(doc, o));
  return [];
}

async function stripPage(
  doc: PDFDocument,
  page: PDFPage,
  rects: UserRect[],
): Promise<number> {
  const chunks = chunksOf(doc, page.node.Contents());
  if (chunks.length === 0) return 0;
  const joined = new Uint8Array(chunks.reduce((s, c) => s + c.length + 1, 0));
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.length;
    joined[at++] = 10;
  }
  const hits: Parameters<typeof stripStream>[6] = [];
  const result = await stripStream(doc, joined, page.node.Resources(), IDENTITY, rects, 0, hits);
  let removed = result.removed;
  if (result.removed > 0) {
    const ref = doc.context.register(doc.context.flateStream(result.bytes));
    page.node.set(PDFName.of("Contents"), ref);
  }

  const seen = new Set<string>();
  const queue = hits.map((h) => ({ ...h, depth: 1 }));
  while (queue.length) {
    const form = queue.shift()!;
    const key = form.ref.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    let data: Uint8Array;
    try {
      data = decodePDFRawStream(form.stream).decode();
    } catch {
      continue;
    }
    const nested: typeof hits = [];
    const res = await stripStream(doc, data, form.resources, form.matrix, rects, form.depth, nested);
    removed += res.removed;
    if (res.removed > 0) {
      const dict = form.stream.dict.clone();
      dict.delete(PDFName.of("Filter"));
      dict.delete(PDFName.of("DecodeParms"));
      const replacement = doc.context.flateStream(res.bytes, {});
      for (const [k, v] of dict.entries()) {
        if (k === PDFName.of("Length")) continue;
        replacement.dict.set(k, v);
      }
      doc.context.assign(form.ref, replacement);
    }
    for (const n of nested) queue.push({ ...n, depth: form.depth + 1 });
  }
  return removed;
}

/**
 * Deletes every glyph whose centre falls inside one of the rectangles from the
 * page's content (and the forms it draws), keeping the glyphs next to them
 * where they were. Returns how many glyphs went. Async because font widths
 * come from the scratch standard-font document.
 */
export function stripTextInRects(
  doc: PDFDocument,
  page: PDFPage,
  rects: UserRect[],
): Promise<number> {
  return stripPage(doc, page, rects);
}
