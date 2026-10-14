import JSZip from "jszip";

import type {
  Block,
  DocModel,
  ListInfo,
  MediaFile,
  ParagraphBlock,
  Run,
  Section,
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
type Ctx = { linkRel?: (url: string) => string; bookmarkId: () => number };

function runXml(run: Run): string {
  if (run.tab) return "<w:r><w:tab/></w:r>";
  const props: string[] = [];
  if (run.link) props.push('<w:rStyle w:val="Hyperlink"/>');
  if (run.font) {
    const f = esc(run.font);
    props.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/>`);
  }
  if (run.bold) props.push("<w:b/><w:bCs/>");
  if (run.italic) props.push("<w:i/><w:iCs/>");
  if (run.color && /^[0-9a-f]{6}$/i.test(run.color)) {
    props.push(`<w:color w:val="${run.color.toUpperCase()}"/>`);
  }
  if (run.size) {
    const half = Math.max(2, Math.round(run.size * 2));
    props.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);
  }
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  if (run.field) {
    return `<w:fldSimple w:instr=" ${run.field} "><w:r>${rPr}<w:t>1</w:t></w:r></w:fldSimple>`;
  }
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
}

function paragraphProps(p: ParagraphBlock, sectPr = ""): string {
  const parts: string[] = [];
  if (p.style) parts.push(`<w:pStyle w:val="${p.style}"/>`);
  if (p.list) parts.push(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${p.list.instance}"/></w:numPr>`);
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
  return `<w:p>${paragraphProps(p, sectPr)}${colBreak}${starts}${runsXml(p.runs, ctx)}${ends}</w:p>`;
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
    .map((row) => {
      let col = 0;
      const cells = row
        .map((cell) => {
          const width = t.colWidths.slice(col, col + cell.colSpan).reduce((a, b) => a + b, 0);
          col += cell.colSpan;
          const props = [`<w:tcW w:w="${tw(width)}" w:type="dxa"/>`];
          if (cell.colSpan > 1) props.push(`<w:gridSpan w:val="${cell.colSpan}"/>`);
          if (cell.vMerge === "restart") props.push('<w:vMerge w:val="restart"/>');
          if (cell.vMerge === "continue") props.push("<w:vMerge/>");
          const body = cell.paragraphs.length
            ? cell.paragraphs.map((p) => paragraphXml(p, ctx)).join("")
            : "<w:p/>";
          return `<w:tc><w:tcPr>${props.join("")}</w:tcPr>${body}</w:tc>`;
        })
        .join("");
      return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells}</w:tr>`;
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
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${docId}" name="${part.file}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${part.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
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
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

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
  `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/>` +
  `<w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/></w:style>` +
  `</w:styles>`;

const SETTINGS =
  `${XML_HEAD}<w:settings ${NS}><w:defaultTabStop w:val="720"/><w:compat>` +
  `<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>` +
  `</w:compat></w:settings>`;

function numberingXml(lists: Map<number, ListInfo>): string {
  const abstracts: string[] = [];
  const nums: string[] = [];
  for (const [instance, list] of [...lists].sort((a, b) => a[0] - b[0])) {
    const bullet = list.kind === "bullet";
    const fmt = bullet ? "bullet" : list.kind;
    const text = bullet ? "•" : `%1${list.suffix || "."}`;
    const font = bullet ? '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:hint="default"/></w:rPr>' : "";
    abstracts.push(
      `<w:abstractNum w:abstractNumId="${instance}"><w:multiLevelType w:val="singleLevel"/>` +
        `<w:lvl w:ilvl="0"><w:start w:val="${bullet ? 1 : Math.max(1, list.start)}"/><w:numFmt w:val="${fmt}"/>` +
        `<w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${tw(list.leftIndent)}" ` +
        `w:hanging="${tw(list.hanging)}"/></w:pPr>${font}</w:lvl></w:abstractNum>`,
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
  const ctx: Ctx = {
    bookmarkId: plain.bookmarkId,
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

  const lists = new Map<number, ListInfo>();
  const collect = (p: ParagraphBlock) => {
    if (p.list && !lists.has(p.list.instance)) lists.set(p.list.instance, p.list);
  };

  let docId = 0;
  const body: string[] = [];
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

  zip.file("word/document.xml", `${XML_HEAD}<w:document ${NS}><w:body>${body.join("")}</w:body></w:document>`);
  zip.file("word/styles.xml", STYLES);
  zip.file("word/settings.xml", SETTINGS);
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
  if (model.header.length) overrides.push(["/word/header1.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"]);
  if (model.footer.length) overrides.push(["/word/footer1.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"]);
  zip.file(
    "[Content_Types].xml",
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
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
  zip.file(
    "docProps/core.xml",
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
      `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title>` +
      `<dc:creator>iHateUpload</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  zip.file(
    "docProps/app.xml",
    `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>iHateUpload</Application></Properties>`,
  );

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
