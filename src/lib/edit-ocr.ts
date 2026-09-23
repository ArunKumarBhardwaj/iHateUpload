import { wordsFromOcrBlocks, type OcrWord } from "@/lib/ocr-words";

type TessWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

let workerPromise: Promise<TessWorker> | null = null;

function tessWords(
  words: Array<{ text?: string; bbox: OcrWord["bbox"] }> | undefined,
): OcrWord[] {
  if (!words) return [];
  const out: OcrWord[] = [];
  for (const word of words) {
    const text = word.text?.trim() ?? "";
    if (!text) continue;
    out.push({ text, bbox: word.bbox });
  }
  return out;
}

export async function recognizePageWords(image: Blob): Promise<OcrWord[]> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(({ createWorker }) =>
      createWorker("eng"),
    );
  }
  const worker = await workerPromise;
  const recognized = await worker.recognize(image);
  const fromBlocks = wordsFromOcrBlocks(
    recognized.data.blocks as Parameters<typeof wordsFromOcrBlocks>[0],
  );
  if (fromBlocks.length > 0) return fromBlocks;
  return tessWords(recognized.data.words);
}
