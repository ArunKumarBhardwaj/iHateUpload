import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
  TextRenderingMode,
  beginText,
  decodePDFRawStream,
  endText,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
} from "@cantoo/pdf-lib";

import { keepHelveticaWinAnsi } from "@/lib/ocr-words";

import { addAppearance } from "./appearances";
import { cffGlyphNames, type1GlyphNames } from "./cff";
import { allFontDicts, judgeFont, replaceFonts, type LoadFont, type ReplaceJob } from "./fonts";
import { cmykProfile, srgbProfile } from "./icc";
import { fontUsage } from "./usage";
import { dropUnreachable, reachable } from "./walk";
import { writePdfAMetadata, type PdfAPart } from "./xmp";

/**
 * Turns a PDF into PDF/A-1b, 2b or 3b in place, in the browser. Most of the
 * work is structural (embed fonts, add the output intent and XMP, remove what
 * the standard forbids). A page that cannot be fixed that way, such as one
 * whose font is missing and has no stand-in, is redrawn as a picture with an
 * invisible text layer, so it still looks the same and stays searchable.
 */

export type PdfALevel = "1b" | "2b" | "3b";

/** One line of text to lay invisibly over a picture page, in PDF user space. */
export type TextRun = { str: string; x: number; y: number; size: number; width: number; angle: number };

export type PagePicture = { jpeg: Uint8Array; text: TextRun[] };

/**
 * Draws a page of the source PDF. With `annotations`, comments and markup are
 * drawn into the picture too (they are then removed from the page).
 */
export type PictureFn = (pageIndex: number, options: { annotations: boolean }) => Promise<PagePicture>;

export type PdfAOptions = {
  loadFont: LoadFont;
  picture: PictureFn;
  now?: Date;
  onProgress?: (ratio: number) => void;
};

export type PdfAReport = {
  bytes: Uint8Array;
  level: PdfALevel;
  fontsEmbedded: string[];
  /** 1-based page numbers drawn as pictures. */
  pagesAsPictures: number[];
  /** Plain-language list of what changed. */
  changes: string[];
};

const N = PDFName.of;
const partOf = (level: PdfALevel) => Number(level[0]) as PdfAPart;
const name = (v: unknown) => (v instanceof PDFName ? v.toString() : undefined);

// --- planning -------------------------------------------------------------------

type PagePlan = { reasons: string[]; annotations: boolean };

function filters(dict: PDFDict): string[] {
  const f = dict.get(N("Filter"));
  if (f instanceof PDFName) return [f.toString()];
  if (f instanceof PDFArray) return f.asArray().map((v) => v.toString());
  return [];
}

