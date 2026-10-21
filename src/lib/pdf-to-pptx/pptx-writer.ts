/**
 * PowerPoint (.pptx) writer for PDF to PowerPoint. Each slide is either an
 * exact-layout page (text boxes, tables, pictures and shapes at their PDF
 * positions) or one picture of the page.
 *
 * Lengths in the model are PDF points from the top left; DrawingML wants EMU
 * (12 700 per point). A fit transform scales and centres pages that do not
 * match the slide size.
 */
import JSZip from "jszip";

import type {
  DocProperties,
  ExactItem,
  ExactPage,
  ImageBlock,
  ListInfo,
  MediaFile,
  ParagraphBlock,
  Run,
  Shape,
  TableBlock,
} from "@/lib/pdf-to-word/model";

export type SlideSize = "match" | "16:9" | "4:3";

export type Slide =
  | { kind: "exact"; page: ExactPage }
  | { kind: "picture"; ref: string; width: number; height: number };

export type PptxOptions = {
  size: SlideSize;
  title: string;
  properties?: DocProperties;
};

const EMU = 12700;
// PowerPoint accepts slides from 1 to 56 inches on each side.
const MIN_SIDE = 72;
const MAX_SIDE = 56 * 72;

function esc(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])/g, "")
    .replace(/(^|[^\ud800-\udbff])[\udc00-\udfff]/g, "$1")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const hex = (value: string | undefined) => (value && /^[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : undefined);

/** Slide size in points for the first page and the chosen format. */
export function slideSize(size: SlideSize, first: { width: number; height: number }) {
  if (size === "16:9") return { width: 960, height: 540 };
  if (size === "4:3") return { width: 720, height: 540 };
  // Match the page, clamped to what PowerPoint allows, keeping the shape.
  const scale = Math.min(1, MAX_SIDE / Math.max(first.width, first.height));
  return {
    width: Math.max(MIN_SIDE, first.width * scale),
    height: Math.max(MIN_SIDE, first.height * scale),
  };
}

/** Places a page on the slide: uniform scale, centred. */
type Fit = { s: number; ox: number; oy: number };

function fitFor(page: { width: number; height: number }, slide: { width: number; height: number }): Fit {
  const s = Math.min(slide.width / page.width, slide.height / page.height);
  return { s, ox: (slide.width - page.width * s) / 2, oy: (slide.height - page.height * s) / 2 };
}

type Ctx = {
  fit: Fit;
  /** Items seen so far per running list ("instance:level"), across slides, so numbers continue. */
  listCounts: Map<string, number>;
  nextId: () => number;
  /** Relationship id for a hyperlink or picture on this slide. */
  rel: (type: "hyperlink" | "image", target: string) => string;
};

const X = (ctx: Ctx, pt: number) => Math.round((ctx.fit.ox + pt * ctx.fit.s) * EMU);
const Y = (ctx: Ctx, pt: number) => Math.round((ctx.fit.oy + pt * ctx.fit.s) * EMU);
const L = (ctx: Ctx, pt: number) => Math.max(0, Math.round(pt * ctx.fit.s * EMU));

function xfrm(ctx: Ctx, box: { x: number; y: number; w: number; h: number }, flipV = false) {
  return (
    `<a:xfrm${flipV ? ' flipV="1"' : ""}><a:off x="${X(ctx, box.x)}" y="${Y(ctx, box.y)}"/>` +
    `<a:ext cx="${Math.max(1, L(ctx, box.w))}" cy="${Math.max(1, L(ctx, box.h))}"/></a:xfrm>`
  );
}

const solid = (color: string | undefined, alpha?: number) => {
  const c = hex(color);
  if (!c) return "<a:noFill/>";
  const a = alpha !== undefined && alpha < 0.995 ? `<a:alpha val="${Math.round(Math.max(0, alpha) * 100000)}"/>` : "";
  return `<a:solidFill><a:srgbClr val="${c}"${a ? `>${a}</a:srgbClr>` : "/>"}</a:solidFill>`;
};

function geometry(ctx: Ctx, shape: Shape): string {
  if (shape.kind !== "path") return `<a:prstGeom prst="${shape.kind}"><a:avLst/></a:prstGeom>`;
  const W = Math.max(1, L(ctx, shape.w));
  const H = Math.max(1, L(ctx, shape.h));
  const pt = (x: number, y: number) => `<a:pt x="${L(ctx, x)}" y="${L(ctx, y)}"/>`;
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

function shapeXml(ctx: Ctx, shape: Shape): string {
  const id = ctx.nextId();
  const line = shape.stroke
    ? `<a:ln w="${Math.max(1, L(ctx, shape.strokeWidth))}">${solid(shape.stroke, shape.strokeAlpha)}${shape.dash ? '<a:prstDash val="dash"/>' : ""}</a:ln>`
    : "<a:ln><a:noFill/></a:ln>";
  const fill = shape.kind === "line" ? "<a:noFill/>" : solid(shape.fill, shape.fillAlpha);
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(ctx, shape, shape.flipV)}${geometry(ctx, shape)}${fill}${line}</p:spPr></p:sp>`
  );
}

function runProps(ctx: Ctx, run: Run, tag = "a:rPr"): string {
  const attrs = ['lang="en-US"'];
  if (run.size) attrs.push(`sz="${Math.max(100, Math.min(400000, Math.round(run.size * ctx.fit.s * 100)))}"`);
  if (run.bold) attrs.push('b="1"');
  if (run.italic) attrs.push('i="1"');
  if (run.underline) attrs.push('u="sng"');
  if (run.strike) attrs.push('strike="sngStrike"');
  if (run.vertAlign) attrs.push(`baseline="${run.vertAlign === "superscript" ? 30000 : -25000}"`);
  const kids: string[] = [];
  const color = hex(run.color);
  if (color) kids.push(`<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`);
  const highlight = hex(run.highlight);
  if (highlight) kids.push(`<a:highlight><a:srgbClr val="${highlight}"/></a:highlight>`);
  if (run.font) {
    const f = esc(run.font);
    kids.push(`<a:latin typeface="${f}"/><a:ea typeface="${esc(run.eastAsia ?? run.font)}"/><a:cs typeface="${f}"/>`);
  }
  if (run.link && "url" in run.link && /^(https?|mailto):/i.test(run.link.url)) {
    kids.push(`<a:hlinkClick r:id="${ctx.rel("hyperlink", run.link.url)}"/>`);
  }
  return `<${tag} ${attrs.join(" ")}${kids.length ? `>${kids.join("")}</${tag}>` : "/>"}`;
}

const AUTONUM: Record<Exclude<ListInfo["kind"], "bullet">, string> = {
  decimal: "arabic",
  lowerLetter: "alphaLc",
  upperLetter: "alphaUc",
  lowerRoman: "romanLc",
  upperRoman: "romanUc",
};

function paragraphXml(ctx: Ctx, block: ParagraphBlock): string {
  const attrs: string[] = [];
  const kids: string[] = [];
  if (block.align === "center") attrs.push('algn="ctr"');
  if (block.align === "right") attrs.push('algn="r"');
  const list = block.list;
  if (list) {
    attrs.push(`marL="${L(ctx, list.leftIndent)}" indent="${-L(ctx, list.hanging)}"`);
  } else {
    if (block.indentLeft) attrs.push(`marL="${L(ctx, block.indentLeft)}"`);
    if (block.firstLine) attrs.push(`indent="${L(ctx, block.firstLine)}"`);
  }
  if (block.lineRatio && Math.abs(block.lineRatio - 1) > 0.02) {
    kids.push(`<a:lnSpc><a:spcPct val="${Math.round(Math.min(5, Math.max(0.5, block.lineRatio)) * 100000)}"/></a:lnSpc>`);
  }
  kids.push(`<a:spcBef><a:spcPts val="${Math.round((block.spaceBefore ?? 0) * ctx.fit.s * 100)}"/></a:spcBef>`);
  kids.push('<a:spcAft><a:spcPts val="0"/></a:spcAft>');
  if (list?.kind === "bullet") {
    kids.push(`<a:buFont typeface="Arial"/><a:buChar char="${esc(list.glyph ?? "•")}"/>`);
  } else if (list) {
    // Every list item sits in its own text box, so each one says which number it is.
    const key = `${list.instance}:${list.level}`;
    const seen = ctx.listCounts.get(key) ?? 0;
    ctx.listCounts.set(key, seen + 1);
    const number = list.start + seen;
    const scheme = `${AUTONUM[list.kind]}${list.suffix === ")" ? "ParenR" : "Period"}`;
    kids.push(`<a:buAutoNum type="${scheme}"${number > 1 ? ` startAt="${number}"` : ""}/>`);
  } else {
    kids.push("<a:buNone/>");
  }
  if (block.tabs?.length) {
    const algn = { left: "l", center: "ctr", right: "r" } as const;
    kids.push(`<a:tabLst>${block.tabs.map((t) => `<a:tab pos="${L(ctx, t.pos)}" algn="${algn[t.kind]}"/>`).join("")}</a:tabLst>`);
  }
  const runs = block.runs.map((run) => {
    if (run.field === "PAGE") {
      return `<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum">${runProps(ctx, run)}<a:t>${esc(run.text || "1")}</a:t></a:fld>`;
    }
    const text = run.tab ? "\t" : run.text;
    if (!text) return "";
    return `<a:r>${runProps(ctx, run)}<a:t>${esc(text)}</a:t></a:r>`;
  });
  const last = block.runs.at(-1);
  const end = last ? runProps(ctx, { ...last, link: undefined, text: "" }, "a:endParaRPr") : '<a:endParaRPr lang="en-US"/>';
  return `<a:p><a:pPr${attrs.length ? " " + attrs.join(" ") : ""}>${kids.join("")}</a:pPr>${runs.join("")}${end}</a:p>`;
}

