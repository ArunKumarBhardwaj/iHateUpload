import { AskError } from "@/lib/ask/gemini";
import { batchBaseNames } from "@/lib/batch";
import type { FileItem, ResultItem } from "@/lib/job";
import { convertPdfToMarkdown } from "@/lib/pdf-to-markdown/convert";
import type { ConvertDeps } from "@/lib/pdf-to-word";
import { createPageReader, type PageReader } from "@/lib/pdf-to-word/ocr";
import { rasterizeImage, renderPageCanvas } from "@/lib/pdf-to-word/raster";
import { loadPdfJs } from "@/lib/pdfjs";
import { resolvePageRange, type ToolOptions } from "@/lib/tool-options";

import { summarizeDirect, summarizeViaServer } from "./gemini-summary";
import { SERVER_DOC_CHARS, summarizeDocument, summaryMarkdown, type SummaryRequest } from "./summary";

export async function processSummarizePdf(
  files: FileItem[],
  onProgress: (ratio: number) => void,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "summarize") throw new Error("Summarize PDF needs its options.");
  if (files.length === 0) throw new Error("Choose a PDF to summarize.");
  const own = options.mode === "own";
  if (own && !options.key.trim()) throw new Error("Paste your Gemini API key, or switch to our server.");
  const request: SummaryRequest = { length: options.length, language: options.language };
  const pdfjs = await loadPdfJs();
  const bases = batchBaseNames(files.map((f) => f.name));
  const results: ResultItem[] = [];

  for (let index = 0; index < files.length; index++) {
    const item = files[index];
    const report = (r: number) => onProgress(Math.min(0.99, (index + r) / files.length));
    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data: new Uint8Array(await item.file.arrayBuffer()), fontExtraProperties: true }).promise;
    } catch (error) {
      if ((error as { name?: string }).name === "PasswordException") throw new Error(`${item.name} is locked. Unlock it first, then summarize.`);
      throw new Error(`${item.name} could not be opened as a PDF. Try Repair PDF first.`);
    }
    let reader: PageReader | null = null;
    let onPage: (r: number) => void = () => {};
    const deps: ConvertDeps = {
      OPS: pdfjs.OPS as unknown as Record<string, number>,
      rasterizeImage,
      // Scanned pages are read with OCR, so a scan can be summarized too.
      readScan: async (page, _no, progress) => {
        onPage = progress;
        reader ??= await createPageReader("eng", (r) => onPage(r));
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(3, 3600 / Math.max(base.width, base.height));
        const canvas = await renderPageCanvas(page, scale);
        try {
          return await reader.read(canvas, scale, base.height);
        } finally {
          canvas.width = canvas.height = 0;
        }
      },
    };
    try {
      const numbers = resolvePageRange(options.range, pdf.numPages).map((i) => i + 1);
      // Each page on its own, as Markdown, so tables keep their rows and every point can name its page.
      const pages: { page: number; text: string }[] = [];
      for (const [n, page] of numbers.entries()) {
        const md = await convertPdfToMarkdown(pdf as never, item.name, { output: "md", pages: [page] }, deps, (r) =>
          report(((n + r) / numbers.length) * 0.5),
        );
        const text = md.markdown.trim();
        if (text) pages.push({ page, text });
      }
      if (!pages.length) throw new Error(`${item.name} has no text to summarize, even after reading it with OCR.`);
      const chars = pages.reduce((sum, p) => sum + p.text.length, 0);
      if (!own && chars > SERVER_DOC_CHARS) {
        throw new Error(`${item.name} has more text than our shared key summarizes in one go. Pick fewer pages, or use your own Gemini key.`);
      }
      const { summary, parts } = await summarizeDocument(
        pages,
        request,
        async (text, stage) => {
          const call = { text, stage, request };
          return own ? summarizeDirect(options.key, call) : summarizeViaServer(call);
        },
        (r) => report(0.5 + r * 0.5),
      );
      const source = pages.map((p) => p.text).join("\n");
      const { markdown, unchecked } = summaryMarkdown(summary, { file: item.name, pages: numbers.length, length: options.length, source });
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const notes = [
        `${summary.points.length} key point${summary.points.length === 1 ? "" : "s"} from ${numbers.length} page${numbers.length === 1 ? "" : "s"}${parts > 1 ? `, read in ${parts} parts` : ""}.`,
        unchecked.length
          ? `${unchecked.length} figure${unchecked.length === 1 ? " is" : "s are"} not in the PDF and marked ⚠.`
          : "Every figure in the summary was found in the PDF.",
      ];
      results.push({
        id: crypto.randomUUID(),
        name: `${bases[index]}-summary.md`,
        size: blob.size,
        blob,
        originalSize: item.size,
        note: notes.join(" "),
        previewText: markdown,
      });
    } catch (error) {
      if (error instanceof AskError) throw new Error(`${item.name}: ${error.message}`);
      throw error;
    } finally {
      const r = reader as PageReader | null;
      if (r) await r.close();
      await pdf.loadingTask.destroy();
    }
    report(1);
  }
  return results;
}
