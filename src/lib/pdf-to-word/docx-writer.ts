import JSZip from "jszip";

import { obfuscate } from "./sfnt";
import type {
  Block,
  DocModel,
  ExactItem,
  ExactPage,
  ListInfo,
  MediaFile,
  ParagraphBlock,
  Run,
  Section,
  Shape,
  TableBlock,
} from "./model";

const tw = (pt: number) => Math.round(pt * 20);
const emu = (pt: number) => Math.round(pt * 12700);
const MAX_PAGE_TWIPS = 31680;

function esc(text: string): string {
  return (
    text
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
      .replace(/[\ud800-\udbff](?![\udc00-\udfff])/g, "")
      .replace(/(^|[^\ud800-\udbff])[\udc00-\udfff]/g, "$1")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  );
}

/** What the paragraph writers need from the package: hyperlink relationships and bookmark ids. */
type Ctx = { linkRel?: (url: string) => string; bookmarkId: () => number; shapeId?: () => number };

const colorFill = (hex: string | undefined, alpha: number | undefined) => {
  if (!hex) return "<a:noFill/>";
  const a = alpha !== undefined && alpha < 0.995 ? `<a:alpha val="${Math.round(Math.max(0, alpha) * 100000)}"/>` : "";
  return `<a:solidFill><a:srgbClr val="${hex}"${a ? `>${a}</a:srgbClr>` : "/>"}</a:solidFill>`;
};

function geometryXml(shape: Shape): string {
  if (shape.kind !== "path") return `<a:prstGeom prst="${shape.kind}"><a:avLst/></a:prstGeom>`;
  const W = Math.max(1, emu(shape.w));
  const H = Math.max(1, emu(shape.h));
  const pt = (x: number, y: number) => `<a:pt x="${emu(x)}" y="${emu(y)}"/>`;
  const steps = (shape.paths ?? []).flatMap((sub) =>
    sub.map((seg) => {
      const p = seg.pts;
      if (seg.op === "M") return `<a:moveTo>${pt(p[0], p[1])}</a:moveTo>`;
      if (seg.op === "L") return `<a:lnTo>${pt(p[0], p[1])}</a:lnTo>`;
      if (seg.op === "C") return `<a:cubicBezTo>${pt(p[0], p[1])}${pt(p[2], p[3])}${pt(p[4], p[5])}</a:cubicBezTo>`;
      return "<a:close/>";
    }),
  );
  return (
    `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>` +
    `<a:pathLst><a:path w="${W}" h="${H}">${steps.join("")}</a:path></a:pathLst></a:custGeom>`
  );
}

/** A drawing anchored to the page at a position (EMU), over or behind the text; z is its stacking order. */
function anchorXml(a: {
  x: number;
  y: number;
  cx: number;
  cy: number;
  z: number;
  behind: boolean;
  id: number;
  name: string;
  graphic: string;
}): string {
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${a.z}" ` +
    `behindDoc="${a.behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${a.x}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${a.y}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${a.cx}" cy="${a.cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${a.id}" name="${a.name} ${a.id}"/><wp:cNvGraphicFramePr/>${a.graphic}` +
    `</wp:anchor></w:drawing></w:r>`
  );
}

/** A drawing pinned to the page at its own position, behind or over the text. */
function shapeXml(shape: Shape, id: number, z = id): string {
  const cx = emu(shape.w);
  const cy = emu(shape.h);
  const width = shape.stroke ? Math.max(1, emu(shape.strokeWidth)) : 0;
  const dash = shape.dash ? '<a:prstDash val="dash"/>' : "";
  const line = shape.stroke
    ? `<a:ln w="${width}">${colorFill(shape.stroke, shape.strokeAlpha)}${dash}</a:ln>`
    : "<a:ln><a:noFill/></a:ln>";
  // The fill of an open line means nothing; it would only shade the gap between its ends.
  const fill = shape.kind === "line" ? "<a:noFill/>" : colorFill(shape.fill, shape.fillAlpha);
  return anchorXml({
    x: emu(shape.x),
    y: emu(shape.y),
    cx,
    cy,
    z,
    behind: shape.behind,
    id,
    name: "Shape",
    graphic:
      `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
      `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm${shape.flipV ? ' flipV="1"' : ""}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      `${geometryXml(shape)}${fill}${line}</wps:spPr><wps:bodyPr/></wps:wsp>` +
      `</a:graphicData></a:graphic>`,
  });
}

