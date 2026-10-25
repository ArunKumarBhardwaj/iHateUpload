import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import encode, { init as initEncode } from "@jsquash/jpeg/encode";
import decode, { init as initDecode } from "@jsquash/jpeg/decode";

import { checkOutput } from "./check";
import { byteBand, coverCrop, inkBounds, searchQuality } from "./fit";
import { padJpeg, readJpegInfo, setJpegDpi } from "./jpeg";
import type { SlotSpec } from "./types";

const CODEC = join(import.meta.dir, "../../../node_modules/@jsquash/jpeg/codec");

beforeAll(async () => {
  await initEncode(new WebAssembly.Module(readFileSync(join(CODEC, "enc/mozjpeg_enc.wasm"))));
  await initDecode(new WebAssembly.Module(readFileSync(join(CODEC, "dec/mozjpeg_dec.wasm"))));
});

/** A synthetic gradient photo, so the encoder has real detail to spend bytes on. */
async function jpeg(width: number, height: number, quality = 80): Promise<Uint8Array> {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 7) % 256;
      data[i + 1] = (y * 5) % 256;
      data[i + 2] = ((x ^ y) * 3) % 256;
      data[i + 3] = 255;
    }
  }
  const buf = await encode({ data, width, height, colorSpace: "srgb" } as ImageData, { quality });
  return new Uint8Array(buf);
}

const PHOTO: SlotSpec = {
  kind: "photo",
  label: "Photograph",
  width: 200,
  height: 230,
  minKb: 20,
  maxKb: 50,
  pixels: { minWidth: 200, maxWidth: 200, minHeight: 230, maxHeight: 230 },
};

test("readJpegInfo reads the real pixel size from the frame header", async () => {
  const info = readJpegInfo(await jpeg(200, 230));
  expect(info).toMatchObject({ width: 200, height: 230 });
});

