// Reads a filled PDF back with pdf-lib and pdf.js. Usage: bun internal/benchmarks/fill-form/verify.ts <editable.pdf> <flat.pdf>
import { readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [editablePath, flatPath] = process.argv.slice(2);
const expected: Record<string, unknown> = {
  "applicant.name": "Ada Example",
  "applicant.address": "12 Test Lane\nSampletown",
  pin: "4821",
  "start.date": "11/05/2026",
  "case.id": "CASE-0001",
  subscribe: true,
  plan: "plus",
  country: ["Kenya"],
  topics: ["Privacy", "Support"],
  notes: "Second page note",
};
let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

if (editablePath) {
  const bytes = new Uint8Array(readFileSync(editablePath));
  const form = (await PDFDocument.load(bytes)).getForm();
  const got: Record<string, unknown> = {
    "applicant.name": form.getTextField("applicant.name").getText(),
    "applicant.address": form.getTextField("applicant.address").getText(),
    pin: form.getTextField("pin").getText(),
    "start.date": form.getTextField("start.date").getText(),
    "case.id": form.getTextField("case.id").getText(),
    subscribe: form.getCheckBox("subscribe").isChecked(),
    plan: form.getRadioGroup("plan").getSelected(),
    country: form.getDropdown("country").getSelected(),
    topics: form.getOptionList("topics").getSelected(),
    notes: form.getTextField("notes").getText(),
  };
  for (const [k, v] of Object.entries(expected)) check(`pdf-lib ${k}`, JSON.stringify(got[k]) === JSON.stringify(v), JSON.stringify(got[k]));

  const doc = await getDocument({ data: bytes }).promise;
  const js: Record<string, unknown> = {};
  for (let n = 1; n <= doc.numPages; n++) {
    for (const a of await (await doc.getPage(n)).getAnnotations()) {
      if (!a.fieldName) continue;
      if (a.checkBox) js[a.fieldName] = a.fieldValue === a.exportValue;
      else if (a.radioButton) { if (a.fieldValue === a.buttonValue) js[a.fieldName] = a.buttonValue; }
      else js[a.fieldName] = a.fieldValue;
    }
  }
  const objects = (await doc.getFieldObjects()) ?? {};
  const planObj = (objects.plan as Array<{ value: string }>).find((w) => w.value && w.value !== "Off");
  check("pdf.js text fields", js["applicant.name"] === "Ada Example" && js.pin === "4821" && js.notes === "Second page note" && js["start.date"] === "11/05/2026");
  check("pdf.js checkbox", js.subscribe === true);
  check("pdf.js radio (export value)", planObj?.value === "plus", planObj?.value);
  check("pdf.js dropdown", JSON.stringify(js.country) === JSON.stringify(["Kenya"]), JSON.stringify(js.country));
  check("pdf.js list box", JSON.stringify(js.topics) === JSON.stringify(["Privacy", "Support"]), JSON.stringify(js.topics));
  await doc.loadingTask.destroy();
}

if (flatPath) {
  const bytes = new Uint8Array(readFileSync(flatPath));
  const pdf = await PDFDocument.load(bytes);
  check("flatten: pdf-lib sees no fields", pdf.getForm().getFields().length === 0);
  const doc = await getDocument({ data: bytes }).promise;
  let text = "";
  let widgets = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    widgets += (await page.getAnnotations()).filter((a) => a.subtype === "Widget").length;
    text += (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ") + " ";
  }
  check("flatten: comb PIN on page", /4\s+8\s+2\s+1/.test(text));
  check("flatten: pdf.js sees no widgets", widgets === 0, String(widgets));
  for (const s of ["Ada Example", "Sampletown", "11/05/2026", "CASE-0001", "Kenya", "Second page note"]) {
    check(`flatten: text "${s}" on page`, text.includes(s));
  }
  await doc.loadingTask.destroy();
}
const unicodePath = process.argv[4];
if (unicodePath) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(unicodePath)) }).promise;
  const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
  check("unicode name drawn as page text", text.includes("Łukasz Ωmega Дмитрий"));
  await doc.loadingTask.destroy();
}
process.exit(failed ? 1 : 0);