function runXml(run: Run): string {
  if (run.tab) return "<w:r><w:tab/></w:r>";
  const props: string[] = [];
  if (run.link) props.push('<w:rStyle w:val="Hyperlink"/>');
  if (run.font) {
    const f = esc(run.font);
    const ea = run.eastAsia ? esc(run.eastAsia) : f;
    const hint = run.eastAsia ? ' w:hint="eastAsia"' : "";
    props.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${ea}"${hint}/>`);
  }
  if (run.bold) props.push("<w:b/><w:bCs/>");
  if (run.italic) props.push("<w:i/><w:iCs/>");
  if (run.strike) props.push("<w:strike/>");
  if (run.color && /^[0-9a-f]{6}$/i.test(run.color)) {
    props.push(`<w:color w:val="${run.color.toUpperCase()}"/>`);
  }
  if (run.size) {
    const half = Math.max(2, Math.round(run.size * 2));
    props.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);
  }
  if (run.underline) props.push('<w:u w:val="single"/>');
  if (run.highlight && /^[0-9a-f]{6}$/i.test(run.highlight)) {
    props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${run.highlight.toUpperCase()}"/>`);
  }
  if (run.vertAlign) props.push(`<w:vertAlign w:val="${run.vertAlign}"/>`);
  if (run.lang) props.push(`<w:lang w:eastAsia="${esc(run.lang)}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  if (run.field) {
    return `<w:fldSimple w:instr=" ${run.field} "><w:r>${rPr}<w:t>1</w:t></w:r></w:fldSimple>`;
  }
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
}

function paragraphProps(p: ParagraphBlock, sectPr = ""): string {
  const parts: string[] = [];
  if (p.style) parts.push(`<w:pStyle w:val="${p.style}"/>`);
  if (p.list) parts.push(`<w:numPr><w:ilvl w:val="${p.list.level}"/><w:numId w:val="${p.list.instance}"/></w:numPr>`);
  if (p.tabs?.length) {
    parts.push(
      `<w:tabs>${p.tabs.map((t) => `<w:tab w:val="${t.kind}" w:pos="${tw(t.pos)}"/>`).join("")}</w:tabs>`,
    );
  }
  const spacing: string[] = [];
  // A named style carries its own spacing, so say "none" unless the page had some.
  if (p.spaceBefore || p.style) spacing.push(`w:before="${tw(p.spaceBefore ?? 0)}"`);
  if (p.style) spacing.push('w:after="0"');
  if (p.lineRatio) spacing.push(`w:line="${Math.round(p.lineRatio * 240)}" w:lineRule="auto"`);
  // A paragraph that only carries drawings must not push the page content down.
  if (p.shapes?.length && !p.runs.length) spacing.splice(0, spacing.length, 'w:before="0" w:after="0" w:line="20" w:lineRule="exact"');
  if (spacing.length) parts.push(`<w:spacing ${spacing.join(" ")}/>`);
  if (p.list) {
    parts.push(`<w:ind w:left="${tw(p.list.leftIndent)}" w:hanging="${tw(p.list.hanging)}"/>`);
  } else if (p.indentLeft || p.firstLine) {
    const ind = [`w:left="${tw(p.indentLeft ?? 0)}"`];
    if (p.firstLine && p.firstLine > 0) ind.push(`w:firstLine="${tw(p.firstLine)}"`);
    if (p.firstLine && p.firstLine < 0) ind.push(`w:hanging="${tw(-p.firstLine)}"`);
    parts.push(`<w:ind ${ind.join(" ")}/>`);
  }
  if (p.align) parts.push(`<w:jc w:val="${p.align}"/>`);
  if (sectPr) parts.push(sectPr);
  return parts.length ? `<w:pPr>${parts.join("")}</w:pPr>` : "";
}

/** Runs in order, with neighbours that share a link gathered under one hyperlink. */
function runsXml(runs: Run[], ctx: Ctx): string {
  const out: string[] = [];
  for (let i = 0; i < runs.length; ) {
    const link = runs[i].link;
    const rId = link && "url" in link ? ctx.linkRel?.(link.url) : undefined;
    const target = link && (rId || ("anchor" in link && link.anchor)) ? link : undefined;
    if (!target) {
      out.push(runXml(runs[i++]));
      continue;
    }
    const group: Run[] = [];
    while (i < runs.length && JSON.stringify(runs[i].link) === JSON.stringify(link)) group.push(runs[i++]);
    const attr = "url" in target ? `r:id="${rId}"` : `w:anchor="${esc(target.anchor)}"`;
    out.push(`<w:hyperlink ${attr} w:history="1">${group.map(runXml).join("")}</w:hyperlink>`);
  }
  return out.join("");
}

function paragraphXml(p: ParagraphBlock, ctx: Ctx, sectPr = ""): string {
  const colBreak = p.columnBreakBefore ? '<w:r><w:br w:type="column"/></w:r>' : "";
  const marks = (p.bookmarks ?? []).map((name) => ({ id: ctx.bookmarkId(), name }));
  const starts = marks.map((m) => `<w:bookmarkStart w:id="${m.id}" w:name="${esc(m.name)}"/>`).join("");
  const ends = marks.map((m) => `<w:bookmarkEnd w:id="${m.id}"/>`).join("");
  const shapes = (p.shapes ?? []).map((sh) => shapeXml(sh, ctx.shapeId?.() ?? 1)).join("");
  return `<w:p>${paragraphProps(p, sectPr)}${colBreak}${starts}${shapes}${runsXml(p.runs, ctx)}${ends}</w:p>`;
}

const BORDER = '<w:{side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>';

function tableXml(t: TableBlock, ctx: Ctx): string {
  const total = t.colWidths.reduce((a, b) => a + b, 0);
  const borders = t.borders
    ? `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"]
        .map((side) => BORDER.replace("{side}", side))
        .join("")}</w:tblBorders>`
    : "";
  const grid = t.colWidths.map((w) => `<w:gridCol w:w="${tw(w)}"/>`).join("");
  const rows = t.rows
    .map((row, rowIndex) => {
      let col = 0;
      const cells = row
        .map((cell) => {
          const width = t.colWidths.slice(col, col + cell.colSpan).reduce((a, b) => a + b, 0);
          col += cell.colSpan;
          const props = [`<w:tcW w:w="${tw(width)}" w:type="dxa"/>`];
          if (cell.colSpan > 1) props.push(`<w:gridSpan w:val="${cell.colSpan}"/>`);
          if (cell.vMerge === "restart") props.push('<w:vMerge w:val="restart"/>');
          if (cell.vMerge === "continue") props.push("<w:vMerge/>");
          if (cell.shade && /^[0-9a-f]{6}$/i.test(cell.shade)) {
            props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${cell.shade.toUpperCase()}"/>`);
          }
          const body = cell.paragraphs.length
            ? cell.paragraphs.map((p) => paragraphXml(p, ctx)).join("")
            : "<w:p/>";
          return `<w:tc><w:tcPr>${props.join("")}</w:tcPr>${body}</w:tc>`;
        })
        .join("");
      const header = rowIndex < (t.headerRows ?? 0) ? "<w:tblHeader/>" : "";
      return `<w:tr><w:trPr><w:cantSplit/>${header}</w:trPr>${cells}</w:tr>`;
    })
    .join("");
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${tw(total)}" w:type="dxa"/>` +
    `<w:tblInd w:w="${tw(t.indentLeft)}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>` +
    `<w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`
  );
}