test("readJpegInfo rejects bytes that are not a JPEG", () => {
  expect(readJpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBeNull();
});

test("setJpegDpi stamps the density and the file still decodes", async () => {
  const out = setJpegDpi(await jpeg(120, 60), 200);
  expect(readJpegInfo(out)).toMatchObject({ width: 120, height: 60, dpi: 200 });
  const back = await decode(out.buffer as ArrayBuffer);
  expect([back.width, back.height]).toEqual([120, 60]);
});

test("padJpeg grows a small file to the floor and keeps the image", async () => {
  const small = await jpeg(140, 60, 40);
  const floor = small.length + 9000;
  const out = padJpeg(small, floor);
  expect(out.length).toBeGreaterThanOrEqual(floor);
  expect(out.length).toBeLessThan(floor + 70_000);
  expect(readJpegInfo(out)).toMatchObject({ width: 140, height: 60 });
  const back = await decode(out.buffer as ArrayBuffer);
  expect([back.width, back.height]).toEqual([140, 60]);
});

test("padJpeg can add more than one segment's worth", async () => {
  const small = await jpeg(64, 64, 30);
  const out = padJpeg(small, small.length + 150_000);
  expect(out.length).toBeGreaterThanOrEqual(small.length + 150_000);
  expect((await decode(out.buffer as ArrayBuffer)).width).toBe(64);
});

test("padJpeg leaves a file that already meets the floor alone", async () => {
  const file = await jpeg(64, 64);
  expect(padJpeg(file, 10)).toBe(file);
});

test("byteBand is safe whether the portal counts 1 KB as 1000 or 1024 bytes", () => {
  expect(byteBand({ minKb: 20, maxKb: 50 })).toEqual({ min: 20 * 1024, max: 50 * 1000 });
});

test("searchQuality picks the best quality that fits the band", async () => {
  // Size grows with quality: 10 KB at q=0 up to 110 KB at q=1.
  const sizes: number[] = [];
  const result = await searchQuality(async (q) => {
    const size = Math.round(10_000 + q * 100_000);
    sizes.push(size);
    return size;
  }, { min: 20_480, max: 50_000 });
  expect(result.status).toBe("ok");
  expect(result.size).toBeLessThanOrEqual(50_000);
  expect(result.size).toBeGreaterThan(48_000);
  expect(sizes.length).toBeLessThanOrEqual(12);
});

test("searchQuality says when even the top quality is under the floor", async () => {
  const result = await searchQuality(async () => 3_000, { min: 10_240, max: 20_000 });
  expect(result.status).toBe("under-min");
  expect(result.quality).toBeGreaterThan(0.9);
});

test("searchQuality says when even the lowest quality is over the cap", async () => {
  const result = await searchQuality(async () => 90_000, { min: 10_240, max: 20_000 });
  expect(result.status).toBe("over-max");
});

test("coverCrop matches the output shape and stays inside the source", () => {
  const rect = coverCrop(4000, 3000, 200, 230, { zoom: 1, x: 0.5, y: 0.5 });
  expect(rect.height).toBe(3000);
  expect(rect.width / rect.height).toBeCloseTo(200 / 230, 2);
  expect(rect.x).toBeCloseTo((4000 - rect.width) / 2, 0);
  expect(rect.y).toBe(0);
});

test("coverCrop zooms in and clamps panning at the edges", () => {
  const rect = coverCrop(4000, 3000, 200, 230, { zoom: 2, x: 1, y: 0 });
  expect(rect.height).toBeCloseTo(1500, 0);
  expect(rect.x + rect.width).toBeCloseTo(4000, 0);
  expect(rect.y).toBe(0);
});

test("inkBounds finds the signature on a page photo, with a margin", () => {
  const w = 400;
  const h = 300;
  const lum = new Uint8Array(w * h).fill(235);
  for (let y = 120; y < 160; y++) for (let x = 100; x < 300; x++) lum[y * w + x] = 40;
  const box = inkBounds(lum, w, h);
  expect(box).not.toBeNull();
  expect(box!.x).toBeLessThan(100);
  expect(box!.x).toBeGreaterThan(80);
  expect(box!.x + box!.width).toBeGreaterThan(300);
  expect(box!.y + box!.height).toBeGreaterThan(160);
});

test("inkBounds ignores specks and returns null on a blank page", () => {
  const w = 200;
  const h = 100;
  const lum = new Uint8Array(w * h).fill(240);
  lum[50 * w + 50] = 0;
  expect(inkBounds(lum, w, h)).toBeNull();
});

test("checkOutput passes a file that meets every rule", async () => {
  const bytes = padJpeg(await jpeg(200, 230, 60), 25 * 1024);
  const checks = checkOutput(bytes, PHOTO);
  expect(checks.every((c) => c.ok)).toBe(true);
  expect(checks.map((c) => c.id)).toEqual(["format", "size", "pixels"]);
});

test("checkOutput flags a file over the cap and a wrong pixel size", async () => {
  const bytes = padJpeg(await jpeg(210, 230, 60), 60 * 1024);
  const checks = checkOutput(bytes, PHOTO);
  expect(checks.find((c) => c.id === "size")?.ok).toBe(false);
  expect(checks.find((c) => c.id === "pixels")?.ok).toBe(false);
});

test("checkOutput flags a file that is not a JPEG", () => {
  const checks = checkOutput(new Uint8Array(30_000), PHOTO);
  expect(checks.find((c) => c.id === "format")?.ok).toBe(false);
});

test("every preset is internally consistent and cites an official source", async () => {
  const { EXAMS } = await import("./specs");
  const official = /(^|\.)(gov\.in|nic\.in|ac\.in|ibps\.in|sbi\.co\.in|sbi\.bank\.in|proteantech\.in|utiitsl\.com)$/;
  const slugs = new Set<string>();
  expect(EXAMS.length).toBeGreaterThanOrEqual(8);
  for (const exam of EXAMS) {
    expect(slugs.has(exam.slug)).toBe(false);
    slugs.add(exam.slug);
    expect(exam.slug).toMatch(/^[a-z0-9-]+$/);
    expect(exam.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const host = new URL(exam.source.url).hostname;
    expect(official.test(host) ? exam.slug : `${exam.slug} cites ${host}`).toBe(exam.slug);
    expect(exam.slots.length).toBeGreaterThan(0);
    for (const slot of exam.slots) {
      const where = `${exam.slug}/${slot.kind}`;
      const band = byteBand(slot);
      expect(band.min < band.max ? where : `${where} has an empty KB band`).toBe(where);
      if (slot.pixels) {
        const p = slot.pixels;
        const inside =
          slot.width >= p.minWidth && slot.width <= (p.maxWidth ?? Infinity) &&
          slot.height >= p.minHeight && slot.height <= (p.maxHeight ?? Infinity);
        expect(inside ? where : `${where} output size is outside its pixel rule`).toBe(where);
      }
    }
  }
});

function page(w: number, h: number, paper = 225): Uint8Array {
  return new Uint8Array(w * h).fill(paper);
}
function paint(lum: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number, v: number) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) lum[y * w + x] = v;
}

