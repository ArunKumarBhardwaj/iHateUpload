import { expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { FileItem } from "./job";
import { processProtectPdf } from "./processors";
import { passwordStrength } from "./protect";
import { initialOptions } from "./tool-options";
import { unlockPdfBytes } from "./unlock";

async function item(): Promise<FileItem> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const file = new File([await doc.save()], "a.pdf", { type: "application/pdf" });
  return { id: "a", name: "a.pdf", size: file.size, file };
}

async function protect(extra: Record<string, unknown>) {
  const [r] = await processProtectPdf(
    [await item()],
    () => {},
    { ...initialOptions("protect"), ...extra } as never,
  );
  return new Uint8Array(await r.blob.arrayBuffer());
}

test("default stays fully allowed (/P -4)", async () => {
  const bytes = await protect({ password: "pw" });
  expect(new TextDecoder("latin1").decode(bytes)).toMatch(/\/P -4\b/);
});

test("unticked permissions are really off, and restrict-only needs no open password", async () => {
  const bytes = await protect({ password: "", allowPrint: false, allowCopy: false });
  const pdf = await getDocument({ data: bytes }).promise;
  const perms = (await pdf.getPermissions()) ?? [];
  // pdf.js PermissionFlag: PRINT=4, COPY=16
  expect(perms).not.toContain(4);
  expect(perms).not.toContain(16);
  expect(perms).toContain(8);
});

test("a separate owner password is honoured", async () => {
  const bytes = await protect({ password: "open", ownerPassword: "boss", allowEdit: false });
  const out = await unlockPdfBytes(bytes, "boss");
  expect(new TextDecoder("latin1").decode(out)).not.toContain("/Encrypt");
});

test("strength meter ranks passwords", () => {
  expect(passwordStrength("").score).toBe(0);
  expect(passwordStrength("password1").score).toBe(0);
  expect(passwordStrength("Tr0ub4dor&3xyz!").score).toBeGreaterThanOrEqual(3);
  expect(passwordStrength("abcdefg").score).toBeLessThan(passwordStrength("Xk9#mQ2$vL7@pR4!").score);
});
