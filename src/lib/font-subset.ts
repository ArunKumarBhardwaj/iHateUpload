/**
 * Font subsetting for PDFs that carry whole fonts: pdf-lib output, many merged files, forms set
 * in a full Indian-script font. HarfBuzz's subsetter (C++, compiled to WebAssembly by harfbuzzjs,
 * MIT) cuts each font down to the glyphs the pages draw, keeping glyph ids where they were, so no
 * page needs rewriting.
 *
 * Only Type0 fonts with Identity encoding over TrueType outlines are touched: their character codes
 * are glyph ids, so the glyphs in use can be read straight from the text operators. A font is
 * left whole when any use of it can't be accounted for (a stream that won't parse, a form field
 * that may type new text into it).
 */
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream } from "@cantoo/pdf-lib";

import { deflateMax } from "@/lib/compress-structure";

/** The subsetter's wasm, as public/fonts serves it. */
export const HB_SUBSET_WASM = "harfbuzz-subset-1.6.3.wasm";

interface Hb {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, len: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, lenPtr: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy?(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, value: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_glyph_set(input: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

const HB_MEMORY_MODE_DUPLICATE = 0;
// Keep glyph ids (the PDF's codes are glyph ids), keep a .notdef outline, and add no glyphs for
// layout features: the PDF already holds the shaped result.
const HB_SUBSET_FLAGS_RETAIN_GIDS = 0x2;
const HB_SUBSET_FLAGS_NOTDEF_OUTLINE = 0x40;
const HB_SUBSET_FLAGS_NO_LAYOUT_CLOSURE = 0x200;

export type Subsetter = (font: Uint8Array, glyphs: Iterable<number>) => Uint8Array | null;

export async function createSubsetter(wasm: Uint8Array | WebAssembly.Module): Promise<Subsetter> {
  const compiled = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm as BufferSource);
  const instance = await WebAssembly.instantiate(compiled, {});
  const hb = instance.exports as unknown as Hb;
  hb._initialize();
  return (font, glyphs) => {
    const ptr = hb.malloc(font.length);
    new Uint8Array(hb.memory.buffer, ptr, font.length).set(font);
    const blob = hb.hb_blob_create(ptr, font.length, HB_MEMORY_MODE_DUPLICATE, 0, 0);
    hb.free(ptr);
    const face = hb.hb_face_create(blob, 0);
    const input = hb.hb_subset_input_create_or_fail();
    try {
      if (!input) return null;
      const set = hb.hb_subset_input_glyph_set(input);
      hb.hb_set_add(set, 0);
      for (const g of glyphs) hb.hb_set_add(set, g);
      hb.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_RETAIN_GIDS | HB_SUBSET_FLAGS_NOTDEF_OUTLINE | HB_SUBSET_FLAGS_NO_LAYOUT_CLOSURE);
      const sub = hb.hb_subset_or_fail(face, input);
      if (!sub) return null;
      const out = hb.hb_face_reference_blob(sub);
      const lenPtr = hb.malloc(4);
      const data = hb.hb_blob_get_data(out, lenPtr);
      const len = new Uint32Array(hb.memory.buffer, lenPtr, 1)[0];
      const bytes = new Uint8Array(hb.memory.buffer, data, len).slice();
      hb.free(lenPtr);
      hb.hb_blob_destroy(out);
      hb.hb_face_destroy?.(sub);
      return bytes.length ? bytes : null;
    } finally {
      if (input) hb.hb_subset_input_destroy(input);
      hb.hb_face_destroy?.(face);
      hb.hb_blob_destroy(blob);
    }
  };
}

// --- reading which glyphs the pages draw -------------------------------------------------------

type Tok = { t: "num"; v: number } | { t: "name"; v: string } | { t: "str"; v: Uint8Array } | { t: "op"; v: string } | { t: "[" } | { t: "]" } | { t: "other" };

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/** A content-stream lexer that keeps string bytes, for the text operators. */
export function* lex(b: Uint8Array): Generator<Tok> {
  const n = b.length;
  let i = 0;
  while (i < n) {
    const c = b[i];
    if (WS.has(c)) {
      i++;
      continue;
    }
    if (c === 0x25) {
      while (i < n && b[i] !== 0x0a && b[i] !== 0x0d) i++;
      continue;
    }
    if (c === 0x28) {
      const out: number[] = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const ch = b[i];
        if (ch === 0x5c) {
          const e = b[i + 1];
          i += 2;
          if (e === 0x6e) out.push(10);
          else if (e === 0x72) out.push(13);
          else if (e === 0x74) out.push(9);
          else if (e === 0x62) out.push(8);
          else if (e === 0x66) out.push(12);
          else if (e === 0x0d) {
            if (b[i] === 0x0a) i++;
          } else if (e === 0x0a) {
            /* line continuation */
          } else if (e >= 0x30 && e <= 0x37) {
            let v = e - 0x30;
            for (let k = 0; k < 2 && b[i] >= 0x30 && b[i] <= 0x37; k++, i++) v = v * 8 + (b[i] - 0x30);
            out.push(v & 255);
          } else out.push(e);
          continue;
        }
        if (ch === 0x28) depth++;
        else if (ch === 0x29 && --depth === 0) {
          i++;
          break;
        }
        out.push(ch);
        i++;
      }
      yield { t: "str", v: Uint8Array.from(out) };
      continue;
    }
    if (c === 0x3c) {
      if (b[i + 1] === 0x3c) {
        i += 2;
        yield { t: "other" };
        continue;
      }
      i++;
      let hex = "";
      while (i < n && b[i] !== 0x3e) {
        if (!WS.has(b[i])) hex += String.fromCharCode(b[i]);
        i++;
      }
      i++;
      if (hex.length % 2) hex += "0";
      const out = new Uint8Array(hex.length / 2);
      for (let k = 0; k < out.length; k++) out[k] = parseInt(hex.slice(k * 2, k * 2 + 2), 16);
      yield { t: "str", v: out };
      continue;
    }
    if (c === 0x5b || c === 0x5d) {
      i++;
      yield c === 0x5b ? { t: "[" } : { t: "]" };
      continue;
    }
    if (c === 0x3e || c === 0x7b || c === 0x7d || c === 0x29) {
      i += c === 0x3e && b[i + 1] === 0x3e ? 2 : 1;
      yield { t: "other" };
      continue;
    }
    const start = i;
    i++;
    while (i < n && !WS.has(b[i]) && !DELIM.has(b[i])) i++;
    const word = String.fromCharCode(...b.subarray(start, i));
    if (c === 0x2f) yield { t: "name", v: word.slice(1).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
    else if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) yield { t: "num", v: Number(word) };
    else if (word === "ID") {
      i++;
      while (i < n) {
        if (b[i] === 0x45 && b[i + 1] === 0x49 && WS.has(b[i - 1]) && (i + 2 >= n || WS.has(b[i + 2]))) {
          i += 2;
          break;
        }
        i++;
      }
      yield { t: "other" };
    } else yield { t: "op", v: word };
  }
}

