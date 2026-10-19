// Renders every page of a PDF with pdf.js in Chrome and screenshots the contact sheet.
// Usage: node internal/benchmarks/page-tools/render.mjs <in.pdf> <out.png> [scale=0.5]
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = join(homedir(), ".npm/_npx");
const dir = readdirSync(root).find((d) => {
  try {
    readdirSync(join(root, d, "node_modules/playwright-core"));
    return true;
  } catch {
    return false;
  }
});
const { chromium } = createRequire(join(root, dir, "node_modules/x.js"))("playwright-core");
const [input, out, scale = "0.5"] = process.argv.slice(2);
const build = resolve("node_modules/pdfjs-dist/legacy/build");
const html = `<!doctype html><body style="margin:8px;background:#888;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start">
<script type="module">
import * as pdfjs from "https://r.local/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "https://r.local/worker.mjs";
const doc = await pdfjs.getDocument({ url: "https://r.local/f.pdf" }).promise;
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const vp = page.getViewport({ scale: ${Number(scale)} });
  const c = document.createElement("canvas");
  c.width = vp.width; c.height = vp.height;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
  document.body.appendChild(c);
}
document.title = "ready " + doc.numPages;
</script></body>`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.route("https://r.local/**", (route) => {
  const p = new URL(route.request().url()).pathname;
  const js = { contentType: "text/javascript" };
  if (p === "/") return route.fulfill({ body: html, contentType: "text/html" });
  if (p === "/pdf.mjs") return route.fulfill({ ...js, body: readFileSync(join(build, "pdf.mjs")) });
  if (p === "/worker.mjs") return route.fulfill({ ...js, body: readFileSync(join(build, "pdf.worker.mjs")) });
  return route.fulfill({ body: readFileSync(resolve(input)), contentType: "application/pdf" });
});
await page.goto("https://r.local/");
await page.waitForFunction(() => document.title.startsWith("ready"), null, { timeout: 60000 });
console.log(await page.title());
await page.screenshot({ path: resolve(out), fullPage: true });
await browser.close();
