// Drives the real Repair PDF page on a production build with all damaged fixtures at once.
// Usage: node internal/benchmarks/repair/prove.mjs [port]   (fixtures from write.ts)
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const port = process.argv[2] ?? "43127";
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
const browserOut = out + "browser/";
mkdirSync(browserOut, { recursive: true });
const files = readdirSync(fx).filter((f) => f.endsWith(".pdf")).sort();

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1100 } })).newPage();
const errors = [];
const posts = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => { if (["POST", "PUT"].includes(r.method())) posts.push(r.url()); });
const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); console.log(log.at(-1)); };

await page.goto(`http://localhost:${port}/tools/repair-pdf`, { waitUntil: "networkidle" });
await page.setInputFiles('input[aria-label="Choose files"]', files.map((f) => fx + f));
const start = Date.now();
await page.getByRole("button", { name: "Repair PDF", exact: true }).click();
const all = page.getByRole("button", { name: /Download all/ });
await all.waitFor({ timeout: 120000 });
const ms = Date.now() - start;
check("batch of 9 repaired", true, `${ms} ms total`);
const notes = await page.locator("p.text-xs").allInnerTexts();
const recovered = notes.filter((n) => /recovered/.test(n));
check("a report line per file", recovered.length === files.length, `${recovered.length} lines`);
for (const n of recovered) console.log("   ", n);
check("truncated report names the cut-off pages", recovered.some((n) => /2 cut-off pages were left out/.test(n)));
await page.screenshot({ path: out + "ui-results.png", fullPage: true });
const [download] = await Promise.all([page.waitForEvent("download"), all.click()]);
await download.saveAs(browserOut + "results.zip");
execFileSync("unzip", ["-o", "-q", browserOut + "results.zip", "-d", browserOut]);
check("zip holds one repaired PDF per input", readdirSync(browserOut).filter((f) => f.endsWith("-repaired.pdf")).length === files.length);
check("no POST/PUT requests", posts.length === 0, posts.join(", "));
check("no page errors", errors.length === 0, errors.join(" | "));
writeFileSync(out + "prove.log", log.join("\n") + "\n" + recovered.join("\n") + "\n");
await browser.close();
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);