function num(dict: PDFDict, key: string): number | undefined {
  const v = dict.lookup(N(key));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

/** Why a set of resources breaks PDF/A-1, which has no transparency, JPEG 2000 or layers. */
function level1Problems(dicts: { dict: PDFDict; stream?: PDFStream }[]): string[] {
  const out = new Set<string>();
  for (const { dict, stream } of dicts) {
    const type = name(dict.get(N("Type")));
    const subtype = name(dict.get(N("Subtype")));
    if (stream && subtype === "/Image") {
      if (dict.has(N("SMask")) || (num(dict, "SMaskInData") ?? 0) > 0) out.add("transparent picture");
      if (filters(dict).includes("/JPXDecode")) out.add("JPEG 2000 picture");
    }
    if (!stream && (type === "/ExtGState" || dict.has(N("ca")) || dict.has(N("CA")) || dict.has(N("BM")))) {
      const smask = dict.get(N("SMask"));
      if (smask && name(smask) !== "/None") out.add("soft mask");
      if ((num(dict, "CA") ?? 1) < 1 || (num(dict, "ca") ?? 1) < 1) out.add("see-through drawing");
      const bm = dict.get(N("BM"));
      const modes = bm instanceof PDFArray ? bm.asArray().map(String) : bm ? [String(bm)] : [];
      if (modes.some((m) => m !== "/Normal" && m !== "/Compatible")) out.add("blend mode");
    }
    if (type === "/OCG" || type === "/OCMD") out.add("layers");
    if (type === "/FontDescriptor") {
      const ff3 = dict.lookupMaybe(N("FontFile3"), PDFStream);
      const fontName = String(dict.get(N("FontName")) ?? "");
      const subset = /^\/[A-Z]{6}\+/.test(fontName);
      if (ff3 && name(ff3.dict.get(N("Subtype"))) === "/OpenType") out.add("OpenType font");
      if (subset && ff3 && name(ff3.dict.get(N("Subtype"))) === "/CIDFontType0C" && !dict.has(N("CIDSet"))) {
        out.add("CFF font subset without a glyph list");
      }
      if (subset && (ff3 || dict.has(N("FontFile"))) && name(ff3?.dict.get(N("Subtype"))) !== "/CIDFontType0C" && !dict.has(N("CharSet")) && !charSetOf(dict)) {
        out.add("Type 1 font subset without a glyph list");
      }
    }
  }
  return [...out];
}

/** The glyph names of a Type 1 or bare CFF font program, for PDF/A-1's CharSet. */
function charSetOf(desc: PDFDict): string[] | null {
  const program = desc.lookupMaybe(N("FontFile"), PDFStream) ?? desc.lookupMaybe(N("FontFile3"), PDFStream);
  if (!program) return null;
  try {
    const bytes = program instanceof PDFRawStream ? decodePDFRawStream(program).decode() : program.getContents();
    if (desc.has(N("FontFile"))) return type1GlyphNames(bytes, num(program.dict, "Length1") ?? 0);
    return name(program.dict.get(N("Subtype"))) === "/Type1C" ? cffGlyphNames(bytes) : null;
  } catch {
    return null;
  }
}

function annotationsOf(doc: PDFDocument, pageIndex: number): PDFDict[] {
  const annots = doc.getPage(pageIndex).node.lookupMaybe(N("Annots"), PDFArray);
  return (annots?.asArray() ?? [])
    .map((r) => doc.context.lookup(r))
    .filter((a): a is PDFDict => a instanceof PDFDict);
}

/** Pages that must be drawn as pictures, with the reasons, for `level`. */
export function planPdfA(doc: PDFDocument, level: PdfALevel): { pictures: Map<number, PagePlan> } {
  const pictures = new Map<number, PagePlan>();
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const resources = page.node.Resources();
    const dicts = resources ? reachable(doc, [resources]) : [];
    const reasons = new Set<string>();
    for (const { dict, stream } of dicts) {
      if (stream || name(dict.get(N("Type"))) !== "/Font") continue;
      const verdict = judgeFont(doc, dict);
      if (verdict.kind === "picture") reasons.add(verdict.reason);
    }
    let annotations = false;
    if (level === "1b") {
      for (const r of level1Problems(dicts)) reasons.add(r);
      for (const annot of annotationsOf(doc, i)) {
        const ap = annot.lookupMaybe(N("AP"), PDFDict);
        if (ap && name(annot.get(N("Subtype"))) !== "/Widget" && level1Problems(reachable(doc, [ap])).length) {
          annotations = true;
          reasons.add("see-through comment");
        }
      }
    }
    if (reasons.size) pictures.set(i, { reasons: [...reasons], annotations });
  });
  return { pictures };
}

// --- pictures --------------------------------------------------------------------