type ImagePart = { rId: string; file: string; mime: string; data: Uint8Array };

function pictureGraphic(part: ImagePart, docId: number, cx: number, cy: number): string {
  return (
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${docId}" name="${part.file}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${part.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic>`
  );
}

function imageXml(
  block: Extract<Block, { type: "image" }>,
  part: ImagePart,
  docId: number,
  sectPr = "",
): string {
  const cx = emu(block.width);
  const cy = emu(block.height);
  const pPr: string[] = [];
  const spacing = block.spaceBefore ? ` w:before="${tw(block.spaceBefore)}"` : "";
  if (spacing) pPr.push(`<w:spacing${spacing}/>`);
  if (block.indentLeft) pPr.push(`<w:ind w:left="${tw(block.indentLeft)}"/>`);
  if (sectPr) pPr.push(sectPr);
  return (
    `<w:p>${pPr.length ? `<w:pPr>${pPr.join("")}</w:pPr>` : ""}<w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${docId}" name="Picture ${docId}" descr=""/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `${pictureGraphic(part, docId, cx, cy)}</wp:inline></w:drawing></w:r></w:p>`
  );
}

// Stacking order of the layers on an exact page: backdrop shapes, pictures, tables, then text.
const Z = { shape: 1, picture: 2, table: 3, text: 5 };

/** A paragraph or table in a text box anchored to the page; the extra points keep Word from re-wrapping. */
function textBoxXml(item: ExactItem, ctx: Ctx, id: number): string {
  const { box, block } = item;
  const inner =
    block.type === "table"
      ? `${tableXml(block, ctx)}<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`
      : paragraphXml(block as ParagraphBlock, ctx);
  const cx = emu(box.w + 4);
  const cy = emu(box.h + 3);
  return anchorXml({
    x: emu(box.x - 1),
    y: emu(box.y - 1),
    cx,
    cy,
    z: item.kind === "table" ? Z.table : Z.text,
    behind: false,
    id,
    name: "Text Box",
    graphic:
      `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
      `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>` +
      `<wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx>` +
      `<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" wrap="square"><a:noAutofit/></wps:bodyPr></wps:wsp>` +
      `</a:graphicData></a:graphic>`,
  });
}

function pictureAnchorXml(item: ExactItem, part: ImagePart, id: number): string {
  const cx = emu(item.box.w);
  const cy = emu(item.box.h);
  return anchorXml({
    x: emu(item.box.x),
    y: emu(item.box.y),
    cx,
    cy,
    z: Z.picture,
    behind: false,
    id,
    name: "Picture",
    graphic: pictureGraphic(part, id, cx, cy),
  });
}

/** One carrier paragraph per page holds all that page's anchors; it is tiny so it never moves them. */
function carrierXml(page: ExactPage, lead: string, sect: string, ctx: Ctx, draw: (item: ExactItem, id: number) => string): string {
  const id = () => ctx.shapeId?.() ?? 1;
  const shapes = page.shapes.map((sh) => shapeXml(sh, id(), Z.shape)).join("");
  const items = page.items.map((it) => draw(it, id())).join("");
  const spacing = '<w:spacing w:before="0" w:after="0" w:line="10" w:lineRule="auto"/>';
  return `<w:p><w:pPr>${spacing}${sect}</w:pPr>${lead}${shapes}${items}</w:p>`;
}

/** Columns scaled to the text width the section really has, equal when they are close to it. */
function colsXml(section: Section): string {
  const cols = section.columns;
  if (!cols || cols.widths.length < 2) return "";
  const n = cols.widths.length;
  const m = section.margins;
  const avail = Math.max(24 * n, section.width - m.left - m.right - cols.gap * (n - 1));
  const sum = cols.widths.reduce((a, b) => a + b, 0);
  const widths = cols.widths.map((w) => (w * avail) / sum);
  const space = tw(cols.gap);
  const mean = avail / n;
  if (widths.every((w) => Math.abs(w - mean) <= 0.04 * mean)) {
    return `<w:cols w:num="${n}" w:space="${space}" w:equalWidth="1"/>`;
  }
  const list = widths
    .map((w, i) => `<w:col w:w="${tw(w)}"${i < n - 1 ? ` w:space="${space}"` : ""}/>`)
    .join("");
  return `<w:cols w:num="${n}" w:space="${space}" w:equalWidth="0">${list}</w:cols>`;
}

function sectionProps(section: Section, refs: string): string {
  const w = Math.min(MAX_PAGE_TWIPS, tw(section.width));
  const h = Math.min(MAX_PAGE_TWIPS, tw(section.height));
  const m = section.margins;
  const orient = section.width > section.height ? ' w:orient="landscape"' : "";
  return (
    `<w:sectPr>${refs}<w:type w:val="${section.start ?? "nextPage"}"/><w:pgSz w:w="${w}" w:h="${h}"${orient}/>` +
    `<w:pgMar w:top="${tw(m.top)}" w:right="${tw(m.right)}" w:bottom="${tw(m.bottom)}" w:left="${tw(m.left)}" ` +
    `w:header="${tw(section.headerDistance ?? 36)}" w:footer="${tw(section.footerDistance ?? 36)}" w:gutter="0"/>` +
    colsXml(section) +
    `</w:sectPr>`
  );
}

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function headingStyle(id: string, name: string, size: number, outline: number) {
  return (
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>` +
    `<w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="60"/>` +
    `<w:outlineLvl w:val="${outline}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
  );
}

const STYLES =
  `${XML_HEAD}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/>` +
  `<w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>` +
  `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/>` +
  `<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>` +
  `<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
  headingStyle("Heading1", "heading 1", 40, 0) +
  headingStyle("Heading2", "heading 2", 32, 1) +
  headingStyle("Heading3", "heading 3", 26, 2) +
  headingStyle("Heading4", "heading 4", 24, 3) +
  headingStyle("Heading5", "heading 5", 22, 4) +
  headingStyle("Heading6", "heading 6", 22, 5) +
  `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/>` +
  `<w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/></w:style>` +
  `</w:styles>`;

const settingsXml = (embedFonts: boolean) =>
  `${XML_HEAD}<w:settings ${NS}>${embedFonts ? "<w:embedTrueTypeFonts/><w:saveSubsetFonts/>" : ""}<w:defaultTabStop w:val="720"/><w:compat>` +
  `<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>` +
  `</w:compat></w:settings>`;

/** A GUID that depends only on the font, so the same input gives the same file every time. */
function fontKey(seed: string, data: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  const mix = (n: number) => {
    a = Math.imul(a ^ n, 0x01000193) >>> 0;
    b = Math.imul(b + n + (a >>> 7), 0x85ebca6b) >>> 0;
  };
  for (const ch of seed) mix(ch.charCodeAt(0));
  for (let i = 0; i < data.length; i += 7) mix(data[i]);
  const bytes = new Uint8Array(16);
  let x = a;
  let y = b;
  for (let i = 0; i < 16; i++) {
    x = Math.imul(x ^ (y >>> 13), 0x2c1b3c6d) >>> 0;
    y = Math.imul(y + x, 0x297a2d39) >>> 0;
    bytes[i] = (x ^ y) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
}

function levelXml(level: number, list: ListInfo): string {
  const bullet = list.kind === "bullet";
  const fmt = bullet ? "bullet" : list.kind;
  const text = bullet ? (list.glyph ?? "•") : `%${level + 1}${list.suffix || "."}`;
  const font = bullet ? '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:hint="default"/></w:rPr>' : "";
  return (
    `<w:lvl w:ilvl="${level}"><w:start w:val="${bullet ? 1 : Math.max(1, list.start)}"/><w:numFmt w:val="${fmt}"/>` +
    `<w:lvlText w:val="${esc(text)}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${tw(list.leftIndent)}" ` +
    `w:hanging="${tw(list.hanging)}"/></w:pPr>${font}</w:lvl>`
  );
}

/** One numbering per list; the levels seen get their own look and the gaps between are filled in. */
function numberingXml(lists: Map<number, Map<number, ListInfo>>): string {
  const abstracts: string[] = [];
  const nums: string[] = [];
  for (const [instance, levels] of [...lists].sort((a, b) => a[0] - b[0])) {
    const deepest = Math.max(...levels.keys());
    const lvls: string[] = [];
    for (let level = 0; level <= deepest; level++) {
      let info = levels.get(level);
      if (!info) {
        // A level nobody used: borrow the nearest used one, shifted by the step between levels.
        const near = [...levels.keys()].sort((a, b) => Math.abs(a - level) - Math.abs(b - level))[0];
        const base = levels.get(near)!;
        info = { ...base, leftIndent: Math.max(12, base.leftIndent + (level - near) * 30) };
      }
      lvls.push(levelXml(level, info));
    }
    abstracts.push(
      `<w:abstractNum w:abstractNumId="${instance}"><w:multiLevelType w:val="${deepest ? "multilevel" : "singleLevel"}"/>${lvls.join("")}</w:abstractNum>`,
    );
    nums.push(`<w:num w:numId="${instance}"><w:abstractNumId w:val="${instance}"/></w:num>`);
  }
  return `${XML_HEAD}<w:numbering ${NS}>${abstracts.join("")}${nums.join("")}</w:numbering>`;
}

function partXml(root: "hdr" | "ftr", paragraphs: ParagraphBlock[], ctx: Ctx): string {
  const body = paragraphs.length ? paragraphs.map((p) => paragraphXml(p, ctx)).join("") : "<w:p/>";
  return `${XML_HEAD}<w:${root} ${NS}>${body}</w:${root}>`;
}

function tinyParagraph(sectPr: string): string {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${sectPr}<w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>`;
}

