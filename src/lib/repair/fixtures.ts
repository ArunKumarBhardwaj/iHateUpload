/**
 * Synthetic damaged PDFs for the Repair tool's tests and benchmark.
 * Every page carries a marker "PAGE-n-MARKER" so recovery can be counted.
 */
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "@cantoo/pdf-lib";

export const PAGES = 5;

export async function buildHealthy(useObjectStreams = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Synthetic repair sample");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= PAGES; n++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`PAGE-${n}-MARKER`, { x: 60, y: 760, size: 24, font });
    for (let line = 0; line < 12; line++) {
      page.drawText(`Synthetic line ${line + 1} on page ${n}: the quick brown fox jumps over the lazy dog.`, {
        x: 60, y: 700 - line * 22, size: 11, font, color: rgb(0.15, 0.15, 0.2),
      });
    }
    page.drawRectangle({ x: 60, y: 300, width: 200, height: 80, color: rgb(0.85, 0.3, 0.2) });
  }
  // One bookmark so we can see whether the outline survives.
  const first = doc.getPage(0);
  const outline = doc.context.register(doc.context.obj({}));
  const item = doc.context.register(
    doc.context.obj({ Title: PDFString.of("Start"), Parent: outline, Dest: [first.ref, PDFName.of("Fit")] }),
  );
  const outlineDict = doc.context.lookup(outline);
  if (outlineDict && "set" in outlineDict) {
    const dict = outlineDict as unknown as { set(k: PDFName, v: unknown): void };
    dict.set(PDFName.of("Type"), PDFName.of("Outlines"));
    dict.set(PDFName.of("First"), item);
    dict.set(PDFName.of("Last"), item);
    dict.set(PDFName.of("Count"), doc.context.obj(1));
  }
  doc.catalog.set(PDFName.of("Outlines"), outline);
  return doc.save({ useObjectStreams });
}

const latin1 = (bytes: Uint8Array) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
};
const bytesOf = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 255);

/** Offset of "n 0 obj" (pdf-lib writes one object per line). */
function objAt(s: string, n: number) {
  const at = s.indexOf(`\n${n} 0 obj`);
  if (at < 0) throw new Error(`object ${n} not found`);
  return at + 1;
}

export type Damage =
  | "xref-offsets"
  | "no-xref"
  | "truncated"
  | "junk-header"
  | "bad-length"
  | "xref-stream"
  | "missing-eof"
  | "zeroed-block"
  | "no-catalog";

export const DAMAGES: Damage[] = [
  "xref-offsets", "no-xref", "truncated", "junk-header", "bad-length",
  "xref-stream", "missing-eof", "zeroed-block", "no-catalog",
];

/** What a perfect repair could still get back (pages whose content survives). */
export const RECOVERABLE: Record<Damage, number> = {
  "xref-offsets": 5, "no-xref": 5, truncated: 3, "junk-header": 5, "bad-length": 5,
  "xref-stream": 5, "missing-eof": 5, "zeroed-block": 4, "no-catalog": 5,
};

export async function buildDamaged(kind: Damage): Promise<Uint8Array> {
  const healthy = await buildHealthy(kind === "xref-stream");
  let s = latin1(healthy);
  switch (kind) {
    case "xref-offsets": {
      // Every offset in the xref table points 7 bytes too far.
      const start = s.lastIndexOf("\nxref");
      const tail = s.slice(start).replace(/^(\d{10}) (\d{5}) n/gm, (_, off, gen) => `${String(Number(off) + 7).padStart(10, "0")} ${gen} n`);
      s = s.slice(0, start) + tail;
      break;
    }
    case "no-xref": {
      // Table, trailer and startxref gone: the Root has to be found by scanning.
      s = s.slice(0, s.lastIndexOf("\nxref")) + "\n%%EOF\n";
      break;
    }
    case "truncated": {
      // The download stopped early: page 4's content (object 12) and everything after is gone.
      s = s.slice(0, objAt(s, 12));
      break;
    }
    case "junk-header":
      s = "<html>Saved by a mail client\n".repeat(30) + s;
      break;
    case "bad-length": {
      // Page 1's content stream (object 6) says it is 40 bytes long; it is not.
      const at = objAt(s, 6);
      const end = s.indexOf("stream", at);
      s = s.slice(0, at) + s.slice(at, end).replace(/\/Length \d+/, "/Length 40") + s.slice(end);
      break;
    }
    case "xref-stream": {
      // Object streams + a garbled cross-reference stream.
      const at = s.lastIndexOf("/Type /XRef");
      const streamAt = s.indexOf("stream", at) + 8;
      s = s.slice(0, streamAt) + "X".repeat(40) + s.slice(streamAt + 40);
      break;
    }
    case "missing-eof":
      s = s.slice(0, s.lastIndexOf("startxref"));
      break;
    case "zeroed-block": {
      // A disk error wiped page 3's content stream (object 10).
      const at = objAt(s, 10);
      const begin = s.indexOf("stream", at) + 7;
      const end = s.indexOf("endstream", begin);
      s = s.slice(0, begin) + "\0".repeat(end - begin) + s.slice(end);
      break;
    }
    case "no-catalog": {
      // The catalog object is destroyed and the trailer points nowhere.
      s = s.replace(/\/Type \/Catalog/, "/Type /Junk   ").replace(/\/Root \d+ 0 R/, "/Root 999 0 R");
      break;
    }
  }
  return bytesOf(s);
}