type Usage = { glyphs: Map<string, Set<number>>; unsure: Set<string>; failed: boolean };

function contentBytes(doc: PDFDocument, contents: unknown): Uint8Array[] | null {
  const v = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  if (v instanceof PDFRawStream) {
    try {
      return [decodePDFRawStream(v).decode()];
    } catch {
      return null;
    }
  }
  if (v instanceof PDFArray) {
    const parts: Uint8Array[] = [];
    for (let k = 0; k < v.size(); k++) {
      const p = contentBytes(doc, v.get(k));
      if (!p) return null;
      parts.push(...p);
    }
    // Content split over streams may break mid-token; join with a space.
    const total = parts.reduce((a, p) => a + p.length + 1, 0);
    const joined = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      joined.set(p, o);
      o += p.length + 1;
      joined[o - 1] = 0x20;
    }
    return [joined];
  }
  return v === undefined ? [] : null;
}

/** Records the glyphs every text operator draws, per font object, following forms and patterns. */
function walkContent(doc: PDFDocument, bytes: Uint8Array, resources: PDFDict | undefined, use: Usage, seen: Set<string>, depth = 0) {
  if (depth > 12) {
    use.failed = true;
    return;
  }
  const fonts = resources?.lookup(PDFName.of("Font"));
  const xobjects = resources?.lookup(PDFName.of("XObject"));
  const patterns = resources?.lookup(PDFName.of("Pattern"));
  let font: string | null = null;
  const stack: Tok[] = [];
  const record = (s: Uint8Array) => {
    if (!font) {
      use.failed = true;
      return;
    }
    let set = use.glyphs.get(font);
    if (!set) use.glyphs.set(font, (set = new Set()));
    // Identity encoding: two bytes per glyph id. Other fonts' codes are counted but never used.
    for (let k = 0; k + 1 < s.length; k += 2) set.add((s[k] << 8) | s[k + 1]);
  };
  for (const tok of lex(bytes)) {
    if (tok.t !== "op") {
      stack.push(tok);
      continue;
    }
    const op = tok.v;
    if (op === "Tf") {
      const name = stack[stack.length - 2];
      const ref = name?.t === "name" && fonts instanceof PDFDict ? fonts.get(PDFName.of(name.v)) : undefined;
      const direct = name?.t === "name" && fonts instanceof PDFDict ? fonts.lookup(PDFName.of(name.v)) : undefined;
      if (ref instanceof PDFRef) font = ref.toString();
      else if (direct instanceof PDFDict) {
        // A font written inline can't be matched to the ones we subset: if it is one, stop.
        if (identityTrueType(doc, direct)) use.failed = true;
        font = "direct";
      } else {
        use.failed = true;
        font = null;
      }
    } else if (op === "Tj" || op === "'" || op === '"') {
      const s = stack[stack.length - 1];
      if (s?.t === "str") record(s.v);
    } else if (op === "TJ") {
      const open = stack.map((t) => t.t).lastIndexOf("[");
      for (const t of stack.slice(open + 1)) if (t.t === "str") record(t.v);
    } else if (op === "Do") {
      const name = stack[stack.length - 1];
      if (name?.t === "name" && xobjects instanceof PDFDict) {
        const ref = xobjects.get(PDFName.of(name.v));
        const xo = xobjects.lookup(PDFName.of(name.v));
        if (xo instanceof PDFRawStream && xo.dict.get(PDFName.of("Subtype")) === PDFName.of("Form")) {
          const key = ref instanceof PDFRef ? ref.toString() : null;
          if (!key || !seen.has(key)) {
            if (key) seen.add(key);
            const inner = contentBytes(doc, xo);
            if (!inner) use.failed = true;
            else for (const b of inner) walkContent(doc, b, (xo.dict.lookup(PDFName.of("Resources")) as PDFDict | undefined) ?? resources, use, seen, depth + 1);
          }
        }
      }
    }
    stack.length = 0;
  }
  // Tiling patterns draw content of their own.
  if (patterns instanceof PDFDict) {
    for (const [, v] of patterns.entries()) {
      const p = v instanceof PDFRef ? doc.context.lookup(v) : v;
      if (p instanceof PDFRawStream && !seen.has(String(v))) {
        seen.add(String(v));
        const inner = contentBytes(doc, p);
        if (!inner) use.failed = true;
        else for (const b of inner) walkContent(doc, b, p.dict.lookup(PDFName.of("Resources")) as PDFDict | undefined, use, seen, depth + 1);
      }
    }
  }
}

