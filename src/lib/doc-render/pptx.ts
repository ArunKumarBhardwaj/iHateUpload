/** PowerPoint -> PDF: each slide becomes a page of its own size, with shapes, pictures and real text. */
import { PDFDocument, type PDFImage } from "@cantoo/pdf-lib";

import { layoutDocument, type Cmd, type FontKey, type Measurer } from "../word-to-pdf/layout";
import type { Block, Inline, Para as BlockPara } from "../word-to-pdf/model";
import { browserRasterise, embedImage, renderPages, type EngineOptions, type OutPage } from "./engine";
import { parsePptx, type Box, type Op, type Para } from "./pptx-parse";

export interface PptxOptions extends EngineOptions {
  /** Print slides marked hidden too. */
  includeHidden?: boolean;
}

export interface PptxResult {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
}

const DEFAULT_SIZE = 18;

function toBlocks(paras: Para[], scale: number, slideNo: number): Block[] {
  const counters: number[] = [];
  return paras.map((p): BlockPara => {
    const inlines: Inline[] = [];
    for (const r of p.runs) {
      if (r.br) {
        inlines.push({ kind: "br" });
        continue;
      }
      const text = r.field === "slidenum" ? String(slideNo) : r.text;
      if (!text) continue;
      inlines.push({
        kind: "text",
        text,
        style: {
          bold: !!r.bold,
          italic: !!r.italic,
          underline: !!r.underline,
          strike: !!r.strike,
          color: r.color,
          size: Math.max(3, (r.size ?? p.endSize ?? DEFAULT_SIZE) * scale),
          family: r.family,
          href: r.href,
        },
      });
    }
    let marker: BlockPara["marker"];
    if (p.bullet && inlines.length) {
      counters.length = p.level + 1;
      counters[p.level] = (counters[p.level] ?? 0) + 1;
      marker = { label: p.bullet.kind === "num" ? `${counters[p.level]}.` : /^[ -ÿ•–—]$/.test(p.bullet.ch) ? p.bullet.ch : "•", level: p.level, base: 18, step: 18 };
    } else counters.length = 0;
    const size = (p.endSize ?? DEFAULT_SIZE) * scale;
    return {
      kind: "para",
      inlines,
      align: p.align ?? "left",
      heading: 0,
      indent: 0,
      marker,
      spacing: {
        before: (p.before ?? 0) * scale,
        after: (p.after ?? 0) * scale,
        ...(p.lineMult ? { line: { kind: "mult" as const, v: p.lineMult } } : {}),
      },
      base: { size },
    };
  });
}

interface Flowed {
  cmds: Cmd[];
  height: number;
}

function flowText(paras: Para[], width: number, scale: number, slideNo: number, measure: Measurer, lineFactor: (k: FontKey) => number): Flowed {
  const blocks = toBlocks(paras, scale, slideNo);
  const pages = layoutDocument(blocks, { width: Math.max(10, width), height: 100000, margin: { top: 0, right: 0, bottom: 0, left: 0 } }, measure, { lineFactor });
  const cmds = pages[0]?.cmds ?? [];
  let h = 0;
  for (const c of cmds) if (c.t === "text") h = Math.max(h, c.y + c.size * 0.28);
  return { cmds, height: h };
}

const shift = (c: Cmd, dx: number, dy: number): Cmd =>
  c.t === "line" ? { ...c, x1: c.x1 + dx, x2: c.x2 + dx, y1: c.y1 + dy, y2: c.y2 + dy } : { ...c, x: c.x + dx, y: c.y + dy };

const f = (n: number) => Math.round(n * 100) / 100;

function shapePath(op: Extract<Op, { k: "shape" }>): string | undefined {
  const { x, y, w, h } = op.box;
  switch (op.geom) {
    case "rect":
    case "flowChartProcess":
      return undefined; // drawn as a plain rectangle
    case "ellipse":
    case "flowChartConnector": {
      const rx = w / 2, ry = h / 2;
      return `M ${f(x)} ${f(y + ry)} a ${f(rx)} ${f(ry)} 0 1 0 ${f(w)} 0 a ${f(rx)} ${f(ry)} 0 1 0 ${f(-w)} 0 Z`;
    }
    case "roundRect":
    case "flowChartAlternateProcess": {
      const r = Math.min(w, h) * Math.min(0.5, (op.adj ?? 16667) / 100000);
      return `M ${f(x + r)} ${f(y)} H ${f(x + w - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)} V ${f(y + h - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)} H ${f(x + r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)} V ${f(y + r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)} Z`;
    }
    case "triangle":
      return `M ${f(x + w / 2)} ${f(op.flipV ? y + h : y)} L ${f(x + w)} ${f(op.flipV ? y : y + h)} L ${f(x)} ${f(op.flipV ? y : y + h)} Z`;
    case "rtTriangle":
      return `M ${f(x)} ${f(y)} L ${f(x + w)} ${f(y + h)} L ${f(x)} ${f(y + h)} Z`;
    case "diamond":
    case "flowChartDecision":
      return `M ${f(x + w / 2)} ${f(y)} L ${f(x + w)} ${f(y + h / 2)} L ${f(x + w / 2)} ${f(y + h)} L ${f(x)} ${f(y + h / 2)} Z`;
    case "hexagon": {
      const d = w * 0.25;
      return `M ${f(x + d)} ${f(y)} L ${f(x + w - d)} ${f(y)} L ${f(x + w)} ${f(y + h / 2)} L ${f(x + w - d)} ${f(y + h)} L ${f(x + d)} ${f(y + h)} L ${f(x)} ${f(y + h / 2)} Z`;
    }
    case "parallelogram": {
      const d = w * 0.2;
      return `M ${f(x + d)} ${f(y)} L ${f(x + w)} ${f(y)} L ${f(x + w - d)} ${f(y + h)} L ${f(x)} ${f(y + h)} Z`;
    }
    case "rightArrow": {
      const hd = Math.min(h, w) * 0.5;
      const t = h * 0.25;
      return `M ${f(x)} ${f(y + t)} L ${f(x + w - hd)} ${f(y + t)} L ${f(x + w - hd)} ${f(y)} L ${f(x + w)} ${f(y + h / 2)} L ${f(x + w - hd)} ${f(y + h)} L ${f(x + w - hd)} ${f(y + h - t)} L ${f(x)} ${f(y + h - t)} Z`;
    }
    default:
      return undefined;
  }
}