async function drawAsPicture(doc: PDFDocument, index: number, picture: PagePicture, keepAnnotations: boolean) {
  const page = doc.getPage(index);
  const { x, y, width, height } = page.getCropBox();
  page.node.delete(N("Contents"));
  page.node.delete(N("Group"));
  page.node.set(N("Resources"), doc.context.obj({}));
  if (!keepAnnotations) {
    const kept = annotationsOf(doc, index).filter((a) => {
      const s = name(a.get(N("Subtype")));
      return s === "/Widget" || s === "/Link" || s === "/Popup";
    });
    page.node.set(N("Annots"), doc.context.obj(kept.map((a) => doc.context.getObjectRef(a) ?? a)));
  }
  const image = await doc.embedJpg(picture.jpeg);
  page.drawImage(image, { x, y, width, height });
  if (!picture.text.length) return;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const key = page.node.newFontDictionary("F", font.ref);
  const ops = [beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  for (const run of picture.text) {
    const str = keepHelveticaWinAnsi(run.str).trim() ? keepHelveticaWinAnsi(run.str) : "";
    const size = Math.max(1, run.size);
    if (!str) continue;
    const natural = font.widthOfTextAtSize(str, size);
    const squeeze = run.width > 0 && natural > 0 ? run.width / natural : 1;
    const cos = Math.cos(run.angle);
    const sin = Math.sin(run.angle);
    ops.push(
      setFontAndSize(key, size),
      setTextMatrix(cos * squeeze, sin * squeeze, -sin, cos, run.x, run.y),
      showText(font.encodeText(str)),
    );
  }
  ops.push(endText());
  page.pushOperators(...ops);
}

// --- actions -----------------------------------------------------------------------

const ALLOWED_NAMED = new Set(["/NextPage", "/PrevPage", "/FirstPage", "/LastPage"]);
const FORBIDDEN_ACTIONS: Record<PdfALevel, Set<string>> = {
  "1b": new Set(["/Launch", "/Sound", "/Movie", "/ResetForm", "/ImportData", "/JavaScript", "/Hide", "/SetOCGState", "/Rendition", "/Trans", "/GoTo3DView", "/SetState", "/NOP"]),
  "2b": new Set(["/Launch", "/Sound", "/Movie", "/ResetForm", "/ImportData", "/JavaScript", "/Hide", "/SetOCGState", "/Rendition", "/Trans", "/GoTo3DView"]),
  "3b": new Set(["/Launch", "/Sound", "/Movie", "/ResetForm", "/ImportData", "/JavaScript", "/Hide", "/SetOCGState", "/Rendition", "/Trans", "/GoTo3DView"]),
};

/** The action with forbidden steps cut out of its Next chain, or undefined when the action itself is forbidden. */
function cleanAction(doc: PDFDocument, level: PdfALevel, raw: unknown, removed: () => void): unknown {
  const action = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  if (!(action instanceof PDFDict)) return raw;
  const s = name(action.get(N("S")));
  if (!s) return raw;
  if (FORBIDDEN_ACTIONS[level].has(s) || (s === "/Named" && !ALLOWED_NAMED.has(name(action.get(N("N"))) ?? ""))) {
    removed();
    return undefined;
  }
  const next = action.get(N("Next"));
  if (next instanceof PDFArray) {
    const kept = next.asArray().map((a) => cleanAction(doc, level, a, removed)).filter((a) => a !== undefined);
    if (kept.length) action.set(N("Next"), doc.context.obj(kept as never));
    else action.delete(N("Next"));
  } else if (next) {
    const kept = cleanAction(doc, level, next, removed);
    if (kept === undefined) action.delete(N("Next"));
  }
  return raw;
}

// --- annotations ----------------------------------------------------------------------

const FORBIDDEN_ANNOTS: Record<PdfALevel, Set<string>> = {
  "1b": new Set(["/FileAttachment", "/Sound", "/Movie", "/Screen", "/3D", "/RichMedia", "/Projection", "/Redact", "/Watermark", "/TrapNet"]),
  "2b": new Set(["/FileAttachment", "/Sound", "/Movie", "/Screen", "/3D", "/RichMedia", "/Projection"]),
  "3b": new Set(["/Sound", "/Movie", "/Screen", "/3D", "/RichMedia", "/Projection"]),
};

async function fixAnnotations(doc: PDFDocument, level: PdfALevel, note: (s: string) => void) {
  const transparency = level !== "1b";
  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i);
    const annots = page.node.lookupMaybe(N("Annots"), PDFArray);
    if (!annots) continue;
    const kept: unknown[] = [];
    for (const ref of annots.asArray()) {
      const annot = doc.context.lookup(ref);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = name(annot.get(N("Subtype"))) ?? "";
      if (FORBIDDEN_ANNOTS[level].has(subtype)) {
        note(`Removed a ${subtype.slice(1)} annotation, which PDF/A-${level} does not allow`);
        continue;
      }
      kept.push(ref);
      // Printable, never hidden.
      const flags = Number(annot.get(N("F"))?.toString() ?? 0);
      const fixed = (flags | 4) & ~(1 | 2 | 32 | 256);
      if (fixed !== flags) annot.set(N("F"), doc.context.obj(fixed));
      if (level === "1b") annot.delete(N("CA"));
      if (subtype === "/Link" || subtype === "/Popup") continue;
      const ap = annot.lookupMaybe(N("AP"), PDFDict);
      const normal = ap?.get(N("N"));
      if (ap && normal) {
        ap.delete(N("D"));
        ap.delete(N("R"));
        const resolved = doc.context.lookup(normal);
        const parent = annot.lookupMaybe(N("Parent"), PDFDict);
        const isButton = name(annot.get(N("FT")) ?? parent?.get(N("FT"))) === "/Btn";
        if (resolved instanceof PDFDict && !(resolved instanceof PDFStream) && !isButton) {
          const state = name(annot.get(N("AS")));
          const pick = (state && resolved.get(N(state.slice(1)))) ?? resolved.entries()[0]?.[1];
          if (pick) ap.set(N("N"), pick);
        }
        continue;
      }
      if (await addAppearance({ doc, transparency }, annot, subtype)) note("Drew appearances for comments that had none");
    }
    if (kept.length !== annots.size()) page.node.set(N("Annots"), doc.context.obj(kept as never));
  }
}

