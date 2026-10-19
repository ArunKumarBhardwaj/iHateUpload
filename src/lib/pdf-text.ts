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
      const text = itemsToLines(content.items);
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

export function itemsToLines(items: unknown[]): string {
  const lines: { y: number; parts: string[] }[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const str = typeof item.str === "string" ? item.str : "";
    if (!str) continue;
    const y =
      "transform" in item && Array.isArray(item.transform)
        ? Math.round(Number(item.transform[5]) || 0)
        : 0;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) <= 2) {
      last.parts.push(str);
    } else {
      lines.push({ y, parts: [str] });
    }
  }
  return lines.map((line) => line.parts.join(" ")).join("\n");
}
