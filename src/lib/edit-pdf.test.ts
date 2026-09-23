import { expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";

import { processEditPdf } from "./extra-processors";
import { continueToolsFor } from "./continue-map";
import {
  editMarkReady,
  initialOptions,
  newHighlightMark,
  newTextMark,
  optionsReady,
} from "./tool-options";

async function blankPdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]);
  const bytes = await doc.save();
  return new File([bytes], "blank.pdf", { type: "application/pdf" });
}

test("edit options stay unready until a mark can be drawn", () => {
  const empty = initialOptions("edit");
  expect(empty.kind).toBe("edit");
  expect(optionsReady(empty, "")).toBe(false);
  if (empty.kind !== "edit") throw new Error("expected edit options");
  const draft = newTextMark(0);
  expect(editMarkReady(draft)).toBe(false);
  expect(optionsReady({ kind: "edit", marks: [draft] }, "")).toBe(false);
  expect(
    optionsReady({ kind: "edit", marks: [{ ...draft, text: "Invoice" }] }, ""),
  ).toBe(true);
  expect(
    optionsReady(
      {
        kind: "edit",
        marks: [newHighlightMark({ pageIndex: 0, x: 0.1, y: 0.2, w: 0.4, h: 0.08 })],
      },
      "",
    ),
  ).toBe(true);
});

test("covering a line is ready even before the words change", () => {
  const mark = newTextMark(0, 0.1, 0.2, {
    w: 0.3,
    h: 0.04,
    text: "ATHARV ENTERPRISES",
    cover: true,
  });
  expect(editMarkReady(mark)).toBe(true);
  expect(optionsReady({ kind: "edit", marks: [mark] }, "")).toBe(true);
});

test("processEditPdf writes a PDF the user can download", async () => {
  const file = await blankPdfFile();
  const results = await processEditPdf(
    [{ id: "1", name: file.name, size: file.size, file }],
    () => {},
    {
      kind: "edit",
      marks: [
        { ...newTextMark(0), text: "Invoice 42" },
        newTextMark(0, 0.1, 0.2, {
          w: 0.4,
          h: 0.05,
          text: "Replaced",
          cover: true,
        }),
        newHighlightMark({ pageIndex: 0, x: 0.1, y: 0.4, w: 0.5, h: 0.08 }),
      ],
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

test("OCR options default to a searchable PDF and can skip text pages", () => {
  const ocr = initialOptions("ocr");
  expect(ocr.kind).toBe("ocr");
  if (ocr.kind !== "ocr") throw new Error("expected ocr options");
  expect(ocr.language).toBe("eng");
  expect(ocr.output).toBe("pdf");
  expect(ocr.skipTextPages).toBe(true);
  expect(optionsReady(ocr, "")).toBe(true);
});
