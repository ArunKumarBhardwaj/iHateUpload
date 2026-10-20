/**
 * A synthetic AcroForm with one of every field type the Fill form tool handles.
 * Used by the unit tests and the browser proof; no real person's data.
 */
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "@cantoo/pdf-lib";

export async function buildSyntheticForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const page = doc.addPage([612, 792]);
  const label = (text: string, x: number, y: number) =>
    page.drawText(text, { x, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });

  page.drawText("Synthetic test form", { x: 50, y: 740, size: 18, font });

  label("Full name *", 50, 700);
  const name = form.createTextField("applicant.name");
  name.enableRequired();
  name.addToPage(page, { x: 150, y: 692, width: 300, height: 20, font });

  label("Address", 50, 660);
  const address = form.createTextField("applicant.address");
  address.enableMultiline();
  address.addToPage(page, { x: 150, y: 600, width: 300, height: 70, font });

  label("PIN (4)", 50, 570);
  const pin = form.createTextField("pin");
  pin.setMaxLength(4);
  pin.enableCombing();
  pin.addToPage(page, { x: 150, y: 562, width: 100, height: 20, font });

  label("Start date", 50, 540);
  const date = form.createTextField("start.date");
  date.addToPage(page, { x: 150, y: 532, width: 120, height: 20, font });
  const action = doc.context.obj({
    F: { S: "JavaScript", JS: PDFString.of('AFDate_FormatEx("mm/dd/yyyy");') },
    K: { S: "JavaScript", JS: PDFString.of('AFDate_KeystrokeEx("mm/dd/yyyy");') },
  });
  date.acroField.dict.set(PDFName.of("AA"), action);

  label("Case ID", 50, 510);
  const caseId = form.createTextField("case.id");
  caseId.setText("CASE-0001");
  caseId.enableReadOnly();
  caseId.addToPage(page, { x: 150, y: 502, width: 120, height: 20, font });

  label("Subscribe", 50, 480);
  const subscribe = form.createCheckBox("subscribe");
  subscribe.addToPage(page, { x: 150, y: 476, width: 14, height: 14 });

  label("Plan", 50, 450);
  const plan = form.createRadioGroup("plan");
  plan.addOptionToPage("basic", page, { x: 150, y: 446, width: 14, height: 14 });
  plan.addOptionToPage("plus", page, { x: 210, y: 446, width: 14, height: 14 });
  plan.addOptionToPage("pro", page, { x: 270, y: 446, width: 14, height: 14 });
  label("Basic", 168, 449);
  label("Plus", 228, 449);
  label("Pro", 288, 449);

  label("Country", 50, 420);
  const country = form.createDropdown("country");
  country.addOptions(["Canada", "India", "Kenya", "Peru"]);
  country.addToPage(page, { x: 150, y: 412, width: 150, height: 20, font });

  label("Topics", 50, 380);
  const topics = form.createOptionList("topics");
  topics.addOptions(["Billing", "Privacy", "Security", "Support"]);
  topics.enableMultiselect();
  topics.addToPage(page, { x: 150, y: 320, width: 150, height: 70, font });

  // pdf-lib stores its own fitted size in /DA; real forms use 9-12 pt or 0 (auto).
  for (const field of [name, pin, date, caseId, country, topics]) field.setFontSize(10);

  // A second page so widgets on page 2 are tested too.
  const page2 = doc.addPage([612, 792]);
  page2.drawText("Page two", { x: 50, y: 740, size: 14, font });
  page2.drawText("Notes", { x: 50, y: 700, size: 10, font });
  const notes = form.createTextField("notes");
  notes.addToPage(page2, { x: 150, y: 692, width: 300, height: 20, font });
  notes.setFontSize(10);

  // pdf-lib rewrites /DA when it draws appearances on save, so mark Address as
  // auto-size (0 pt, common in real forms) on a second pass that leaves them alone.
  const saved = await PDFDocument.load(await doc.save());
  const auto = saved.getForm().getTextField("applicant.address").acroField;
  auto.setDefaultAppearance("/Helv 0 Tf 0 g");
  for (const widget of auto.getWidgets()) widget.setDefaultAppearance("/Helv 0 Tf 0 g");
  return saved.save({ updateFieldAppearances: false });
}

/** A PDF with text but no form at all. */
export async function buildPlainPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 400]).drawText("No fields here", { x: 40, y: 340, size: 14, font });
  return doc.save();
}
