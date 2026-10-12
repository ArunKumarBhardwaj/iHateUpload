import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  StandardFonts,
} from "@cantoo/pdf-lib";

import { createWasmCodec } from "./compress-codec";
import { COMPRESS_PLANS } from "./compress-plans";
import {
  compressPdfBytes,
  deflate,
  compressPdfToTarget,
  looksPhotographic,
  psnr,
  targetSize,
  type Pixels,
} from "./compress-engine";
import { scanImagePlacements } from "./pdf-placements";

const codec = createWasmCodec(async (file) =>
  WebAssembly.compile(readFileSync(`public/codecs/${file}`)),
);

/** Smooth gradients plus seeded noise: compresses like a real photo. */
function photo(width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed >> 16) & 31;
      const o = (y * width + x) * 4;
      data[o] = (x * 255) / width + n;
      data[o + 1] = (y * 255) / height + n;
      data[o + 2] = ((x + y) * 128) / (width + height) + n;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

function images(doc: PDFDocument) {
  const found: { ref: string; dict: PDFRawStream["dict"]; size: number }[] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    found.push({ ref: ref.toString(), dict: object.dict, size: object.contents.length });
  }
  return found;
}

const num = (dict: PDFRawStream["dict"], key: string) =>
  Number(dict.get(PDFName.of(key))?.toString());

async function photoPdf() {
  const doc = await PDFDocument.create();
  const jpeg = await codec.encodeJpeg(photo(3000, 2000), 95, false);
  const image = await doc.embedJpg(jpeg);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawImage(image, { x: 36, y: 400, width: 300, height: 200 });
  page.drawText("Invoice 2041, keep me selectable", { x: 36, y: 360, size: 12, font });
  return doc.save();
}

test("placements follow cm through q/Q and form matrices", async () => {
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(await codec.encodeJpeg(photo(64, 32), 80, false));
  const page = doc.addPage([600, 800]);
  page.drawImage(image, { x: 10, y: 10, width: 120, height: 60 });
  page.drawImage(image, { x: 200, y: 200, width: 240, height: 30 });

  const form = doc.context.stream("q 2 0 0 2 0 0 cm /Im0 Do Q", {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, 1, 1],
    Matrix: [50, 0, 0, 25, 0, 0],
    Resources: { XObject: { Im0: image.ref } },
  });
  const formRef = doc.context.register(form);
  const other = doc.addPage([600, 800]);
  const formName = other.node.newXObject("Fm0", formRef);
  const content = doc.context.stream(`q 3 0 0 3 0 0 cm ${formName} Do Q`);
  other.node.addContentStream(doc.context.register(content));

  const placements = scanImagePlacements(await PDFDocument.load(await doc.save()));
  const placed = [...placements.values()];
  expect(placed).toHaveLength(1);
  // Widest draw is the form: 2 × 50 × 3 = 300pt wide, 2 × 25 × 3 = 150pt tall.
  expect(placed[0].widthPt).toBeCloseTo(300);
  expect(placed[0].heightPt).toBeCloseTo(150);
});

test("targetSize keeps images already near the needed resolution", () => {
  const placement = { widthPt: 72, heightPt: 72 };
  expect(targetSize(200, 200, placement, 200)).toEqual({ width: 200, height: 200 });
  expect(targetSize(1000, 1000, placement, 150)).toEqual({ width: 150, height: 150 });
});

test("light shrinks a photo PDF and keeps its text and font", async () => {
  const input = await photoPdf();
  const { bytes, stats } = await compressPdfBytes(input, COMPRESS_PLANS.light, codec);

  expect(bytes.length).toBeLessThan(input.length * 0.4);
  expect(stats.resampled).toBe(1);

  const out = await PDFDocument.load(bytes);
  const [image] = images(out);
  // 300pt at 220 dpi is about 917 px wide.
  expect(num(image.dict, "Width")).toBeGreaterThan(880);
  expect(num(image.dict, "Width")).toBeLessThan(960);
  expect(image.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("DCTDecode"));
  const decoded = await codec.decodeJpeg(
    (out.context.lookup(PDFRef.of(Number(image.ref.split(" ")[0]))) as PDFRawStream).contents,
  );
  expect(decoded?.width).toBe(num(image.dict, "Width"));
  const fonts = [...out.context.enumerateIndirectObjects()].filter(
    ([, o]) => "get" in o && (o as PDFRawStream["dict"]).get?.(PDFName.of("Type")) === PDFName.of("Font"),
  );
  expect(fonts.length).toBeGreaterThan(0);
});

test("each level is smaller than the last", async () => {
  const input = await photoPdf();
  const sizes: number[] = [];
  for (const level of ["light", "medium", "heavy"] as const) {
    sizes.push((await compressPdfBytes(input, COMPRESS_PLANS[level], codec)).bytes.length);
  }
  expect(sizes[1]).toBeLessThan(sizes[0]);
  expect(sizes[2]).toBeLessThan(sizes[1]);
});

