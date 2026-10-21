import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/arunbhardwaj/.npm/_npx/af752b90495482d7/node_modules/playwright-core");
const C = "/private/tmp/claude-501/-Users-arunbhardwaj-Desktop-Projects-iHateUpload/1a3c1933-ee15-427e-aa2f-bd2773319e50/scratchpad/corpus";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const posts = [];
p.on("request", (r) => r.method() === "POST" && posts.push(r.url()));
await p.goto("https://www.ihatepdf.cv/workflow", { waitUntil: "networkidle" });
await p.waitForTimeout(4000);
await p.locator("input[type=file]").first().setInputFiles(C + "/pdf/doc-01.pdf");
await p.waitForTimeout(3000);
console.log((await p.innerText("main")).slice(0, 4000));
console.log("BUTTONS", (await p.$$eval("button", (is) => is.map((i) => i.textContent.trim().slice(0, 40)))).slice(14).join(" | "));
await p.screenshot({ path: process.argv[2], fullPage: true });
// try preset
const preset = p.getByText("Email Ready").first();
if (await preset.count()) { await preset.click(); await p.waitForTimeout(1500); console.log("---AFTER PRESET---"); console.log((await p.innerText("main")).slice(0, 3000)); await p.screenshot({ path: process.argv[2].replace(".png", "-preset.png"), fullPage: true }); }
console.log("POSTS", posts);
await b.close();
