import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { buildPlainPdf, buildSyntheticForm } from "./fill-form.fixture";
import {
  fillForm,
  formatDate,
  missingRequired,
  parseDate,
  parseDateFormat,
  readForm,
  type FieldValue,
} from "./fill-form";
import { initialOptions, optionsReady } from "./tool-options";

const VALUES: Record<string, FieldValue> = {
  "applicant.name": "Ada Example",
  "applicant.address": "12 Test Lane\nSampletown",
  pin: "4821",
  "start.date": "11/05/2026",
  "case.id": "SHOULD-NOT-WRITE",
  subscribe: true,
  plan: "plus",
  country: "Kenya",
  topics: ["Privacy", "Support"],
  notes: "Second page note",
};

async function pdfjsValues(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice() }).promise;
  try {
    const objects = (await doc.getFieldObjects()) ?? {};
    const out: Record<string, unknown> = {};
    for (const [name, list] of Object.entries(objects)) {
      const widgets = list as Array<{ value: unknown; exportValues?: string; type?: string }>;
      out[name] = widgets.find((w) => w.value !== undefined && w.value !== "Off" && w.value !== "")?.value ?? widgets[0]?.value;
    }
    // Scripting objects show one pick of a multi-select list; the annotation carries them all.
    for (let n = 1; n <= doc.numPages; n++) {
      for (const annot of await (await doc.getPage(n)).getAnnotations()) {
        if (annot.fieldType === "Ch" && annot.multiSelect) out[annot.fieldName] = annot.fieldValue;
      }
    }
    return out;
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function pageText(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice() }).promise;
  try {
    let text = "";
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
    }
    return text;
  } finally {
    await doc.loadingTask.destroy();
  }
}

test("reads every field type with its flags, widgets and reading order", async () => {
  const info = await readForm(await buildSyntheticForm());
  expect(info.encrypted).toBe(false);
  const byName = Object.fromEntries(info.fields.map((f) => [f.name, f]));
  expect(info.fields.map((f) => f.name)).toEqual([
    "applicant.name", "applicant.address", "pin", "start.date", "case.id",
    "subscribe", "plan", "country", "topics", "notes",
  ]);
  expect(byName["applicant.name"].required).toBe(true);
  expect(byName["applicant.address"].multiline).toBe(true);
  expect(byName.pin.maxLength).toBe(4);
  expect(byName.pin.comb).toBe(true);
  expect(byName["start.date"].dateFormat).toBe("mm/dd/yyyy");
  expect(byName["case.id"].readOnly).toBe(true);
  expect(byName["case.id"].value).toBe("CASE-0001");
  expect(byName.subscribe.type).toBe("checkbox");
  expect(byName.plan.type).toBe("radio");
  expect(byName.plan.widgets.map((w) => w.onValue)).toEqual(["basic", "plus", "pro"]);
  expect(byName.country.type).toBe("dropdown");
  expect(byName.country.options).toEqual(["Canada", "India", "Kenya", "Peru"]);
  expect(byName.topics.type).toBe("listbox");
  expect(byName.topics.multiSelect).toBe(true);
  expect(byName.notes.widgets[0].pageIndex).toBe(1);
  // pdf-lib pads the rect by half the 1pt border.
  expect(byName["applicant.name"].widgets[0].rect).toEqual([149.5, 691.5, 450.5, 712.5]);
});

test("a PDF with no form reports no fields", async () => {
  const info = await readForm(await buildPlainPdf());
  expect(info.fields).toEqual([]);
  await expect(fillForm(await buildPlainPdf(), { values: {}, flatten: false })).rejects.toThrow(/no form fields/);
});

test("keep editable: values read back in pdf-lib and pdf.js, read-only untouched", async () => {
  const out = await fillForm(await buildSyntheticForm(), { values: VALUES, flatten: false });
  const doc = await PDFDocument.load(out);
  const form = doc.getForm();
  expect(form.getTextField("applicant.name").getText()).toBe("Ada Example");
  expect(form.getTextField("applicant.address").getText()).toBe("12 Test Lane\nSampletown");
  expect(form.getTextField("pin").getText()).toBe("4821");
  expect(form.getTextField("start.date").getText()).toBe("11/05/2026");
  expect(form.getTextField("case.id").getText()).toBe("CASE-0001");
  expect(form.getCheckBox("subscribe").isChecked()).toBe(true);
  expect(form.getRadioGroup("plan").getSelected()).toBe("plus");
  expect(form.getDropdown("country").getSelected()).toEqual(["Kenya"]);
  expect(form.getOptionList("topics").getSelected()).toEqual(["Privacy", "Support"]);
  expect(form.getTextField("notes").getText()).toBe("Second page note");

  // Every widget has a normal appearance, so viewers that never regenerate still show values.
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      expect(widget.getAppearances()?.normal).toBeDefined();
    }
  }
  // Radio widget states follow the value.
  const states = form.getRadioGroup("plan").acroField.getWidgets().map((w) => w.getAppearanceState()?.decodeText());
  expect(states).toEqual(["Off", "1", "Off"]); // pdf-lib names on-states by index, /Opt holds "plus"

  const js = await pdfjsValues(out);
  expect(js["applicant.name"]).toBe("Ada Example");
  expect(js.pin).toBe("4821");
  expect(js.subscribe).toBe("Yes");
  expect(js.plan).toBe("plus");
  expect(js.country).toBe("Kenya");
  expect(js.topics).toEqual(["Privacy", "Support"]);
  expect(js.notes).toBe("Second page note");
});