const bodyPr = (wrap: "square" | "none") =>
  `<a:bodyPr wrap="${wrap}" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr>`;

/**
 * One line laid out with tab stops, as one text box per stop. Google Slides
 * ignores custom tab stops and bunches the pieces together; separate boxes land
 * where the PDF had them in every viewer.
 */
export function splitAtTabs(item: ExactItem, block: ParagraphBlock): ExactItem[] {
  const pieces: Run[][] = [[]];
  for (const run of block.runs) {
    if (run.tab) pieces.push([]);
    else pieces[pieces.length - 1].push(run);
  }
  const tabs = block.tabs ?? [];
  // Where each piece's tab stop is, in points from the box's left edge; past the defined stops, every half inch.
  const stops = pieces.map((_, i) => (i === 0 ? 0 : (tabs[i - 1]?.pos ?? (tabs.at(-1)?.pos ?? 0) + 36 * (i - tabs.length))));
  const out: ExactItem[] = [];
  pieces.forEach((runs, i) => {
    if (!runs.some((run) => run.text.trim())) return;
    const kind = i === 0 ? "left" : (tabs[i - 1]?.kind ?? "left");
    const next = stops[i + 1] ?? item.box.w;
    const prev = i === 0 ? 0 : stops[i - 1];
    // A right tab ends the text at its stop; a centre tab centres on it; a left tab starts there.
    const [from, to] =
      kind === "right" ? [prev, stops[i]] : kind === "center" ? [stops[i] - (stops[i] - prev) / 2, stops[i] + (next - stops[i]) / 2] : [stops[i], next];
    out.push({
      kind: "text",
      box: { x: item.box.x + from, y: item.box.y, w: Math.max(1, to - from), h: item.box.h },
      block: { ...block, runs, tabs: undefined, indentLeft: undefined, firstLine: undefined, align: kind === "left" ? undefined : kind },
    });
  });
  return out;
}

