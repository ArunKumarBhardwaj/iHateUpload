// Proves redacted text is gone: pdf.js text of every page + metadata.
// Usage: node bench/redact/verify.mjs <pdf> [needle ...]
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const [file, ...needles] = process.argv.slice(2);
const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
let all = "";
for (let i = 1; i <= doc.numPages; i++) {
  const t = await (await doc.getPage(i)).getTextContent();
  all += t.items.map((x) => x.str).join(" ") + "\n";
}
const meta = await doc.getMetadata();
console.log("pages", doc.numPages, "chars", all.replace(/\s/g, "").length);
console.log("info", JSON.stringify({ Title: meta.info.Title, Author: meta.info.Author, Subject: meta.info.Subject }));
for (const n of needles) console.log(all.includes(n) ? "STILL PRESENT" : "gone", n);
