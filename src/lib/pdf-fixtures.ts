import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  StandardFonts,
} from "@cantoo/pdf-lib";

/** Synthetic fixtures for tests and benches. Never real documents. */
export type OutlineSpec = {
  title: string;
  page: number;
  children?: OutlineSpec[];
};

/** Writes a real /Outlines tree (nested, with /Dest to page refs) into `doc`. */
export function addOutline(doc: PDFDocument, items: OutlineSpec[]) {
  const ctx = doc.context;
  const pageRefs = doc.getPages().map((page) => page.ref);
  const rootRef = ctx.nextRef();

  const build = (
    specs: OutlineSpec[],
    parent: PDFRef,
  ): { first: PDFRef; last: PDFRef; total: number } => {
    const refs = specs.map(() => ctx.nextRef());
    let total = specs.length;
    specs.forEach((spec, i) => {
      const dict = ctx.obj({
        Title: PDFHexString.fromText(spec.title),
        Parent: parent,
        Dest: [pageRefs[spec.page], PDFName.of("Fit")],
      }) as PDFDict;
      if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]);
      if (i < specs.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]);
      if (spec.children?.length) {
        const kids = build(spec.children, refs[i]);
        dict.set(PDFName.of("First"), kids.first);
        dict.set(PDFName.of("Last"), kids.last);
        dict.set(PDFName.of("Count"), PDFNumber.of(kids.total));
        total += kids.total;
      }
      ctx.assign(refs[i], dict);
    });
    return { first: refs[0], last: refs[refs.length - 1], total };
  };

  const top = build(items, rootRef);
  ctx.assign(
    rootRef,
    ctx.obj({
      Type: "Outlines",
      First: top.first,
      Last: top.last,
      Count: top.total,
    }),
  );
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
}

/** A PDF whose page n carries `texts[n]` as real selectable text. */
export async function textPdf(texts: string[], outline?: OutlineSpec[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of texts) {
    const page = doc.addPage([400, 500]);
    text.split("\n").forEach((line, i) =>
      page.drawText(line, { x: 40, y: 440 - i * 22, size: 14, font }),
    );
  }
  if (outline) addOutline(doc, outline);
  return doc.save();
}
