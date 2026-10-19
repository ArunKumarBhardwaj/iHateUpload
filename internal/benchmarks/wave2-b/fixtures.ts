// Synthetic fixtures for wave 2 group B. Run: bun internal/benchmarks/wave2-b/fixtures.ts
import { mkdirSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import sharp from "sharp";

const out = new URL("./fx/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const E = (pt: number) => Math.round(pt * 12700);
const xfrm = (x: number, y: number, w: number, h: number) => `<a:xfrm><a:off x="${E(x)}" y="${E(y)}"/><a:ext cx="${E(w)}" cy="${E(h)}"/></a:xfrm>`;
const fill = (c: string) => `<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>`;
const sp = (id: number, name: string, geom: string, x: number, y: number, w: number, h: number, f: string, ln: string, body = "") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${fill(f)}<a:ln w="25400">${fill(ln)}</a:ln></p:spPr>${body}</p:sp>`;
const label = (t: string, sz: number, color: string, extra = "") =>
  `<p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="${sz}" ${extra}>${fill(color)}</a:rPr><a:t>${t}</a:t></a:r></a:p></p:txBody>`;

// a 200x120 gradient picture
const raw = Buffer.alloc(200 * 120 * 3);
for (let y = 0; y < 120; y++) for (let x = 0; x < 200; x++) {
  const i = (y * 200 + x) * 3;
  raw[i] = x + 20; raw[i + 1] = 200 - y; raw[i + 2] = 120;
}
const png = await sharp(raw, { raw: { width: 200, height: 120, channels: 3 } }).png().toBuffer();

const zip = new JSZip();
zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId r:id="rM"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst><p:sldSz cx="${E(960)}" cy="${E(540)}"/></p:presentation>`);
zip.file("ppt/_rels/presentation.xml.rels", '<Relationships xmlns="x"><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/><Relationship Id="rId3" Target="slides/slide3.xml"/><Relationship Id="rM" Target="slideMasters/slideMaster1.xml"/></Relationships>');
zip.file("ppt/theme/theme1.xml", `<a:theme ${NS}><a:themeElements><a:clrScheme name="t"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="F97316"/></a:accent2></a:clrScheme></a:themeElements></a:theme>`);
const ph = (id: number, type: string, idx: string, x: number, y: number, w: number, h: number) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${type}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"${idx ? ` idx="${idx}"` : ""}/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}</p:spPr></p:sp>`;
zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr>${fill("F8FAFC")}</p:bgPr></p:bg><p:spTree>
  <p:sp><p:nvSpPr><p:cNvPr id="9" name="Band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 520, 960, 20)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill("2563EB")}</p:spPr></p:sp>
  ${ph(2, "title", "", 40, 30, 880, 80)}${ph(3, "body", "1", 40, 130, 880, 360)}
  </p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4000" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2400"/></a:lvl1pPr><a:lvl2pPr><a:buChar char="–"/><a:defRPr sz="2000"/></a:lvl2pPr></p:bodyStyle></p:txStyles></p:sldMaster>`);
zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", '<Relationships xmlns="x"><Relationship Id="t" Target="../theme/theme1.xml"/></Relationships>');
zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout ${NS}><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", '<Relationships xmlns="x"><Relationship Id="m" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
zip.file("ppt/media/pic.png", png);
const title = (t: string) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en"/><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`;
zip.file("ppt/slides/slide1.xml", `<p:sld ${NS}><p:cSld><p:bg><p:bgPr>${fill("FFF7E6")}</p:bgPr></p:bg><p:spTree>${title("Quarterly Review")}
  <p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Revenue up 18 percent</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>Driven by the new plan</a:t></a:r></a:p><a:p><a:r><a:rPr b="1" i="1" sz="2000">${fill("D61F3A")}</a:rPr><a:t>Bold red italic line</a:t></a:r></a:p></p:txBody></p:sp>
  ${sp(4, "Card", "roundRect", 600, 300, 260, 110, "2563EB", "1E3A8A", label("Centered label", 2000, "FFFFFF", 'b="1"'))}
  ${sp(5, "Dot", "ellipse", 100, 400, 80, 80, "F97316", "9A3412")}
  <p:pic><p:nvPicPr><p:cNvPr id="6" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="img1"/></p:blipFill><p:spPr>${xfrm(300, 360, 200, 120)}</p:spPr></p:pic>
  </p:spTree></p:cSld></p:sld>`);
zip.file("ppt/slides/_rels/slide1.xml.rels", '<Relationships xmlns="x"><Relationship Id="l" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="img1" Target="../media/pic.png"/></Relationships>');
zip.file("ppt/slides/slide2.xml", `<p:sld ${NS}><p:cSld><p:spTree>${title("Shapes and lines")}
  ${sp(3, "R", "rect", 60, 150, 200, 120, "DBEAFE", "2563EB", label("Rectangle", 1800, "1F2937"))}
  ${sp(4, "RR", "roundRect", 300, 150, 200, 120, "FEF3C7", "D97706", label("Rounded", 1800, "1F2937"))}
  ${sp(5, "E", "ellipse", 540, 150, 200, 120, "DCFCE7", "16A34A", label("Ellipse", 1800, "1F2937"))}
  <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="7" name="L"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(60, 330, 680, 0)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="38100">${fill("DC2626")}</a:ln></p:spPr></p:cxnSp>
  <p:sp><p:nvSpPr><p:cNvPr id="8" name="tb"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(60, 360, 680, 100)}</p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr algn="r"/><a:r><a:rPr sz="1600"/><a:t>Right aligned text box, 16 pt.</a:t></a:r></a:p><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1400" i="1"/><a:t>Centered italic text box line.</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:sld>`);
zip.file("ppt/slides/_rels/slide2.xml.rels", '<Relationships xmlns="x"><Relationship Id="l" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
zip.file("ppt/slides/slide3.xml", `<p:sld ${NS}><p:cSld><p:bg><p:bgPr>${fill("1F2937")}</p:bgPr></p:bg><p:spTree>
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(80, 200, 800, 120)}</p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4400" b="1">${fill("FFFFFF")}</a:rPr><a:t>Thank you</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:sld>`);
zip.file("ppt/slides/_rels/slide3.xml.rels", '<Relationships xmlns="x"><Relationship Id="l" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
writeFileSync(out + "deck.pptx", await zip.generateAsync({ type: "uint8array" }));

// markdown with math and a long paragraph for line spacing
writeFileSync(out + "math.md", `# Physics notes

The energy of a particle is $E = mc^2$ and a circle has area $A = \\pi r^2$. Inline fractions like $\\frac{a}{b} + \\sqrt{x^2 + y^2}$ stay in the line.

Display math:

$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$

$$\\sum_{n=1}^{N} n = \\frac{N(N+1)}{2}$$

A price of \\$5 and \\$10 is not math. Plain **bold**, *italic* and \`code\` still work.

- first item with $x_i^2$
- second item

${"Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(6)}
`);

// csv: 60 rows, quoted commas, numbers for sorting
const names = ["Zoe", "Adam", "Mia", "Noah", "Eli", "Ava", "Liam", "Ivy", "Omar", "Lena"];
let csv = "id,name,city,amount,note\n";
for (let i = 1; i <= 60; i++) csv += `${i},${names[i % 10]} ${String.fromCharCode(65 + (i % 26))},${["Oslo", "Lima", "Pune", "Kyiv"][i % 4]},${((i * 37) % 500) + 0.5},"note, number ${i}"\n`;
writeFileSync(out + "people.csv", csv);
console.log("fixtures written to", out);
