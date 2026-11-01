import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from "@cantoo/pdf-lib";

import {
  binarize,
  isColorful,
  lumaOf,
  shrinkLuma,
  unpackGray1,
} from "@/lib/bilevel";
import { TARGET_LADDER, type CompressPlan } from "@/lib/compress-plans";
import { dedupe, deflateMax, dropUnreachable, recompressStreams, stripInvisible } from "@/lib/compress-structure";
import {
  colourCount,
  commonColours,
  encodeLossless,
  looksDigital,
  paletteOf,
  snapToPalette,
  unpredict,
  type Lossless,
} from "@/lib/image-lossless";
import { mrcBytes, splitScan, type MrcLayers } from "@/lib/compress-mrc";
import { hasWholeFonts, subsetFonts, type Subsetter } from "@/lib/font-subset";
import { encodeJbig2Best } from "@/lib/jbig2";
import { stripPdfMetadata } from "@/lib/pdf-meta";
import { scanImagePlacements, type Placement } from "@/lib/pdf-placements";

/** Streams this pass wrote, already deflated as hard as they will go. */
const written = new WeakSet<PDFRawStream>();

/** RGBA pixels, the shape both codecs and canvases speak. */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

export interface ImageCodec {
  decodeJpeg(bytes: Uint8Array): Promise<Pixels | null>;
  resize(pixels: Pixels, width: number, height: number): Promise<Pixels>;
  /** quality is 0–100; gray writes a one-channel JPEG. */
  encodeJpeg(pixels: Pixels, quality: number, gray: boolean): Promise<Uint8Array>;
  /** Cuts whole embedded fonts down to the glyphs in use; null when it can't load. */
  fontSubsetter?(): Promise<Subsetter | null>;
}

const QUALITY_STEP = 8;
const QUALITY_FLOOR_DROP = 32;

/** Keep the original pixels unless this would drop at least 15% per side. */
const RESAMPLE_BELOW = 0.85;
/** A rewrite has to save at least 5% to be worth swapping in. */
const KEEP_IF_UNDER = 0.95;
const PHOTO_COLOR_FLOOR = 256;
/** Grey images top out at 256 tones, so photos show up with fewer. */
const PHOTO_GRAY_FLOOR = 96;

export type CompressStats = {
  images: number;
  resampled: number;
  streams: number;
  /** Objects nothing pointed to, and copies of identical ones, dropped. */
  dropped?: number;
  folded?: number;
  /** Bytes the embedded font programs lost to subsetting. */
  fontBytes?: number;
};

export type ProgressFn = (fraction: number) => void;

/** zlib at level 9: a few percent under the browser's CompressionStream on every stream. */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return deflateMax(bytes);
}

