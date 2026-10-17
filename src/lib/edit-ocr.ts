import {
  OCR_RECOGNIZE_OUTPUT,
  wordsFromOcrBlocks,
  type OcrWord,
} from "@/lib/ocr-words";

type TessWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

let workerPromise: Promise<TessWorker> | null = null;

export async function recognizePageWords(image: Blob): Promise<OcrWord[]> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(({ createWorker }) =>
      createWorker("eng"),
    );
  }
  const worker = await workerPromise;
  const recognized = await worker.recognize(
    image,
    {},
    { ...OCR_RECOGNIZE_OUTPUT, pdf: false },
  );
  return wordsFromOcrBlocks(
    recognized.data.blocks as Parameters<typeof wordsFromOcrBlocks>[0],
  );
}
