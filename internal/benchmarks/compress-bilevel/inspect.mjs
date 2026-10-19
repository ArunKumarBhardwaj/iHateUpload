// Lists every image XObject in PDFs: filter, size, colour space, bytes. Usage: bun internal/benchmarks/compress-bilevel/inspect.mjs a.pdf b.pdf
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFRawStream } from "@cantoo/pdf-lib";

for (const path of process.argv.slice(2)) {
  const bytes = readFileSync(path);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  console.log(`\n${path}  ${bytes.length} bytes, ${doc.getPageCount()} pages`);
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const g = (k) => String(obj.dict.lookup(PDFName.of(k)) ?? "-");
    console.log(
      `  ${ref.toString().padEnd(7)} ${g("Width")}x${g("Height")} bpc=${g("BitsPerComponent")} cs=${g("ColorSpace").slice(0, 30)} filter=${g("Filter")} mask=${g("ImageMask")} parms=${g("DecodeParms").replace(/\s+/g, " ").slice(0, 80)} bytes=${obj.contents.length}`,
    );
  }
}
