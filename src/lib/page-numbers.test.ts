import { expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { FileItem } from "./job";
import { processAnnotatePdf } from "./extra-processors";
import { initialOptions, optionsReady } from "./tool-options";

async function pdfItem(pages: number): Promise<FileItem> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([400, 500]);
  const file = new File([await doc.save()], "doc.pdf", {
    type: "application/pdf",
  });
  return { id: "a", name: "doc.pdf", size: file.size, file };
}

async function stamps(blob: Blob) {
  const pdf = await getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
  }).promise;
  const out: { text: string; height: number }[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const items = content.items as { str: string; height: number }[];
    out.push({
      text: items.map((i) => i.str).join("").trim(),
      height: Math.round(items[0]?.height ?? 0),
    });
  }
  return out;
}

async function number(pages: number, patch: Record<string, unknown>) {
  const [result] = await processAnnotatePdf(
    [await pdfItem(pages)],
    () => {},
    { ...initialOptions("page-numbers"), ...patch } as never,
  );
  return stamps(result.blob);
}

test("page numbers default to 1 / N at 11pt", async () => {
  const out = await number(3, {});
  expect(out.map((s) => s.text)).toEqual(["1 / 3", "2 / 3", "3 / 3"]);
  expect(out[0].height).toBe(11);
});

test("page numbers support each format", async () => {
  expect((await number(2, { numberFormat: "n" })).map((s) => s.text)).toEqual(["1", "2"]);
  expect((await number(2, { numberFormat: "page" })).map((s) => s.text)).toEqual(["Page 1", "Page 2"]);
  expect((await number(2, { numberFormat: "page-of" })).map((s) => s.text)).toEqual(["Page 1 of 2", "Page 2 of 2"]);
  expect((await number(4, { numberFormat: "roman" })).map((s) => s.text)).toEqual(["i", "ii", "iii", "iv"]);
});

test("start at shifts the count and the total", async () => {
  const out = await number(2, { startAt: 5 });
  expect(out.map((s) => s.text)).toEqual(["5 / 6", "6 / 6"]);
});

test("skip first page leaves it bare", async () => {
  const out = await number(3, { skipFirst: true, numberFormat: "n" });
  expect(out.map((s) => s.text)).toEqual(["", "2", "3"]);
});

test("font size changes the stamp", async () => {
  expect((await number(1, { numberSize: "small" }))[0].height).toBe(9);
  expect((await number(1, { numberSize: "large" }))[0].height).toBe(14);
  expect(optionsReady({ ...initialOptions("page-numbers") }, "")).toBe(true);
});
