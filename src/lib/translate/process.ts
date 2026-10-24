import { batchBaseNames } from "@/lib/batch";
import { AskError } from "@/lib/ask/gemini";
import type { FileItem, ResultItem } from "@/lib/job";
import type { ConvertDeps } from "@/lib/pdf-to-word";
import { createPageReader, type PageReader } from "@/lib/pdf-to-word/ocr";
import { rasterizeImage, renderPageCanvas } from "@/lib/pdf-to-word/raster";
import { loadPdfJs } from "@/lib/pdfjs";
import { resolvePageRange, type ToolOptions } from "@/lib/tool-options";

import { SERVER_DOC_CHARS, translateDirect, translateViaServer } from "./gemini-translate";
import { targetLanguage } from "./languages";
import { translatePdf } from "./translate";

const loadFont = async (file: string) => {
  const res = await fetch(`/fonts/${file}`);
  if (!res.ok) throw new Error(`Could not load the font ${file}.`);
  return new Uint8Array(await res.arrayBuffer());
};

/** A batch the model answered badly is split in two and tried again, down to single texts. */
function withSplitting(call: (texts: string[]) => Promise<string[]>) {
  const run = async (texts: string[]): Promise<string[]> => {
    try {
      return await call(texts);
    } catch (error) {
      const status = error instanceof AskError ? error.status : 0;
      if (texts.length < 2 || status !== 502) throw error;
      const half = Math.ceil(texts.length / 2);
      return [...(await run(texts.slice(0, half))), ...(await run(texts.slice(half)))];
    }
  };
  return run;
}

export async function processTranslatePdf(
  files: FileItem[],
  onProgress: (ratio: number) => void,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "translate") throw new Error("Translate PDF needs a language.");
  if (files.length === 0) throw new Error("Choose a PDF to translate.");
  const language = targetLanguage(options.target);
  const own = options.mode === "own";
  if (own && !options.key.trim()) throw new Error("Paste your Gemini API key, or switch to our server.");
  const pdfjs = await loadPdfJs();
  const bases = batchBaseNames(files.map((f) => f.name));
  const results: ResultItem[] = [];

  for (let index = 0; index < files.length; index++) {
    const item = files[index];
    const report = (r: number) => onProgress(Math.min(0.99, (index + r) / files.length));
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const open = async (data: Uint8Array) => {
      try {
        return await pdfjs.getDocument({ data: data.slice(), fontExtraProperties: true }).promise;
      } catch (error) {
        if ((error as { name?: string }).name === "PasswordException") throw new Error(`${item.name} is locked. Unlock it first, then translate.`);
        throw new Error(`${item.name} could not be opened as a PDF. Try Repair PDF first.`);
      }
    };
    const probe = await open(bytes);
    const count = probe.numPages;
    await probe.loadingTask.destroy();
    let reader: PageReader | null = null;
    let onPage: (r: number) => void = () => {};
    const deps: ConvertDeps = {
      OPS: pdfjs.OPS as unknown as Record<string, number>,
      rasterizeImage,
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
    let sent = 0;
    const call = withSplitting(async (texts) => {
      if (!own) {
        sent += texts.reduce((n, t) => n + t.length, 0);
        if (sent > SERVER_DOC_CHARS) {
          throw new Error(`${item.name} has more text than our shared key translates in one go. Pick fewer pages, or use your own Gemini key.`);
        }
      }
      return own ? translateDirect(options.key, language.code, texts) : translateViaServer(language.code, texts);
    });
    try {
      const result = await translatePdf(bytes, {
        deps,
        loadFont,
        script: language.script,
        translate: call,
        onProgress: report,
        open,
        pages: resolvePageRange(options.range, count).map((i) => i + 1),
      });
      const blob = new Blob([result.bytes.buffer as ArrayBuffer], { type: "application/pdf" });
      results.push({
        id: crypto.randomUUID(),
        name: `${bases[index]}-${language.code}.pdf`,
        size: blob.size,
        blob,
        originalSize: item.size,
        note: [`${result.units} passage${result.units === 1 ? "" : "s"} translated into ${language.name} by Gemini.`, ...result.notes].join(" "),
      });
    } finally {
      const r = reader as PageReader | null;
      if (r) await r.close();
    }
    report(1);
  }
  return results;
}
