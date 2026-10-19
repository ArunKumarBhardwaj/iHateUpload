import {
  PDFDict,
  PDFDocument,
  PDFInvalidObject,
  PDFName,
  PDFRawStream,
} from "@cantoo/pdf-lib";

/**
 * - open: not encrypted at all
 * - restricted: encrypted, but opens with no password (owner-only limits)
 * - password: needs a password to open
 */
export type LockState = "open" | "restricted" | "password";

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password.");
  }
}

async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return doc.isEncrypted;
  } catch {
    return false;
  }
}

export async function probeLock(bytes: Uint8Array): Promise<LockState> {
  if (!(await isEncrypted(bytes))) return "open";
  try {
    await PDFDocument.load(bytes, { password: "" });
    return "restricted";
  } catch {
    return "password";
  }
}

/**
 * Decrypts and writes a brand new file: no /Encrypt dictionary, no encrypted
 * revision left behind, every stream and string in the clear.
 */
export async function unlockPdfBytes(
  bytes: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      password,
      updateMetadata: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password/i.test(message) || /encrypt/i.test(message)) {
      throw new WrongPasswordError();
    }
    throw error;
  }
  const { context } = doc;
  const stale: Parameters<typeof context.delete>[0][] = [];
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    const dict =
      object instanceof PDFRawStream
        ? object.dict
        : object instanceof PDFDict
          ? object
          : null;
    const type = dict?.get(PDFName.of("Type"));
    if (
      object instanceof PDFInvalidObject ||
      type === PDFName.of("XRef") ||
      type === PDFName.of("ObjStm") ||
      dict?.get(PDFName.of("Filter")) === PDFName.of("Standard")
    ) {
      stale.push(ref);
    }
  }
  for (const ref of stale) context.delete(ref);
  context.trailerInfo.Encrypt = undefined;
  context.security = undefined;
  return doc.save({ useObjectStreams: false });
}