/** Appearance streams of an annotation: /AP /N, /R, /D, each a stream or a dict of states. */
function appearanceStreams(doc: PDFDocument, annot: PDFDict): PDFRawStream[] {
  const ap = annot.lookup(PDFName.of("AP"));
  if (!(ap instanceof PDFDict)) return [];
  const out: PDFRawStream[] = [];
  for (const key of ["N", "R", "D"]) {
    const v = ap.lookup(PDFName.of(key));
    if (v instanceof PDFRawStream) out.push(v);
    else if (v instanceof PDFDict) for (const [, s] of v.entries()) {
      const st = s instanceof PDFRef ? doc.context.lookup(s) : s;
      if (st instanceof PDFRawStream) out.push(st);
    }
  }
  return out;
}

export function glyphUsage(doc: PDFDocument): Usage {
  const use: Usage = { glyphs: new Map(), unsure: new Set(), failed: false };
  const seen = new Set<string>();
  for (const page of doc.getPages()) {
    const bytes = contentBytes(doc, page.node.get(PDFName.of("Contents")));
    if (!bytes) {
      use.failed = true;
      continue;
    }
    const resources = page.node.Resources();
    for (const b of bytes) walkContent(doc, b, resources, use, seen);
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (annots instanceof PDFArray) {
      for (let k = 0; k < annots.size(); k++) {
        const a = annots.lookup(k);
        if (!(a instanceof PDFDict)) continue;
        for (const s of appearanceStreams(doc, a)) {
          const inner = contentBytes(doc, s);
          if (!inner) use.failed = true;
          else for (const b of inner) walkContent(doc, b, s.dict.lookup(PDFName.of("Resources")) as PDFDict | undefined, use, seen, 1);
        }
      }
    }
  }
  // Form fields can type new text in their default-resource fonts.
  const acro = doc.catalog.lookup(PDFName.of("AcroForm"));
  const dr = acro instanceof PDFDict ? acro.lookup(PDFName.of("DR")) : undefined;
  const drFonts = dr instanceof PDFDict ? dr.lookup(PDFName.of("Font")) : undefined;
  if (drFonts instanceof PDFDict) for (const [, v] of drFonts.entries()) if (v instanceof PDFRef) use.unsure.add(v.toString());
  // Type3 glyphs are content too, with fonts of their own.
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of("Subtype")) !== PDFName.of("Type3")) continue;
    const procs = obj.lookup(PDFName.of("CharProcs"));
    const res = obj.lookup(PDFName.of("Resources")) as PDFDict | undefined;
    if (!(procs instanceof PDFDict)) continue;
    for (const [, v] of procs.entries()) {
      const s = v instanceof PDFRef ? doc.context.lookup(v) : v;
      const inner = s instanceof PDFStream ? contentBytes(doc, s) : null;
      if (!inner) use.failed = true;
      else for (const b of inner) walkContent(doc, b, res, use, seen, 1);
    }
  }
  return use;
}