// --- the rest of the object graph ------------------------------------------------------

function recompressLzw(doc: PDFDocument, note: (s: string) => void) {
  const ctx = doc.context;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const f = filters(obj.dict);
    if (f.length !== 1 || f[0] !== "/LZWDecode") continue;
    const data = decodePDFRawStream(obj).decode();
    const parms = obj.dict.lookupMaybe(N("DecodeParms"), PDFDict);
    parms?.delete(N("EarlyChange"));
    const dict: Record<string, unknown> = {};
    for (const [k, v] of obj.dict.entries()) {
      const key = k.decodeText();
      if (key !== "Filter" && key !== "Length") dict[key] = v;
    }
    ctx.assign(ref, ctx.flateStream(data, dict as never));
    note("Recompressed LZW streams with Flate");
  }
}

const usesCmyk = (doc: PDFDocument) =>
  reachable(doc).some(({ dict, stream }) => {
    if (dict.entries().some(([, v]) => name(v) === "/DeviceCMYK" || (v instanceof PDFArray && v.asArray().some((x) => name(x) === "/DeviceCMYK")))) {
      return true;
    }
    if (!stream || !(stream instanceof PDFRawStream)) return false;
    const sub = name(dict.get(N("Subtype")));
    const isContent = !sub || sub === "/Form";
    if (!isContent || dict.has(N("Length1")) || name(dict.get(N("Type"))) === "/Metadata") return false;
    try {
      const text = new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
      return /(?:^|\s)(?:[-\d.]+\s+){4}[kK](?=\s|$)/.test(text);
    } catch {
      return false;
    }
  });

