/** Markdown, Excel, CSV and HTML to PDF: read the file, build blocks, lay out, draw selectable text. */
import type { FileItem, ResultItem } from "@/lib/job";
import type { ToolOptions } from "@/lib/tool-options";

import { workbookGrids } from "./excel";
import { sheetPageSpec, sheetToBlocks } from "./excel-layout";
import { pageSpec, renderFlow, renderSections, type FlowOptions, type FlowSection } from "./flow";
import { markdownToDoc } from "./markdown";
import { findMathSpans } from "./math-art";
import { MARGIN_PT, type DocConvertOptions } from "./options";
import { csvToGridView, gridToBlocks } from "./tables";
import type { Block } from "../word-to-pdf/model";
import type { LaidOutPage } from "../word-to-pdf/layout";

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

export interface DocOutput {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
}

/** Convert one file's text or bytes. Exposed for tests; the UI goes through processDocToPdf. */
export async function convertDoc(
  name: string,
  data: { text: () => Promise<string>; bytes: () => Promise<ArrayBuffer> },
  o: DocConvertOptions,
  engine: Pick<FlowOptions, "loadFont" | "rasterise"> = {},
): Promise<DocOutput> {
  const spec = pageSpec(o.paper, o.landscape, MARGIN_PT[o.margin]);
  const width = spec.width - spec.margin.left - spec.margin.right;
  let blocks: Block[] = [];
  let refine: ((pages: LaidOutPage[]) => boolean) | undefined;
  let footer: FlowOptions["footer"];
  const title = stem(name);

  if (o.src === "pptx") {
    const { convertPptxToPdf } = await import("./pptx");
    return convertPptxToPdf(await data.bytes(), { ...engine, includeHidden: o.hiddenSlides });
  }

  if (o.src === "markdown") {
    const text = await data.text();
    let mathArt: Awaited<ReturnType<typeof import("./math").renderMath>> | undefined;
    if (o.math) {
      const spans = findMathSpans(text);
      if (spans.length) mathArt = await (await import("./math")).renderMath(spans);
    }
    const doc = markdownToDoc(text, { ...o, mathArt });
    blocks = doc.blocks;
    refine = doc.refine as typeof refine;
    footer = { pageNumbers: true };
  } else if (o.src === "csv") {
    blocks = gridToBlocks(csvToGridView(await data.text(), { sort: o.csvSort, filter: o.csvFilter, hidden: o.csvHidden }), {
      fontSize: 9,
      zebra: o.zebra,
      width,
      fit: "wrap",
      title: o.title ? title : undefined,
    });
    footer = o.footer ? { text: name, pageNumbers: true } : undefined;
  } else if (o.src === "excel") {
    const { sheets } = await workbookGrids(await data.bytes());
    const chosen = o.sheets.length ? sheets.filter((s) => o.sheets.includes(s.name)) : sheets;
    if (!chosen.length) throw new Error("This workbook has no sheets to print.");
    if ((o.excelLayout ?? "workbook") === "workbook") {
      // each sheet prints with its own page setup, header and footer
      // empty sheets print nothing, as when Excel prints a whole workbook
      const printable = chosen.filter((s) => s.grid.rows.some((r) => r.some((c) => c.text || c.style?.fill || c.style?.border)) || s.grid.sheet?.pictures.length);
      const sections: FlowSection[] = (printable.length ? printable : chosen.slice(0, 1)).map((s) => {
        const setup = s.grid.sheet?.setup ?? {};
        const sheetSpec = sheetPageSpec(setup);
        const inch = (v: number | undefined, d: number) => Math.max(0, Math.min(v ?? d, 4)) * 72;
        return {
          blocks: sheetToBlocks(s.grid, sheetSpec, o.title ? s.name : undefined),
          spec: sheetSpec,
          header: setup.header ? { code: setup.header, at: inch(setup.headerMargin, 0.3) } : undefined,
          footer: setup.footer ? { code: setup.footer, at: inch(setup.footerMargin, 0.3) } : undefined,
          name: s.name,
        };
      });
      footer = o.footer ? { text: name, pageNumbers: true } : undefined;
      return renderSections(sections, { ...engine, footer, refine, title });
    }
    chosen.forEach((s, i) => {
      if (i) blocks.push({ kind: "pagebreak" });
      blocks.push(
        ...gridToBlocks(s.grid, {
          fontSize: 9,
          zebra: o.zebra,
          width,
          fit: o.fit,
          title: o.title ? s.name : undefined,
        }),
      );
    });
    if (!chosen.length) throw new Error("This workbook has no sheets to print.");
    footer = o.footer ? { text: name, pageNumbers: true } : undefined;
  } else {
    const { htmlToDoc } = await import("./html-doc");
    blocks = (await htmlToDoc(await data.text())).blocks;
    footer = undefined;
  }
  return renderFlow(blocks, spec, { ...engine, footer, refine, title });
}

export async function processDocToPdf(
  files: FileItem[],
  onProgress: (ratio: number) => void,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "convert-doc") throw new Error("Missing conversion settings.");
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const out = await convertDoc(
      item.name,
      { text: () => item.file.text(), bytes: () => item.file.arrayBuffer() },
      options,
    );
    const blob = new Blob([out.bytes.buffer as ArrayBuffer], { type: "application/pdf" });
    results.push({
      id: item.id,
      name: `${stem(item.name)}.pdf`,
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }
  return results;
}
