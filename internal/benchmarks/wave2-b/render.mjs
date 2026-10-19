// Render PDF pages to PNG with pdfjs inside system Chrome. Usage: node render.mjs in.pdf outPrefix [scale]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const root = resolve(new URL("../../../", import.meta.url).pathname);
const pdfjs = root + "/node_modules/pdfjs-dist/build/";
const [, , input, prefix, scaleArg] = process.argv;
const scale = Number(scaleArg ?? 1.2);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.route("http://r.test/**", (route) => {
  const u = new URL(route.request().url()).pathname;
  if (u === "/") return route.fulfill({ contentType: "text/html", body: "<canvas id=c></canvas>" });
  if (u === "/pdf.mjs") return route.fulfill({ contentType: "text/javascript", body: readFileSync(pdfjs + "pdf.mjs") });
  if (u === "/pdf.worker.mjs") return route.fulfill({ contentType: "text/javascript", body: readFileSync(pdfjs + "pdf.worker.mjs") });
  if (u === "/in.pdf") return route.fulfill({ contentType: "application/pdf", body: readFileSync(input) });
  return route.abort();
});
await page.goto("http://r.test/");
const urls = await page.evaluate(async (scale) => {
  const m = await import("http://r.test/pdf.mjs");
  m.GlobalWorkerOptions.workerSrc = "http://r.test/pdf.worker.mjs";
  const doc = await m.getDocument({ url: "http://r.test/in.pdf" }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale });
    const c = document.getElementById("c");
    c.width = vp.width; c.height = vp.height;
    await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    out.push(c.toDataURL("image/png"));
  }
  return out;
}, scale);
urls.forEach((u, i) => writeFileSync(`${prefix}-${i + 1}.png`, Buffer.from(u.split(",")[1], "base64")));
console.log("rendered", urls.length, "pages ->", prefix + "-N.png");
await browser.close();
