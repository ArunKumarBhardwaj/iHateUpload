// Drives the six batch tools on a real build (or the live site) with several files each and checks every output.
// Usage: node internal/benchmarks/batch/prove.mjs [port | https://origin]   (fixtures from gen.mjs)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const arg = process.argv[2] ?? "43127";
const origin = arg.startsWith("http") ? arg : `http://localhost:${arg}`;
const fx = new URL("./fx/", import.meta.url).pathname;
const outRoot = new URL("./out/", import.meta.url).pathname;
rmSync(outRoot, { recursive: true, force: true });

const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); console.log(log.at(-1)); };
async function text(path) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  let all = "";
  for (let n = 1; n <= pdf.numPages; n++) all += (await (await pdf.getPage(n)).getTextContent()).items.map((i) => i.str).join(" ") + "\n";
  return all;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } });
const posts = [];
const errors = [];

async function run(slug, files, action, setup) {
  const page = await context.newPage();
  page.on("request", (r) => { if (["POST", "PUT"].includes(r.method()) && !r.url().includes("vercel")) posts.push(`${slug}: ${r.url()}`); });
  page.on("pageerror", (e) => errors.push(`${slug}: ${e.message}`));
  await page.goto(`${origin}/tools/${slug}`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[aria-label="Choose files"]', files.map((f) => fx + f));
  if (setup) await setup(page);
  const start = Date.now();
  await page.getByRole("button", { name: action, exact: true }).click();
  const all = page.getByRole("button", { name: /Download all/ });
  await all.waitFor({ timeout: 240000 });
  const ms = Date.now() - start;
  const notes = (await page.locator("p.text-xs").allInnerTexts()).join(" | ");
  const out = `${outRoot}${slug}/`;
  mkdirSync(out, { recursive: true });
  const [download] = await Promise.all([page.waitForEvent("download"), all.click()]);
  await download.saveAs(out + "all.zip");
  execFileSync("unzip", ["-o", "-q", out + "all.zip", "-d", out]);
  rmSync(out + "all.zip");
  await page.close();
  return { out, names: readdirSync(out).sort(), ms, notes };
}

{
  const r = await run("pdf-to-jpg", ["text-a.pdf", "text-b.pdf", "dup/text-a.pdf", "locked.pdf"], "Convert to JPG");
  const want = ["text-a-2-page-1.jpg", "text-a-page-1.jpg", "text-a-page-2.jpg", "text-b-page-1.jpg", "text-b-page-2.jpg", "text-b-page-3.jpg"];
  check("PDF to JPG: 3 PDFs -> 6 pages, same-named files kept apart", JSON.stringify(r.names) === JSON.stringify(want), `${r.names.join(", ")} in ${r.ms} ms`);
  check("PDF to JPG: the locked PDF is skipped and named", /Skipped: locked\.pdf/.test(r.notes), r.notes.match(/Skipped[^|]*/)?.[0] ?? "no note");
}
{
  const r = await run("pdf-to-png", ["text-a.pdf", "scan-1.pdf"], "Convert to PNG");
  check("PDF to PNG: 2 PDFs -> 3 PNGs", r.names.length === 3 && r.names.every((n) => n.endsWith(".png")), `${r.names.join(", ")} in ${r.ms} ms`);
}
{
  const r = await run("crop-pdf", ["text-a.pdf", "text-b.pdf", "dup/text-a.pdf"], "Crop PDF", async (page) => {
    await page.locator("#crop-top").fill("20");
    await page.locator("#crop-left").fill("15");
  });
  let ok = r.names.length === 3;
  for (const n of r.names) {
    const doc = await PDFDocument.load(readFileSync(r.out + n));
    for (const p of doc.getPages()) ok &&= p.getCropBox().height < 842 - 50 && p.getCropBox().width < 595 - 35;
  }
  check("Crop: 3 PDFs, every page cropped 20 mm top and 15 mm left", ok, `${r.names.join(", ")} in ${r.ms} ms`);
}
{
  const r = await run("redact-pdf", ["text-a.pdf", "text-b.pdf", "dup/text-a.pdf"], "Redact PDF", async (page) => {
    await page.getByRole("button", { name: "Scan document" }).click();
    await page.getByRole("button", { name: "Scan again" }).waitFor({ timeout: 60000 });
  });
  const texts = await Promise.all(r.names.map((n) => text(r.out + n)));
  const leaked = texts.some((t) => /@example\.(com|org|net)/.test(t));
  const kept = texts.some((t) => /Letter B page 2/.test(t));
  check("Redact: 3 PDFs, emails gone from every file (found again in files 2 and 3)", r.names.length === 3 && !leaked, `${r.names.join(", ")} in ${r.ms} ms; ${r.notes.match(/\d+ items? found[^|]*/g)?.join("; ") ?? ""}`);
  check("Redact: pages without personal data keep their text", kept);
}
{
  const r = await run("extract-images", ["pics-1.pdf", "pics-2.pdf"], "Extract images");
  check("Extract images: 2 PDFs -> 3 images, named by file", r.names.length === 3 && r.names.filter((n) => n.startsWith("pics-1")).length === 2, `${r.names.join(", ")} in ${r.ms} ms`);
}
{
  const r = await run("ocr-pdf", ["scan-1.pdf", "scan-2.pdf"], "Make searchable");
  const pdfs = r.names.filter((n) => n.endsWith(".pdf"));
  const t = await Promise.all(pdfs.map((n) => text(r.out + n)));
  check("OCR: 2 scans -> 2 searchable PDFs with the right words", pdfs.length === 2 && /Quarterly/i.test(t.join(" ")) && /Budget/i.test(t.join(" ")), `${pdfs.join(", ")} in ${r.ms} ms`);
}
check("no POST/PUT requests", posts.length === 0, posts.join(", "));
check("no page errors", errors.length === 0, errors.join(" | "));
writeFileSync(new URL("./prove.log", import.meta.url).pathname.replace("prove.log", "out/prove.log"), log.join("\n") + "\n");
await browser.close();
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);
