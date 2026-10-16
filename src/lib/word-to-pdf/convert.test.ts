import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFDict, PDFArray } from "@cantoo/pdf-lib";

import { convertDocxToPdf } from "./convert";
import { buildLongDocx, buildRichDocx, buildUnicodeDocx } from "./fixtures";

const loadFont = async (file: string) =>
  new Uint8Array(readFileSync(join(process.cwd(), "public/fonts", file)));

async function pdfText(bytes: Uint8Array): Promise<{ pages: string[] }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return { pages };
}

function fontNames(doc: PDFDocument): string[] {
  const names: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("Font")) {
      const base = obj.get(PDFName.of("BaseFont"));
      if (base) names.push(base.toString());
    }
  }
  return names;
}

describe("convertDocxToPdf (end to end)", () => {
  test("keeps text selectable, structure, links, images and fonts", async () => {
    const docx = await buildRichDocx();
    const out = await convertDocxToPdf(docx, { loadFont, locale: "en-US" });
    const { pages } = await pdfText(out.bytes);

    expect(out.pageCount).toBe(2);
    expect(pages.length).toBe(2);
    const all = pages.join("\n");
    for (const s of ["Quarterly Report", "1. Overview", "specification page", "Step two", "Sub step", "Region", "Revenue", "Strong growth", "Appendix"]) {
      expect(all).toContain(s);
    }
    expect(pages[1]).toContain("Appendix");
    expect(pages[0]).not.toContain("Appendix");
    expect(all).toContain("1.");
    expect(all).toContain("•");

    const doc = await PDFDocument.load(out.bytes);
    const names = fontNames(doc).join(" ");
    expect(names).toContain("Helvetica-Bold");
    expect(names).toContain("Helvetica-Oblique");

    // link annotation with the right URI
    const annots = doc.getPage(0).node.Annots();
    expect(annots).toBeDefined();
    let uri = "";
    for (let i = 0; i < (annots as PDFArray).size(); i++) {
      const a = doc.context.lookup((annots as PDFArray).get(i), PDFDict);
      const act = a.lookup(PDFName.of("A"), PDFDict);
      uri = act.lookup(PDFName.of("URI")).toString();
    }
    expect(uri).toContain("https://example.com/spec");

    // an embedded image XObject
    const images = [...doc.context.enumerateIndirectObjects()].filter(([, o]) => {
      const d = (o as { dict?: PDFDict }).dict;
      return d?.get(PDFName.of("Subtype")) === PDFName.of("Image");
    });
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(out.bytes.length).toBeGreaterThan(3000);
  });

  test("paginates long documents automatically", async () => {
    const out = await convertDocxToPdf(await buildLongDocx(60), { loadFont });
    expect(out.pageCount).toBeGreaterThan(3);
    const { pages } = await pdfText(out.bytes);
    expect(pages[pages.length - 1]).toContain("Paragraph 60");
  });

  test("non-Latin text does not crash and Cyrillic/Greek stay selectable", async () => {
    const out = await convertDocxToPdf(await buildUnicodeDocx(), { loadFont });
    const { pages } = await pdfText(out.bytes);
    expect(pages[0]).toContain("Café");
    expect(pages[0]).toContain("Привет");
    expect(pages[0]).toContain("Γεια");
    // CJK/Arabic have no glyphs in the bundled font: reported, not crashed
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  test("without a font loader, non-Latin falls back and still produces a PDF", async () => {
    const out = await convertDocxToPdf(await buildUnicodeDocx(), {
      loadFont: async () => {
        throw new Error("offline");
      },
    });
    expect(out.pageCount).toBe(1);
    expect(out.warnings.join(" ")).toMatch(/font/i);
  });
});
