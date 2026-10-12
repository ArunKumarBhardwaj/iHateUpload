import type { PDFDocument } from "@cantoo/pdf-lib";

export function stripPdfMetadata(doc: PDFDocument) {
  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("iHateUpload");
  doc.setCreator("iHateUpload");
}