test("inkBounds ignores a dark desk strip along the edge of the photo", () => {
  const w = 400;
  const h = 300;
  const lum = page(w, h);
  paint(lum, w, 0, 0, 48, h, 70); // desk on the left 12%
  paint(lum, w, 150, 130, 300, 170, 40); // the signature
  const box = inkBounds(lum, w, h)!;
  expect(box.x).toBeGreaterThan(100);
  expect(box.width).toBeLessThan(200);
  expect(box.height).toBeLessThan(80);
});

test("inkBounds finds the signature when most of the photo is desk", () => {
  const w = 400;
  const h = 300;
  const lum = page(w, h);
  paint(lum, w, 0, 0, 240, h, 70); // desk covers 60%
  paint(lum, w, 280, 130, 380, 160, 40);
  const box = inkBounds(lum, w, h)!;
  expect(box.x).toBeGreaterThan(250);
  expect(box.width).toBeLessThan(140);
  expect(box.height).toBeLessThan(70);
});

test("inkBounds ignores a shadow along the bottom edge", () => {
  const w = 400;
  const h = 300;
  const lum = page(w, h);
  for (let y = 240; y < h; y++) paint(lum, w, 0, y, w, y + 1, 225 - (y - 240) * 3);
  paint(lum, w, 120, 100, 280, 140, 40);
  const box = inkBounds(lum, w, h)!;
  expect(box.y + box.height).toBeLessThan(200);
});

test("inkBounds returns null when there is desk but no ink", () => {
  const w = 400;
  const h = 300;
  const lum = page(w, h);
  paint(lum, w, 0, 0, 60, h, 70);
  expect(inkBounds(lum, w, h)).toBeNull();
});

test("checkOutput accepts anything above a minimum-only pixel and DPI rule", async () => {
  const slot: SlotSpec = {
    kind: "signature",
    label: "Signature",
    width: 276,
    height: 157,
    minKb: 30,
    maxKb: 49,
    dpi: 200,
    minDpi: 100,
    pixels: { minWidth: 140, minHeight: 60 },
  };
  const bytes = padJpeg(setJpegDpi(await jpeg(276, 157, 60), 200), 32 * 1024);
  const checks = checkOutput(bytes, slot);
  expect(checks.every((c) => c.ok)).toBe(true);
  expect(checks.find((c) => c.id === "pixels")?.wanted).toBe("140+ × 60+");
  expect(checks.find((c) => c.id === "dpi")?.wanted).toBe("100+ DPI");
  const small = checkOutput(padJpeg(setJpegDpi(await jpeg(120, 50, 60), 72), 32 * 1024), slot);
  expect(small.find((c) => c.id === "pixels")?.ok).toBe(false);
  expect(small.find((c) => c.id === "dpi")?.ok).toBe(false);
});

test("inkBounds keeps a signature whose tail runs off the bottom edge", () => {
  const w = 400;
  const h = 300;
  const lum = page(w, h);
  paint(lum, w, 100, 120, 300, 150, 40); // the name
  paint(lum, w, 280, 150, 290, h, 40); // tail down to the edge
  paint(lum, w, 140, 90, 148, 98, 40); // an i-dot
  const box = inkBounds(lum, w, h)!;
  expect(box.x).toBeLessThan(100);
  expect(box.x + box.width).toBeGreaterThan(290);
  expect(box.height).toBeGreaterThan(150);
});

