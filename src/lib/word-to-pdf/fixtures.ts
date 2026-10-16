/**
 * Synthetic .docx builders for tests: hand-written OOXML zipped with jszip.
 * Nothing here reads a real document.
 */
import { deflateSync } from "node:zlib";
import JSZip from "jszip";

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** A small RGB gradient PNG. */
export function makePng(w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = Math.round((x / w) * 255);
      raw[row + 2 + x * 3] = Math.round((y / h) * 255);
      raw[row + 3 + x * 3] = 160;
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface RunOpts {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  color?: string;
  size?: number; // points
  font?: string;
}

export function r(text: string, o: RunOpts = {}): string {
  const props =
    (o.font ? `<w:rFonts w:ascii="${o.font}" w:hAnsi="${o.font}"/>` : "") +
    (o.b ? "<w:b/>" : "") +
    (o.i ? "<w:i/>" : "") +
    (o.strike ? "<w:strike/>" : "") +
    (o.color ? `<w:color w:val="${o.color}"/>` : "") +
    (o.size ? `<w:sz w:val="${o.size * 2}"/>` : "") +
    (o.u ? '<w:u w:val="single"/>' : "");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

export function p(
  content: string,
  o: { style?: string; jc?: string; num?: [number, number]; ind?: number } = {},
): string {
  const props =
    (o.style ? `<w:pStyle w:val="${o.style}"/>` : "") +
    (o.num
      ? `<w:numPr><w:ilvl w:val="${o.num[1]}"/><w:numId w:val="${o.num[0]}"/></w:numPr>`
      : "") +
    (o.ind ? `<w:ind w:left="${o.ind * 20}"/>` : "") +
    (o.jc ? `<w:jc w:val="${o.jc}"/>` : "");
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${content}</w:p>`;
}

export const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

export function link(rid: string, text: string): string {
  return `<w:hyperlink r:id="${rid}"><w:r><w:t>${esc(text)}</w:t></w:r></w:hyperlink>`;
}

export function table(rows: string[][], opts: { header?: boolean } = {}): string {
  const tr = (cells: string[], head: boolean) =>
    `<w:tr>${head ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells
      .map(
        (c) =>
          `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${p(r(c, { b: head }))}</w:tc>`,
      )
      .join("")}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows
    .map((row, i) => tr(row, !!opts.header && i === 0))
    .join("")}</w:tbl>`;
}

export function image(rid: string): string {
  return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><wp:extent cx="1143000" cy="762000"/><wp:docPr id="1" name="Picture 1" descr="gradient"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
</w:styles>`;

const lvl = (i: number, fmt: string, text: string) =>
  `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/></w:lvl>`;
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}>
<w:abstractNum w:abstractNumId="0">${lvl(0, "bullet", "•")}${lvl(1, "bullet", "o")}</w:abstractNum>
<w:abstractNum w:abstractNumId="1">${lvl(0, "decimal", "%1.")}${lvl(1, "lowerLetter", "%2.")}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

export async function buildDocx(
  bodyXml: string,
  opts: { sectPr?: string; png?: Uint8Array } = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/spec" TargetMode="External"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`,
  );
  zip.file("word/styles.xml", STYLES);
  zip.file("word/numbering.xml", NUMBERING);
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${bodyXml}${opts.sectPr ?? ""}</w:body></w:document>`,
  );
  zip.file("word/media/image1.png", opts.png ?? makePng(120, 80));
  return zip.generateAsync({ type: "uint8array" });
}

/** Headings, styles, lists, table, image, link, colour, alignment, page break. */
export async function buildRichDocx(): Promise<Uint8Array> {
  const body =
    p(r("Quarterly Report"), { style: "Title" }) +
    p(r("1. Overview"), { style: "Heading1" }) +
    p(
      r("Plain text, ") +
        r("bold", { b: true }) +
        r(", ") +
        r("italic", { i: true }) +
        r(", ") +
        r("underlined", { u: true }) +
        r(", ") +
        r("struck", { strike: true }) +
        r(", and ") +
        r("crimson", { color: "C00000" }) +
        r(". See the ") +
        link("rId3", "specification page") +
        r(" for details."),
    ) +
    p(r("Centered line"), { jc: "center" }) +
    p(r("Right aligned line"), { jc: "right" }) +
    p(r("1.1 Highlights"), { style: "Heading2" }) +
    p(r("First bullet"), { num: [1, 0] }) +
    p(r("Nested bullet"), { num: [1, 1] }) +
    p(r("Second bullet"), { num: [1, 0] }) +
    p(r("Step one"), { num: [2, 0] }) +
    p(r("Step two"), { num: [2, 0] }) +
    p(r("Sub step"), { num: [2, 1] }) +
    p(r("Data table"), { style: "Heading2" }) +
    table(
      [
        ["Region", "Revenue", "Notes"],
        [
          "North",
          "1,200",
          "Strong growth driven by the new product line and extended hours",
        ],
        ["South", "900", "Flat"],
      ],
      { header: true },
    ) +
    p(r("Figure:") + image("rId4")) +
    pageBreak +
    p(r("Appendix"), { style: "Heading1" }) +
    p(r("Final page text."));
  return buildDocx(body);
}

export async function buildLongDocx(paragraphs: number): Promise<Uint8Array> {
  const sentence =
    "The quick brown fox jumps over the lazy dog while the committee reviews the quarterly figures in detail. ";
  let body = "";
  for (let i = 0; i < paragraphs; i++)
    body += p(r(`Paragraph ${i + 1}. ` + sentence.repeat(4)));
  return buildDocx(body);
}

export async function buildUnicodeDocx(): Promise<Uint8Array> {
  const body =
    p(r("Café crème — “quoted” €5")) +
    p(
      r(
        "Привет мир Γεια σου κόσμε",
      ),
    ) +
    p(
      r(
        "你好，世界 こんにちは مرحبا",
      ),
    );
  return buildDocx(body);
}
