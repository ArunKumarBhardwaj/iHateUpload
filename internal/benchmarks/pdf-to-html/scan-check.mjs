// Debug: convert the scanned corpus page on our tool and print what the page says. Usage: node scan-check.mjs [mode-regex-source]
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("requestfailed", (r) => console.log("reqfail:", r.url()));
await page.goto("http://localhost:43160/tools/pdf-to-html", { waitUntil: "networkidle" });
await page.setInputFiles('input[aria-label="Choose files"]', new URL("../pdf-to-word/realistic/corpus/scanned-letter.pdf", import.meta.url).pathname);
await page.getByRole("button", { name: "Convert to HTML" }).click();
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(5000);
  console.log(i, (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 300));
  if (await page.getByRole("button", { name: "Download HTML page" }).count()) break;
}
await browser.close();
