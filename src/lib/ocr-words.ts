export const OCR_RECOGNIZE_OUTPUT = {
  text: true,
  blocks: true,
} as const;

export type OcrBbox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type OcrWord = {
  text: string;
  bbox: OcrBbox;
};

type OcrLine = { words?: Array<{ text?: string; bbox: OcrBbox }> };
type OcrParagraph = { lines?: OcrLine[] };
type OcrBlock = { paragraphs?: OcrParagraph[] };

export function wordsFromOcrBlocks(
  blocks: OcrBlock[] | null | undefined,
): OcrWord[] {
  if (!blocks) return [];
  const words: OcrWord[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text?.trim() ?? "";
          if (!text) continue;
          words.push({ text, bbox: word.bbox });
        }
      }
    }
  }
  return words;
}

/** Helvetica WinAnsi. Drop scripts the standard font cannot draw. */
export function printablePdfText(text: string): string {
  return text.replace(
    /[^\u0009\u000a\u000d\u0020-\u007e\u00a0-\u00ff]/g,
    "",
  );
}

export function ghostTextPlacement(
  bbox: OcrBbox,
  pageWidth: number,
  pageHeight: number,
  renderWidth: number,
  renderHeight: number,
) {
  const scaleX = pageWidth / Math.max(renderWidth, 1);
  const scaleY = pageHeight / Math.max(renderHeight, 1);
  const width = Math.max(8, (bbox.x1 - bbox.x0) * scaleX);
  const size = Math.max(6, (bbox.y1 - bbox.y0) * scaleY * 0.85);
  return {
    x: bbox.x0 * scaleX,
    y: pageHeight - bbox.y1 * scaleY,
    size,
    maxWidth: width,
  };
}
