import { expect, test } from "bun:test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  StandardFonts,
} from "@cantoo/pdf-lib";

import { DEFAULT_STRIP, flattenAndStrip } from "./flatten";

async function sample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 200]);
  page.drawText("Body text", { x: 20, y: 160, size: 14, font });
  const form = doc.getForm();
  const field = form.createTextField("name");
  field.setText("Ada");
  field.addToPage(page, { x: 20, y: 100, width: 120, height: 20, font });
  // A link, a comment and a file attachment.
  const ctx = doc.context;
  const link = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 10, 80, 30],
      A: { S: "URI", URI: "https://example.com" },
    }),
  );
  const note = ctx.register(
    ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [100, 10, 120, 30], Contents: "hi" }),
  );
  const attach = ctx.register(
    ctx.obj({ Type: "Annot", Subtype: "FileAttachment", Rect: [130, 10, 150, 30] }),
  );
  const annots = page.node.lookup(PDFName.of("Annots"), PDFArray);
  for (const a of [link, note, attach]) annots.push(a);
  // Document level JavaScript and an embedded file name tree.
  const js = ctx.register(ctx.obj({ S: "JavaScript", JS: "app.alert(1)" }));
  doc.catalog.set(PDFName.of("OpenAction"), js);
  doc.catalog.set(
    PDFName.of("Names"),
    ctx.obj({
      JavaScript: { Names: ["x", js] },
      EmbeddedFiles: { Names: [] },
    }),
  );
  doc.setTitle("Secret title");
  doc.setAuthor("Synthetic Author");
  return PDFDocument.load(await doc.save());
}

const subtypes = (doc: PDFDocument) =>
  (doc.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.asArray() ?? []).map(
    (r) => (doc.context.lookup(r) as PDFDict).get(PDFName.of("Subtype"))?.toString(),
  );

const none = { annotations: false, forms: false, metadata: false, javascript: false, attachments: false };

test("flattening burns the field in and keeps the rest", () => {
  return sample().then((doc) => {
    flattenAndStrip(doc, none);
    expect(doc.getForm().getFields().length).toBe(0);
    expect(subtypes(doc)).toEqual(["/Link", "/Text", "/FileAttachment"]);
    expect(doc.catalog.has(PDFName.of("OpenAction"))).toBe(true);
  });
});

test("annotations strip removes links, notes and attachments but not by itself the form", async () => {
  const doc = await sample();
  flattenAndStrip(doc, { ...none, annotations: true });
  expect(subtypes(doc)).toEqual([]);
});

test("forms strip removes fields without flattening them first", async () => {
  const doc = await sample();
  flattenAndStrip(doc, { ...none, forms: true }, { flattenForm: false });
  expect(doc.catalog.has(PDFName.of("AcroForm"))).toBe(false);
  expect(subtypes(doc)).toEqual(["/Link", "/Text", "/FileAttachment"]);
});

test("javascript strip clears open action, names and link actions that run script", async () => {
  const doc = await sample();
  flattenAndStrip(doc, { ...none, javascript: true });
  expect(doc.catalog.has(PDFName.of("OpenAction"))).toBe(false);
  const names = doc.catalog.lookup(PDFName.of("Names"), PDFDict);
  expect(names.has(PDFName.of("JavaScript"))).toBe(false);
  expect(names.has(PDFName.of("EmbeddedFiles"))).toBe(true);
});

test("attachments strip removes the file tree and attachment annots", async () => {
  const doc = await sample();
  flattenAndStrip(doc, { ...none, attachments: true });
  const names = doc.catalog.lookup(PDFName.of("Names"), PDFDict);
  expect(names.has(PDFName.of("EmbeddedFiles"))).toBe(false);
  expect(subtypes(doc)).toEqual(["/Link", "/Text"]);
});

test("metadata strip empties the info dictionary", async () => {
  const doc = await sample();
  flattenAndStrip(doc, { ...none, metadata: true });
  expect(doc.getTitle() ?? "").toBe("");
  expect(doc.getAuthor() ?? "").toBe("");
});

test("defaults keep annotations and strip script and metadata", () => {
  expect(DEFAULT_STRIP).toEqual({
    annotations: false,
    forms: false,
    metadata: true,
    javascript: true,
    attachments: false,
  });
});
