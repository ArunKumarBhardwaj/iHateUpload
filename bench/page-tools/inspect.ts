// Prints what is left in a PDF: size, pages, form fields, annotations, text chars, info title/author, JS/attachments, /Rotate.
// Usage: bun bench/page-tools/inspect.ts <pdf>...
import { readFileSync } from "node:fs";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

for (const file of process.argv.slice(2)) {
  const bytes = readFileSync(file);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  let annots = 0;
  for (const p of doc.getPages()) annots += p.node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.size() ?? 0;
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const js = !!names?.has(PDFName.of("JavaScript")) || doc.catalog.has(PDFName.of("OpenAction"));
  const emb = !!names?.has(PDFName.of("EmbeddedFiles"));
  const pdf = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  let chars = 0;
  for (let n = 1; n <= pdf.numPages; n++) chars += (await (await pdf.getPage(n)).getTextContent()).items.reduce((a, i) => a + ("str" in i ? i.str.length : 0), 0);
  console.log(JSON.stringify({ file: file.split("/").pop(), bytes: bytes.length, pages: doc.getPageCount(), fields: doc.getForm().getFields().length, annots, textChars: chars, title: doc.getTitle() ?? "", author: doc.getAuthor() ?? "", js, embeddedFiles: emb }));
}
