// Drives the real PDF to PDF/A page with the whole corpus at each level, then asks veraPDF about every download.
// Usage: node internal/benchmarks/pdfa/prove.mjs [port]   (fixtures from gen.ts + gen-apps.mjs; needs `brew install verapdf`)
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const port = process.argv[2] ?? "43127";
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/ours/", import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = readdirSync(fx).filter((f) => f.endsWith(".pdf")).sort();

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } });
const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); console.log(log.at(-1)); };
const origin = port.startsWith("http") ? port : `http://localhost:${port}`;
const labels = { "1b": "PDF/A-1b — strictest", "2b": "PDF/A-2b — recommended", "3b": "PDF/A-3b — keeps attachments" };

for (const level of ["2b", "1b", "3b"]) {
  const page = await context.newPage();
  const errors = [];
  const posts = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (["POST", "PUT"].includes(r.method())) posts.push(r.url()); });
  await page.goto(`${origin}/tools/pdf-to-pdfa`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[aria-label="Choose files"]', files.map((f) => fx + f));
  await page.getByRole("button", { name: labels[level] }).click();
  const start = Date.now();
  await page.getByRole("button", { name: "Convert to PDF/A", exact: true }).click();
  const all = page.getByRole("button", { name: /Download all/ });
  await all.waitFor({ timeout: 180000 });
  const ms = Date.now() - start;
  check(`${level}: batch of ${files.length} converted`, true, `${ms} ms`);
  if (level === "2b") await page.screenshot({ path: out + "../ui-results.png", fullPage: true });
  const [download] = await Promise.all([page.waitForEvent("download"), all.click()]);
  const zip = `${out}${level}.zip`;
  await download.saveAs(zip);
  execFileSync("unzip", ["-o", "-q", zip, "-d", out]);
  const got = readdirSync(out).filter((f) => f.endsWith(`-pdfa-${level}.pdf`));
  check(`${level}: one PDF per input`, got.length === files.length, `${got.length}`);
  let pass = 0;
  for (const f of got) {
    const v = spawnSync("verapdf", ["-f", level, "--format", "text", out + f], { encoding: "utf8" }).stdout.trim();
    if (v.startsWith("PASS")) pass++;
    else console.log("   ", v);
    renameSync(out + f, out + f.replace(`-pdfa-${level}.pdf`, `-${level}.pdf`));
  }
  check(`${level}: veraPDF`, pass === got.length, `${pass}/${got.length}`);
  check(`${level}: no POST/PUT requests`, posts.length === 0, posts.join(", "));
  check(`${level}: no page errors`, errors.length === 0, errors.join(" | "));
  rmSync(zip);
  await page.close();
}
writeFileSync(out + "../prove.log", log.join("\n") + "\n");
await browser.close();
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);
