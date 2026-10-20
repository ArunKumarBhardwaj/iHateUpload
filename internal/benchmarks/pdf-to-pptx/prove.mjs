// Drives the real PDF to PowerPoint page. Usage: node internal/benchmarks/pdf-to-pptx/prove.mjs [port|origin]
// Saves out/ours-<case>.pptx; check them with check.sh (LibreOffice + Quick Look).
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const port = process.argv[2] ?? "43127";
const origin = port.startsWith("http") ? port : `http://localhost:${port}`;
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } })).newPage();
const errors = [];
const posts = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => { if (["POST", "PUT"].includes(r.method())) posts.push(r.url()); });
const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); console.log(log.at(-1)); };

async function run(name, file, setup) {
  await page.goto(`${origin}/tools/pdf-to-pptx`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[aria-label="Choose files"]', fx + file);
  await page.getByRole("button", { name: "Convert to PowerPoint" }).waitFor();
  await setup?.();
  const start = Date.now();
  await page.getByRole("button", { name: "Convert to PowerPoint" }).click();
  const button = page.getByRole("button", { name: "Download PowerPoint file" });
  await button.waitFor({ timeout: 120000 });
  const ms = Date.now() - start;
  const note = await page.locator("p.text-xs").first().innerText().catch(() => "");
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  await download.saveAs(out + `ours-${name}.pptx`);
  check(`${name}: converted`, true, `${download.suggestedFilename()} in ${ms} ms; ${note}`);
}

await run("deck-editable", "deck.pdf");
await page.screenshot({ path: out + "ui-done.png" });
await run("deck-picture", "deck.pdf", () => page.getByRole("button", { name: /Page pictures/ }).click());
await run("report-16x9", "report.pdf", () => page.getByRole("button", { name: /Widescreen 16:9/ }).click());
await run("deck-range", "deck.pdf", () => page.getByLabel("Pages").fill("2-3"));
check("no POST/PUT requests", posts.length === 0, posts.join(", "));
check("no page errors", errors.length === 0, errors.join(" | "));
writeFileSync(out + "prove.log", log.join("\n") + "\n");
await browser.close();
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);
