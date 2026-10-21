// Drives the real PDF to ZIP page on a production build; unzips the download and checks names, bytes and per-page text.
// Usage: node prove-zip.mjs [port]   (run `bun gen.ts` first)
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { pageTexts } from "./pagetext.mjs";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const port = process.argv[2] ?? "43162";
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/zip/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1500 } })).newPage();
const posts = [], errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => { if (["POST", "PUT"].includes(r.method())) posts.push(r.url()); });
let failed = false;
const check = (name, ok, detail = "") => { if (!ok) failed = true; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const list = (d) => execFileSync("find", [d, "-type", "f"]).toString().split("\n").filter(Boolean).map((p) => p.slice(d.length)).sort();

async function run(label, setup) {
  await page.goto(`http://localhost:${port}/tools/pdf-to-zip`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[aria-label="Choose files"]', ["fronts.pdf", "backs.pdf", "short.pdf"].map((f) => fx + f));
  await page.getByText("in the ZIP").first().waitFor();
  await page.waitForTimeout(800);
  await setup();
  const start = Date.now();
  await page.getByRole("button", { name: "Create ZIP", exact: true }).click();
  const dl = page.getByRole("button", { name: /^Download/ }).first();
  await dl.waitFor({ timeout: 60000 });
  const ms = Date.now() - start;
  const [download] = await Promise.all([page.waitForEvent("download"), dl.click()]);
  const zip = out + label + ".zip";
  await download.saveAs(zip);
  const dest = out + label + "/";
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  execFileSync("unzip", ["-o", "-q", zip, "-d", dest]);
  await page.screenshot({ path: out + label + ".png", fullPage: true });
  return { dest, ms, name: download.suggestedFilename() };
}

let r = await run("whole", async () => {});
check("whole: file name", r.name === "pdfs.zip", r.name);
check("whole: entries", JSON.stringify(list(r.dest)) === JSON.stringify(["backs.pdf", "fronts.pdf", "short.pdf"]), list(r.dest).join(", "));
check("whole: byte-identical", ["fronts", "backs", "short"].every((n) => readFileSync(r.dest + n + ".pdf").equals(readFileSync(fx + n + ".pdf"))), `${r.ms} ms`);

r = await run("pages", async () => {
  await page.getByRole("button", { name: "One PDF per page" }).click();
  await page.locator("#zip-template").fill("{name}_p{part}");
  await page.locator("#zip-folder").fill("scan");
  await page.locator("#zip-name").fill("pages-out");
  await page.getByRole("button", { name: "Max" }).click();
});
check("pages: file name", r.name === "pages-out.zip", r.name);
const names = list(r.dest);
check("pages: 10 entries in folder", names.length === 10 && names.every((n) => n.startsWith("scan/")), `${names.length} entries, e.g. ${names[0]}`);
const texts = [];
for (const n of names) texts.push((await pageTexts(r.dest + n)).join("|"));
check("pages: every page is its own PDF with the right text", [...texts].sort().join(" ") === "B1 B2 B3 B4 F1 F2 F3 F4 S1 S2", `${texts.join(" ")} (${r.ms} ms)`);

r = await run("chunks", async () => {
  await page.getByRole("button", { name: "Every N pages" }).click();
  await page.getByLabel("Pages per PDF").fill("3");
  await page.getByRole("checkbox").check();
  await page.locator("#zip-template").fill("{name} {from}-{to}");
});
const cn = list(r.dest);
check("chunks: folders per file, ranges named", cn.join(", ") === "backs/backs 1-3.pdf, backs/backs 4-4.pdf, fronts/fronts 1-3.pdf, fronts/fronts 4-4.pdf, short/short 1-2.pdf", cn.join(", "));
check("chunks: first part holds pages in order", (await pageTexts(r.dest + "fronts/fronts 1-3.pdf")).join(" ") === "F1 F2 F3");

check("no POST/PUT requests", posts.length === 0, posts.join(", "));
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