function fixGraph(doc: PDFDocument, level: PdfALevel, note: (s: string) => void) {
  const ctx = doc.context;
  const catalog = doc.catalog;
  for (const { dict, stream } of reachable(doc)) {
    const type = name(dict.get(N("Type")));
    const subtype = name(dict.get(N("Subtype")));
    if (dict !== catalog && dict.has(N("Metadata"))) dict.delete(N("Metadata"));
    if (dict.has(N("AA"))) {
      dict.delete(N("AA"));
      note("Removed automatic actions");
    }
    for (const key of ["A", "OpenAction"]) {
      const raw = dict.get(N(key));
      if (!raw) continue;
      const kept = cleanAction(doc, level, raw, () => note("Removed scripts and other actions PDF/A does not allow"));
      if (kept === undefined) dict.delete(N(key));
    }
    if (stream) {
      // Streams that point at data outside the file.
      for (const key of ["F", "FFilter", "FDecodeParms"]) dict.delete(N(key));
      if (subtype === "/Image") {
        dict.delete(N("Alternates"));
        dict.delete(N("OPI"));
        if (dict.has(N("Interpolate"))) dict.delete(N("Interpolate"));
      }
      if (subtype === "/Form") {
        for (const key of ["OPI", "PS", "Ref"]) dict.delete(N(key));
        if (level === "1b") dict.delete(N("Group"));
      }
      if (subtype === "/PS") {
        dict.set(N("Subtype"), N("Form"));
        dict.set(N("BBox"), ctx.obj([0, 0, 0, 0]));
        if (stream instanceof PDFRawStream) ctx.assign(ctx.getObjectRef(stream)!, ctx.stream("", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 0, 0] }));
        note("Removed embedded PostScript");
      }
    }
    const gsRes = dict.lookupMaybe(N("ExtGState"), PDFDict);
    for (const [, raw] of gsRes?.entries() ?? []) {
      const gs = ctx.lookup(raw);
      if (!(gs instanceof PDFDict)) continue;
      gs.delete(N("TR"));
      gs.delete(N("HTP"));
      gs.delete(N("HT"));
      if (gs.has(N("TR2")) && name(gs.get(N("TR2"))) !== "/Default") gs.set(N("TR2"), N("Default"));
    }
    if (type === "/Page") {
      dict.delete(N("PresSteps"));
      if (level === "1b") dict.delete(N("Group"));
    }
    if (type === "/FontDescriptor" && level !== "1b") {
      dict.delete(N("CIDSet"));
      dict.delete(N("CharSet"));
    }
    if (type === "/FontDescriptor" && level === "1b" && !dict.has(N("CharSet")) && /^\/[A-Z]{6}\+/.test(String(dict.get(N("FontName"))))) {
      const names = charSetOf(dict);
      if (names) dict.set(N("CharSet"), PDFString.of(names.map((n) => `/${n}`).join("")));
    }
    if (type === "/Font" && subtype === "/CIDFontType2" && !dict.has(N("CIDToGIDMap"))) {
      dict.set(N("CIDToGIDMap"), N("Identity"));
    }
    if (type === "/Font" && subtype === "/CIDFontType2" && level === "1b") addCidSet(doc, dict);
    if (type === "/Font" && subtype === "/TrueType" && !dict.has(N("Encoding"))) {
      const desc = dict.lookupMaybe(N("FontDescriptor"), PDFDict);
      const flags = Number(desc?.get(N("Flags"))?.toString() ?? 0);
      if (desc?.has(N("FontFile2")) && !(flags & 4)) dict.set(N("Encoding"), N("WinAnsiEncoding"));
    }
  }

  for (const key of ["AA", "NeedsRendering", "Perms", "Requirements", "Collection"]) catalog.delete(N(key));
  const acro = catalog.lookupMaybe(N("AcroForm"), PDFDict);
  if (acro?.has(N("XFA"))) {
    acro.delete(N("XFA"));
    note("Removed the XFA form layer");
  }
  acro?.delete(N("NeedAppearances"));
  const names = catalog.lookupMaybe(N("Names"), PDFDict);
  if (names?.has(N("JavaScript"))) {
    names.delete(N("JavaScript"));
    note("Removed scripts and other actions PDF/A does not allow");
  }
  names?.delete(N("AlternatePresentations"));

  const oc = catalog.lookupMaybe(N("OCProperties"), PDFDict);
  if (oc && level === "1b") {
    catalog.delete(N("OCProperties"));
  } else if (oc) {
    const all = oc.lookupMaybe(N("OCGs"), PDFArray)?.asArray() ?? [];
    // A layer's name must be a text string; some writers use a name object.
    for (const g of all) {
      const group = ctx.lookup(g);
      const label = group instanceof PDFDict ? group.get(N("Name")) : undefined;
      if (group instanceof PDFDict && label instanceof PDFName) group.set(N("Name"), PDFHexString.fromText(label.decodeText()));
    }
    const configs = [oc.lookupMaybe(N("D"), PDFDict), ...(oc.lookupMaybe(N("Configs"), PDFArray)?.asArray() ?? []).map((c) => ctx.lookup(c))];
    configs.forEach((config, i) => {
      if (!(config instanceof PDFDict)) return;
      if (!config.has(N("Name"))) config.set(N("Name"), PDFString.of(i ? `Layers ${i}` : "Default"));
      config.delete(N("AS"));
      const order = config.lookupMaybe(N("Order"), PDFArray);
      if (!order) return;
      const listed = new Set<string>();
      const collect = (arr: PDFArray) => arr.asArray().forEach((v) => {
        const inner = ctx.lookup(v);
        if (inner instanceof PDFArray) collect(inner);
        else listed.add(String(v));
      });
      collect(order);
      for (const g of all) if (!listed.has(String(g))) order.push(g);
    });
  }
}

