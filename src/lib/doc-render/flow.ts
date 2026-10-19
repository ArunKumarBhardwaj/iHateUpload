/** Flow documents (Markdown, HTML, CSV, Excel) -> PDF through the shared layout engine. */
import { PDFDocument } from "@cantoo/pdf-lib";

import { layoutDocument, type Cmd, type LaidOutPage } from "../word-to-pdf/layout";
import type { Block } from "../word-to-pdf/model";
import type { PageSpec } from "../word-to-pdf/page";
import { embedBlockImages, renderPages, type EngineOptions } from "./engine";

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

export async function renderFlow(blocks: Block[], spec: PageSpec, opts: FlowOptions = {}): Promise<FlowResult> {
  const warnings: string[] = [];
  const doc = await PDFDocument.create();
  doc.setProducer("iHateUpload");
  doc.setCreator("iHateUpload");
  if (opts.title) doc.setTitle(opts.title);
  const images = await embedBlockImages(doc, blocks, opts, warnings);
  const out = await renderPages(
    doc,
    (measure, lineFactor) => {
      let pages = layoutDocument(blocks, spec, measure, { lineFactor });
      for (let i = 0; i < 3 && opts.refine?.(pages); i++) pages = layoutDocument(blocks, spec, measure, { lineFactor });
      const total = pages.length;
      return pages.map((p, i) => {
        const cmds: Cmd[] = p.cmds;
        const f = opts.footer;
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
        return { width: spec.width, height: spec.height, cmds };
      });
    },
    images,
    opts,
    warnings,
    [spec.width, spec.height],
  );
  return { bytes: out.bytes, pageCount: out.pageCount, warnings };
}
