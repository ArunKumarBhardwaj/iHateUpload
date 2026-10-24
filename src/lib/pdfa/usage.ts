import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream } from "@cantoo/pdf-lib";

import { reachable } from "./walk";

/**
 * Which character codes each simple font actually draws, read from every
 * content stream in the file. Font keys are matched by name across all
 * resource dictionaries, which can only over-count. Null when a stream could
 * not be read, so the caller keeps every glyph.
 */

const N = PDFName.of;

const SKIP_SUBTYPES = new Set(["/Image", "/Type1C", "/CIDFontType0C", "/OpenType", "/XML"]);
const SKIP_TYPES = new Set(["/Metadata", "/EmbeddedFile", "/XRef", "/ObjStm", "/CMap"]);

function isContent(dict: PDFDict): boolean {
  const subtype = dict.get(N("Subtype"))?.toString();
  const type = dict.get(N("Type"))?.toString();
  if (subtype && SKIP_SUBTYPES.has(subtype)) return false;
  if (type && SKIP_TYPES.has(type)) return false;
  // Font programs, ICC profiles, functions and the like.
  return !["Length1", "Length2", "Length3", "N", "FunctionType", "Alternate"].some((k) => dict.has(N(k)));
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([...Buffer.from("()<>[]{}/%")]);

/** Font key -> codes shown with it, for one content stream. */
export function scanContent(data: Uint8Array, into: Map<string, Set<number>>) {
  let font = "";
  const saved: string[] = [];
  let lastName = "";
  let strings: Uint8Array[] = [];
  let inArray = 0;
  const show = () => {
    if (!font) return;
    const set = into.get(font) ?? new Set<number>();
    for (const s of strings) for (const c of s) set.add(c);
    into.set(font, set);
  };
  let i = 0;
  while (i < data.length) {
    const c = data[i];
    if (WS.has(c)) {
      i++;
    } else if (c === 37) {
      while (i < data.length && data[i] !== 10 && data[i] !== 13) i++;
    } else if (c === 40) {
      // Literal string with nesting and escapes.
      const out: number[] = [];
      let depth = 1;
      i++;
      while (i < data.length && depth > 0) {
        const b = data[i++];
        if (b === 92) {
          const e = data[i++];
          const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
          if (e in map) out.push(map[e]);
          else if (e >= 48 && e <= 55) {
            let v = e - 48;
            for (let k = 0; k < 2 && data[i] >= 48 && data[i] <= 55; k++) v = v * 8 + (data[i++] - 48);
            out.push(v & 255);
          } else if (e === 13 || e === 10) {
            if (e === 13 && data[i] === 10) i++;
          } else out.push(e);
        } else if (b === 40) {
          depth++;
          out.push(b);
        } else if (b === 41) {
          if (--depth > 0) out.push(b);
        } else out.push(b);
      }
      strings.push(Uint8Array.from(out));
    } else if (c === 60 && data[i + 1] === 60) {
      i += 2;
    } else if (c === 62 && data[i + 1] === 62) {
      i += 2;
    } else if (c === 60) {
      const end = data.indexOf(62, i);
      const hex = new TextDecoder("latin1").decode(data.subarray(i + 1, end < 0 ? data.length : end)).replace(/[^0-9a-fA-F]/g, "");
      const padded = hex.length % 2 ? hex + "0" : hex;
      strings.push(Uint8Array.from(padded.match(/../g) ?? [], (h) => parseInt(h, 16)));
      i = end < 0 ? data.length : end + 1;
    } else if (c === 91) {
      inArray++;
      i++;
    } else if (c === 93) {
      inArray = Math.max(0, inArray - 1);
      i++;
    } else if (c === 47) {
      let j = i + 1;
      while (j < data.length && !WS.has(data[j]) && !DELIM.has(data[j])) j++;
      lastName = new TextDecoder("latin1").decode(data.subarray(i + 1, j)).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      i = j;
    } else {
      let j = i;
      while (j < data.length && !WS.has(data[j]) && !DELIM.has(data[j])) j++;
      if (j === i) j++;
      const word = new TextDecoder("latin1").decode(data.subarray(i, j));
      i = j;
      if (/^[-+.\d]/.test(word)) continue;
      if (inArray) continue;
      switch (word) {
        case "Tf":
          font = lastName;
          break;
        case "Tj":
        case "TJ":
        case "'":
        case '"':
          show();
          break;
        case "q":
          saved.push(font);
          break;
        case "Q":
          font = saved.pop() ?? font;
          break;
        case "ID": {
          // Inline image data runs to the next whitespace-delimited EI.
          let k = i + 1;
          while (k < data.length - 2 && !(WS.has(data[k - 1]) && data[k] === 69 && data[k + 1] === 73 && (k + 2 >= data.length || WS.has(data[k + 2])))) k++;
          i = k + 2;
          break;
        }
      }
      strings = [];
    }
  }
}

export function fontUsage(doc: PDFDocument): Map<PDFDict, Set<number>> | null {
  const ctx = doc.context;
  const byKey = new Map<string, Set<number>>();
  const keyToFonts = new Map<string, PDFDict[]>();
  for (const { dict, stream } of reachable(doc)) {
    const fonts = dict.lookupMaybe(N("Font"), PDFDict);
    if (fonts && !stream && dict.get(N("Type"))?.toString() !== "/Font") {
      for (const [key, value] of fonts.entries()) {
        const font = value instanceof PDFRef ? ctx.lookup(value) : value;
        if (!(font instanceof PDFDict)) continue;
        const list = keyToFonts.get(key.decodeText()) ?? [];
        list.push(font);
        keyToFonts.set(key.decodeText(), list);
      }
    }
    if (!stream || !isContent(dict)) continue;
    let bytes: Uint8Array;
    try {
      bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : (stream as PDFStream).getContents();
    } catch {
      return null;
    }
    scanContent(bytes, byKey);
  }
  const out = new Map<PDFDict, Set<number>>();
  for (const [key, codes] of byKey) {
    for (const font of keyToFonts.get(key) ?? []) {
      const set = out.get(font) ?? new Set<number>();
      for (const c of codes) set.add(c);
      out.set(font, set);
    }
  }
  return out;
}
