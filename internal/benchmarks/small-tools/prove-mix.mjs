// Drives the real Alternate & Mix page on a production build; checks page order by extracting text from every output page.
// Usage: node prove-mix.mjs [port]   (run `bun gen.ts` first)
import { createRequire } from "node:module";
import { mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { pageTexts } from "./pagetext.mjs";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const port = process.argv[2] ?? "43162";
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/mix/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1500 } })).newPage();
const posts = [], errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => { if (["POST", "PUT"].includes(r.method())) posts.push(r.url()); });
let failed = false;
const check = (name, ok, detail = "") => { if (!ok) failed = true; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

async function run(label, files, setup, expected) {
  await page.goto(`http://localhost:${port}/tools/alternate-mix`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[aria-label="Choose files"]', files.map((f) => fx + f));
  await page.getByText("Resulting order").waitFor();
  await page.waitForTimeout(800);
  await setup();
  const preview = (await page.getByTestId("mix-order").innerText()).replace(/\s+/g, " ");
  const start = Date.now();
  await page.getByRole("button", { name: "Mix pages", exact: true }).click();
  const dl = page.getByRole("button", { name: /^Download/ }).first();
  await dl.waitFor({ timeout: 60000 });
  const ms = Date.now() - start;
  const [download] = await Promise.all([page.waitForEvent("download"), dl.click()]);
  const path = out + label + ".pdf";
  await download.saveAs(path);
  const got = (await pageTexts(path)).join(" ");
  check(label, got === expected, `${got} (${ms} ms)`);
  check(label + " preview page count", preview.includes(`${expected.split(" ").length} pages`), preview);
  await page.screenshot({ path: out + label + ".png", fullPage: true });
}

await run("duplex", ["fronts.pdf", "backs.pdf"],
  () => page.getByRole("button", { name: /Duplex scan/ }).click(),
  "F1 B1 F2 B2 F3 B3 F4 B4");
await run("plain-no-reverse", ["fronts.pdf", "backs.pdf"], async () => {}, "F1 B4 F2 B3 F3 B2 F4 B1");
await run("unequal-append", ["fronts.pdf", "short.pdf"], async () => {}, "F1 S1 F2 S2 F3 F4");
await run("unequal-stop", ["fronts.pdf", "short.pdf"],
  () => page.getByRole("button", { name: "Stop at the shortest" }).click(),
  "F1 S1 F2 S2");
await run("two-per-turn", ["fronts.pdf", "short.pdf"],
  () => page.getByLabel("Pages per turn from fronts.pdf").fill("2"),
  "F1 F2 S1 F3 F4 S2");
await run("three-files", ["fronts.pdf", "backs.pdf", "short.pdf"], async () => {}, "F1 B4 S1 F2 B3 S2 F3 B2 F4 B1");

check("no POST/PUT requests", posts.length === 0, posts.join(", "));
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(failed ? 1 : 0);
