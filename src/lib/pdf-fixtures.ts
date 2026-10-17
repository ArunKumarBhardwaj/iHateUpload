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

/** An XMP packet that agrees with the metadata fixture, plus a foreign `acme:` property. */
export const SAMPLE_XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:acme="http://example.com/acme/" acme:Secret="keep me">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Quarterly Plan</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>Test Author</rdf:li></rdf:Seq></dc:creator>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">Synthetic &amp; fake</rdf:li></rdf:Alt></dc:description>
<pdf:Keywords>alpha, beta</pdf:Keywords>
<pdf:Producer>Fixture Producer</pdf:Producer>
<xmp:CreatorTool>Fixture Maker</xmp:CreatorTool>
<xmp:CreateDate>2020-01-02T03:04:05Z</xmp:CreateDate>
<xmp:ModifyDate>2021-06-07T08:09:10Z</xmp:ModifyDate>
</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
