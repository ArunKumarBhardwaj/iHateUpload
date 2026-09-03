import { loadPdfJs } from "@/lib/pdfjs";

const MAX_CHARS = 120_000;

export async function extractPdfText(file: File): Promise<string> {
  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await getDocument({ data }).promise;
  try {
    const parts: string[] = [];
    let used = 0;
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      const chunk = `\n\n--- Page ${pageNum} ---\n${text}`;
      if (used + chunk.length > MAX_CHARS) {
        parts.push(chunk.slice(0, MAX_CHARS - used));
        break;
      }
      parts.push(chunk);
      used += chunk.length;
      page.cleanup();
    }
    const result = parts.join("").trim();
    if (!result) {
      throw new Error(
        "This PDF has no selectable text. Run OCR PDF first if it is a scan.",
      );
    }
    return result;
  } finally {
    await doc.loadingTask.destroy();
  }
}