export async function convertPptxToPdf(
  input: ArrayBuffer | Uint8Array,
  opts: PptxOptions = {},
): Promise<PptxResult> {
  const warnings: string[] = [];
  let slides = await parsePptx(input, warnings);
  if (!opts.includeHidden) {
    const visible = slides.filter((s) => !s.hidden);
    if (visible.length) slides = visible;
  }

  const doc = await PDFDocument.create();
  doc.setProducer("iHateUpload");
  doc.setCreator("iHateUpload");
  const images = new Map<Uint8Array, PDFImage>();
  const rasterise = opts.rasterise ?? browserRasterise;
  let dropped = 0;
  for (const s of slides) {
    for (const op of [...s.ops]) {
      if (op.k !== "pic") continue;
      const e = await embedImage(doc, op.data, op.mime, rasterise);
      if (e) {
        images.set(e.bytes, e.img);
        op.data = e.bytes;
      } else {
        dropped++;
        s.ops.splice(s.ops.indexOf(op), 1);
      }
    }
  }
  if (dropped) warnings.push(`${dropped} picture${dropped === 1 ? "" : "s"} in a format PDF cannot embed were skipped.`);

  const build = (measure: Measurer, lineFactor: (k: FontKey) => number): OutPage[] =>
    slides.map((s, si) => {
      const cmds: Cmd[] = [];
      const text = (paras: Para[], box: Box, inset: [number, number, number, number], anchor: "t" | "ctr" | "b", scale0: number, fit: boolean) => {
        const [l, t, r, b] = inset;
        const aw = box.w - l - r;
        const ah = box.h - t - b;
        let scale = scale0;
        let fl = flowText(paras, aw, scale, si + 1, measure, lineFactor);
        if (fit && scale0 === 1 && fl.height > ah * 1.02 && ah > 0) {
          scale = Math.max(0.55, ah / fl.height);
          fl = flowText(paras, aw, scale, si + 1, measure, lineFactor);
        }
        const dy = anchor === "ctr" ? Math.max(0, (ah - fl.height) / 2) : anchor === "b" ? Math.max(0, ah - fl.height) : 0;
        for (const c of fl.cmds) cmds.push(shift(c, box.x + l, box.y + t + dy));
      };
      for (const op of s.ops) {
        if (op.k === "shape") {
          const path = shapePath(op);
          if (path) cmds.push({ t: "shape", x: 0, y: 0, path, fill: op.fill, stroke: op.line?.color, strokeWidth: op.line?.w });
          else cmds.push({ t: "rect", x: op.box.x, y: op.box.y, w: op.box.w, h: op.box.h, fill: op.fill, stroke: op.line?.color, strokeWidth: op.line?.w });
        } else if (op.k === "line") {
          cmds.push({ t: "line", x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2, width: op.w, color: op.color });
        } else if (op.k === "pic") {
          cmds.push({ t: "image", x: op.box.x, y: op.box.y, w: op.box.w, h: op.box.h, data: op.data, mime: op.mime });
        } else if (op.k === "text") {
          text(op.paras, op.box, op.inset, op.anchor, op.scale, !!op.fit);
        } else if (op.k === "table") {
          let y = op.box.y;
          for (const row of op.rows) {
            let x = op.box.x;
            let ci = 0;
            for (const cell of row.cells) {
              const w = op.cols.slice(ci, ci + cell.span).reduce((a, b) => a + b, 0) || op.cols[ci] || 50;
              if (cell.fill) cmds.push({ t: "rect", x, y, w, h: row.h, fill: cell.fill });
              cmds.push({ t: "rect", x, y, w, h: row.h, stroke: "BFBFBF", strokeWidth: 0.5 });
              text(cell.paras, { x, y, w, h: row.h }, [5.4, 3.6, 5.4, 3.6], "t", 1, false);
              x += w;
              ci += cell.span;
            }
            y += row.h;
          }
        }
      }
      return { width: s.width, height: s.height, cmds, bg: s.bg };
    });

  const out = await renderPages(doc, build, images, opts, warnings, [720, 540]);
  return { bytes: out.bytes, pageCount: out.pageCount, warnings };
}
