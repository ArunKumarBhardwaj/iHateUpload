import { PDFDocument, degrees } from "@cantoo/pdf-lib";

import { normaliseTurn } from "./geometry";
import type { OrganizeEntry } from "./types";

/**
 * Builds a new document from the entries, in order. A page used twice is
 * copied twice, so each copy can be turned on its own. Blank pages take the
 * size of the page before them (or the one after, at the start).
 */
export async function buildOrganized(
  donor: PDFDocument,
  entries: OrganizeEntry[],
  onProgress?: (ratio: number) => void,
): Promise<PDFDocument> {
  const count = donor.getPageCount();
  for (const entry of entries) {
    if (entry.src >= count || entry.src < -1) {
      throw new Error("Page order includes an invalid page.");
    }
  }
  const out = await PDFDocument.create();
  let last: [number, number] | null = null;
  const firstReal = entries.find((e) => e.src >= 0);
  const fallback: [number, number] = firstReal
    ? [donor.getPage(firstReal.src).getWidth(), donor.getPage(firstReal.src).getHeight()]
    : [595.28, 841.89];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.src < 0) {
      out.addPage(last ?? fallback);
    } else {
      const [page] = await out.copyPages(donor, [entry.src]);
      if (entry.turn) {
        page.setRotation(
          degrees(normaliseTurn(page.getRotation().angle + entry.turn)),
        );
      }
      out.addPage(page);
      last = [page.getWidth(), page.getHeight()];
    }
    onProgress?.((i + 1) / entries.length);
  }
  return out;
}
