import { expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";

import { processEditPdf } from "./extra-processors";
import { continueToolsFor } from "./continue-map";
import { initialOptions, optionsReady } from "./tool-options";

async function blankPdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]);
  const bytes = await doc.save();
  return new File([bytes], "blank.pdf", { type: "application/pdf" });
}

test("edit options stay unready until there is text and a box", () => {
  const empty = initialOptions("edit");
  expect(empty.kind).toBe("edit");
  expect(optionsReady(empty, "")).toBe(false);
  if (empty.kind !== "edit") throw new Error("expected edit options");
  expect(
    optionsReady({ ...empty, text: "Invoice" }, ""),
  ).toBe(true);
});

test("processEditPdf writes a PDF the user can download", async () => {
  const file = await blankPdfFile();
  const results = await processEditPdf(
    [{ id: "1", name: file.name, size: file.size, file }],
    () => {},
    {
      kind: "edit",
      text: "Invoice 42",
      box: { pageIndex: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.1 },
    },
  );
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe("blank-edited.pdf");
  expect(results[0].blob.type).toBe("application/pdf");
  const again = await PDFDocument.load(await results[0].blob.arrayBuffer());
  expect(again.getPageCount()).toBe(1);
  const contents = again.getPage(0).node.Contents();
  expect(contents).toBeDefined();
});

test("OCR continue chips include Extract Text", () => {
  const next = continueToolsFor("ocr-pdf", [{ type: "application/pdf" }]);
  expect(next.map((tool) => tool.id)).toEqual([
    "extract-text",
    "compress-pdf",
    "protect-pdf",
  ]);
});