test("flat graphics stay lossless when resampled", async () => {
  const doc = await PDFDocument.create();
  const width = 2400;
  const height = 1200;
  const raw = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const band = Math.floor((i % width) / 300) % 3;
    raw[i * 3 + band] = 220;
  }
  const flat = doc.context.flateStream(raw, {
    Type: "XObject",
    Subtype: "Image",
    Width: width,
    Height: height,
    ColorSpace: "DeviceRGB",
    BitsPerComponent: 8,
  });
  const ref = doc.context.register(flat);
  const page = doc.addPage([600, 800]);
  const imageName = page.node.newXObject("Im0", ref);
  page.node.addContentStream(
    doc.context.register(
      doc.context.stream(`q 240 0 0 120 10 10 cm ${imageName} Do Q`),
    ),
  );

  const input = await doc.save();
  const { bytes } = await compressPdfBytes(input, COMPRESS_PLANS.medium, codec);
  const [image] = images(await PDFDocument.load(bytes));
  expect(image.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("FlateDecode"));
  expect(num(image.dict, "Width")).toBe(500);
});

test("images with a Decode array are left alone", async () => {
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(await codec.encodeJpeg(photo(2000, 1000), 95, false));
  doc.addPage([600, 800]).drawImage(image, { x: 0, y: 0, width: 100, height: 50 });
  const saved = await PDFDocument.load(await doc.save());
  const stream = saved.context.lookup(image.ref) as PDFRawStream;
  stream.dict.set(PDFName.of("Decode"), saved.context.obj([1, 0, 1, 0, 1, 0]));
  const input = await saved.save();
  const { bytes } = await compressPdfBytes(input, COMPRESS_PLANS.heavy, codec);
  const [out] = images(await PDFDocument.load(bytes));
  expect(num(out.dict, "Width")).toBe(2000);
});

test("target size walks down until the PDF fits", async () => {
  const input = await photoPdf();
  const target = 60 * 1024;
  const { bytes, fit } = await compressPdfToTarget(input, target, codec);
  expect(fit).toBe(true);
  expect(bytes.length).toBeLessThanOrEqual(target);
});

test("photo detection separates photos from flat art", () => {
  expect(looksPhotographic(photo(200, 200))).toBe(true);
  const flat = new Uint8ClampedArray(200 * 200 * 4).fill(255);
  expect(looksPhotographic({ data: flat, width: 200, height: 200 })).toBe(false);
});

test("smooth images drop below the starting quality, detailed ones hold", async () => {
  const smooth = photo(900, 600);
  for (let i = 0; i < smooth.data.length; i += 4) {
    const p = i / 4;
    smooth.data[i] = smooth.data[i + 1] = smooth.data[i + 2] = (p % 900) / 4;
  }
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(await codec.encodeJpeg(smooth, 98, false));
  doc.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 300, height: 200 });
  const input = await doc.save();

  const fixed = (await codec.encodeJpeg(smooth, COMPRESS_PLANS.medium.quality, false)).length;
  const { bytes } = await compressPdfBytes(input, COMPRESS_PLANS.medium, codec);
  const [out] = images(await PDFDocument.load(bytes));
  expect(out.size).toBeLessThan(fixed);
});

test("psnr is infinite for identical pixels and finite after JPEG", async () => {
  const source = photo(300, 200);
  expect(psnr(source, source)).toBe(Infinity);
  const back = await codec.decodeJpeg(await codec.encodeJpeg(source, 60, false));
  const score = psnr(source, back!);
  expect(score).toBeGreaterThan(20);
  expect(score).toBeLessThan(60);
});

test("transparent PNGs shrink with their soft mask in step", async () => {
  const { width, height } = { width: 1600, height: 1200 };
  const rgba = photo(width, height);
  for (let i = 3; i < rgba.data.length; i += 4) rgba.data[i] = (i / 4) % width < 800 ? 255 : 90;
  const png = await pngBytes(rgba);
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  doc.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 200, height: 150 });
  const input = await doc.save();

  const { bytes } = await compressPdfBytes(input, COMPRESS_PLANS.medium, codec);
  expect(bytes.length).toBeLessThan(input.length);
  const out = await PDFDocument.load(bytes);
  const all = images(out);
  const parent = all.find((i) => i.dict.has(PDFName.of("SMask")))!;
  const mask = all.find((i) => i !== parent)!;
  expect(num(parent.dict, "Width")).toBeLessThan(width);
  expect(num(mask.dict, "Width")).toBe(num(parent.dict, "Width"));
  expect(num(mask.dict, "Height")).toBe(num(parent.dict, "Height"));
});

/** Minimal RGBA PNG writer for fixtures: one IDAT, filter 0 on every row. */
async function pngBytes(pixels: Pixels): Promise<Uint8Array> {
  const rows = new Uint8Array((pixels.width * 4 + 1) * pixels.height);
  for (let y = 0; y < pixels.height; y++) {
    rows.set(
      pixels.data.subarray(y * pixels.width * 4, (y + 1) * pixels.width * 4),
      y * (pixels.width * 4 + 1) + 1,
    );
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    let crc = 0xffffffff;
    for (const b of out.subarray(4, 8 + data.length)) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, pixels.width);
  hv.setUint32(4, pixels.height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", await deflate(rows)),
    chunk("IEND", new Uint8Array()),
  ];
  return new Uint8Array(await new Blob(parts.map((p) => p.slice().buffer as ArrayBuffer)).arrayBuffer());
}