/** The FontFile2 stream of a Type0 font that maps codes straight to glyph ids, if it is one. */
function identityTrueType(_doc: PDFDocument, font: PDFDict): PDFRawStream | null {
  if (font.get(PDFName.of("Subtype")) !== PDFName.of("Type0")) return null;
  const enc = font.get(PDFName.of("Encoding"));
  if (enc !== PDFName.of("Identity-H") && enc !== PDFName.of("Identity-V")) return null;
  const desc = font.lookup(PDFName.of("DescendantFonts"));
  const cid = desc instanceof PDFArray ? desc.lookup(0) : undefined;
  if (!(cid instanceof PDFDict) || cid.get(PDFName.of("Subtype")) !== PDFName.of("CIDFontType2")) return null;
  const map = cid.get(PDFName.of("CIDToGIDMap"));
  if (map !== undefined && map !== PDFName.of("Identity")) return null;
  const fd = cid.lookup(PDFName.of("FontDescriptor"));
  const file = fd instanceof PDFDict ? fd.lookup(PDFName.of("FontFile2")) : undefined;
  return file instanceof PDFRawStream ? file : null;
}

/** True when some Type0 TrueType font program is big enough to be worth loading the subsetter for. */
export function hasWholeFonts(doc: PDFDocument): boolean {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
    const file = identityTrueType(doc, obj);
    if (file && file.contents.length >= 8192) return true;
  }
  return false;
}

/**
 * Subsets every whole TrueType font the pages draw from, when every use is accounted for.
 * Returns how many bytes the font programs lost.
 */
export function subsetFonts(doc: PDFDocument, subset: Subsetter): number {
  const use = glyphUsage(doc);
  if (use.failed) return 0;
  let saved = 0;
  const done = new Set<PDFRawStream>();
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
    const key = ref.toString();
    if (use.unsure.has(key)) continue;
    const file = identityTrueType(doc, obj);
    if (!file || done.has(file) || file.contents.length < 8192) continue;
    // The same font program may sit under several font dicts (after de-duplication): use them all.
    const glyphs = new Set<number>();
    let unsure = false;
    for (const [r2, o2] of doc.context.enumerateIndirectObjects()) {
      if (!(o2 instanceof PDFDict) || o2.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
      if (identityTrueType(doc, o2) !== file) continue;
      if (use.unsure.has(r2.toString())) unsure = true;
      for (const g of use.glyphs.get(r2.toString()) ?? []) glyphs.add(g);
    }
    done.add(file);
    if (unsure) continue;
    let program: Uint8Array;
    try {
      program = decodePDFRawStream(file).decode();
    } catch {
      continue;
    }
    const cut = subset(program, glyphs);
    if (!cut) continue;
    const packed = deflateMax(cut);
    if (packed.length >= file.contents.length * 0.95) continue;
    saved += file.contents.length - packed.length;
    file.contents = packed;
    file.dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
    file.dict.delete(PDFName.of("DecodeParms"));
    file.dict.set(PDFName.of("Length"), doc.context.obj(packed.length));
    file.dict.set(PDFName.of("Length1"), doc.context.obj(cut.length));
  }
  return saved;
}
