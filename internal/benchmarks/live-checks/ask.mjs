// Ask PDF on the live site with the server's own Gemini key: two questions, one follow-up.
// Usage: node internal/benchmarks/live-checks/ask.mjs [origin]
import { createRequire } from "node:module";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
const npx = homedir() + "/.npm/_npx/";
const dir = readdirSync(npx).find((d) => { try { return readdirSync(npx + d + "/node_modules").includes("playwright-core"); } catch { return false; } });
const { chromium } = createRequire(npx + dir + "/node_modules/")("playwright-core");
const origin = process.argv[2] ?? "https://www.ihateupload.com";
const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
const errors = [];
const posts = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => { if (r.method() === "POST") posts.push(new URL(r.url()).host + new URL(r.url()).pathname); });
const timings = [];
page.on("response", (r) => { if (r.url().endsWith("/api/ask")) timings.push(`${r.status()} ${r.headers()["server-timing"] ?? "(no timing header)"}`); });
const log = [];
const check = (name, ok, detail = "") => { log.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); console.log(log.at(-1)); };

await page.goto(`${origin}/tools/ask-pdf`, { waitUntil: "networkidle" });
await page.setInputFiles('input[aria-label="Choose files"]', fx + "brief.pdf");
const box = page.getByLabel("Your question");
await box.waitFor();
await page.getByText("Ask anything about these PDFs.").waitFor({ timeout: 30000 });

async function ask(question, expect) {
  await box.fill(question);
  const start = Date.now();
  await page.getByRole("button", { name: "Ask" }).click();
  // The chat shows "Waiting for Gemini…" until the answer is in.
  await page.getByText("Waiting for Gemini…").waitFor({ timeout: 10000 }).catch(() => {});
  const answered = await page.getByText("Waiting for Gemini…").waitFor({ state: "hidden", timeout: 120000 }).then(() => true, () => false);
  const text = await page.locator("main").innerText();
  if (!answered) check(`answered within 120 s: ${question}`, false);
  const at = text.lastIndexOf(question);
  const added = text.slice(at + question.length, at + question.length + 600).replace(/\s+/g, " ").trim();
  const ok = expect.every((re) => re.test(added));
  check(`answer: ${question}`, ok, `${Date.now() - start} ms — ${added.slice(0, 160)}`);
}
await ask("What is the project codename and the approved budget?", [/heron/i, /7[,.\s]?340/]);
await ask("And when is the deadline?", [/14\s+March\s+2027|March\s+14,?\s+2027|2027-03-14/i]);
await page.screenshot({ path: out + "ask.png", fullPage: true });
check("only our own /api/ask was called", posts.length > 0 && posts.every((p) => p.endsWith("/api/ask") || p.includes("vercel")), posts.join(", "));
check("no page errors", errors.length === 0, errors.join(" | "));
for (const t of timings) console.log("   server:", t);
writeFileSync(out + "ask.log", log.join("\n") + "\n" + timings.join("\n") + "\n");
await browser.close();
