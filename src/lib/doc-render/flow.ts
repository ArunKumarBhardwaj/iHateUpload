/** Flow documents (Markdown, HTML, CSV, Excel) -> PDF through the shared layout engine. */
import { PDFDocument } from "@cantoo/pdf-lib";

import { layoutDocument, type Cmd, type LaidOutPage } from "../word-to-pdf/layout";
import type { Block } from "../word-to-pdf/model";
import type { PageSpec } from "../word-to-pdf/page";
import { embedBlockImages, renderPages, type EngineOptions } from "./engine";
import { isKrutiDevFont, krutiToUnicode } from "./krutidev";
import { legacyFontOf, toUnicode, type LegacyFont } from "./legacy-fonts";

export interface FooterSpec {
  /** printed at the left of every page, e.g. the sheet name or file name */
  text?: string;
  pageNumbers?: boolean;
}

export interface FlowOptions extends EngineOptions {
  footer?: FooterSpec;
  /** Called after each layout with the laid-out pages; mutate blocks and return true to lay out again. */
  refine?: (pages: LaidOutPage[]) => boolean;
  title?: string;
}

export interface FlowResult {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
}

export const PAPER: Record<string, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  a3: { width: 841.89, height: 1190.55 },
};

/** Page spec from a paper name, orientation and a margin in points. */
export function pageSpec(paper: string, landscape: boolean, margin: number): PageSpec {
  const p = PAPER[paper] ?? PAPER.a4;
  const [width, height] = landscape ? [p.height, p.width] : [p.width, p.height];
  return { width, height, margin: { top: margin, right: margin, bottom: margin, left: margin } };
}

const FOOT_SIZE = 8;
const FOOT_COLOR = "6B7280";

/** One part of a document with its own page size (a workbook's sheets each have their own setup). */
export interface FlowSection {
  blocks: Block[];
  spec: PageSpec;
  /** Excel header and footer codes, drawn at these distances from the page edge (points) */
  header?: { code: string; at: number };
  footer?: { code: string; at: number };
  /** what &A (sheet name) prints */
  name?: string;
}

export async function renderFlow(blocks: Block[], spec: PageSpec, opts: FlowOptions = {}): Promise<FlowResult> {
  return renderSections([{ blocks, spec }], opts);
}

export async function renderSections(sections: FlowSection[], opts: FlowOptions = {}): Promise<FlowResult> {
  const warnings: string[] = [];
  const doc = await PDFDocument.create();
  doc.setProducer("iHateUpload");
  doc.setCreator("iHateUpload");
  if (opts.title) doc.setTitle(opts.title);
  const images = await embedBlockImages(doc, sections.flatMap((s) => s.blocks), opts, warnings);
  const now = new Date();
  const first = sections[0]?.spec ?? { width: 595.28, height: 841.89 };
  const out = await renderPages(
    doc,
    (measure, lineFactor) => {
      const laid = sections.map((sec) => {
        let pages = layoutDocument(sec.blocks, sec.spec, measure, { lineFactor });
        for (let i = 0; i < 3 && opts.refine?.(pages); i++) pages = layoutDocument(sec.blocks, sec.spec, measure, { lineFactor });
        return { sec, pages };
      });
      const total = laid.reduce((n, l) => n + l.pages.length, 0);
      let n = 0;
      return laid.flatMap(({ sec, pages }) =>
        pages.map((p) => {
          const spec = sec.spec;
          const i = n++;
          const cmds: Cmd[] = p.cmds;
          // a sheet's own footer takes the place of the app's
          const f = sec.footer?.code ? undefined : opts.footer;
          if (f && (f.text || f.pageNumbers)) {
            const key = { family: "sans" as const, bold: false, italic: false };
            const y = spec.height - Math.max(12, spec.margin.bottom / 2) + FOOT_SIZE / 2;
            const base = { t: "text" as const, y, size: FOOT_SIZE, family: "sans" as const, bold: false, italic: false, color: FOOT_COLOR, underline: false, strike: false };
            if (f.text) cmds.push({ ...base, x: spec.margin.left, text: f.text.slice(0, 120) });
            if (f.pageNumbers) {
              const label = `Page ${i + 1} of ${total}`;
              cmds.push({ ...base, x: spec.width - spec.margin.right - measure(label, key, FOOT_SIZE), text: label });
            }
          }
          const fields = { page: i + 1, pages: total, now, file: opts.title ?? "", sheet: sec.name ?? "" };
          for (const [hf, top] of [
            [sec.header, true],
            [sec.footer, false],
          ] as const) {
            if (hf?.code) cmds.push(...headerFooterCmds(hf.code, hf.at, top, spec, fields, measure));
          }
          return { width: spec.width, height: spec.height, cmds };
        }),
      );
    },
    images,
    opts,
    warnings,
    [first.width, first.height],
  );
  return { bytes: out.bytes, pageCount: out.pageCount, warnings };
}

