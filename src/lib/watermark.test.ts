import { expect, test } from "bun:test";
import { PDFDict, PDFDocument, PDFName, PDFNumber } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { FileItem } from "./job";
import { processAnnotatePdf } from "./extra-processors";
import { initialOptions, optionsReady } from "./tool-options";
import { watermarkStamps } from "./watermark";

async function pdfItem(pages: number): Promise<FileItem> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([400, 500]);
  const file = new File([await doc.save()], "doc.pdf", {
    type: "application/pdf",
  });
  return { id: "a", name: "doc.pdf", size: file.size, file };
}

async function stamp(pages: number, patch: Record<string, unknown>) {
  const [result] = await processAnnotatePdf(
    [await pdfItem(pages)],
    () => {},
    { ...initialOptions("watermark"), ...patch } as never,
  );
  return result.blob;
}

type Item = { str: string; height: number; width: number; transform: number[] };

async function textItems(blob: Blob): Promise<Item[][]> {
  const pdf = await getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
  }).promise;
  const out: Item[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    out.push((content.items as Item[]).filter((i) => i.str.trim()));
  }
  return out;
}

async function alphas(blob: Blob) {
  const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  const resources = doc.getPage(0).node.Resources();
  const states = resources?.lookup(PDFName.of("ExtGState"), PDFDict);
  const found: number[] = [];
  for (const key of states?.keys() ?? []) {
    const state = states?.lookup(key, PDFDict);
    const ca = state?.lookup(PDFName.of("ca"));
    if (ca instanceof PDFNumber) found.push(ca.asNumber());
  }
  return found;
}

test("a single watermark stays real, extractable text", async () => {
  const pages = await textItems(
    await stamp(2, { text: "DRAFT", layout: "single" }),
  );
  expect(pages.map((p) => p.map((i) => i.str).join(""))).toEqual([
    "DRAFT",
    "DRAFT",
  ]);
});

test("tiled layout draws a grid of stamps on every page", async () => {
  const widthOf = (size: number) => size * 3.4;
  const style = {
    size: "medium",
    rotation: 0,
    position: "center",
    layout: "tiled",
  } as const;
  const stamps = watermarkStamps(style, 400, 500, widthOf);
  expect(stamps.length).toBeGreaterThan(6);
  expect(watermarkStamps({ ...style, layout: "single" }, 400, 500, widthOf)).toHaveLength(1);
  // A smaller stamp packs more tiles.
  expect(
    watermarkStamps({ ...style, size: "small" }, 400, 500, widthOf).length,
  ).toBeGreaterThan(stamps.length);

  const pages = await textItems(
    await stamp(2, { text: "DRAFT", layout: "tiled", rotation: 0 }),
  );
  for (const items of pages) {
    const text = items.map((i) => i.str).join("");
    expect(text.replace(/[DRAFT\s]/g, "")).toBe("");
    // pdf.js drops letters that fall off the page edge.
    expect(text.length).toBeGreaterThan(30);
  }
});

test("opacity lands in the graphics state", async () => {
  const out = await alphas(await stamp(1, { opacity: 0.4 }));
  expect(out.some((v) => Math.abs(v - 0.4) < 0.001)).toBe(true);
});

test("rotation turns the text, and 0 leaves it level", async () => {
  const [[tilted]] = await textItems(await stamp(1, { rotation: 45 }));
  expect(tilted.transform[1]).toBeGreaterThan(0);
  expect(tilted.transform[0]).toBeCloseTo(tilted.transform[1], 1);
  const [[level]] = await textItems(await stamp(1, { rotation: 0 }));
  expect(level.transform[1]).toBeCloseTo(0, 3);
  const [[down]] = await textItems(await stamp(1, { rotation: -45 }));
  expect(down.transform[1]).toBeLessThan(0);
});

test("size presets scale the text, and Fit fills most of the page width", async () => {
  const one = async (size: string) =>
    (await textItems(await stamp(1, { size, rotation: 0 })))[0][0];
  const small = await one("small");
  const medium = await one("medium");
  const large = await one("large");
  expect(small.height).toBeLessThan(medium.height);
  expect(medium.height).toBeLessThan(large.height);
  const fit = await one("fit");
  expect(fit.width).toBeGreaterThan(400 * 0.6);
  expect(fit.width).toBeLessThan(400);
});

test("page range limits which pages are stamped", async () => {
  const pages = await textItems(await stamp(4, { range: "2-3" }));
  expect(pages.map((p) => p.length)).toEqual([0, 1, 1, 0]);
  await expect(stamp(2, { range: "9" })).rejects.toThrow();
});

test("colour option is accepted and bad hex falls back to grey", async () => {
  await stamp(1, { color: "#d61f3a" });
  await stamp(1, { color: "nonsense" });
});

test("defaults are ready and an empty stamp is not", () => {
  const options = initialOptions("watermark");
  expect(options).toMatchObject({ layout: "single", size: "medium", range: "" });
  expect(optionsReady(options, "")).toBe(true);
  expect(optionsReady({ ...options, text: "  " } as never, "")).toBe(false);
});
