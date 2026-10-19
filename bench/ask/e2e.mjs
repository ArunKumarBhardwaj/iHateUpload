// Drives /tools/ask-pdf with the network mocked (no real Gemini call, no key).
// env: PORT, FX (dir from make-fixtures.ts), OUT, PLAYWRIGHT_CORE
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);
const port = process.env.PORT ?? "43154";
const fx = process.env.FX;
const out = process.env.OUT;
mkdirSync(out, { recursive: true });
const FAKE_KEY = "AIza-FAKE-TEST-KEY-0000";
const log = [];
const check = (name, ok, extra = "") => {
  console.log(ok ? "PASS" : "FAIL", name, extra);
  if (!ok) process.exitCode = 1;
};

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.route("**/api/ask", async (route) => {
  const body = route.request().postDataJSON();
  log.push({ via: "server", body });
  await route.fulfill({ json: { answer: `Server answer ${body.messages.length}` } });
});
await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
  const req = route.request();
  log.push({ via: "google", key: req.headers()["x-goog-api-key"], body: req.postDataJSON() });
  await route.fulfill({
    headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
    json: { candidates: [{ content: { parts: [{ text: "Own-key answer" }] } }] },
  });
});

await page.goto(`http://localhost:${port}/tools/ask-pdf`);
await page.waitForTimeout(2500);
await page.setInputFiles('input[type="file"]', [`${fx}/invoice.pdf`, `${fx}/meeting.pdf`]);
await page.waitForSelector('[data-testid="ask-chat"]');
const ask = page.getByLabel("Your question");

// 1. server path, two turns, two files
await ask.fill("What is the total due?");
await page.getByRole("button", { name: "Ask", exact: true }).click();
await page.getByText("Server answer 1").waitFor();
await ask.fill("And the late fee?");
await page.getByRole("button", { name: "Ask", exact: true }).click();
await page.getByText("Server answer 3").waitFor();
const second = log[1].body;
check("server: 2 docs sent", log[0].body.docs.length === 2, log[0].body.docs.map((d) => d.name).join(","));
check("server: doc text carries page markers", log[0].body.docs[0].text.includes("--- Page 2 ---") && log[0].body.docs[0].text.includes("1290"));
check("server: second request has the whole chat", second.messages.map((m) => m.role).join() === "user,assistant,user");
check("server: no PDF bytes sent", !JSON.stringify(log[0].body).includes("%PDF"));
check("notice names the server", (await page.getByTestId("ask-notice").innerText()).includes("our server"));
await page.screenshot({ path: `${out}/1-server-chat.png`, fullPage: true });

// 2. own key, remember off: nothing stored, nothing to our server
await page.getByRole("button", { name: "New chat" }).click();
await page.getByRole("button", { name: "My own Gemini key" }).click();
check("notice says straight to Google", (await page.getByTestId("ask-notice").innerText()).includes("straight from this browser"));
await page.getByLabel("Gemini API key").fill(FAKE_KEY);
await ask.fill("Who sends the budget?");
const before = log.length;
await page.getByRole("button", { name: "Ask", exact: true }).click();
await page.getByText("Own-key answer").waitFor();
const own = log.slice(before);
check("own key: only Google was called", own.length === 1 && own[0].via === "google");
check("own key: key header sent to Google", own[0].key === FAKE_KEY);
check("own key: both files in the request", own[0].body.contents[0].parts[0].text.includes("invoice.pdf") && own[0].body.contents[0].parts[0].text.includes("meeting.pdf"));
const stored = () => page.evaluate(() => Object.entries(localStorage).filter(([k]) => /ask/i.test(k)));
check("own key: not stored when remember is off", (await stored()).length === 0);
await page.screenshot({ path: `${out}/2-own-key-chat.png`, fullPage: true });

// 3. remember on: stored in this browser, restored after reload
await page.getByLabel("Remember the key in this browser").check();
await ask.fill("Anything else?");
await page.getByRole("button", { name: "Ask", exact: true }).click();
await page.getByText("Own-key answer").nth(1).waitFor();
check("remember: stored locally", (await stored()).length === 1);
await page.reload();
await page.waitForTimeout(2500);
await page.setInputFiles('input[type="file"]', [`${fx}/invoice.pdf`]);
await page.waitForSelector('[data-testid="ask-chat"]');
check("remember: key restored after reload", (await page.getByLabel("Gemini API key").inputValue()) === FAKE_KEY);
await page.getByLabel("Remember the key in this browser").uncheck();
check("untick forgets the key", (await stored()).length === 0);

// 4. a PDF with no text says so
await page.getByRole("button", { name: "Add a PDF (1/10)" }).click().catch(() => {});
await page.setInputFiles('input[type="file"]', [`${fx}/scan-only.pdf`]);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/3-no-text.png`, fullPage: true });
check("no-text PDF is flagged", await page.getByText("No selectable text").isVisible());
const footer = await page.locator("footer").innerText();
check("footer is honest on this page", footer.includes("Only text is sent") && !footer.includes("Nothing is uploaded"));
await browser.close();
