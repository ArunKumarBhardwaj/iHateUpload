import {
  decodePDFRawStream,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  PDFHexString,
  type PDFObject,
} from "@cantoo/pdf-lib";

import { encodePng } from "@/lib/png-encode";

/**
 * Pulls the pictures out of a PDF without redrawing them. A JPEG stays the
 * very same JPEG bytes (JPX stays JPEG 2000); everything else is decoded
 * straight from its stream and written as a lossless PNG. No canvas, so it
 * runs the same in a worker, a test or the page.
 */
export type ImageFormat = "jpg" | "jp2" | "png";

export type ExtractedImage = {
  /** Stable within one scan: "<objectNumber>". */
  id: string;
  /** First page that uses it, 1-based. */
  page: number;
  /** Every page that uses it. */
  pages: number[];
  width: number;
  height: number;
  format: ImageFormat;
  bytes: Uint8Array;
};

export type SkippedImage = { page: number; width: number; height: number };

export type ImageScan = {
  images: ExtractedImage[];
  /** Streams we could not decode here (fax / JBIG2 / spot colours). */
  skipped: SkippedImage[];
};

const N = (name: string) => PDFName.of(name);

function filtersOf(dict: PDFDict): PDFName[] {
  const filter = dict.lookup(N("Filter"));
  if (filter instanceof PDFName) return [filter];
  if (filter instanceof PDFArray) {
    const out: PDFName[] = [];
    for (let i = 0; i < filter.size(); i++) {
      const item = filter.lookup(i);
      if (item instanceof PDFName) out.push(item);
    }
    return out;
  }
  return [];
}

function numberOf(value: PDFObject | undefined, fallback: number) {
  return value instanceof PDFNumber ? value.asNumber() : fallback;
}

function isRawStream(value: unknown): value is PDFRawStream {
  return value instanceof PDFRawStream;
}

/** Streams stored through ordinary filters, minus the trailing image codec. */
function bytesBeforeCodec(stream: PDFRawStream, keep: number): Uint8Array {
  if (keep === 0) return stream.getContents();
  const filters = filtersOf(stream.dict);
  const parms = stream.dict.lookup(N("DecodeParms"));
  const dict = stream.dict.context.obj({});
  dict.set(N("Filter"), stream.dict.context.obj(filters.slice(0, keep)));
  if (parms instanceof PDFArray) {
    const head: PDFObject[] = [];
    for (let i = 0; i < keep; i++) head.push(parms.get(i));
    dict.set(N("DecodeParms"), stream.dict.context.obj(head));
  } else if (parms && keep === 1) {
    dict.set(N("DecodeParms"), parms);
  }
  return decodePDFRawStream({
    dict,
    contents: stream.getContents(),
  } as PDFRawStream).decode();
}

type Colour =
  | { kind: "gray" }
  | { kind: "rgb" }
  | { kind: "cmyk" }
  | { kind: "indexed"; base: "gray" | "rgb" | "cmyk"; palette: Uint8Array };

function lookupBytes(value: PDFObject | undefined): Uint8Array | null {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.asBytes();
  }
  if (isRawStream(value)) return decodePDFRawStream(value).decode();
  return null;
}