test("inkBounds keeps ink that already fills a tightly cropped frame", () => {
  const w = 140;
  const h = 60;
  const lum = page(w, h);
  paint(lum, w, 0, 20, w, 30, 40); // a stroke from edge to edge
  paint(lum, w, 30, 0, 36, h, 40);
  paint(lum, w, 100, 0, 106, h, 40);
  const box = inkBounds(lum, w, h)!;
  expect(box.width).toBeGreaterThan(130);
  expect(box.height).toBeGreaterThan(55);
});

test("inkBounds keeps a second word that touches the right edge", () => {
  const w = 400;
  const h = 300;
  const lum = page(w, h);
  // Words are strokes, not solid blocks: vertical letters joined by a baseline.
  const word = (x0: number, x1: number) => {
    for (let x = x0; x < x1; x += 14) paint(lum, w, x, 125, x + 4, 160, 40);
    paint(lum, w, x0, 156, x1, 160, 40);
  };
  word(60, 180);
  word(240, w);
  const box = inkBounds(lum, w, h)!;
  expect(box.x).toBeLessThan(60);
  expect(box.x + box.width).toBe(w);
});

const SIGNATURE = (lum: Uint8Array, w: number) => paint(lum, w, 130, 160, 470, 200, 40);

// A shadow along part of one edge looks like bold ink touching that edge; the
// trim keeps both, and the studio's "Trim to the ink" switch is the way out.
test.todo("inkBounds ignores a shadow along part of one edge (indistinguishable from bold edge ink)");

test("inkBounds ignores an L-shaped corner shadow", () => {
  const w = 600;
  const h = 400;
  const lum = page(w, h);
  paint(lum, w, 0, 340, 240, h, 70);
  paint(lum, w, 0, 240, 60, h, 70);
  SIGNATURE(lum, w);
  const box = inkBounds(lum, w, h)!;
  expect(box.x).toBeGreaterThan(90);
  expect(box.y + box.height).toBeLessThan(260);
});

test("inkBounds ignores desk triangles in the corners of a tilted page", () => {
  const w = 600;
  const h = 400;
  const lum = page(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.min(x, w - 1 - x);
      const cy = Math.min(y, h - 1 - y);
      if (cx + cy < 90) lum[y * w + x] = 70;
    }
  }
  SIGNATURE(lum, w);
  const box = inkBounds(lum, w, h)!;
  expect(box.width).toBeLessThan(420);
  expect(box.height).toBeLessThan(120);
});

test("inkBounds keeps a bold marker signature touching one edge, off-centre", () => {
  const w = 400;
  const h = 160;
  const lum = page(w, h);
  for (let x = 230; x < w; x += 22) paint(lum, w, x, 40, x + 14, h, 30); // thick downstrokes to the bottom
  paint(lum, w, 230, 40, w, 56, 30);
  const box = inkBounds(lum, w, h)!;
  expect(box).not.toBeNull();
  expect(box.x).toBeLessThan(230);
  expect(box.x + box.width).toBe(w);
});

test("inkBounds keeps a solid thumb print touching the bottom edge", () => {
  const w = 400;
  const h = 300;
  const lum = page(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (((x - 280) / 60) ** 2 + ((y - 250) / 80) ** 2 < 1) lum[y * w + x] = 50;
    }
  }
  const box = inkBounds(lum, w, h)!;
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(110);
});

test("inkBounds keeps a word reaching the right edge whatever its stroke weight", () => {
  const w = 400;
  const h = 300;
  for (const gap of [14, 9, 7]) {
    const lum = page(w, h);
    for (let x = 240; x < w; x += gap) paint(lum, w, x, 125, x + 5, 160, 40);
    paint(lum, w, 240, 156, w, 160, 40);
    paint(lum, w, 60, 130, 64, 160, 40);
    paint(lum, w, 60, 156, 180, 160, 40);
    const box = inkBounds(lum, w, h)!;
    expect(box.x + box.width).toBe(w);
  }
});
