import { expect, test } from "bun:test";
import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { processSignPdf } from "./extra-processors";
import { scanImagePlacements } from "./pdf-placements";
import { removeBackground } from "./signature-ink";
import { initialOptions, optionsReady, type SignPlacement } from "./tool-options";

// 1x1 transparent-ish red PNG
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function pdf(pages: number, rotate = 0) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([400, 600]);
    if (rotate) p.setRotation(degrees(rotate));
  }
  const bytes = await doc.save();
  return new File([bytes], "in.pdf", { type: "application/pdf" });
}

function place(pageIndex: number, extra: Partial<SignPlacement> = {}): SignPlacement {
  return { id: crypto.randomUUID(), pageIndex, x: 0.1, y: 0.7, w: 0.3, h: 0.1, dataUrl: PNG, ...extra };
}

async function run(file: File, placements: SignPlacement[]) {
  const [res] = await processSignPdf(
    [{ id: "1", name: file.name, size: file.size, file }],
    () => {},
    { kind: "sign", placements },
  );
  return PDFDocument.load(await res.blob.arrayBuffer());
}

test("sign options need at least one usable placement", () => {
  const empty = initialOptions("sign");
  expect(empty.kind).toBe("sign");
  expect(optionsReady(empty, "")).toBe(false);
  expect(optionsReady({ kind: "sign", placements: [place(0)] }, "")).toBe(true);
  expect(optionsReady({ kind: "sign", placements: [place(0, { w: 0.001 })] }, "")).toBe(false);
});

test("signatures land on several pages, each where it was put", async () => {
  const out = await run(await pdf(3), [place(0), place(2, { x: 0.5 }), place(2, { y: 0.1 })]);
  const draws = scanImagePlacements(out);
  expect(draws.size).toBe(1); // one PNG embedded once, reused
  const w = [...draws.values()][0].widthPt;
  expect(w).toBeCloseTo(120, 0);
  // page 2 (index 1) was not signed
  const ops = out.getPage(1).node.Resources()?.toString() ?? "";
  expect(ops.includes("XObject")).toBe(false);
});

test("placements on a turned page are turned with it", async () => {
  const out = await run(await pdf(1, 90), [place(0)]);
  const doc = await getDocument({ data: new Uint8Array(await out.save()) }).promise;
  const ops = await (await doc.getPage(1)).getOperatorList();
  expect(ops.fnArray.length).toBeGreaterThan(0);
  const draws = scanImagePlacements(out);
  // Seen width 0.3 of the 600pt view side.
  expect([...draws.values()][0].widthPt).toBeCloseTo(0.3 * 600, 0);
});

test("a date stamp is real text", async () => {
  const out = await run(await pdf(1), [
    { id: "d", pageIndex: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.04, text: "2026-10-17", color: "#1d4ed8" },
  ]);
  const doc = await getDocument({ data: new Uint8Array(await out.save()) }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  expect(content.items.map((i) => ("str" in i ? i.str : "")).join("")).toContain("2026-10-17");
});

test("photo of a signature: paper turns transparent, ink takes the chosen colour", () => {
  const px = new Uint8ClampedArray([
    250, 250, 250, 255, // paper
    20, 20, 30, 255, // ink
    130, 130, 130, 255, // soft edge
  ]);
  removeBackground(px, { threshold: 190, color: "#d61f3a" });
  expect(px[3]).toBe(0);
  expect(px[7]).toBe(255);
  expect([px[4], px[5], px[6]]).toEqual([0xd6, 0x1f, 0x3a]);
  expect(px[11]).toBeGreaterThan(0);
  expect(px[11]).toBeLessThan(255);
});