interface HfFields {
  page: number;
  pages: number;
  now: Date;
  file: string;
  sheet: string;
}

/**
 * An Excel header or footer: "&L", "&C" and "&R" start the left, centre and right parts (centre when
 * none is given); &P, &N, &D, &T, &F and &A are fields; &"Font,Bold Italic", &12, &B, &I, &U and &S
 * set the look. Pictures (&G) and colours are left out.
 */
export function headerFooterCmds(
  code: string,
  at: number,
  top: boolean,
  spec: PageSpec,
  f: HfFields,
  measure: (text: string, key: { family: "sans"; bold: boolean; italic: boolean }, size: number) => number,
): Cmd[] {
  // text after a legacy-font code (&"Kruti Dev 010") is typed in that font: kept apart to convert it
  type Part = { text: string; size: number; bold: boolean; italic: boolean; underline: boolean; strike: boolean; legacy?: (t: string) => string; raw?: string };
  const parts: Record<"L" | "C" | "R", Part> = {
    L: { text: "", size: 11, bold: false, italic: false, underline: false, strike: false },
    C: { text: "", size: 11, bold: false, italic: false, underline: false, strike: false },
    R: { text: "", size: 11, bold: false, italic: false, underline: false, strike: false },
  };
  let cur = parts.C;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch !== "&") {
      if (cur.legacy) cur.raw = (cur.raw ?? "") + ch;
      else cur.text += ch;
      continue;
    }
    const k = code[++i];
    if (k === undefined) break;
    // "&&" is a literal ampersand (in Kruti Dev, a hyphen)
    if (k === "&") {
      if (cur.legacy) cur.raw = `${cur.raw ?? ""}&`;
      else cur.text += "&";
      continue;
    }
    // a field or a new font ends a run typed in a legacy font
    if (cur.legacy && cur.raw) {
      cur.text += cur.legacy(cur.raw);
      cur.raw = "";
    }
    if (k === "L" || k === "C" || k === "R") cur = parts[k];
    else if (k === "P") cur.text += String(f.page);
    else if (k === "N") cur.text += String(f.pages);
    else if (k === "D") cur.text += f.now.toLocaleDateString("en-IN");
    else if (k === "T") cur.text += f.now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    else if (k === "F") cur.text += f.file;
    else if (k === "A") cur.text += f.sheet;
    else if (k === "B") cur.bold = !cur.bold;
    else if (k === "I") cur.italic = !cur.italic;
    else if (k === "U" || k === "E") cur.underline = !cur.underline;
    else if (k === "S") cur.strike = !cur.strike;
    else if (k === "K") i += /^[0-9A-Fa-f]{6}/.test(code.slice(i + 1, i + 7)) ? 6 : /^[0-9A-Fa-f]{2}[+-]\d{3}/.test(code.slice(i + 1, i + 7)) ? 6 : 0;
    else if (k === '"') {
      const end = code.indexOf('"', i + 1);
      const font = code.slice(i + 1, end < 0 ? code.length : end);
      const style = font.split(",")[1] ?? "";
      const name = font.split(",")[0];
      cur.legacy = isKrutiDevFont(name) ? krutiToUnicode : legacyFontOf(name) ? (t) => toUnicode(legacyFontOf(name) as LegacyFont, t) : undefined;
      if (style) {
        cur.bold = /bold/i.test(style);
        cur.italic = /italic|oblique/i.test(style);
      }
      i = end < 0 ? code.length : end;
    } else if (/\d/.test(k)) {
      let num = k;
      while (/\d/.test(code[i + 1] ?? "")) num += code[++i];
      const size = Number(num);
      if (size > 0 && size < 200) cur.size = size;
    }
    // anything else (&G pictures, &Z path, &X/&Y super/subscript, &O/&H outline/shadow) is left out
  }
  for (const p of Object.values(parts)) if (p.legacy && p.raw) p.text += p.legacy(p.raw);
  const cmds: Cmd[] = [];
  (["L", "C", "R"] as const).forEach((side) => {
    const p = parts[side];
    // several lines are allowed; each prints under the one before
    const lines = p.text.split(/\r?\n/).filter((l, idx, all) => l.trim() || idx < all.length - 1);
    const lineH = p.size * 1.2;
    lines.forEach((line, li) => {
      if (!line.trim()) return;
      const key = { family: "sans" as const, bold: p.bold, italic: p.italic };
      const w = measure(line, key, p.size);
      const x = side === "L" ? spec.margin.left : side === "R" ? spec.width - spec.margin.right - w : (spec.width - w) / 2;
      const y = top ? at + p.size * 0.8 + li * lineH : spec.height - at - (lines.length - 1 - li) * lineH - p.size * 0.2;
      cmds.push({ t: "text", x, y, text: line, size: p.size, family: "sans", bold: p.bold, italic: p.italic, underline: p.underline, strike: p.strike });
    });
  });
  return cmds;
}
