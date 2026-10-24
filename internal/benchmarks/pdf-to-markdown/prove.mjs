// Drives the real PDF to Markdown page: all 20 corpus PDFs in one batch (-> out/ours/*.md for score.ts),
// then one file as a zip with pictures. Checks OCR on the scan, 0 POST/PUT, no page errors.
// Usage: node internal/benchmarks/pdf-to-markdown/prove.mjs [port | https://origin]
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, rmSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const arg = process.argv[2] ?? "43127";
const origin = arg.startsWith("http") ? arg : `http://localhost:${arg}`;
const corpus = new URL("../pdf-to-word/realistic/corpus/", import.meta.url).pathname;
const ours = new URL("./out/ours/", import.meta.url).pathname;
const zipDir = new URL("./out/ours-zip/", import.meta.url).pathname;
rmSync(ours, { recursive: true, force: true });
rmSync(zipDir, { recursive: true, force: true });
mkdirSync(ours, { recursive: true });
mkdirSync(zipDir, { recursive: true });
const docs = readdirSync(corpus).filter((f) => f.endsWith(".pdf")).sort();
const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); console.log(log.at(-1)); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } });
const posts = [];
const errors = [];
async function open() {
  const page = await context.newPage();
  page.on("request", (r) => { if (["POST", "PUT"].includes(r.method()) && !r.url().includes("vercel")) posts.push(r.url()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/tools/pdf-to-markdown`, { waitUntil: "networkidle" });
  return page;
}

{
  const page = await open();
  await page.setInputFiles('input[aria-label="Choose files"]', docs.map((d) => corpus + d));
  const start = Date.now();
  await page.getByRole("button", { name: "Convert to Markdown", exact: true }).click();
  const all = page.getByRole("button", { name: /Download all/ });
  await all.waitFor({ timeout: 300000 });
  const ms = Date.now() - start;
  await page.screenshot({ path: ours + "../ui-results.png", fullPage: true });
  const [download] = await Promise.all([page.waitForEvent("download"), all.click()]);
  await download.saveAs(ours + "all.zip");
  execFileSync("unzip", ["-o", "-q", ours + "all.zip", "-d", ours]);
  rmSync(ours + "all.zip");
  const mds = readdirSync(ours).filter((f) => f.endsWith(".md"));
  check(`batch of ${docs.length} PDFs -> one .md each`, mds.length === docs.length, `${mds.length} files in ${ms} ms`);
  const scan = readFileSync(ours + "scanned-letter.md", "utf8");
  check("scanned letter read with OCR", scan.split(/\s+/).length > 30, `${scan.split(/\s+/).length} words`);
  const invoice = readFileSync(ours + "invoice.md", "utf8");
  check("invoice table is a real pipe table", /^\| Description \| Qty \| Unit price \| Amount \|$/m.test(invoice));
  await page.close();
}
{
  const page = await open();
  await page.setInputFiles('input[aria-label="Choose files"]', corpus + "brochure.pdf");
  await page.getByRole("button", { name: "Zip with pictures" }).click();
  await page.getByRole("button", { name: "Convert to Markdown", exact: true }).click();
  const save = page.getByRole("button", { name: /^Save/ }).first();
  await save.waitFor({ timeout: 120000 });
  const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
  await download.saveAs(zipDir + "brochure.zip");
  execFileSync("unzip", ["-o", "-q", zipDir + "brochure.zip", "-d", zipDir]);
  const md = readFileSync(zipDir + "index.md", "utf8");
  const imgs = existsDir(zipDir + "images") ? readdirSync(zipDir + "images") : [];
  const linked = imgs.every((f) => md.includes(`](images/${f})`));
  check("zip keeps pictures and links them from index.md", imgs.length > 0 && linked, `${imgs.length} pictures`);
  await page.close();
}
check("no POST/PUT requests", posts.length === 0, posts.join(", "));
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
for (const f of readdirSync(ours)) if (f.endsWith(".md") && /-\d+\.md$/.test(f)) renameSync(ours + f, ours + f.replace(/-\d+\.md$/, ".md"));
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);

function existsDir(p) {
  try { return readdirSync(p) && true; } catch { return false; }
}
