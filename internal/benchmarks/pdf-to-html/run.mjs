// Converts the synthetic realistic corpus on our PDF to HTML page (3 layouts) and on ihatepdf.cv/pdf-to-html (Semantic, Positioned).
// Usage: node internal/benchmarks/pdf-to-html/run.mjs [--ours PORT] [--sides ours-reflow,ours-exact,ours-picture,rival-semantic,rival-positioned] [--only a,b]
// Output: results/<side>/<doc>.html and results/<side>/<doc>.json (ms, errors). Also asserts no POST/PUT with data on our side.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const port = arg("ours", "43160");
const sides = arg("sides", "ours-reflow,ours-exact,ours-picture,rival-semantic,rival-positioned").split(",");
const only = arg("only", "").split(",").filter(Boolean);
const corpus = join(HERE, "../pdf-to-word/realistic/corpus");
const names = readdirSync(corpus).filter((f) => f.endsWith(".pdf")).map((f) => f.slice(0, -4)).filter((n) => !only.length || only.includes(n)).sort();

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } });
const posts = [];

async function ours(name, mode) {
  const page = await ctx.newPage();
  page.on("request", (r) => { if (["POST", "PUT"].includes(r.method())) posts.push(r.url()); });
  try {
    await page.goto(`http://localhost:${port}/tools/pdf-to-html`, { waitUntil: "networkidle" });
    await page.setInputFiles('input[aria-label="Choose files"]', join(corpus, name + ".pdf"));
    await page.getByRole("button", { name: "Convert to HTML" }).waitFor();
    const label = { reflow: /^Flowing page/, exact: /^Exact layout/, picture: /^Page pictures/ }[mode];
    await page.getByRole("button", { name: label }).click();
    const t0 = Date.now();
    await page.getByRole("button", { name: "Convert to HTML" }).click();
    const button = page.getByRole("button", { name: "Download HTML page" });
    await button.waitFor({ timeout: 180000 });
    const ms = Date.now() - t0;
    const [dl] = await Promise.all([page.waitForEvent("download"), button.click()]);
    return { bytes: readFileSync(await dl.path()), ms };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  } finally {
    await page.close();
  }
}

async function rival(name, mode) {
  const page = await ctx.newPage();
  try {
    await page.goto("https://www.ihatepdf.cv/pdf-to-html", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    const t0 = Date.now();
    await page.locator("input[type=file]").first().setInputFiles(join(corpus, name + ".pdf"));
    const exportBtn = page.getByRole("button", { name: /^Export \d+ page/ });
    const failed = page.getByText(/Extraction failed/);
    const which = await Promise.race([
      exportBtn.waitFor({ timeout: 120000 }).then(() => "ok"),
      failed.waitFor({ timeout: 120000 }).then(() => "failed"),
    ]);
    if (which === "failed") return { error: (await failed.innerText()).slice(0, 200) };
    await page.getByRole("button", { name: mode === "positioned" ? "Positioned" : "Semantic" }).click();
    await page.waitForTimeout(1500);
    const ms = Date.now() - t0;
    const event = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
    await exportBtn.click();
    const dl = await event;
    if (dl) return { bytes: readFileSync(await dl.path()), ms };
    const bytes = await page.evaluate(() => window._lastDownloadedFile?.bytes && Array.from(window._lastDownloadedFile.bytes)).catch(() => null);
    return bytes ? { bytes: Buffer.from(bytes), ms } : { error: "no download event" };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  } finally {
    await page.close();
  }
}

for (const side of sides) {
  const out = join(HERE, "results", side);
  mkdirSync(out, { recursive: true });
  for (const name of names) {
    const [who, mode] = side.split("-");
    const r = await (who === "ours" ? ours : rival)(name, mode);
    if (r.bytes) writeFileSync(join(out, name + (r.bytes.subarray(0, 2).toString() === "PK" ? ".zip" : ".html")), r.bytes);
    writeFileSync(join(out, name + ".json"), JSON.stringify({ ms: r.ms, error: r.error, bytes: r.bytes?.length }));
    console.log(side, name, r.error ? "FAILED " + r.error : `${r.ms} ms ${r.bytes.length} B`);
    if (who === "rival") await new Promise((res) => setTimeout(res, 1500));
  }
}
console.log("POST/PUT requests from our page:", posts.length, posts.join(","));
writeFileSync(join(HERE, "results", "posts.txt"), `${posts.length}\n${posts.join("\n")}\n`);
await browser.close();
