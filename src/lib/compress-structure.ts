/**
 * Lossless squeezes on the file's structure, before and after images are recoded:
 *  - objects nothing points to are dropped (pages deleted by pdf-lib leave their photos behind)
 *  - identical streams, fonts and their descriptors are stored once (merged PDFs carry a copy of
 *    every font and logo per source file)
 *  - things no viewer draws are removed: page thumbnails, app-private PieceInfo, XMP packets
 *  - every Flate stream is deflated again at level 9, kept only when smaller
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from "@cantoo/pdf-lib";
import { unzlibSync, zlibSync } from "fflate";

/** Every object reachable from the trailer; the rest is deleted. Returns how many went. */
export function dropUnreachable(doc: PDFDocument): number {
  const { context } = doc;
  const seen = new Set<string>();
  const stack: PDFObject[] = [];
  const info = context.trailerInfo;
  for (const root of [info.Root, info.Info, info.Encrypt]) if (root) stack.push(root as PDFObject);
  while (stack.length) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const target = context.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFDict) {
      for (const [, v] of obj.entries()) stack.push(v);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }
  let dropped = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) {
      context.delete(ref);
      dropped++;
    }
  }
  return dropped;
}

/** FNV-1a over bytes, sampled for long buffers; buckets only, equality is checked in full. */
function quickHash(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  const step = bytes.length > 65536 ? Math.floor(bytes.length / 16384) : 1;
  for (let i = 0; i < bytes.length; i += step) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h ^ bytes.length) >>> 0;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Dicts that mean the same thing wherever they are used. Pages and annotations know where they live, so never. */
const SHAREABLE_TYPES = new Set(["/Font", "/FontDescriptor", "/ExtGState", "/Encoding", "/XObject", "/Pattern", "/Shading"]);

function dictKey(dict: PDFDict): string {
  const parts: string[] = [];
  for (const [k, v] of dict.entries()) {
    if (k === PDFName.of("Length")) continue;
    parts.push(`${k.toString()} ${v.toString()}`);
  }
  return parts.sort().join("\n");
}

/** Points every reference to a duplicate at the copy that stays. */
function rewriteRefs(doc: PDFDocument, map: Map<string, PDFRef>) {
  const swap = (v: PDFObject): PDFObject | null => (v instanceof PDFRef ? (map.get(v.toString()) ?? null) : null);
  const visit = (obj: PDFObject) => {
    if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) {
        const to = swap(v);
        if (to) obj.set(k, to);
        else if (v instanceof PDFDict || v instanceof PDFArray) visit(v);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const v = obj.get(i);
        const to = swap(v);
        if (to) obj.set(i, to);
        else if (v instanceof PDFDict || v instanceof PDFArray) visit(v);
      }
    } else if (obj instanceof PDFStream) visit(obj.dict);
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) visit(obj);
  const info = doc.context.trailerInfo;
  if (info.Root instanceof PDFRef && map.has(info.Root.toString())) info.Root = map.get(info.Root.toString());
}

/**
 * Stores identical streams once, then the font and descriptor dicts that became identical
 * because of it, until nothing more matches. Returns how many objects were folded.
 */
export function dedupe(doc: PDFDocument): number {
  let folded = 0;
  for (let pass = 0; pass < 4; pass++) {
    const map = new Map<string, PDFRef>();
    const buckets = new Map<string, { ref: PDFRef; obj: PDFRawStream | PDFDict | PDFArray }[]>();
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      let key: string;
      if (obj instanceof PDFRawStream) {
        if (obj.dict.get(PDFName.of("Type")) === PDFName.of("Metadata")) continue;
        key = `s${quickHash(obj.contents)}|${dictKey(obj.dict)}`;
      } else if (obj instanceof PDFDict) {
        const type = obj.get(PDFName.of("Type"));
        if (!(type instanceof PDFName) || !SHAREABLE_TYPES.has(type.toString())) continue;
        key = `d|${dictKey(obj)}`;
      } else if (obj instanceof PDFArray) {
        key = `a|${obj.toString()}`;
      } else continue;
      const list = buckets.get(key) ?? [];
      const twin = list.find((o) => o.obj.constructor === obj.constructor && (!(obj instanceof PDFRawStream) || sameBytes((o.obj as PDFRawStream).contents, obj.contents)));
      if (twin) map.set(ref.toString(), twin.ref);
      else {
        list.push({ ref, obj: obj as PDFRawStream });
        buckets.set(key, list);
      }
    }
    if (!map.size) break;
    rewriteRefs(doc, map);
    for (const key of map.keys()) {
      const [n, g] = key.split(" ").map(Number);
      doc.context.delete(PDFRef.of(n, g));
    }
    folded += map.size;
  }
  return folded;
}