function resolveColour(
  space: PDFObject | undefined,
  context: PDFDict["context"],
  depth = 0,
): Colour | null {
  if (!space || depth > 3) return null;
  const resolved = context.lookup(space);
  if (resolved instanceof PDFName) {
    switch (resolved.asString()) {
      case "/DeviceGray":
      case "/G":
      case "/CalGray":
        return { kind: "gray" };
      case "/DeviceRGB":
      case "/RGB":
      case "/CalRGB":
        return { kind: "rgb" };
      case "/DeviceCMYK":
      case "/CMYK":
        return { kind: "cmyk" };
      default:
        return null;
    }
  }
  if (!(resolved instanceof PDFArray) || resolved.size() === 0) return null;
  const head = resolved.lookup(0);
  if (!(head instanceof PDFName)) return null;
  switch (head.asString()) {
    case "/CalGray":
      return { kind: "gray" };
    case "/CalRGB":
    case "/Lab":
      return head.asString() === "/Lab" ? null : { kind: "rgb" };
    case "/ICCBased": {
      const profile = resolved.lookup(1);
      const dict =
        profile instanceof PDFRawStream
          ? profile.dict
          : profile instanceof PDFStream
            ? profile.dict
            : null;
      const n = dict ? numberOf(dict.lookup(N("N")), 0) : 0;
      return n === 1
        ? { kind: "gray" }
        : n === 3
          ? { kind: "rgb" }
          : n === 4
            ? { kind: "cmyk" }
            : null;
    }
    case "/Indexed":
    case "/I": {
      const base = resolveColour(resolved.get(1), context, depth + 1);
      const table = lookupBytes(resolved.lookup(3));
      if (!base || base.kind === "indexed" || !table) return null;
      return { kind: "indexed", base: base.kind, palette: table };
    }
    default:
      return null;
  }
}

function componentsOf(colour: Colour): number {
  switch (colour.kind) {
    case "gray":
    case "indexed":
      return 1;
    case "rgb":
      return 3;
    case "cmyk":
      return 4;
  }
}

/** Samples of any depth to 8 bits, one byte per component, rows unpadded. */
function unpackSamples(
  raw: Uint8Array,
  width: number,
  height: number,
  comps: number,
  bpc: number,
  scaleTo255: boolean,
): Uint8Array | null {
  const perRow = width * comps;
  const out = new Uint8Array(perRow * height);
  if (bpc === 8) {
    if (raw.length < out.length) return null;
    out.set(raw.subarray(0, out.length));
    return out;
  }
  if (bpc === 16) {
    if (raw.length < out.length * 2) return null;
    for (let i = 0; i < out.length; i++) out[i] = raw[i * 2];
    return out;
  }
  if (bpc !== 1 && bpc !== 2 && bpc !== 4) return null;
  const rowBytes = Math.ceil((perRow * bpc) / 8);
  if (raw.length < rowBytes * height) return null;
  const max = (1 << bpc) - 1;
  const mask = max;
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    for (let i = 0; i < perRow; i++) {
      const bit = i * bpc;
      const byte = raw[rowStart + (bit >> 3)];
      const value = (byte >> (8 - bpc - (bit & 7))) & mask;
      out[y * perRow + i] = scaleTo255 ? Math.round((value * 255) / max) : value;
    }
  }
  return out;
}

function decodeStreamBytes(stream: PDFRawStream): Uint8Array | null {
  for (const filter of filtersOf(stream.dict)) {
    const name = filter.asString();
    if (
      name === "/CCITTFaxDecode" ||
      name === "/CCF" ||
      name === "/JBIG2Decode" ||
      name === "/DCTDecode" ||
      name === "/DCT" ||
      name === "/JPXDecode"
    ) {
      return null;
    }
  }
  try {
    return decodePDFRawStream(stream).decode();
  } catch {
    return null;
  }
}

type Raster = { channels: 1 | 3 | 4; data: Uint8Array };

