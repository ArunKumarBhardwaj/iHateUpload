import { expect, test } from "bun:test";
import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

import { DAMAGES, RECOVERABLE, buildDamaged, buildHealthy } from "./fixtures";
import { diagnose, repairPdf, reportLine } from "./repair";

const open = (bytes: Uint8Array) => getDocument({ data: bytes, verbosity: VerbosityLevel.ERRORS }).promise;

async function markers(bytes: Uint8Array) {
  const doc = await open(bytes.slice());
  let found = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const text = (await (await doc.getPage(n)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    found += (text.match(/PAGE-\d-MARKER/g) ?? []).length;
  }
  await doc.loadingTask.destroy();
  return found;
}

for (const damage of DAMAGES) {
  test(`recovers every surviving page: ${damage}`, async () => {
    const { bytes, report } = await repairPdf(await buildDamaged(damage), open);
    expect(report.healthy).toBe(false);
    expect(report.problems.length).toBeGreaterThan(0);
    expect(await markers(bytes)).toBe(RECOVERABLE[damage]);
    // The output is a clean file: strict pdf-lib load, no leftover junk before the header.
    await PDFDocument.load(bytes, { throwOnInvalidObject: true });
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe("%PDF-");
    expect(reportLine(report)).toMatch(/recovered/);
  });
}

test("a truncated file drops only the cut-off pages and says so", async () => {
  const { report } = await repairPdf(await buildDamaged("truncated"), open);
  expect(report.method).toBe("salvage");
  expect(report.pagesBefore).toBeNull();
  expect(report.pagesAfter).toBe(3);
  expect(report.droppedPages).toBe(2);
  expect(reportLine(report)).toContain("2 cut-off pages were left out");
});

test("a broken index keeps bookmarks and metadata (structure-keeping route wins ties)", async () => {
  const { bytes, report } = await repairPdf(await buildDamaged("xref-offsets"), open);
  expect(report.method).toBe("resave");
  const doc = await PDFDocument.load(bytes);
  expect(doc.catalog.get(PDFName.of("Outlines"))).toBeDefined();
  expect(doc.getTitle()).toBe("Synthetic repair sample");
});

test("a healthy file is reported healthy and comes back whole", async () => {
  const { bytes, report } = await repairPdf(await buildHealthy(), open);
  expect(report.healthy).toBe(true);
  expect(report.problems).toEqual([]);
  expect(await markers(bytes)).toBe(5);
  expect(reportLine(report)).toContain("No damage found");
});

test("a page whose content was wiped is named in the report", async () => {
  const { report } = await repairPdf(await buildDamaged("zeroed-block"), open);
  expect(report.problems[0]).toBe("The content of page 3 is damaged and cannot be drawn.");
});

test("diagnose names the damage in plain words", async () => {
  expect(diagnose(await buildDamaged("junk-header"))[0]).toMatch(/bytes of junk before the PDF starts/);
  expect(diagnose(await buildDamaged("missing-eof")).join(" ")).toMatch(/end of the file is missing/);
  expect(diagnose(await buildDamaged("no-catalog")).join(" ")).toMatch(/catalog/);
  expect(diagnose(await buildDamaged("xref-offsets")).join(" ")).toMatch(/cross-reference entries point to the wrong place/);
});

test("something that is not a PDF fails with a clear message", async () => {
  const junk = new TextEncoder().encode("this is not a pdf at all ".repeat(50));
  await expect(repairPdf(junk, open)).rejects.toThrow(/too damaged to rebuild/);
});
