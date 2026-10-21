// Head-to-head probe of https://www.ihatepdf.cv/workflow with the same synthetic files.
// Usage: node internal/benchmarks/workflows/rival.mjs --corpus DIR --out DIR
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const CORPUS = arg("corpus", "corpus");
const OUT = arg("out", "rival-results");
mkdirSync(OUT, { recursive: true });
const npx = join(homedir(), ".npm/_npx");
const pw = readdirSync(npx).map((d) => join(npx, d, "node_modules/playwright-core/index.mjs")).find(existsSync);
const { chromium } = await import(pw);
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const reqs = [];
page.on("request", (r) => { if (!["GET", "HEAD", "OPTIONS"].includes(r.method())) reqs.push(r.method() + " " + r.url()); });
const pdfs = readdirSync(join(CORPUS, "pdf")).sort().map((f) => join(CORPUS, "pdf", f));
const imgs = readdirSync(join(CORPUS, "img")).sort().map((f) => join(CORPUS, "img", f));

await page.goto("https://www.ihatepdf.cv/workflow", { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
const input = page.locator("input[type=file]").first();
console.log("input.multiple =", await input.evaluate((i) => i.multiple), "accept =", await input.evaluate((i) => i.accept));

// 1. Twenty PDFs at once.
await input.setInputFiles(pdfs).catch((e) => console.log("20 PDFs rejected:", String(e.message).split("\n")[0]));
await page.waitForTimeout(2500);
const fileChips = await page.locator("main").innerText();
console.log("after 20 PDFs, file area text:", fileChips.split("\n").filter((l) => /\.pdf|KB|MB|files?/i.test(l)).slice(0, 6));

// 2. Twenty images.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await page.locator("input[type=file]").first().setInputFiles(imgs.slice(0, 1)).catch((e) => console.log("JPG rejected:", String(e.message).split("\n")[0]));
await page.waitForTimeout(2500);
console.log("after JPG images, text:", (await page.locator("main").innerText()).split("\n").filter((l) => /\.jpg|error|only|PDF/i.test(l)).slice(0, 6));
const ops = await page.locator("main").innerText();
console.log("ops list includes image-to-pdf step:", /image/i.test(ops.split("Operations")[1]?.split("Run")[0] ?? ""));

// 3. One PDF through Compress -> Encrypt, timed.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await page.locator("input[type=file]").first().setInputFiles(pdfs[0]);
await page.waitForTimeout(2500);
await page.getByText("Email Ready").first().click(); // preset: Compress, Page Numbers, Strip Metadata
await page.waitForTimeout(4000);
await page.screenshot({ path: join(OUT, "rival-steps.png"), fullPage: true });
console.log("pipeline text:", (await page.locator("main").innerText()).split("Pipeline")[0].slice(-600).replace(/\n+/g, " | "));
const t0 = Date.now();
const dl = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
await page.mouse.click(1330, 95);
await page.waitForTimeout(6000);
await page.screenshot({ path: join(OUT, "rival-run.png"), fullPage: true });
const d = await dl;
console.log("download after", Date.now() - t0, "ms:", d ? d.suggestedFilename() : "none (no auto download)");
if (d) await d.saveAs(join(OUT, d.suggestedFilename()));
console.log("non-GET requests:", reqs.length, reqs.slice(0, 5));
writeFileSync(join(OUT, "rival.json"), JSON.stringify({ reqs }, null, 2));
await browser.close();
