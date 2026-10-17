import { readFileSync } from "node:fs";
import { join } from "node:path";

export const loadFont = async (file: string) =>
  new Uint8Array(readFileSync(join(process.cwd(), "public/fonts", file)));

export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return pages;
}
