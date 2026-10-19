import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
} from "@cantoo/pdf-lib";

import { wipePdfMetadata } from "../pdf-meta";
import type { FlattenMode } from "./types";

export type StripOptions = {
  /** Links, comments, highlights, stamps: every annotation except form fields. */
  annotations: boolean;
  /** Form fields and the AcroForm itself. */
  forms: boolean;
  metadata: boolean;
  javascript: boolean;
  attachments: boolean;
};

export const DEFAULT_STRIP: StripOptions = {
  annotations: false,
  forms: false,
  metadata: true,
  javascript: true,
  attachments: false,
};

export type FlattenSettings = {
  mode: FlattenMode;
  /** Full flatten: render resolution, 96 to 400. */
  dpi: number;
  strip: StripOptions;
};

export const DEFAULT_FLATTEN: FlattenSettings = {
  mode: "form",
  dpi: 150,
  strip: { ...DEFAULT_STRIP },
};

const N = PDFName.of;

function isScriptAction(doc: PDFDocument, action: unknown): boolean {
  const dict = action instanceof PDFDict ? action : doc.context.lookup(action as never);
  if (!(dict instanceof PDFDict)) return false;
  const s = dict.get(N("S"));
  if (s?.toString() === "/JavaScript") return true;
  const next = dict.get(N("Next"));
  if (next instanceof PDFArray) {
    return next.asArray().some((a) => isScriptAction(doc, a));
  }
  return next ? isScriptAction(doc, next) : false;
}

function subtypeOf(doc: PDFDocument, ref: unknown): string {
  const dict = doc.context.lookup(ref as never);
  return dict instanceof PDFDict ? (dict.get(N("Subtype"))?.toString() ?? "") : "";
}

function filterAnnots(
  doc: PDFDocument,
  drop: (subtype: string) => boolean,
) {
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(N("Annots"), PDFArray);
    if (!annots) continue;
    const keep = annots.asArray().filter((ref) => !drop(subtypeOf(doc, ref)));
    if (keep.length === annots.size()) continue;
    if (keep.length === 0) page.node.delete(N("Annots"));
    else page.node.set(N("Annots"), doc.context.obj(keep));
  }
}

function stripJavascript(doc: PDFDocument) {
  const cat = doc.catalog;
  const open = cat.get(N("OpenAction"));
  if (open && isScriptAction(doc, open)) cat.delete(N("OpenAction"));
  cat.delete(N("AA"));
  const names = cat.lookupMaybe(N("Names"), PDFDict);
  names?.delete(N("JavaScript"));
  const acro = cat.lookupMaybe(N("AcroForm"), PDFDict);
  acro?.delete(N("XFA"));
  for (const page of doc.getPages()) {
    page.node.delete(N("AA"));
    const annots = page.node.lookupMaybe(N("Annots"), PDFArray);
    if (!annots) continue;
    for (const ref of annots.asArray()) {
      const annot = doc.context.lookup(ref as never);
      if (!(annot instanceof PDFDict)) continue;
      annot.delete(N("AA"));
      const action = annot.get(N("A"));
      if (action && isScriptAction(doc, action)) annot.delete(N("A"));
    }
  }
}

function stripAttachments(doc: PDFDocument) {
  const cat = doc.catalog;
  cat.lookupMaybe(N("Names"), PDFDict)?.delete(N("EmbeddedFiles"));
  cat.delete(N("AF"));
  for (const page of doc.getPages()) page.node.delete(N("AF"));
  filterAnnots(doc, (s) => s === "/FileAttachment");
}

/**
 * Applies a form flatten and the strip choices in place. `flattenForm: false`
 * skips burning the fields in, for callers that rasterise next.
 */
export function flattenAndStrip(
  doc: PDFDocument,
  strip: StripOptions,
  { flattenForm = true }: { flattenForm?: boolean } = {},
) {
  if (flattenForm) {
    try {
      doc.getForm().flatten();
    } catch {
      // A PDF with no AcroForm still gets a clean rewrite.
    }
  }
  if (strip.annotations) filterAnnots(doc, (s) => s !== "/Widget");
  if (strip.forms) {
    filterAnnots(doc, (s) => s === "/Widget");
    doc.catalog.delete(N("AcroForm"));
  }
  if (strip.javascript) stripJavascript(doc);
  if (strip.attachments) stripAttachments(doc);
  if (strip.metadata) wipePdfMetadata(doc);
}