/** PDF/A-1 wants a CIDSet naming every glyph of a CID TrueType subset. */
function addCidSet(doc: PDFDocument, font: PDFDict) {
  const desc = font.lookupMaybe(N("FontDescriptor"), PDFDict);
  const file = desc?.lookupMaybe(N("FontFile2"), PDFStream);
  if (!desc || !file || desc.has(N("CIDSet"))) return;
  let bytes: Uint8Array;
  try {
    bytes = file instanceof PDFRawStream ? decodePDFRawStream(file).decode() : file.getContents();
  } catch {
    return;
  }
  const count = glyphCount(bytes);
  if (!count) return;
  let cids: number[];
  const map = font.lookup(N("CIDToGIDMap"));
  if (map instanceof PDFStream) {
    const m = map instanceof PDFRawStream ? decodePDFRawStream(map).decode() : map.getContents();
    cids = [];
    for (let cid = 0; cid * 2 + 1 < m.length; cid++) {
      const gid = (m[cid * 2] << 8) | m[cid * 2 + 1];
      if (gid < count && (gid > 0 || cid === 0)) cids.push(cid);
    }
  } else {
    cids = Array.from({ length: count }, (_, i) => i);
  }
  const max = Math.max(0, ...cids);
  const bits = new Uint8Array(Math.floor(max / 8) + 1);
  for (const cid of cids) bits[cid >> 3] |= 0x80 >> (cid & 7);
  desc.set(N("CIDSet"), doc.context.register(doc.context.flateStream(bits)));
}

function glyphCount(font: Uint8Array): number {
  if (font.length < 12) return 0;
  const tables = (font[4] << 8) | font[5];
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16;
    if (String.fromCharCode(...font.subarray(at, at + 4)) !== "maxp") continue;
    const off = ((font[at + 8] << 24) | (font[at + 9] << 16) | (font[at + 10] << 8) | font[at + 11]) >>> 0;
    return (font[off + 4] << 8) | font[off + 5];
  }
  return 0;
}

// --- attachments ------------------------------------------------------------------------

const MIME: Record<string, string> = {
  csv: "text/csv", txt: "text/plain", xml: "application/xml", json: "application/json", pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip: "application/zip", html: "text/html",
};

function fileSpecs(doc: PDFDocument): PDFDict[] {
  const ctx = doc.context;
  const out: PDFDict[] = [];
  const tree = doc.catalog.lookupMaybe(N("Names"), PDFDict)?.lookupMaybe(N("EmbeddedFiles"), PDFDict);
  const visit = (node: PDFDict | undefined) => {
    const arr = node?.lookupMaybe(N("Names"), PDFArray)?.asArray() ?? [];
    for (let i = 1; i < arr.length; i += 2) {
      const spec = ctx.lookup(arr[i]);
      if (spec instanceof PDFDict) out.push(spec);
    }
    for (const kid of node?.lookupMaybe(N("Kids"), PDFArray)?.asArray() ?? []) {
      const k = ctx.lookup(kid);
      if (k instanceof PDFDict) visit(k);
    }
  };
  visit(tree);
  return out;
}

function fixAttachments(doc: PDFDocument, level: PdfALevel, note: (s: string) => void) {
  const ctx = doc.context;
  const names = doc.catalog.lookupMaybe(N("Names"), PDFDict);
  if (level !== "3b") {
    if (names?.has(N("EmbeddedFiles"))) {
      names.delete(N("EmbeddedFiles"));
      note(`Removed attachments, which PDF/A-${level} does not allow (PDF/A-3b keeps them)`);
    }
    doc.catalog.delete(N("AF"));
    for (const page of doc.getPages()) page.node.delete(N("AF"));
    return;
  }
  const specs = fileSpecs(doc);
  if (!specs.length) return;
  const refs = specs.map((spec) => {
    if (!spec.has(N("AFRelationship"))) spec.set(N("AFRelationship"), N("Unspecified"));
    const f = spec.get(N("F")) ?? spec.get(N("UF"));
    if (f && !spec.has(N("UF"))) spec.set(N("UF"), f);
    if (f && !spec.has(N("F"))) spec.set(N("F"), f);
    const fileName = f instanceof PDFString || f instanceof PDFHexString ? f.decodeText() : "";
    const stream = spec.lookupMaybe(N("EF"), PDFDict)?.lookupMaybe(N("F"), PDFStream);
    if (stream && !stream.dict.has(N("Subtype"))) {
      const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? "";
      stream.dict.set(N("Subtype"), N(MIME[ext] ?? "application/octet-stream"));
    }
    return ctx.getObjectRef(spec) ?? ctx.register(spec);
  });
  const existing = doc.catalog.lookupMaybe(N("AF"), PDFArray);
  const listed = new Set(existing?.asArray().map(String) ?? []);
  const af = existing ?? ctx.obj([]);
  for (const r of refs) if (!listed.has(String(r))) af.push(r);
  doc.catalog.set(N("AF"), af);
  note("Kept attachments and marked how each relates to the document");
}

// --- colour ---------------------------------------------------------------------------------

