import { expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { probeLock, unlockPdfBytes, WrongPasswordError } from "./unlock";

async function make(user: string, owner: string, restrict: boolean) {
  const d = await PDFDocument.create();
  const p = d.addPage([300, 300]);
  p.drawText("secret words", {
    font: await d.embedFont(StandardFonts.Helvetica),
    size: 14,
  });
  d.encrypt({
    userPassword: user,
    ownerPassword: owner,
    permissions: restrict ? { printing: false, copying: false, modifying: false } : {},
  });
  return d.save();
}

const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

test("probe tells open, restricted and password apart", async () => {
  const plain = await PDFDocument.create();
  plain.addPage();
  expect(await probeLock(await plain.save())).toBe("open");
  expect(await probeLock(await make("", "own", true))).toBe("restricted");
  expect(await probeLock(await make("usr", "own", true))).toBe("password");
});

test("unlock leaves no /Encrypt and opens without a password", async () => {
  const out = await unlockPdfBytes(await make("usr", "own", true), "usr");
  expect(text(out)).not.toContain("/Encrypt");
  expect(await probeLock(out)).toBe("open");
  const pdf = await getDocument({ data: out }).promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  expect((content.items as { str: string }[]).map((i) => i.str).join("")).toContain(
    "secret words",
  );
  expect((await pdf.getPermissions()) ?? null).toBeNull();
});

test("owner-only restrictions are removed with no password", async () => {
  const out = await unlockPdfBytes(await make("", "own", true), "");
  expect(text(out)).not.toContain("/Encrypt");
  const pdf = await getDocument({ data: out }).promise;
  expect((await pdf.getPermissions()) ?? null).toBeNull();
});

test("wrong password is reported", async () => {
  await expect(unlockPdfBytes(await make("usr", "own", false), "nope")).rejects.toBeInstanceOf(
    WrongPasswordError,
  );
});