export async function writeDocx(
  model: DocModel,
  media: Record<string, MediaFile>,
  title: string,
): Promise<Uint8Array> {
  const rels: string[] = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
  ];
  const zip = new JSZip();
  let relId = 3;
  const next = () => `rId${++relId}`;
  let bookmarks = 0;
  // Header and footer parts have relationships of their own, so links there stay plain text.
  const plain: Ctx = { bookmarkId: () => ++bookmarks };
  const linkIds = new Map<string, string>();
  let shapeIds = 1000;
  const ctx: Ctx = {
    bookmarkId: plain.bookmarkId,
    shapeId: () => ++shapeIds,
    linkRel: (url) => {
      let id = linkIds.get(url);
      if (!id) {
        id = next();
        linkIds.set(url, id);
        rels.push(
          `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(url)}" TargetMode="External"/>`,
        );
      }
      return id;
    },
  };

  let headerRefs = "";
  if (model.header.length) {
    const id = next();
    rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`);
    zip.file("word/header1.xml", partXml("hdr", model.header, plain));
    headerRefs += `<w:headerReference w:type="default" r:id="${id}"/>`;
  }
  if (model.footer.length) {
    const id = next();
    rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`);
    zip.file("word/footer1.xml", partXml("ftr", model.footer, plain));
    headerRefs += `<w:footerReference w:type="default" r:id="${id}"/>`;
  }

  const imageParts = new Map<string, ImagePart>();
  let imageCount = 0;
  const partFor = (ref: string): ImagePart | null => {
    const known = imageParts.get(ref);
    if (known) return known;
    const file = media[ref];
    if (!file) return null;
    const ext = file.mime === "image/png" ? "png" : "jpeg";
    const name = `image${++imageCount}.${ext}`;
    const part: ImagePart = { rId: next(), file: name, mime: file.mime, data: file.data };
    rels.push(`<Relationship Id="${part.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
    zip.file(`word/media/${name}`, file.data);
    imageParts.set(ref, part);
    return part;
  };

  const lists = new Map<number, Map<number, ListInfo>>();
  const collect = (p: ParagraphBlock) => {
    if (!p.list) return;
    const levels = lists.get(p.list.instance) ?? lists.set(p.list.instance, new Map()).get(p.list.instance)!;
    if (!levels.has(p.list.level)) levels.set(p.list.level, p.list);
  };

  let docId = 0;
  const body: string[] = [];
  const pages = model.pages ?? [];
  const flat = (page: ExactPage): Section => ({
    width: page.width,
    height: page.height,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    blocks: [],
    headerDistance: 0,
    footerDistance: 0,
  });
  pages.forEach((page, index) => {
    const same = (o?: ExactPage) => o && o.width === page.width && o.height === page.height;
    // A new page size needs a section of its own; otherwise a page break does the job.
    const closes = !same(pages[index + 1]);
    const sect = closes && index < pages.length - 1 ? sectionProps(flat(page), "") : "";
    const lead = index > 0 && same(pages[index - 1]) ? '<w:r><w:br w:type="page"/></w:r>' : "";
    body.push(
      carrierXml(page, lead, sect, ctx, (item, id) => {
        if (item.kind === "picture") {
          const part = partFor((item.block as { ref: string }).ref);
          return part ? pictureAnchorXml(item, part, id) : "";
        }
        if (item.block.type === "table") {
          item.block.rows.forEach((row) => row.forEach((c) => c.paragraphs.forEach(collect)));
        } else if (item.block.type === "p") collect(item.block);
        return textBoxXml(item, ctx, id);
      }),
    );
  });
  if (pages.length) body.push(sectionProps(flat(pages[pages.length - 1]), ""));
  model.sections.forEach((section, index) => {
    const last = index === model.sections.length - 1;
    const sect = sectionProps(section, index === 0 ? headerRefs : "");
    const pieces: string[] = [];
    let endsWithParagraph = false;
    const blocks = section.blocks;
    blocks.forEach((block, i) => {
      const isLast = i === blocks.length - 1;
      const carry = isLast && !last ? sect : "";
      endsWithParagraph = false;
      if (block.type === "p") {
        collect(block);
        pieces.push(paragraphXml(block, ctx, carry));
        endsWithParagraph = true;
      } else if (block.type === "image") {
        const part = partFor(block.ref);
        if (!part) return;
        pieces.push(imageXml(block, part, ++docId, carry));
        endsWithParagraph = true;
      } else {
        block.rows.forEach((row) => row.forEach((c) => c.paragraphs.forEach(collect)));
        if (pieces.length && pieces[pieces.length - 1].startsWith("<w:tbl>")) pieces.push(tinyParagraph(""));
        pieces.push(tableXml(block, ctx));
      }
    });
    if (!last && !endsWithParagraph) pieces.push(tinyParagraph(sect));
    if (last && pieces.length && pieces[pieces.length - 1].startsWith("<w:tbl>")) pieces.push(tinyParagraph(""));
    if (!pieces.length && !last) pieces.push(tinyParagraph(sect));
    body.push(...pieces);
    if (last) body.push(sect);
  });

  if (model.fonts?.length) {
    const families = new Map<string, NonNullable<DocModel["fonts"]>>();
    for (const f of model.fonts) (families.get(f.family) ?? families.set(f.family, []).get(f.family)!).push(f);
    const fontRels: string[] = [];
    let n = 0;
    const entries = [...families].map(([family, faces]) => {
      const embeds = faces.map((face) => {
        const key = fontKey(`${family}|${face.bold}|${face.italic}`, face.data);
        const file = `font${++n}.odttf`;
        const id = `rId${n}`;
        zip.file(`word/fonts/${file}`, obfuscate(face.data, key));
        fontRels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/${file}"/>`);
        const tagName = face.bold ? (face.italic ? "embedBoldItalic" : "embedBold") : face.italic ? "embedItalic" : "embedRegular";
        return { tagName, xml: `<w:${tagName} r:id="${id}" w:fontKey="${key}" w:subsetted="1"/>` };
      });
      const order = ["embedRegular", "embedBold", "embedItalic", "embedBoldItalic"];
      embeds.sort((p, q) => order.indexOf(p.tagName) - order.indexOf(q.tagName));
      return `<w:font w:name="${esc(family)}"><w:charset w:val="00"/><w:family w:val="auto"/><w:pitch w:val="variable"/>${embeds.map((e) => e.xml).join("")}</w:font>`;
    });
    zip.file("word/fontTable.xml", `${XML_HEAD}<w:fonts ${NS}>${entries.join("")}</w:fonts>`);
    zip.file(
      "word/_rels/fontTable.xml.rels",
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fontRels.join("")}</Relationships>`,
    );
    rels.push(`<Relationship Id="${next()}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>`);
  }

  zip.file("word/document.xml", `${XML_HEAD}<w:document ${NS}><w:body>${body.join("")}</w:body></w:document>`);
  zip.file("word/styles.xml", STYLES);
  zip.file("word/settings.xml", settingsXml(!!model.fonts?.length));
  zip.file("word/numbering.xml", numberingXml(lists));
  zip.file(
    "word/_rels/document.xml.rels",
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`,
  );

  const hasPng = [...imageParts.values()].some((p) => p.mime === "image/png");
  const hasJpeg = [...imageParts.values()].some((p) => p.mime === "image/jpeg");
  const overrides = [
    ["/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"],
    ["/word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"],
    ["/word/numbering.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"],
    ["/word/settings.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"],
    ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"],
  ];
  if (model.fonts?.length) overrides.push(["/word/fontTable.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"]);
  if (model.header.length) overrides.push(["/word/header1.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"]);
  if (model.footer.length) overrides.push(["/word/footer1.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"]);
  zip.file(
    "[Content_Types].xml",
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      (model.fonts?.length ? '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>' : "") +
      (hasPng ? '<Default Extension="png" ContentType="image/png"/>' : "") +
      (hasJpeg ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : "") +
      overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join("") +
      `</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
      `</Relationships>`,
  );
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const props = model.properties ?? {};
  const created = props.created ?? now;
  const tag = (name: string, value: string | undefined) => (value ? `<${name}>${esc(value)}</${name}>` : "");
  zip.file(
    "docProps/core.xml",
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
      `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      tag("dc:title", props.title ?? title) +
      tag("dc:subject", props.subject) +
      tag("dc:creator", props.author ?? "iHateUpload") +
      tag("cp:keywords", props.keywords) +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${props.modified ?? now}</dcterms:modified></cp:coreProperties>`,
  );
  zip.file(
    "docProps/app.xml",
    `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>iHateUpload</Application></Properties>`,
  );

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