function addColour(doc: PDFDocument, note: (s: string) => void) {
  const ctx = doc.context;
  const profile = ctx.register(ctx.flateStream(srgbProfile(), { N: 3 }));
  const intent = ctx.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
    OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
    Info: PDFString.of("sRGB IEC61966-2.1"),
    RegistryName: PDFString.of("http://www.color.org"),
    DestOutputProfile: profile,
  });
  doc.catalog.set(N("OutputIntents"), ctx.obj([ctx.register(intent)]));

  if (!usesCmyk(doc)) return;
  const cmyk = ctx.register(ctx.obj(["ICCBased", ctx.register(ctx.flateStream(cmykProfile(), { N: 4 }))]));
  for (const { dict } of reachable(doc)) {
    if (!dict.has(N("Resources"))) continue;
    const resources = dict.lookup(N("Resources"));
    if (!(resources instanceof PDFDict)) continue;
    let spaces = resources.lookupMaybe(N("ColorSpace"), PDFDict);
    if (!spaces) {
      spaces = ctx.obj({}) as PDFDict;
      resources.set(N("ColorSpace"), spaces);
    }
    if (!spaces.has(N("DefaultCMYK"))) spaces.set(N("DefaultCMYK"), cmyk);
  }
  note("Tagged CMYK colours with a colour profile");
}

// --- the whole conversion -----------------------------------------------------------------------

function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function convertToPdfA(doc: PDFDocument, level: PdfALevel, options: PdfAOptions): Promise<PdfAReport> {
  const now = options.now ?? new Date();
  const changes = new Set<string>();
  const note = (s: string) => changes.add(s);
  const progress = options.onProgress ?? (() => {});

  const plan = planPdfA(doc, level);
  let done = 0;
  for (const [index, page] of plan.pictures) {
    const picture = await options.picture(index, { annotations: page.annotations });
    await drawAsPicture(doc, index, picture, !page.annotations);
    note(`Drew page ${index + 1} as a picture with searchable text (${page.reasons.join(", ")})`);
    progress((++done / plan.pictures.size) * 0.7);
  }

  const acro = doc.catalog.lookupMaybe(N("AcroForm"), PDFDict);
  if (acro && acro.get(N("NeedAppearances"))?.toString() === "true") {
    try {
      doc.getForm().updateFieldAppearances();
      note("Drew the form fields so they look the same in every viewer");
    } catch {
      // Fields pdf-lib cannot draw keep the appearance they had.
    }
  }
  await fixAnnotations(doc, level, note);
  await doc.flush();

  recompressLzw(doc, note);
  fixGraph(doc, level, note);
  fixAttachments(doc, level, note);

  const usage = fontUsage(doc);
  // Form fields are retyped with the form's own fonts, so those keep every glyph.
  const formFonts = new Set<unknown>();
  const dr = doc.catalog.lookupMaybe(N("AcroForm"), PDFDict)?.lookupMaybe(N("DR"), PDFDict)?.lookupMaybe(N("Font"), PDFDict);
  for (const [, v] of dr?.entries() ?? []) formFonts.add(v instanceof PDFRef ? doc.context.lookup(v) : v);
  const jobs: ReplaceJob[] = [];
  for (const font of allFontDicts(doc)) {
    const verdict = judgeFont(doc, font);
    if (verdict.kind !== "replace") continue;
    const used = usage && !formFonts.has(font) ? (usage.get(font) ?? new Set<number>()) : undefined;
    jobs.push({ font, verdict, used });
  }
  const fontsEmbedded = await replaceFonts(doc, jobs, options.loadFont);
  if (fontsEmbedded.length) note(`Embedded ${fontsEmbedded.length} font${fontsEmbedded.length === 1 ? "" : "s"} the PDF only named`);

  addColour(doc, note);
  writePdfAMetadata(doc, partOf(level), now);
  const ctx = doc.context;
  ctx.trailerInfo.Encrypt = undefined;
  const id = PDFHexString.of(randomId());
  ctx.trailerInfo.ID = ctx.obj([id, id]);
  dropUnreachable(doc);
  progress(0.9);

  const bytes = await doc.save({
    useObjectStreams: level !== "1b",
    updateFieldAppearances: false,
    addDefaultPage: false,
  });
  progress(1);
  return {
    bytes,
    level,
    fontsEmbedded,
    pagesAsPictures: [...plan.pictures.keys()].map((i) => i + 1),
    changes: [...changes],
  };
}
