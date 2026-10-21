// Opens every allowlisted tool's settings panel with no file, then checks failure isolation and the share link (cancel is covered by unit tests).
// Usage: node internal/benchmarks/workflows/smoke.mjs [--base URL] [--corpus DIR]
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:43161");
const CORPUS = arg("corpus", "corpus");
const npx = join(homedir(), ".npm/_npx");
const pw = readdirSync(npx).map((d) => join(npx, d, "node_modules/playwright-core/index.mjs")).find(existsSync);
const { chromium } = await import(pw);
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.goto(BASE + "/tools/workflow", { waitUntil: "networkidle" });

const select = page.getByLabel("Add a step");
const options = await select.locator("option").evaluateAll((os) => os.map((o) => [o.value, o.textContent]).filter(([v]) => v));
console.log("tools in picker (first step):", options.length);
for (const [id, title] of options) {
  const before = errors.length;
  await select.selectOption(id);
  const step = page.getByTestId("wf-step").last();
  const text = await step.innerText();
  const ok = text.includes(title.split(" ")[0]) && errors.length === before;
  if (!ok) console.log("PROBLEM", id, errors.slice(before));
  await step.getByRole("button", { name: "Remove step 1" }).click();
}
console.log("panel errors:", errors.length, errors);

// Failure isolation: one corrupt PDF among good ones.
await page.goto(BASE + "/tools/workflow", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Email ready/ }).click();
const brokenPath = join(CORPUS, "broken.pdf");
writeFileSync(brokenPath, "this is not a pdf");
const good = readdirSync(join(CORPUS, "pdf")).slice(0, 3).map((f) => join(CORPUS, "pdf", f));
await page.locator("input[type=file]").setInputFiles([
  ...good,
  brokenPath,
]);
await page.getByRole("button", { name: /^Run on/ }).click();
await page.getByTestId("wf-results").waitFor({ timeout: 120000 });
console.log("isolation:", (await page.getByTestId("wf-results").innerText()).replace(/\n+/g, " | ").slice(0, 300));

// Share link round trip, password stripped.
await page.goto(BASE + "/tools/workflow", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Merge, compress, protect/ }).click();
await page.getByTestId("wf-step").nth(2).getByRole("button", { name: /Settings/ }).click();
await page.locator("input[type=password]").first().fill("topsecret-123");
await page.locator("input[type=password]").nth(1).fill("topsecret-123");
await page.getByRole("button", { name: /Copy share link/ }).click();
await page.waitForTimeout(300);
const hash = await page.evaluate(() => location.hash);
console.log("hash has password:", hash.includes("topsecret"), "decoded has password:", Buffer.from(hash.slice(3).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString().includes("topsecret"));
await page.goto(BASE + "/tools/workflow" + hash, { waitUntil: "networkidle" });
await page.reload({ waitUntil: "networkidle" });
console.log("steps after load:", (await page.getByTestId("wf-step").allInnerTexts()).map((t) => t.split("\n")[1]));
console.log("notice:", await page.getByRole("status").first().innerText());
await browser.close();
