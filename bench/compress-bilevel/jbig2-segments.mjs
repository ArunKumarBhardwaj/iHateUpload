// Prints the JBIG2 segment structure of every /JBIG2Decode image in a PDF. Usage: bun bench/compress-bilevel/jbig2-segments.mjs file.pdf
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFRawStream } from "@cantoo/pdf-lib";

const u32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
const doc = await PDFDocument.load(readFileSync(process.argv[2]), { ignoreEncryption: true });
for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
  if (!(obj instanceof PDFRawStream)) continue;
  if (String(obj.dict.get(PDFName.of("Filter"))) !== "/JBIG2Decode") continue;
  console.log(ref.toString(), "bytes", obj.contents.length, "dict", obj.dict.toString().replace(/\s+/g, " ").slice(0, 200));
  const d = obj.contents;
  let o = 0;
  while (o + 11 <= d.length) {
    const type = d[o + 4] & 63;
    const refs = d[o + 5] >> 5;
    const lengthAt = o + 6 + refs + (d[o + 4] & 0x40 ? 4 : 1);
    const len = u32(d, lengthAt);
    const data = lengthAt + 4;
    let extra = "";
    if (type === 38 || type === 39) extra = `op=${d[data + 16]} region ${u32(d, data)}x${u32(d, data + 4)} flags=${d[data + 17].toString(2)} at=${[...d.subarray(data + 18, data + 26)]}`;
    console.log(`  seg ${u32(d, o)} type ${type} refs ${refs} len ${len} ${extra}`);
    o = data + len;
  }
}