function rasterOf(
  stream: PDFRawStream,
  width: number,
  height: number,
): Raster | null {
  const dict = stream.dict;
  const context = dict.context;
  const stencil = dict.lookup(N("ImageMask"));
  const isStencil = stencil instanceof PDFBool && stencil.asBoolean();
  const bpc = isStencil ? 1 : numberOf(dict.lookup(N("BitsPerComponent")), 8);
  const colour: Colour | null = isStencil
    ? { kind: "gray" }
    : resolveColour(dict.get(N("ColorSpace")), context);
  if (!colour) return null;
  const raw = decodeStreamBytes(stream);
  if (!raw) return null;
  const comps = componentsOf(colour);
  const samples = unpackSamples(
    raw,
    width,
    height,
    comps,
    bpc,
    colour.kind !== "indexed",
  );
  if (!samples) return null;

  const decodeArray = dict.lookup(N("Decode"));
  const range: number[] | null =
    decodeArray instanceof PDFArray && decodeArray.size() >= comps * 2
      ? Array.from({ length: comps * 2 }, (_, i) =>
          numberOf(decodeArray.lookup(i), i % 2),
        )
      : null;
  if (range && colour.kind !== "indexed") {
    for (let i = 0; i < samples.length; i++) {
      const c = i % comps;
      const lo = range[c * 2];
      const hi = range[c * 2 + 1];
      if (lo === 0 && hi === 1) continue;
      samples[i] = Math.max(
        0,
        Math.min(255, Math.round((lo + (samples[i] / 255) * (hi - lo)) * 255)),
      );
    }
  }
  // A stencil mask paints where the sample is 0: show it as black on white.

  if (colour.kind === "gray") return { channels: 1, data: samples };
  if (colour.kind === "rgb") return { channels: 3, data: samples };
  if (colour.kind === "cmyk") return { channels: 3, data: cmykToRgb(samples) };

  const baseComps = colour.base === "gray" ? 1 : colour.base === "rgb" ? 3 : 4;
  const pixels = width * height;
  const out = new Uint8Array(pixels * 3);
  const lastEntry = Math.floor(colour.palette.length / baseComps) - 1;
  for (let p = 0; p < pixels; p++) {
    const index = Math.min(samples[p], Math.max(0, lastEntry)) * baseComps;
    let r: number, g: number, b: number;
    if (colour.base === "gray") {
      r = g = b = colour.palette[index] ?? 0;
    } else if (colour.base === "rgb") {
      r = colour.palette[index] ?? 0;
      g = colour.palette[index + 1] ?? 0;
      b = colour.palette[index + 2] ?? 0;
    } else {
      const c = colour.palette[index] ?? 0;
      const m = colour.palette[index + 1] ?? 0;
      const y = colour.palette[index + 2] ?? 0;
      const k = colour.palette[index + 3] ?? 0;
      r = Math.round(((255 - c) * (255 - k)) / 255);
      g = Math.round(((255 - m) * (255 - k)) / 255);
      b = Math.round(((255 - y) * (255 - k)) / 255);
    }
    out[p * 3] = r;
    out[p * 3 + 1] = g;
    out[p * 3 + 2] = b;
  }
  return { channels: 3, data: out };
}

function cmykToRgb(cmyk: Uint8Array): Uint8Array {
  const pixels = cmyk.length / 4;
  const out = new Uint8Array(pixels * 3);
  for (let p = 0; p < pixels; p++) {
    const k = 255 - cmyk[p * 4 + 3];
    out[p * 3] = Math.round(((255 - cmyk[p * 4]) * k) / 255);
    out[p * 3 + 1] = Math.round(((255 - cmyk[p * 4 + 1]) * k) / 255);
    out[p * 3 + 2] = Math.round(((255 - cmyk[p * 4 + 2]) * k) / 255);
  }
  return out;
}

/** The soft mask as one alpha byte per pixel of a `width` x `height` image. */
function alphaOf(
  image: PDFDict,
  width: number,
  height: number,
): Uint8Array | null {
  const mask = image.lookup(N("SMask"));
  if (!isRawStream(mask)) return null;
  const mw = numberOf(mask.dict.lookup(N("Width")), 0);
  const mh = numberOf(mask.dict.lookup(N("Height")), 0);
  if (mw <= 0 || mh <= 0) return null;
  const raster = rasterOf(mask, mw, mh);
  if (!raster || raster.channels !== 1) return null;
  if (mw === width && mh === height) return raster.data;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mh - 1, Math.floor((y * mh) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mw - 1, Math.floor((x * mw) / width));
      out[y * width + x] = raster.data[sy * mw + sx];
    }
  }
  return out;
}