/** A text box sized to the block; a little slack keeps PowerPoint from re-wrapping lines. */
function textBoxXml(ctx: Ctx, item: ExactItem): string {
  const block = item.block as ParagraphBlock;
  // One line on the page stays one line: a substitute font a little wider than the PDF's must not wrap it.
  const tallest = Math.max(1, ...block.runs.map((run) => run.size ?? 12));
  const wrap = item.box.h < tallest * 1.6 ? "none" : "square";
  if (wrap === "none" && !block.list && block.runs.some((run) => run.tab)) {
    return splitAtTabs(item, block).map((piece) => textBoxXml(ctx, piece)).join("");
  }
  const id = ctx.nextId();
  const box = { x: item.box.x - 1, y: item.box.y - 1, w: item.box.w + 4, h: item.box.h + 3 };
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(ctx, box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody>${bodyPr(wrap)}<a:lstStyle/>${paragraphXml(ctx, block)}</p:txBody></p:sp>`
  );
}

function pictureXml(ctx: Ctx, ref: string, box: { x: number; y: number; w: number; h: number }, media: Record<string, MediaFile>): string {
  const file = media[ref];
  if (!file) return "";
  const id = ctx.nextId();
  const rid = ctx.rel("image", ref);
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}" descr=""/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(ctx, box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

function tableXml(ctx: Ctx, item: ExactItem): string {
  const table = item.block as TableBlock;
  const id = ctx.nextId();
  const cols = table.colWidths;
  const pad = table.padding ?? { top: 2, bottom: 2, left: 4, right: 4 };
  const border = hex(table.borderColor) ?? "000000";
  const edge = (tag: string, on: boolean) =>
    on
      ? `<a:${tag} w="${Math.max(1, L(ctx, 0.75))}"><a:solidFill><a:srgbClr val="${border}"/></a:solidFill></a:${tag}>`
      : `<a:${tag} w="0"><a:noFill/></a:${tag}>`;

  // Row spans: a "restart" cell spans itself plus the "continue" cells below it in the same grid column.
  const gridCol = (row: TableBlock["rows"][number], index: number) =>
    row.slice(0, index).reduce((sum, cell) => sum + Math.max(1, cell.colSpan), 0);
  const spanBelow = (r: number, col: number) => {
    let span = 1;
    for (let below = r + 1; below < table.rows.length; below++) {
      const row = table.rows[below];
      const index = row.findIndex((_, i) => gridCol(row, i) === col);
      if (index < 0 || row[index].vMerge !== "continue") break;
      span++;
    }
    return span;
  };

  const rows = table.rows.map((row, r) => {
    const height = Math.max(1, L(ctx, table.rowHeights?.[r] ?? 14));
    const cells = row.flatMap((cell, i) => {
      const span = Math.max(1, cell.colSpan);
      const col = gridCol(row, i);
      const attrs: string[] = [];
      if (span > 1) attrs.push(`gridSpan="${span}"`);
      if (cell.vMerge === "restart") {
        const rowSpan = spanBelow(r, col);
        if (rowSpan > 1) attrs.push(`rowSpan="${rowSpan}"`);
      }
      if (cell.vMerge === "continue") attrs.push('vMerge="1"');
      const b = cell.borders ?? (table.borders ? { top: true, bottom: true, left: true, right: true } : {});
      const tcPr =
        `<a:tcPr marL="${L(ctx, pad.left)}" marR="${L(ctx, pad.right)}" marT="${L(ctx, pad.top)}" marB="${L(ctx, pad.bottom)}"${cell.vAlign === "center" ? ' anchor="ctr"' : ""}>` +
        `${edge("lnL", !!b.left)}${edge("lnR", !!b.right)}${edge("lnT", !!b.top)}${edge("lnB", !!b.bottom)}` +
        `${hex(cell.shade) ? `<a:solidFill><a:srgbClr val="${hex(cell.shade)}"/></a:solidFill>` : "<a:noFill/>"}</a:tcPr>`;
      const paragraphs = cell.paragraphs.length ? cell.paragraphs.map((p) => paragraphXml(ctx, p)).join("") : '<a:p><a:endParaRPr lang="en-US"/></a:p>';
      const first = `<a:tc${attrs.length ? " " + attrs.join(" ") : ""}><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</a:txBody>${tcPr}</a:tc>`;
      // Each extra grid column a cell covers needs its own merged placeholder.
      const merged = Array.from({ length: span - 1 }, () =>
        `<a:tc hMerge="1"${cell.vMerge === "continue" ? ' vMerge="1"' : ""}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></a:txBody><a:tcPr/></a:tc>`,
      );
      return [first, ...merged];
    });
    return `<a:tr h="${height}">${cells.join("")}</a:tr>`;
  });
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${X(ctx, item.box.x)}" y="${Y(ctx, item.box.y)}"/><a:ext cx="${Math.max(1, L(ctx, item.box.w))}" cy="${Math.max(1, L(ctx, item.box.h))}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="0" bandRow="0"/>` +
    `<a:tblGrid>${cols.map((w) => `<a:gridCol w="${Math.max(1, L(ctx, w))}"/>`).join("")}</a:tblGrid>${rows.join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const EMPTY_TREE =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

/** Media refs come from pdf.js ("2:img_p1_1"); package part names allow no colons, so each gets a plain name. */
type MediaNames = (ref: string) => string;

function slideXml(
  slide: Slide,
  size: { width: number; height: number },
  media: Record<string, MediaFile>,
  rels: string[],
  nameOf: MediaNames,
  listCounts: Map<string, number>,
): string {
  const page = slide.kind === "exact" ? slide.page : slide;
  let id = 1;
  const relIds = new Map<string, string>();
  const ctx: Ctx = {
    fit: fitFor(page, size),
    listCounts,
    nextId: () => ++id,
    rel: (type, target) => {
      const key = `${type}:${target}`;
      const existing = relIds.get(key);
      if (existing) return existing;
      const rid = `rId${rels.length + 2}`; // rId1 is the layout
      relIds.set(key, rid);
      rels.push(
        type === "hyperlink"
          ? `<Relationship Id="${rid}" Type="${REL_NS}/hyperlink" Target="${esc(target)}" TargetMode="External"/>`
          : `<Relationship Id="${rid}" Type="${REL_NS}/image" Target="../media/${nameOf(target)}"/>`,
      );
      return rid;
    },
  };
  const parts: string[] = [];
  if (slide.kind === "picture") {
    parts.push(pictureXml(ctx, slide.ref, { x: 0, y: 0, w: slide.width, h: slide.height }, media));
  } else {
    const { shapes, items } = slide.page;
    // Back to front: shapes behind text, pictures, other shapes, tables, then text.
    for (const shape of shapes) if (shape.behind) parts.push(shapeXml(ctx, shape));
    for (const item of items) if (item.kind === "picture") parts.push(pictureXml(ctx, (item.block as ImageBlock).ref, item.box, media));
    for (const shape of shapes) if (!shape.behind) parts.push(shapeXml(ctx, shape));
    for (const item of items) if (item.kind === "table") parts.push(tableXml(ctx, item));
    for (const item of items) if (item.kind === "text") parts.push(textBoxXml(ctx, item));
  }
  return `${HEAD}<p:sld ${NS}><p:cSld><p:spTree>${EMPTY_TREE}${parts.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME =
  `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements>` +
  `<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>` +
  `<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>` +
  `<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
  `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
  `<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
  `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
  `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>` +
  `</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

const CLR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

const MASTER =
  `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>${CLR_MAP}` +
  `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
  `<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>` +
  `<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const LAYOUT =
  `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>` +
  `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const isoDate = (value: string | undefined) => (value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString().replace(/\.\d+Z$/, "Z") : undefined);

export async function writePptx(slides: Slide[], media: Record<string, MediaFile>, options: PptxOptions): Promise<Uint8Array> {
  if (slides.length === 0) throw new Error("There are no pages to put on slides.");
  const first = slides[0].kind === "exact" ? slides[0].page : slides[0];
  const size = slideSize(options.size, first);
  const zip = new JSZip();
  const names = new Map<string, string>();
  const nameOf: MediaNames = (ref) => {
    let name = names.get(ref);
    if (!name) {
      name = `image${names.size + 1}.${media[ref].mime === "image/png" ? "png" : "jpeg"}`;
      names.set(ref, name);
    }
    return name;
  };

  const slideIds: string[] = [];
  const presRels: string[] = [
    `<Relationship Id="rId1" Type="${REL_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
  ];
  const listCounts = new Map<string, number>();
  slides.forEach((slide, index) => {
    const n = index + 1;
    const rels: string[] = [];
    zip.file(`ppt/slides/slide${n}.xml`, slideXml(slide, size, media, rels, nameOf, listCounts));
    zip.file(
      `ppt/slides/_rels/slide${n}.xml.rels`,
      `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${rels.join("")}</Relationships>`,
    );
    const rid = `rId${n + 1}`;
    presRels.push(`<Relationship Id="${rid}" Type="${REL_NS}/slide" Target="slides/slide${n}.xml"/>`);
    slideIds.push(`<p:sldId id="${255 + n}" r:id="${rid}"/>`);
  });
  for (const [ref, name] of names) zip.file(`ppt/media/${name}`, media[ref].data);
  const extra = slides.length + 2;
  presRels.push(
    `<Relationship Id="rId${extra}" Type="${REL_NS}/theme" Target="theme/theme1.xml"/>`,
    `<Relationship Id="rId${extra + 1}" Type="${REL_NS}/presProps" Target="presProps.xml"/>`,
    `<Relationship Id="rId${extra + 2}" Type="${REL_NS}/viewProps" Target="viewProps.xml"/>`,
    `<Relationship Id="rId${extra + 3}" Type="${REL_NS}/tableStyles" Target="tableStyles.xml"/>`,
  );

  const cx = Math.round(size.width * EMU);
  const cy = Math.round(size.height * EMU);
  zip.file(
    "ppt/presentation.xml",
    `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="${cy}" cy="${cx}"/>` +
      `<p:defaultTextStyle><a:lvl1pPr><a:defRPr lang="en-US"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file("ppt/_rels/presentation.xml.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join("")}</Relationships>`);
  zip.file("ppt/slideMasters/slideMaster1.xml", MASTER);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL_NS}/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", LAYOUT);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL_NS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file("ppt/theme/theme1.xml", THEME);
  zip.file("ppt/presProps.xml", `${HEAD}<p:presentationPr ${NS}/>`);
  zip.file("ppt/viewProps.xml", `${HEAD}<p:viewPr ${NS}><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
  zip.file("ppt/tableStyles.xml", `${HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);

  const props = options.properties ?? {};
  const created = isoDate(props.created);
  const modified = isoDate(props.modified);
  zip.file(
    "docProps/core.xml",
    `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
      `xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${esc(props.title || options.title)}</dc:title>` +
      (props.author ? `<dc:creator>${esc(props.author)}</dc:creator>` : "") +
      (props.subject ? `<dc:subject>${esc(props.subject)}</dc:subject>` : "") +
      (props.keywords ? `<cp:keywords>${esc(props.keywords)}</cp:keywords>` : "") +
      (created ? `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` : "") +
      (modified ? `<dcterms:modified xsi:type="dcterms:W3CDTF">${modified}</dcterms:modified>` : "") +
      `</cp:coreProperties>`,
  );
  zip.file(
    "docProps/app.xml",
    `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>iHateUpload</Application><Slides>${slides.length}</Slides></Properties>`,
  );
  zip.file(
    "_rels/.rels",
    `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="ppt/presentation.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId3" Type="${REL_NS}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  const overrides = [
    ["/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
    ["/ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"],
    ["/ppt/slideLayouts/slideLayout1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"],
    ["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
    ["/ppt/presProps.xml", "application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"],
    ["/ppt/viewProps.xml", "application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"],
    ["/ppt/tableStyles.xml", "application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"],
    ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"],
    ...slides.map((_, i) => [`/ppt/slides/slide${i + 1}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"]),
  ];
  zip.file(
    "[Content_Types].xml",
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>` +
      overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join("") +
      `</Types>`,
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
