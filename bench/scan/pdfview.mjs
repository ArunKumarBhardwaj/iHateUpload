// Renders every page of a PDF to PNG and extracts its text, using pdfjs inside system Chrome.
// Usage: node pdfview.mjs <file.pdf> <outPrefix>   (needs playwright-core and a pdfjs-dist install)
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.PDFJS_ROOT; // .../node_modules/pdfjs-dist/legacy/build
const pw = process.env.PLAYWRIGHT_CORE; // path to playwright-core
const { chromium } = createRequire(import.meta.url)(pw);
const [pdfPath, prefix] = process.argv.slice(2);

const server = createServer((req, res) => {
  if (req.url === "/") {
    res.setHeader("content-type", "text/html");
    res.end("<!doctype html><body></body>");
    return;
  }
  try {
    const data = readFileSync(join(root, req.url.replace(/^\//, "")));
    res.setHeader("content-type", "text/javascript");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`);
const b64 = readFileSync(pdfPath).toString("base64");
const result = await page.evaluate(
  async ({ b64, port }) => {
    const pdfjs = await import(`http://127.0.0.1:${port}/pdf.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `http://127.0.0.1:${port}/pdf.worker.mjs`;
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await pdfjs.getDocument({ data }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n);
      const vp = p.getViewport({ scale: 1.2 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await p.render({ canvas, canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      const text = (await p.getTextContent()).items.map((i) => i.str).join(" ");
      const size = p.getViewport({ scale: 1 });
      pages.push({ png: canvas.toDataURL("image/png"), text, w: size.width, h: size.height });
    }
    return pages;
  },
  { b64, port },
);
result.forEach((p, i) => {
  writeFileSync(`${prefix}-${i + 1}.png`, Buffer.from(p.png.split(",")[1], "base64"));
  console.log(`page ${i + 1}: ${p.w.toFixed(1)}x${p.h.toFixed(1)} pt, text: ${JSON.stringify(p.text.slice(0, 200))}`);
});
await browser.close();
server.close();