/** "FlateDecode" for one filter, null for none, undefined for a chain. */
function singleFilter(dict: PDFDict): string | null | undefined {
  const filter = dict.lookup(PDFName.of("Filter"));
  if (filter === undefined) return null;
  const name =
    filter instanceof PDFName
      ? filter
      : filter instanceof PDFArray && filter.size() === 1
        ? filter.lookup(0, PDFName)
        : undefined;
  return name?.asString().replace(/^\//, "");
}

/** Lossless filters pdf-lib can undo, which writers stack in front of the real one. */
const TRANSPORT_FILTERS = new Set([
  "ASCII85Decode",
  "ASCIIHexDecode",
  "FlateDecode",
  "LZWDecode",
  "RunLengthDecode",
]);

/** Every filter name in order, or null when an entry isn't a name. */
function filterChain(dict: PDFDict): string[] | null {
  const filter = dict.lookup(PDFName.of("Filter"));
  if (filter === undefined) return [];
  if (filter instanceof PDFName) return [filter.asString().replace(/^\//, "")];
  if (!(filter instanceof PDFArray)) return null;
  const names: string[] = [];
  for (let i = 0; i < filter.size(); i++) {
    const name = filter.lookup(i);
    if (!(name instanceof PDFName)) return null;
    names.push(name.asString().replace(/^\//, ""));
  }
  return names;
}

/** Undoes the given filters only, e.g. the ASCII85 wrapped around a JPEG. */
function undoFilters(stream: PDFRawStream, filters: string[]): Uint8Array {
  if (filters.length === 0) return stream.contents;
  const dict = stream.dict.clone();
  dict.set(
    PDFName.of("Filter"),
    dict.context.obj(filters.map((f) => PDFName.of(f))),
  );
  return decodePDFRawStream(PDFRawStream.of(dict, stream.contents)).decode();
}

/** 1 or 3 for color spaces we can round-trip, otherwise null. */
function channels(doc: PDFDocument, dict: PDFDict): 1 | 3 | null {
  const space = dict.lookup(PDFName.of("ColorSpace"));
  if (space instanceof PDFName) {
    if (space === PDFName.of("DeviceGray")) return 1;
    if (space === PDFName.of("DeviceRGB")) return 3;
    return null;
  }
  if (!(space instanceof PDFArray) || space.size() < 2) return null;
  const family = space.lookup(0);
  if (family === PDFName.of("CalGray")) return 1;
  if (family === PDFName.of("CalRGB")) return 3;
  if (family === PDFName.of("ICCBased")) {
    const profile = doc.context.lookup(space.get(1));
    const n =
      profile instanceof PDFRawStream
        ? profile.dict.lookup(PDFName.of("N"))
        : undefined;
    if (n instanceof PDFNumber && n.asNumber() === 1) return 1;
    if (n instanceof PDFNumber && n.asNumber() === 3) return 3;
  }
  return null;
}

function num(dict: PDFDict, key: string): number | null {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : null;
}

function toRgba(raw: Uint8Array, width: number, height: number, ch: 1 | 3) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0, s = 0; p < width * height; p++, s += ch) {
    const o = p * 4;
    data[o] = raw[s];
    data[o + 1] = raw[s + (ch === 3 ? 1 : 0)];
    data[o + 2] = raw[s + (ch === 3 ? 2 : 0)];
    data[o + 3] = 255;
  }
  return data;
}

function fromRgba(pixels: Pixels, ch: 1 | 3): Uint8Array {
  const count = pixels.width * pixels.height;
  const out = new Uint8Array(count * ch);
  for (let p = 0; p < count; p++) {
    const o = p * 4;
    if (ch === 1) out[p] = pixels.data[o];
    else out.set(pixels.data.subarray(o, o + 3), p * 3);
  }
  return out;
}

/**
 * Flat graphics, charts, and screenshots have few distinct colors; JPEG
 * blurs their edges, so they stay lossless.
 */
export function looksPhotographic(pixels: Pixels, colorFloor = PHOTO_COLOR_FLOOR): boolean {
  const count = pixels.width * pixels.height;
  const step = Math.max(1, Math.floor(count / 8192));
  const seen = new Set<number>();
  for (let p = 0; p < count; p += step) {
    const o = p * 4;
    seen.add(
      (pixels.data[o] << 16) | (pixels.data[o + 1] << 8) | pixels.data[o + 2],
    );
    if (seen.size >= colorFloor) return true;
  }
  return false;
}

/** Luma PSNR in dB between two same-size RGBA buffers, sampled. */
export function psnr(a: Pixels, b: Pixels): number {
  const count = a.width * a.height;
  const step = Math.max(1, Math.floor(count / 65536));
  let sum = 0;
  let n = 0;
  for (let p = 0; p < count; p += step) {
    const o = p * 4;
    const ya = 0.299 * a.data[o] + 0.587 * a.data[o + 1] + 0.114 * a.data[o + 2];
    const yb = 0.299 * b.data[o] + 0.587 * b.data[o + 1] + 0.114 * b.data[o + 2];
    sum += (ya - yb) ** 2;
    n++;
  }
  const mse = sum / Math.max(n, 1);
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/**
 * Starts at plan.quality and steps down while the decoded result still
 * clears plan.minPsnr. Flat gradients and textures land far lower than
 * detailed photos, which is where most of the saving on real files is.
 */
async function encodeAdaptive(
  pixels: Pixels,
  plan: CompressPlan,
  gray: boolean,
  codec: ImageCodec,
): Promise<Uint8Array> {
  let best = await codec.encodeJpeg(pixels, plan.quality, gray);
  const floor = Math.max(10, plan.quality - QUALITY_FLOOR_DROP);
  for (let q = plan.quality - QUALITY_STEP; q >= floor; q -= QUALITY_STEP) {
    const next = await codec.encodeJpeg(pixels, q, gray);
    const back = await codec.decodeJpeg(next);
    if (!back || back.width !== pixels.width || back.height !== pixels.height) break;
    if (psnr(pixels, back) < plan.minPsnr) break;
    if (next.length < best.length) best = next;
  }
  return best;
}

/** Pixel size an image needs to look sharp where it is drawn. */
export function targetSize(
  width: number,
  height: number,
  placement: Placement,
  dpi: number,
): { width: number; height: number } {
  const needW = (placement.widthPt / 72) * dpi;
  const needH = (placement.heightPt / 72) * dpi;
  const scale = Math.max(needW / width, needH / height);
  if (!Number.isFinite(scale) || scale >= RESAMPLE_BELOW) {
    return { width, height };
  }
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function softMaskRefs(doc: PDFDocument): Set<string> {
  const masks = new Set<string>();
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const mask = object.dict.get(PDFName.of("SMask"));
    if (mask instanceof PDFRef) masks.add(mask.toString());
  }
  return masks;
}

function setImage(
  doc: PDFDocument,
  stream: PDFRawStream,
  bytes: Uint8Array,
  width: number,
  height: number,
  filter: "DCTDecode" | "FlateDecode",
) {
  written.add(stream);
  stream.contents = bytes;
  const { dict } = stream;
  dict.set(PDFName.of("Width"), doc.context.obj(width));
  dict.set(PDFName.of("Height"), doc.context.obj(height));
  dict.set(PDFName.of("BitsPerComponent"), doc.context.obj(8));
  dict.set(PDFName.of("Filter"), PDFName.of(filter));
  dict.delete(PDFName.of("DecodeParms"));
  dict.set(PDFName.of("Length"), doc.context.obj(bytes.length));
}

/** Swaps in a 1-bit JBIG2 stream; ink is sample 0, as DeviceGray reads it. */
function setBilevelImage(
  doc: PDFDocument,
  stream: PDFRawStream,
  bytes: Uint8Array,
  width: number,
  height: number,
) {
  written.add(stream);
  stream.contents = bytes;
  const { dict } = stream;
  dict.set(PDFName.of("Width"), doc.context.obj(width));
  dict.set(PDFName.of("Height"), doc.context.obj(height));
  dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceGray"));
  dict.set(PDFName.of("BitsPerComponent"), doc.context.obj(1));
  dict.set(PDFName.of("Filter"), PDFName.of("JBIG2Decode"));
  dict.delete(PDFName.of("DecodeParms"));
  dict.set(PDFName.of("Length"), doc.context.obj(bytes.length));
}

/**
 * Lossless coding of a big image takes seconds; one band of rows in eight, coded alone, says
 * within a few percent whether it can beat the JPEG at all.
 */
function losslessMayWin(samples: Uint8Array, width: number, height: number, ch: 1 | 3, jpegBytes: number): boolean {
  if (!Number.isFinite(jpegBytes) || width * height < 1_000_000) return true;
  const band = 16;
  const rows: number[] = [];
  for (let y = 0; y + band <= height; y += band * 8) for (let k = 0; k < band; k++) rows.push(y + k);
  const rowBytes = width * ch;
  const sample = new Uint8Array(rows.length * rowBytes);
  rows.forEach((y, i) => sample.set(samples.subarray(y * rowBytes, (y + 1) * rowBytes), i * rowBytes));
  const estimate = (encodeLossless(sample, width, rows.length, ch).bytes.length * height) / rows.length;
  return estimate < jpegBytes * 1.15;
}

/** Predictor parms of an image, {predictor: 1} for none, null for ones we can't undo. */
function predictorOf(dict: PDFDict): { predictor: number; colors: number; bits: number; columns: number } | null {
  const raw = dict.lookup(PDFName.of("DecodeParms"));
  if (raw === undefined) return { predictor: 1, colors: 1, bits: 8, columns: 1 };
  const parms = raw instanceof PDFArray && raw.size() === 1 ? raw.lookup(0) : raw;
  if (!(parms instanceof PDFDict)) return null;
  const n = (key: string, fallback: number) => {
    const v = parms.lookup(PDFName.of(key));
    return v instanceof PDFNumber ? v.asNumber() : fallback;
  };
  const known = new Set(["Predictor", "Colors", "BitsPerComponent", "Columns"]);
  for (const [k] of parms.entries()) if (!known.has(k.asString().replace(/^\//, ""))) return null;
  return { predictor: n("Predictor", 1), colors: n("Colors", 1), bits: n("BitsPerComponent", 8), columns: n("Columns", 1) };
}

/**
 * Grey in all but name. Decoded JPEGs carry a little chroma noise, so tolerance lets a pixel
 * stray that far, and one in two hundred may stray further (dust, a coloured speck).
 */
function nearlyGray(pixels: Pixels, tolerance: number): boolean {
  const count = pixels.width * pixels.height;
  const step = Math.max(1, Math.floor(count / 65536));
  let off = 0;
  let n = 0;
  for (let p = 0; p < count; p += step, n++) {
    const o = p * 4;
    const r = pixels.data[o];
    const g = pixels.data[o + 1];
    const b = pixels.data[o + 2];
    if (Math.abs(r - g) > tolerance || Math.abs(g - b) > tolerance) off++;
  }
  return off <= n / 200 && (tolerance > 0 || off === 0);
}

/** Writes a lossless coding: palette, bit depth and predictor parms as encodeLossless chose. */
function setLossless(doc: PDFDocument, stream: PDFRawStream, l: Lossless, width: number, height: number, ch: 1 | 3) {
  written.add(stream);
  const { dict } = stream;
  const original = dict.get(PDFName.of("ColorSpace"));
  const base = l.gray && ch === 3 ? PDFName.of("DeviceGray") : original!;
  stream.contents = l.bytes;
  dict.set(PDFName.of("Width"), doc.context.obj(width));
  dict.set(PDFName.of("Height"), doc.context.obj(height));
  dict.set(PDFName.of("BitsPerComponent"), doc.context.obj(l.bitsPerComponent));
  dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
  if (l.palette) {
    const hex = Array.from(l.palette, (b) => b.toString(16).padStart(2, "0")).join("");
    const n = l.palette.length / (l.gray || ch === 1 ? 1 : 3);
    dict.set(PDFName.of("ColorSpace"), doc.context.obj([PDFName.of("Indexed"), base, n - 1, PDFHexString.of(hex)]));
  } else dict.set(PDFName.of("ColorSpace"), base);
  if (l.predictor) {
    dict.set(
      PDFName.of("DecodeParms"),
      doc.context.obj({ Predictor: 15, Colors: l.predictor.colors, BitsPerComponent: l.predictor.bits, Columns: l.predictor.columns }),
    );
  } else dict.delete(PDFName.of("DecodeParms"));
  dict.set(PDFName.of("Length"), doc.context.obj(l.bytes.length));
}

/** Big enough on the page, and fine enough, to be a scanned page rather than a picture on one. */
function scanSized(placement: Placement, width: number, height: number): boolean {
  const area = placement.widthPt * placement.heightPt;
  const dpi = (width / placement.widthPt) * 72;
  return area >= 0.3 * 612 * 792 && dpi >= 120 && width * height >= 1_000_000;
}

/**
 * Puts the three MRC layers where the scan was: the image object becomes a form, drawn in the
 * same unit square, that paints the paper and then the ink colour through the text mask.
 */
function setMrc(doc: PDFDocument, ref: PDFRef, l: MrcLayers) {
  const ctx = doc.context;
  const image = (bytes: Uint8Array, entries: Record<string, unknown>) => {
    const s = ctx.stream(bytes, { Type: "XObject", Subtype: "Image", Length: bytes.length, ...entries } as never);
    written.add(s);
    return ctx.register(s);
  };
  const mask = image(l.mask.bytes, {
    Width: l.mask.width,
    Height: l.mask.height,
    ImageMask: true,
    BitsPerComponent: 1,
    // JBIG2 ink decodes to 1, and in an explicit mask 1 is where the foreground shows.
    Filter: "JBIG2Decode",
  });
  const fg = image(l.fg.bytes, {
    Width: l.fg.width,
    Height: l.fg.height,
    ColorSpace: l.fg.gray ? "DeviceGray" : "DeviceRGB",
    BitsPerComponent: 8,
    Filter: "DCTDecode",
    Mask: mask,
  });
  const bg = image(l.bg.bytes, {
    Width: l.bg.width,
    Height: l.bg.height,
    ColorSpace: l.bg.gray ? "DeviceGray" : "DeviceRGB",
    BitsPerComponent: 8,
    Filter: "DCTDecode",
  });
  const content = new TextEncoder().encode("/B Do /F Do");
  const form = ctx.stream(content, {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, 1, 1],
    Resources: { XObject: { B: bg, F: fg } },
    Length: content.length,
  } as never);
  written.add(form);
  ctx.assign(ref, form);
}

/** Shrinks a gray soft mask to match its parent's new pixel size. */
async function resizeSoftMask(
  doc: PDFDocument,
  parent: PDFRawStream,
  width: number,
  height: number,
  codec: ImageCodec,
) {
  const ref = parent.dict.get(PDFName.of("SMask"));
  const mask = ref instanceof PDFRef ? doc.context.lookup(ref) : null;
  if (!(mask instanceof PDFRawStream)) return;
  const filter = singleFilter(mask.dict);
  const mw = num(mask.dict, "Width");
  const mh = num(mask.dict, "Height");
  if (filter !== null && filter !== "FlateDecode") return;
  if (mask.dict.has(PDFName.of("DecodeParms")) || mask.dict.has(PDFName.of("Matte"))) return;
  if (num(mask.dict, "BitsPerComponent") !== 8 || !mw || !mh) return;
  if (mw <= width && mh <= height) return;
  let raw: Uint8Array;
  try {
    raw = decodePDFRawStream(mask).decode();
  } catch {
    return;
  }
  if (raw.length < mw * mh) return;
  const resized = await codec.resize(
    { data: toRgba(raw, mw, mh, 1), width: mw, height: mh },
    width,
    height,
  );
  const packed = await deflate(fromRgba(resized, 1));
  if (packed.length < mask.contents.length) {
    setImage(doc, mask, packed, width, height, "FlateDecode");
  }
}

/**
 * Scanned text as 1-bit JBIG2. Returns null when the image is a photo,
 * carries colour, or the result would not be smaller, so the caller can
 * fall back to the JPEG/Flate route.
 */
function tryBilevel(
  doc: PDFDocument,
  stream: PDFRawStream,
  pixels: Pixels,
  placement: Placement,
  plan: CompressPlan,
): "rewritten" | "resampled" | null {
  if (isColorful(pixels)) return null;
  const size = targetSize(pixels.width, pixels.height, placement, plan.bilevelDpi);
  const luma = shrinkLuma(lumaOf(pixels), pixels.width, pixels.height, size.width, size.height);
  const result = binarize(luma, size.width, size.height);
  if (!result.bilevel) return null;
  const bytes = encodeJbig2Best(result.ink, size.width, size.height, plan.matchLetters);
  if (bytes.length >= stream.contents.length * KEEP_IF_UNDER) return null;
  setBilevelImage(doc, stream, bytes, size.width, size.height);
  return size.width !== pixels.width || size.height !== pixels.height ? "resampled" : "rewritten";
}

/**
 * Images already 1-bit. They keep every pixel unless the plan lets scans
 * drop to a lower resolution and the page really is text, not halftone.
 */
function recodeOneBit(
  doc: PDFDocument,
  stream: PDFRawStream,
  width: number,
  height: number,
  chain: string[],
  placement: Placement,
  plan: CompressPlan,
): "skipped" | "kept" | "rewritten" | "resampled" {
  if (!chain.every((f) => TRANSPORT_FILTERS.has(f))) return "skipped";
  let raw: Uint8Array;
  try {
    raw = undoFilters(stream, chain);
  } catch {
    return "skipped";
  }
  if (raw.length < ((width + 7) >> 3) * height) return "skipped";
  let ink = unpackGray1(raw, width, height);
  let outW = width;
  let outH = height;
  let outcome: "rewritten" | "resampled" = "rewritten";
  if (plan.bilevelDpi > 0) {
    const size = targetSize(width, height, placement, plan.bilevelDpi);
    if (size.width !== width || size.height !== height) {
      const grey = new Uint8Array(ink.length);
      for (let i = 0; i < ink.length; i++) grey[i] = ink[i] ? 0 : 255;
      const small = binarize(shrinkLuma(grey, width, height, size.width, size.height), size.width, size.height);
      if (small.bilevel) {
        ink = small.ink;
        outW = size.width;
        outH = size.height;
        outcome = "resampled";
      }
    }
  }
  const bytes = encodeJbig2Best(ink, outW, outH, plan.matchLetters);
  if (bytes.length >= stream.contents.length * KEEP_IF_UNDER) return "kept";
  setBilevelImage(doc, stream, bytes, outW, outH);
  return outcome;
}

async function compressImage(
  doc: PDFDocument,
  stream: PDFRawStream,
  placement: Placement,
  plan: CompressPlan,
  codec: ImageCodec,
  ref?: PDFRef,
): Promise<"skipped" | "kept" | "rewritten" | "resampled"> {
  const { dict } = stream;
  const width = num(dict, "Width");
  const height = num(dict, "Height");
  const ch = channels(doc, dict);
  const chain = filterChain(dict);
  if (!width || !height || !ch || !chain) return "skipped";
  const bits = num(dict, "BitsPerComponent");
  if (bits !== 8 && !(bits === 1 && ch === 1)) return "skipped";
  if (dict.has(PDFName.of("ImageMask")) || dict.has(PDFName.of("Decode"))) {
    return "skipped";
  }
  // Color-key masks match exact sample values, which lossy output breaks.
  if (dict.lookup(PDFName.of("Mask")) instanceof PDFArray) return "skipped";
  const parms = predictorOf(dict);
  if (parms === null) return "skipped";
  if (bits === 1) {
    if (parms.predictor > 1) return "skipped";
    return recodeOneBit(doc, stream, width, height, chain, placement, plan);
  }
  const jpeg = chain.at(-1) === "DCTDecode";
  const transport = jpeg ? chain.slice(0, -1) : chain;
  if (!transport.every((f) => TRANSPORT_FILTERS.has(f))) return "skipped";

  let pixels: Pixels | null;
  if (jpeg) {
    let bytes: Uint8Array;
    try {
      bytes = undoFilters(stream, transport);
    } catch {
      return "skipped";
    }
    pixels = await codec.decodeJpeg(bytes);
  } else {
    let raw: Uint8Array;
    try {
      raw = undoFilters(stream, transport);
    } catch {
      return "skipped";
    }
    if (parms.predictor > 1) {
      if (parms.colors !== ch || parms.bits !== 8 || parms.columns !== width) return "skipped";
      const plain = unpredict(raw, parms.predictor, ch, 8, width);
      if (!plain) return "skipped";
      raw = plain;
    }
    if (raw.length < width * height * ch) return "skipped";
    pixels = { data: toRgba(raw, width, height, ch), width, height };
  }
  if (!pixels || pixels.width !== width || pixels.height !== height) {
    return "skipped";
  }

  // Only lossless sources are read as samples again; for a JPEG the copy would be wasted.
  const source = jpeg ? null : fromRgba(pixels, ch);
  // Screenshots and charts are not scans: two-tone coding would wipe out their flat greys.
  const digital = !!source && looksDigital(source, width, height, ch);
  if (plan.bilevelDpi > 0 && !dict.has(PDFName.of("SMask")) && !digital) {
    const outcome = tryBilevel(doc, stream, pixels, placement, plan);
    if (outcome) return outcome;
  }

  // A colour scan of a document: sharp 1-bit text over low-resolution colour (MRC).
  let mrc: MrcLayers | null = null;
  if (ref && plan.bilevelDpi > 0 && !digital && !dict.has(PDFName.of("SMask")) && scanSized(placement, width, height)) {
    const mask = targetSize(width, height, placement, plan.bilevelDpi);
    const bgScale = Math.max(2, plan.bilevelDpi / (plan.dpi / 2));
    mrc = await splitScan(
      pixels,
      {
        maskWidth: mask.width,
        maskHeight: mask.height,
        bgScale,
        fgScale: bgScale * 2,
        bgQuality: Math.max(30, plan.quality - 14),
        fgQuality: 50,
        matchLetters: plan.matchLetters,
      },
      codec,
    );
  }

  const size = targetSize(width, height, placement, plan.dpi);
  const resampled = size.width !== width || size.height !== height;
  const out = resampled
    ? await codec.resize(pixels, size.width, size.height)
    : pixels;

  // Colour that is only grey (a B/W page scanned in colour) is stored as grey.
  const gray = ch === 1 || nearlyGray(out, jpeg ? 3 : 0);
  type Candidate = { bytes: Uint8Array; set: () => void };
  const candidates: Candidate[] = [];
  const jpegAllowed = jpeg || ((plan.lossyFlate || ch === 1) && looksPhotographic(out, ch === 1 ? PHOTO_GRAY_FLOOR : PHOTO_COLOR_FLOOR));
  if (jpegAllowed) {
    const bytes = await encodeAdaptive(out, plan, gray, codec);
    candidates.push({
      bytes,
      set: () => {
        setImage(doc, stream, bytes, out.width, out.height, "DCTDecode");
        if (gray && ch === 3) dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceGray"));
      },
    });
  }
  // Lossless: palette, grey and PNG filters. Skipped for photos, where it never wins and costs time.
  const samples = jpeg ? new Uint8Array(0) : out === pixels ? source! : fromRgba(out, ch);
  const floor = ch === 1 ? 160 : 4096;
  const photographic = !jpeg && jpegAllowed && colourCount(samples, out.width * out.height, ch, floor) >= floor;
  const jpegBytes = candidates[0]?.bytes.length ?? Infinity;
  // Flat art of 256 colours or fewer: resampling blurs it into thousands, so it is also tried at
  // full size, and (when the level allows loss) resampled then put back on its own colours.
  // Screenshots and charts: resampling blurs flat colour into thousands of values, so they are
  // also tried at full size, and (where the level allows loss) on 256 colours of their own.
  const exact = source && digital ? paletteOf(source, width * height, ch) : null;
  if (source && digital) {
    if (resampled) {
      const l = encodeLossless(source, width, height, ch);
      candidates.push({ bytes: l.bytes, set: () => setLossless(doc, stream, l, width, height, ch) });
    }
    const palette = exact ?? (plan.lossyFlate ? commonColours(source, width * height, ch) : null);
    if (palette && plan.lossyFlate) {
      const sized = [{ px: samples, w: out.width, h: out.height }];
      if (resampled && !exact) sized.push({ px: source, w: width, h: height });
      for (const { px, w, h } of sized) {
        const l = encodeLossless(snapToPalette(px, w * h, ch, palette), w, h, ch);
        candidates.push({ bytes: l.bytes, set: () => setLossless(doc, stream, l, w, h, ch) });
      }
    }
  }
  if (!jpeg && !photographic && !(exact && resampled) && losslessMayWin(samples, out.width, out.height, ch, jpegBytes)) {
    const l = encodeLossless(samples, out.width, out.height, ch);
    candidates.push({ bytes: l.bytes, set: () => setLossless(doc, stream, l, out.width, out.height, ch) });
  }

  if (mrc && ref) {
    const layers = mrc;
    candidates.push({ bytes: { length: mrcBytes(layers) } as Uint8Array, set: () => setMrc(doc, ref, layers) });
  }

  const ceiling = stream.contents.length * KEEP_IF_UNDER;
  const chosen = candidates
    .filter((c) => c.bytes.length < ceiling)
    .sort((a, b) => a.bytes.length - b.bytes.length)[0];
  if (!chosen) return "kept";
  chosen.set();
  if (ref && doc.context.lookup(ref) !== stream) return "resampled";
  const finalW = num(dict, "Width")!;
  const finalH = num(dict, "Height")!;
  const shrunk = finalW !== width || finalH !== height;
  if (shrunk) await resizeSoftMask(doc, stream, finalW, finalH, codec);
  return shrunk ? "resampled" : "rewritten";
}

/**
 * One compression pass that keeps the page itself: text, vectors, links,
 * and forms stay as they are. Each image drawn on a page is resampled to the
 * plan's dpi at its drawn size and re-encoded only when that is smaller.
 */
export async function compressPdfBytes(
  input: Uint8Array,
  plan: CompressPlan,
  codec: ImageCodec,
  onProgress: ProgressFn = () => {},
): Promise<{ bytes: Uint8Array; stats: CompressStats }> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true });
  stripPdfMetadata(doc);
  const stats: CompressStats = { images: 0, resampled: 0, streams: 0 };

  // Encrypted streams would decode to noise; only the rewrite is safe.
  if (!doc.isEncrypted) {
    stripInvisible(doc);
    stats.dropped = dropUnreachable(doc);
    // Before images, so a logo repeated in every merged file is recoded once.
    stats.folded = dedupe(doc);
    const placements = scanImagePlacements(doc);
    const masks = softMaskRefs(doc);
    const targets = [...placements].filter(([key]) => !masks.has(key));
    for (let i = 0; i < targets.length; i++) {
      const [key, placement] = targets[i];
      const [objNum, gen] = key.split(" ").map(Number);
      const stream = doc.context.lookup(PDFRef.of(objNum, gen));
      if (stream instanceof PDFRawStream) {
        try {
          const outcome = await compressImage(doc, stream, placement, plan, codec, PDFRef.of(objNum, gen));
          if (outcome === "rewritten" || outcome === "resampled") stats.images++;
          if (outcome === "resampled") stats.resampled++;
        } catch {
          // A codec that chokes on one image leaves that image as it was.
        }
      }
      onProgress((0.9 * (i + 1)) / targets.length);
    }
    // Whole fonts (pdf-lib output, merged files) down to the glyphs the pages draw.
    if (codec.fontSubsetter && hasWholeFonts(doc)) {
      const subsetter = await codec.fontSubsetter();
      if (subsetter) stats.fontBytes = subsetFonts(doc, subsetter);
    }
    stats.streams = recompressStreams(doc, written);
    // Soft masks and images replaced above may have left orphans or new twins.
    stats.dropped += dropUnreachable(doc);
    stats.folded += dedupe(doc);
  }

  const bytes = await doc.save({ useObjectStreams: true });
  onProgress(1);
  return { bytes, stats };
}

/**
 * Walks the ladder until the file fits targetBytes. Returns the first plan
 * that fits, or the smallest result when none does.
 */
export async function compressPdfToTarget(
  input: Uint8Array,
  targetBytes: number,
  codec: ImageCodec,
  onProgress: ProgressFn = () => {},
): Promise<{ bytes: Uint8Array; fit: boolean; plan: CompressPlan }> {
  let smallest: { bytes: Uint8Array; plan: CompressPlan } | null = null;
  for (let i = 0; i < TARGET_LADDER.length; i++) {
    const plan = TARGET_LADDER[i];
    const { bytes } = await compressPdfBytes(input, plan, codec, (f) =>
      onProgress((i + f) / TARGET_LADDER.length),
    );
    if (!smallest || bytes.length < smallest.bytes.length) {
      smallest = { bytes, plan };
    }
    if (bytes.length <= targetBytes) {
      onProgress(1);
      return { bytes, fit: true, plan };
    }
  }
  onProgress(1);
  return { bytes: smallest!.bytes, fit: false, plan: smallest!.plan };
}
