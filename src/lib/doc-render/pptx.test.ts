import { describe, expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";
import JSZip from "jszip";

import { convertPptxToPdf } from "./pptx";
import { loadFont, pdfPages } from "./testkit";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHhgCAh6X4CYAAAAASUVORK5CYII=",
  "base64",
);

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const E = (pt: number) => Math.round(pt * 12700);
const xfrm = (x: number, y: number, w: number, h: number) => `<a:xfrm><a:off x="${E(x)}" y="${E(y)}"/><a:ext cx="${E(w)}" cy="${E(h)}"/></a:xfrm>`;

async function buildPptx(opts: { hidden?: boolean } = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId r:id="rM"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${E(960)}" cy="${E(540)}"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", '<Relationships xmlns="x"><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/><Relationship Id="rM" Target="slideMasters/slideMaster1.xml"/></Relationships>');
  zip.file("ppt/theme/theme1.xml", `<a:theme ${NS}><a:themeElements><a:clrScheme name="t"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`);
  zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(40, 30, 880, 80)}</p:spPr></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(40, 130, 880, 360)}</p:spPr></p:sp>
    </p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4000" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2400"/></a:lvl1pPr><a:lvl2pPr><a:buChar char="–"/><a:defRPr sz="2000"/></a:lvl2pPr></p:bodyStyle></p:txStyles></p:sldMaster>`);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", '<Relationships xmlns="x"><Relationship Id="t" Target="../theme/theme1.xml"/></Relationships>');
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout ${NS}><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", '<Relationships xmlns="x"><Relationship Id="m" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
  zip.file("ppt/media/pic.png", PNG);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFF7E6"/></a:solidFill></p:bgPr></p:bg><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en"/><a:t>Quarterly Review</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Revenue up</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>Nested point</a:t></a:r></a:p><a:p><a:r><a:rPr b="1" i="1" sz="2000"><a:solidFill><a:srgbClr val="D61F3A"/></a:solidFill></a:rPr><a:t>Bold red italic</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="4" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(600, 300, 200, 100)}<a:prstGeom prst="roundRect"/><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="1E3A8A"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2000"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Centered label</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="5" name="Dot"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(100, 400, 60, 60)}<a:prstGeom prst="ellipse"/><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr></p:sp>
    <p:pic><p:nvPicPr><p:cNvPr id="6" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="img1"/></p:blipFill><p:spPr>${xfrm(300, 380, 100, 100)}</p:spPr></p:pic>
    </p:spTree></p:cSld></p:sld>`,
  );
  zip.file("ppt/slides/_rels/slide1.xml.rels", '<Relationships xmlns="x"><Relationship Id="l" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="img1" Target="../media/pic.png"/></Relationships>');
  zip.file(
    "ppt/slides/slide2.xml",
    `<p:sld ${NS}${opts.hidden ? ' show="0"' : ""}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(50, 50, 300, 60)}</p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Second slide text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  zip.file("ppt/slides/_rels/slide2.xml.rels", '<Relationships xmlns="x"><Relationship Id="l" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
  return zip.generateAsync({ type: "uint8array" });
}

async function pageStream(bytes: Uint8Array, i: number): Promise<Uint8Array> {
  const { PDFName, PDFRawStream, PDFArray, decodePDFRawStream } = await import("@cantoo/pdf-lib");
  const pdf = await PDFDocument.load(bytes);
  const c = pdf.getPage(i).node.lookup(PDFName.of("Contents"));
  const parts = c instanceof PDFArray ? c.asArray().map((r) => pdf.context.lookup(r)) : [c];
  const chunks = parts.map((p) => (p instanceof PDFRawStream ? decodePDFRawStream(p).decode() : new Uint8Array()));
  return Buffer.concat(chunks);
}

describe("pptx to pdf", () => {
  test("slide-sized pages, positioned text, shapes, background, picture", async () => {
    const out = await convertPptxToPdf(await buildPptx(), { loadFont });
    expect(out.pageCount).toBe(2);
    const pdf = await PDFDocument.load(out.bytes);
    expect(Math.round(pdf.getPage(0).getWidth())).toBe(960);
    expect(Math.round(pdf.getPage(0).getHeight())).toBe(540);
    const text = (await pdfPages(out.bytes)).map((p) => p.replace(/\s+/g, " "));
    expect(text[0]).toContain("Quarterly Review");
    expect(text[0]).toContain("Revenue up");
    expect(text[0]).toContain("Bold red italic");
    expect(text[0]).toMatch(/–\s*Nested point/);
    expect(text[0]).toContain("Centered label");
    expect(text[1]).toContain("Second slide text");
    const raw = Buffer.from(out.bytes).toString("latin1");
    expect(raw).toContain("/Image");
    expect(raw).toContain("Helvetica-BoldOblique");
  });

  test("deeper levels use the master bullet, backgrounds and shapes are drawn as vectors", async () => {
    const out = await convertPptxToPdf(await buildPptx(), { loadFont });
    // slide background FFF7E6 is a filled page-sized rectangle drawn before everything else
    const stream = Buffer.from(await pageStream(out.bytes, 0)).toString("latin1");
    expect(stream).toMatch(/1 0\.96\d* 0\.90\d* rg/);
    // ellipse = bezier curves, filled shapes use f/B operators
    expect(stream).toMatch(/\d c\n/);
    expect(stream).toMatch(/\nB\n|\nf\n/);
  });

  test("hidden slides are left out", async () => {
    const out = await convertPptxToPdf(await buildPptx({ hidden: true }), { loadFont });
    expect(out.pageCount).toBe(1);
  });

  test("rejects a file that is not a presentation", async () => {
    const zip = new JSZip();
    zip.file("a.txt", "x");
    await expect(convertPptxToPdf(await zip.generateAsync({ type: "uint8array" }), { loadFont })).rejects.toThrow();
  });
});