/** Drops what no viewer draws: page thumbnails, app-private data, the XMP packet. */
export function stripInvisible(doc: PDFDocument): number {
  let removed = 0;
  const drop = (dict: PDFDict, key: string) => {
    if (dict.has(PDFName.of(key))) {
      dict.delete(PDFName.of(key));
      removed++;
    }
  };
  for (const page of doc.getPages()) {
    drop(page.node, "Thumb");
    drop(page.node, "PieceInfo");
  }
  drop(doc.catalog, "PieceInfo");
  // XMP repeats the Info dict, which is cleared anyway; PDF/A files need it, so they keep it.
  const meta = doc.catalog.lookup(PDFName.of("Metadata"));
  if (meta instanceof PDFRawStream && !looksPdfA(meta)) drop(doc.catalog, "Metadata");
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (!dict) continue;
    drop(dict, "PieceInfo");
    // XMP on single images and fonts (Photoshop, Illustrator) is never shown.
    if (dict !== doc.catalog && dict.has(PDFName.of("Metadata"))) {
      const m = dict.lookup(PDFName.of("Metadata"));
      if (m instanceof PDFRawStream) drop(dict, "Metadata");
    }
  }
  return removed;
}

function looksPdfA(meta: PDFRawStream): boolean {
  if (meta.dict.has(PDFName.of("Filter"))) return true; // can't read it cheaply; keep to be safe
  const text = new TextDecoder("latin1").decode(meta.contents.subarray(0, 65536));
  return /pdfaid:part|pdfuaid:part|pdfx:|pdfxid/.test(text);
}

/** "FlateDecode" alone, maybe with predictor parms: the data under the deflate is left as it is. */
function plainFlate(stream: PDFRawStream): boolean {
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  if (filter === PDFName.of("FlateDecode")) return true;
  return filter instanceof PDFArray && filter.size() === 1 && filter.lookup(0) === PDFName.of("FlateDecode");
}

export function deflateMax(bytes: Uint8Array): Uint8Array {
  // Level 9 is about five times slower than 6 on noisy pixels for some 6%; huge buffers take 6.
  return zlibSync(bytes, { level: bytes.length > 3_000_000 ? 6 : 9, mem: 12 });
}

/**
 * Deflates every stream again at the highest level, and stores raw ones deflated.
 * Returns how many streams got smaller.
 */
export function recompressStreams(doc: PDFDocument, skip: { has(s: PDFRawStream): boolean } = new Set()): number {
  let count = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || skip.has(obj)) continue;
    const { dict } = obj;
    if (obj.contents.length < 64) continue;
    let raw: Uint8Array;
    if (!dict.has(PDFName.of("Filter"))) {
      if (dict.get(PDFName.of("Type")) === PDFName.of("Metadata")) continue;
      raw = obj.contents;
    } else if (plainFlate(obj)) {
      try {
        raw = unzlibSync(obj.contents);
      } catch {
        continue;
      }
    } else continue;
    const packed = deflateMax(raw);
    if (packed.length >= obj.contents.length * 0.99) continue;
    obj.contents = packed;
    dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
    dict.set(PDFName.of("Length"), doc.context.obj(packed.length));
    count++;
  }
  return count;
}
