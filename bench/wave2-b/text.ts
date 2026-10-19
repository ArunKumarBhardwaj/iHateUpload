// Extract text per page: bun bench/wave2-b/text.ts file.pdf
import { readFileSync } from "node:fs";
import { pdfPages } from "../../src/lib/doc-render/testkit";
(await pdfPages(new Uint8Array(readFileSync(process.argv[2])))).forEach((t, i) => console.log(`--- page ${i + 1} (${t.length} chars)\n${t.replace(/\s+/g, " ")}`));
