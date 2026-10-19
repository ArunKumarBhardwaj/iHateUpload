import { expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { processEditPdf } from "./extra-processors";
import { newTextMark } from "./tool-options";

async function fileOf(draw: (doc: PDFDocument) => Promise<void> | void) {
  const doc = await PDFDocument.create();
  await draw(doc);
  const bytes = await doc.save();
  return new File([bytes], "in.pdf", { type: "application/pdf" });
}

const textPdfFile = () =>
  fileOf(async (doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 500]);
    page.drawText("Invoice total 100", { x: 40, y: 400, size: 20, font });
    page.drawText("Keep this line", { x: 40, y: 300, size: 20, font });
  });

const blankFile = () =>
  fileOf((doc) => {
    doc.addPage([400, 500]);
  });

async function pageText(blob: Blob) {
  const doc = await getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  const items = content.items.flatMap((i) => ("str" in i ? [i] : []));
  await doc.loadingTask.destroy();
  return items;
}

async function edit(file: File, marks: ReturnType<typeof newTextMark>[]) {
  const [res] = await processEditPdf(
    [{ id: "1", name: file.name, size: file.size, file }],
    () => {},
    { kind: "edit", marks },
  );
  return res.blob;
}

test("replacing a line removes the old letters from the file, not just hides them", async () => {
  const file = await textPdfFile();
  // The 20pt line's baseline at 400 of 500 sits 0.2 from the top.
  const mark = newTextMark(0, 0.09, 0.17, { w: 0.5, h: 0.05, text: "Invoice total 250", cover: true });
  const text = (await pageText(await edit(file, [mark]))).map((i) => i.str).join(" ");
  expect(text).toContain("Invoice total 250");
  expect(text).not.toContain("100");
  expect(text).toContain("Keep this line");
});

test("font family, bold, italic and alignment reach the file", async () => {
  const file = await blankFile();
  const mark = {
    ...newTextMark(0, 0.1, 0.1, { w: 0.6, h: 0.05, text: "Centered" }),
    family: "times" as const,
    bold: true,
    italic: true,
    align: "center" as const,
  };
  const blob = await edit(file, [mark]);
  const out = await PDFDocument.load(await blob.arrayBuffer());
  const objects = out.context.enumerateIndirectObjects().map(([, o]) => String(o));
  expect(objects.join(" ")).toContain("Times-BoldItalic");
  const [item] = await pageText(blob);
  // The box starts at x=40 and is 240 wide; centred text starts well right of it.
  expect(item.transform[4]).toBeGreaterThan(90);
});