test("flatten removes every field and keeps the values as page text", async () => {
  const out = await fillForm(await buildSyntheticForm(), { values: VALUES, flatten: true });
  const doc = await PDFDocument.load(out);
  expect(doc.getForm().getFields()).toHaveLength(0);
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    const widgets = annots && "asArray" in annots
      ? (annots as { asArray(): unknown[] }).asArray().length
      : 0;
    expect(widgets).toBe(0);
  }
  const text = await pageText(out);
  expect(text).toMatch(/4\s+8\s+2\s+1/); // comb cells draw one letter each
  for (const expected of ["Ada Example", "Sampletown",  "11/05/2026", "CASE-0001", "Kenya", "Privacy", "Second page note"]) {
    expect(text).toContain(expected);
  }
});

test("auto-size (0 pt) fields get an Acrobat-like size that fits, not pdf-lib's giant one", async () => {
  const out = await fillForm(await buildSyntheticForm(), { values: VALUES, flatten: false });
  const form = (await PDFDocument.load(out)).getForm();
  const da = form.getTextField("applicant.address").acroField.getDefaultAppearance() ?? "";
  const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1]);
  expect(size).toBeGreaterThan(4);
  expect(size).toBeLessThanOrEqual(12);
});

test("max length trims, single-line drops newlines", async () => {
  const out = await fillForm(await buildSyntheticForm(), {
    values: { ...VALUES, pin: "123456", "applicant.name": "Line\nTwo" },
    flatten: false,
  });
  const form = (await PDFDocument.load(out)).getForm();
  expect(form.getTextField("pin").getText()).toBe("1234");
  expect(form.getTextField("applicant.name").getText()).toBe("Line Two");
});

test("required fields block the save until filled", async () => {
  const bytes = await buildSyntheticForm();
  const info = await readForm(bytes);
  expect(missingRequired(info.fields, {}).map((f) => f.name)).toEqual(["applicant.name"]);
  expect(missingRequired(info.fields, { "applicant.name": "  " })).toHaveLength(1);
  expect(missingRequired(info.fields, VALUES)).toHaveLength(0);
  await expect(fillForm(bytes, { values: { pin: "1" }, flatten: false })).rejects.toThrow(/required/);
});

test("clearing a checkbox, radio and dropdown that were set", async () => {
  const first = await fillForm(await buildSyntheticForm(), { values: VALUES, flatten: false });
  const second = await fillForm(first, {
    values: { "applicant.name": "Ada Example", subscribe: false, plan: "", country: "", topics: [] },
    flatten: false,
  });
  const form = (await PDFDocument.load(second)).getForm();
  expect(form.getCheckBox("subscribe").isChecked()).toBe(false);
  expect(form.getRadioGroup("plan").getSelected()).toBeUndefined();
  expect(form.getDropdown("country").getSelected()).toEqual([]);
  expect(form.getOptionList("topics").getSelected()).toEqual([]);
});

test("letters outside WinAnsi use the embedded Unicode font", async () => {
  const fontBytes = () => Promise.resolve(new Uint8Array(readFileSync(join(import.meta.dir, "../../public/fonts/LiberationSans-Regular.ttf"))));
  const out = await fillForm(await buildSyntheticForm(), {
    values: { ...VALUES, "applicant.name": "Łukasz Ωmega Дмитрий" },
    flatten: true,
    loadUnicodeFont: fontBytes,
  });
  expect(await pageText(out)).toContain("Łukasz Ωmega Дмитрий");
  await expect(
    fillForm(await buildSyntheticForm(), { values: { ...VALUES, "applicant.name": "测试" }, flatten: false, loadUnicodeFont: fontBytes }),
  ).rejects.toThrow(/cannot be drawn/);
});

test("date format helpers round-trip", () => {
  expect(parseDateFormat('AFDate_FormatEx("dd.mm.yyyy");')).toBe("dd.mm.yyyy");
  expect(parseDateFormat('AFDate_FormatEx("mm/dd/yy HH:MM");')).toBeUndefined();
  expect(parseDateFormat("AFNumber_Format(2,0,0,0,'',true);")).toBeUndefined();
  expect(formatDate("2026-03-07", "mm/dd/yyyy")).toBe("03/07/2026");
  expect(formatDate("2026-03-07", "d mmm yyyy")).toBe("7 Mar 2026");
  expect(formatDate("2026-03-07", "mmmm d, yyyy")).toBe("March 7, 2026");
  expect(parseDate("03/07/2026", "mm/dd/yyyy")).toBe("2026-03-07");
  expect(parseDate("7 Mar 2026", "d mmm yyyy")).toBe("2026-03-07");
  expect(parseDate("07.03.26", "dd.mm.yy")).toBe("2026-03-07");
  expect(parseDate("nonsense", "mm/dd/yyyy")).toBeUndefined();
});

test("fill-form options are ready only when fields are loaded and required ones filled", () => {
  const opts = initialOptions("fill-form");
  expect(opts.kind).toBe("fill-form");
  expect(optionsReady(opts, "")).toBe(false);
  if (opts.kind !== "fill-form") return;
  expect(optionsReady({ ...opts, fieldCount: 3, missing: [] }, "")).toBe(true);
  expect(optionsReady({ ...opts, fieldCount: 3, missing: ["Name"] }, "")).toBe(false);
  expect(optionsReady({ ...opts, fieldCount: 0, missing: [] }, "")).toBe(false);
});
