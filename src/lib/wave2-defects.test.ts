import { expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as XLSX from "xlsx";

import type { FileItem } from "./job";
import { processExcelToPdf, processHeaderFooter } from "./extra-processors";
import { processProtectPdf } from "./processors";
import { initialOptions } from "./tool-options";

async function pdfItem(name: string, pages = 1): Promise<FileItem> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([400, 500]);
  const file = new File([await doc.save()], name, { type: "application/pdf" });
  return { id: "a", name, size: file.size, file };
}

async function pageTexts(blob: Blob, password?: string) {
  const pdf = await getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    password,
  }).promise;
  const out: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    out.push((content.items as { str: string }[]).map((i) => i.str).join(" "));
  }
  return { out, pdf };
}

test("protect allows printing, copying and editing once opened (/P -4)", async () => {
  const [result] = await processProtectPdf([await pdfItem("a.pdf")], () => {}, {
    kind: "password-confirm",
    password: "s3cret",
    confirm: "s3cret",
  } as never);
  const bytes = new TextDecoder("latin1").decode(
    new Uint8Array(await result.blob.arrayBuffer()),
  );
  expect(bytes).toMatch(/\/P -4\b/);
  const { pdf } = await pageTexts(result.blob, "s3cret");
  const perms = await pdf.getPermissions();
  expect(perms === null || perms.length >= 8).toBe(true);
});

test("header-footer expands {filename} and {time}", async () => {
  const [result] = await processHeaderFooter(
    [await pdfItem("quarterly-report.pdf", 2)],
    () => {},
    {
      ...initialOptions("header-footer"),
      left: "{filename}",
      center: "{page} of {pages}",
      right: "{time}",
    } as never,
  );
  const { out } = await pageTexts(result.blob);
  expect(out[1]).toContain("quarterly-report");
  expect(out[1]).toContain("2 of 2");
  expect(out.join(" ")).not.toContain("{");
  expect(out[0]).toMatch(/\d{1,2}:\d{2}/);
});

test("excel to pdf keeps every sheet and every row", async () => {
  const wb = XLSX.utils.book_new();
  const rows = Array.from({ length: 120 }, (_, i) => [`Item ${i + 1}`, i * 3]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name", "Qty"], ...rows]), "Stock");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Region", "Sales"], ["North", 42]]), "Regions");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const file = new File([buf], "book.xlsx");
  const [result] = await processExcelToPdf(
    [{ id: "x", name: "book.xlsx", size: file.size, file }],
    () => {},
  );
  const { out } = await pageTexts(result.blob);
  const all = out.join(" ");
  expect(all).toContain("Item 120");
  expect(all).toContain("Regions");
  expect(all).toContain("North");
});