async function pngOf(
  stream: PDFRawStream,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  const raster = rasterOf(stream, width, height);
  if (!raster) return null;
  const alpha = alphaOf(stream.dict, width, height);
  if (!alpha) {
    return encodePng(width, height, raster.channels, raster.data);
  }
  const pixels = width * height;
  const rgba = new Uint8Array(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    if (raster.channels === 1) {
      rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = raster.data[p];
    } else {
      rgba[p * 4] = raster.data[p * 3];
      rgba[p * 4 + 1] = raster.data[p * 3 + 1];
      rgba[p * 4 + 2] = raster.data[p * 3 + 2];
    }
    rgba[p * 4 + 3] = alpha[p];
  }
  return encodePng(width, height, 4, rgba);
}

type Found = { stream: PDFRawStream; key: string; pages: number[] };

function collect(
  resources: PDFDict | undefined,
  page: number,
  found: Map<string, Found>,
  seenForms: Set<string>,
) {
  const xobjects = resources?.lookupMaybe(N("XObject"), PDFDict);
  if (!xobjects) return;
  for (const [, value] of xobjects.entries()) {
    const target = xobjects.context.lookup(value);
    if (!isRawStream(target)) continue;
    const subtype = target.dict.lookup(N("Subtype"));
    const key = value instanceof PDFRef ? String(value.objectNumber) : "";
    if (subtype === N("Image")) {
      const id = key || `inline-${found.size}`;
      const existing = found.get(id);
      if (existing) {
        if (!existing.pages.includes(page)) existing.pages.push(page);
      } else {
        found.set(id, { stream: target, key: id, pages: [page] });
      }
    } else if (subtype === N("Form")) {
      const formKey = `${key}@${page}`;
      if (seenForms.has(formKey)) continue;
      seenForms.add(formKey);
      collect(
        target.dict.lookupMaybe(N("Resources"), PDFDict),
        page,
        found,
        seenForms,
      );
    }
  }
}

/** Fails with a plain sentence when the PDF is locked or damaged. */
export async function scanPdfImages(bytes: Uint8Array): Promise<ImageScan> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/encrypt|password/i.test(message)) {
      throw new Error("This PDF is locked. Unlock it first, then extract.");
    }
    throw new Error("This file could not be read as a PDF.");
  }
  const found = new Map<string, Found>();
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    collect(page.node.Resources(), index + 1, found, new Set());
  });

  const images: ExtractedImage[] = [];
  const skipped: SkippedImage[] = [];
  for (const { stream, key, pages: usedOn } of found.values()) {
    const width = numberOf(stream.dict.lookup(N("Width")), 0);
    const height = numberOf(stream.dict.lookup(N("Height")), 0);
    if (width <= 0 || height <= 0) continue;
    const filters = filtersOf(stream.dict).map((f) => f.asString());
    const last = filters[filters.length - 1];
    const base = { id: key, page: usedOn[0], pages: usedOn, width, height };
    try {
      if (last === "/DCTDecode" || last === "/DCT") {
        images.push({
          ...base,
          format: "jpg",
          bytes: bytesBeforeCodec(stream, filters.length - 1),
        });
        continue;
      }
      if (last === "/JPXDecode") {
        images.push({
          ...base,
          format: "jp2",
          bytes: bytesBeforeCodec(stream, filters.length - 1),
        });
        continue;
      }
      const png = await pngOf(stream, width, height);
      if (png) images.push({ ...base, format: "png", bytes: png });
      else skipped.push({ page: usedOn[0], width, height });
    } catch {
      skipped.push({ page: usedOn[0], width, height });
    }
  }
  images.sort((a, b) => a.page - b.page || Number(a.id) - Number(b.id));
  return { images, skipped };
}

export const IMAGE_MIME: Record<ImageFormat, string> = {
  jpg: "image/jpeg",
  jp2: "image/jp2",
  png: "image/png",
};

/** Smaller edge in pixels; images under the threshold are decoration. */
export function filterBySize<T extends { width: number; height: number }>(
  images: T[],
  minEdge: number,
): T[] {
  return minEdge <= 0
    ? images
    : images.filter((image) => Math.min(image.width, image.height) >= minEdge);
}
