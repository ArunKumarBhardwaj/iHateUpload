/**
 * Fill PDF form: read a PDF's AcroForm fields, write typed values back, and
 * either keep the fields editable or flatten them into the page.
 *
 * Values always get fresh appearance streams, so Acrobat, Chrome (PDFium) and
 * macOS Preview all show what was typed without having to regenerate anything.
 */
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFString,
  PDFHexString,
  PDFTextField,
  PDFDict,
  PDFArray,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  type PDFField,
  type PDFWidgetAnnotation,
  type PDFFont,
} from "@cantoo/pdf-lib";

export type FormFieldType =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "listbox"
  | "signature";

export type FieldValue = string | boolean | string[];

export type FormWidget = {
  pageIndex: number;
  /** PDF user space, [x1, y1, x2, y2] as the widget's /Rect stores it. */
  rect: [number, number, number, number];
  /** Checkbox and radio: the value this widget stands for. */
  onValue?: string;
};

export type FormField = {
  name: string;
  type: FormFieldType;
  /** What a person should read: the tooltip (/TU) when there is one, else the short name. */
  label: string;
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  password: boolean;
  comb: boolean;
  maxLength?: number;
  /** Acrobat date format from AFDate_FormatEx, e.g. "mm/dd/yyyy". */
  dateFormat?: string;
  /** AFNumber_Format: digits only. */
  numeric: boolean;
  options: string[];
  /** Dropdown that also accepts typed text. */
  editable: boolean;
  multiSelect: boolean;
  value: FieldValue;
  /** Points; 0 means auto-size. */
  fontSize: number;
  align: "left" | "center" | "right";
  widgets: FormWidget[];
};

export type FormInfo = {
  fields: FormField[];
  encrypted: boolean;
  hasXfa: boolean;
};

/** Load options shared by reading and writing. */
async function load(bytes: Uint8Array | ArrayBuffer) {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

function decode(value: unknown): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return undefined;
}

/** The JavaScript text of an /AA action entry, if the field carries one. */
function actionScript(field: PDFField, key: "F" | "K"): string {
  const aa = field.acroField.dict.lookupMaybe(PDFName.of("AA"), PDFDict);
  const action = aa?.lookupMaybe(PDFName.of(key), PDFDict);
  const js = action?.lookup(PDFName.of("JS"));
  const text = decode(js);
  if (text !== undefined) return text;
  // A JS stream: rare in forms, but read it rather than miss the format.
  if (js instanceof PDFRawStream) {
    try {
      return new TextDecoder("latin1").decode(decodePDFRawStream(js).decode());
    } catch {
      return "";
    }
  }
  return "";
}

/** Date tokens we can round-trip. Formats with time parts stay plain text. */
export function parseDateFormat(script: string): string | undefined {
  const match = /AFDate_(?:Format|Keystroke)Ex\(\s*["']([^"']+)["']\s*\)/.exec(script);
  if (!match) {
    const legacy = /AFDate_(?:Format|Keystroke)\(\s*(\d+)\s*\)/.exec(script);
    if (!legacy) return undefined;
    // Acrobat's numbered presets that are date-only.
    const presets = ["m/d", "m/d/yy", "mm/dd/yy", "mm/yy", "d-mmm", "d-mmm-yy", "dd-mmm-yy", "yy-mm-dd", "mmm-yy", "mmmm-yy", "mmm d, yyyy", "mmmm d, yyyy", "m/d/yy h:MM tt", "m/d/yy HH:MM"];
    const preset = presets[Number(legacy[1])];
    return preset && !/[hHMt]/.test(preset.replace(/mmm+/g, "")) ? preset : undefined;
  }
  const format = match[1];
  // "MM" is minutes, "h"/"H" hours, "tt" am/pm: not a pure date.
  if (/[HhMt]/.test(format)) return undefined;
  return format;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-10-20" written in an Acrobat date format. */
export function formatDate(iso: string, format: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return format.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/g, (token) => {
    switch (token) {
      case "yyyy": return String(year).padStart(4, "0");
      case "yy": return String(year % 100).padStart(2, "0");
      case "mmmm": return MONTHS[month - 1];
      case "mmm": return MONTHS[month - 1].slice(0, 3);
      case "mm": return String(month).padStart(2, "0");
      case "m": return String(month);
      case "dd": return String(day).padStart(2, "0");
      default: return String(day);
    }
  });
}

/** The reverse of formatDate, so a value already in the PDF fills the date picker. */
export function parseDate(text: string, format: string): string | undefined {
  const order: string[] = [];
  const pattern = format.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/g, (token) => {
    order.push(token);
    if (token === "mmmm" || token === "mmm") return "([A-Za-z]+)";
    if (token === "yyyy") return "(\\d{4})";
    return "(\\d{1,2})";
  });
  const match = new RegExp(`^\\s*${pattern}\\s*$`, "i").exec(text);
  if (!match) return undefined;
  let year = NaN;
  let month = NaN;
  let day = NaN;
  order.forEach((token, i) => {
    const part = match[i + 1];
    if (token === "yyyy") year = Number(part);
    else if (token === "yy") year = 2000 + Number(part) - (Number(part) > 69 ? 100 : 0);
    else if (token.startsWith("mmm")) month = MONTHS.findIndex((name) => name.toLowerCase().startsWith(part.toLowerCase().slice(0, 3))) + 1;
    else if (token.startsWith("m")) month = Number(part);
    else day = Number(part);
  });
  if (!(year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daSize(da: string | undefined): number {
  const match = /([\d.]+)\s+Tf/.exec(da ?? "");
  return match ? Number(match[1]) : 0;
}

/** Widget dict -> page index, for widgets that lack /P or point at the wrong page. */
function widgetPages(doc: PDFDocument): Map<PDFRef, number> {
  const pages = new Map<PDFRef, number>();
  doc.getPages().forEach((page, index) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (ref instanceof PDFRef) pages.set(ref, index);
    }
  });
  return pages;
}

function pageOf(doc: PDFDocument, pages: Map<PDFRef, number>, widgetDict: PDFDict, parentP?: PDFRef): number {
  const ref = doc.context.getObjectRef(widgetDict);
  if (ref && pages.has(ref)) return pages.get(ref)!;
  const p = widgetDict.get(PDFName.of("P")) ?? parentP;
  if (p instanceof PDFRef) {
    const index = doc.getPages().findIndex((page) => page.ref === p);
    if (index >= 0) return index;
  }
  return -1;
}

/** What a radio or checkbox widget means: its /Opt export value, else its on-state name. */
function exportOf(widget: PDFWidgetAnnotation, index: number, exportValues: Array<string | undefined> | null): string {
  return exportValues?.[index] ?? widget.getOnValue()?.decodeText() ?? "Yes";
}

function typeOf(field: PDFField): FormFieldType | null {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "listbox";
  if (field instanceof PDFSignature) return "signature";
  return null; // push buttons do nothing on paper
}

function currentValue(field: PDFField, type: FormFieldType): FieldValue {
  switch (type) {
    case "text":
      return (field as PDFTextField).getText() ?? "";
    case "checkbox":
      return (field as PDFCheckBox).isChecked();
    case "radio":
      return (field as PDFRadioGroup).getSelected() ?? "";
    case "dropdown":
      return (field as PDFDropdown).getSelected()[0] ?? "";
    case "listbox":
      return (field as PDFOptionList).getSelected();
    case "signature":
      return "";
  }
}

/** Every fillable field with its widgets, in reading order (page, top to bottom, left to right). */
export async function readForm(bytes: Uint8Array | ArrayBuffer): Promise<FormInfo> {
  const doc = await load(bytes);
  const encrypted = doc.isEncrypted;
  if (encrypted) return { fields: [], encrypted, hasXfa: false };
  const form = doc.getForm();
  const pages = widgetPages(doc);
  const fields: FormField[] = [];
  for (const field of form.getFields()) {
    const type = typeOf(field);
    if (!type) continue;
    const acro = field.acroField;
    const tu = decode(acro.dict.lookup(PDFName.of("TU")));
    const partial = acro.getPartialName() ?? field.getName();
    const text = field instanceof PDFTextField ? field : null;
    const script = actionScript(field, "F") + "\n" + actionScript(field, "K");
    const widgets: FormWidget[] = [];
    const widgetList = acro.getWidgets();
    const exportValues = field instanceof PDFRadioGroup || field instanceof PDFCheckBox
      ? (acro.dict.lookupMaybe(PDFName.of("Opt"), PDFArray)?.asArray().map(decode) ?? null)
      : null;
    widgetList.forEach((widget, index) => {
      const pageIndex = pageOf(doc, pages, widget.dict, acro.dict.get(PDFName.of("P")) as PDFRef | undefined);
      if (pageIndex < 0) return;
      const r = widget.getRectangle();
      const rect: FormWidget["rect"] = [r.x, r.y, r.x + r.width, r.y + r.height];
      if (r.width <= 0 || r.height <= 0) return;
      widgets.push({
        pageIndex,
        rect,
        ...(type === "checkbox" || type === "radio" ? { onValue: exportOf(widget, index, exportValues) } : {}),
      });
    });
    if (widgets.length === 0) continue;
    // Viewers use the widget's own /DA first, then the field's.
    const da = widgetList[0]?.getDefaultAppearance() ?? acro.getDefaultAppearance?.() ?? undefined;
    const quadding = acro.dict.lookup(PDFName.of("Q"));
    const q = quadding && "asNumber" in quadding ? (quadding as { asNumber(): number }).asNumber() : 0;
    const options =
      field instanceof PDFDropdown || field instanceof PDFOptionList ? field.getOptions() : [];
    fields.push({
      name: field.getName(),
      type,
      label: (tu?.trim() || partial).slice(0, 200),
      readOnly: field.isReadOnly(),
      required: field.isRequired(),
      multiline: text?.isMultiline() ?? false,
      password: text?.isPassword() ?? false,
      comb: text?.isCombed() ?? false,
      maxLength: text?.getMaxLength(),
      dateFormat: type === "text" ? parseDateFormat(script) : undefined,
      numeric: type === "text" && /AFNumber_(Format|Keystroke)/.test(script),
      options,
      editable: field instanceof PDFDropdown ? field.isEditable() : false,
      multiSelect: field instanceof PDFOptionList ? field.isMultiselect() : false,
      value: currentValue(field, type),
      fontSize: daSize(da),
      align: q === 1 ? "center" : q === 2 ? "right" : "left",
      widgets,
    });
  }
  fields.sort((a, b) => {
    const wa = a.widgets[0];
    const wb = b.widgets[0];
    if (wa.pageIndex !== wb.pageIndex) return wa.pageIndex - wb.pageIndex;
    // Same line (within a few points): left to right. Otherwise top first.
    const dy = wb.rect[3] - wa.rect[3];
    if (Math.abs(dy) > 4) return dy;
    return wa.rect[0] - wb.rect[0];
  });
  return { fields, encrypted, hasXfa: form.hasXFA() };
}

/** True when a required field still has nothing in it. */
export function isEmptyValue(field: Pick<FormField, "type">, value: FieldValue | undefined): boolean {
  if (value === undefined) return true;
  if (field.type === "checkbox") return value !== true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === "";
}

export function missingRequired(fields: FormField[], values: Record<string, FieldValue>): FormField[] {
  return fields.filter(
    (field) => field.required && !field.readOnly && field.type !== "signature" &&
      isEmptyValue(field, values[field.name] ?? field.value),
  );
}

const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function winAnsiOnly(text: string) {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a || cp === 0x0d) continue;
    if (!((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp))) return false;
  }
  return true;
}

/**
 * Acrobat's auto size (/DA "0 Tf"): at most 12 pt, shrunk until the text fits.
 * pdf-lib instead fits one line to the box height, which on a tall multi-line
 * box gives 50 pt letters and loses most of the text.
 */
export function autoFontSize(
  text: string,
  box: { width: number; height: number },
  multiline: boolean,
  widthAt: (line: string, size: number) => number,
): number {
  const inner = { width: Math.max(1, box.width - 4), height: Math.max(1, box.height - 4) };
  for (let size = 12; size > 4; size -= 0.5) {
    if (!multiline) {
      if (size <= inner.height * 0.8 && widthAt(text, size) <= inner.width) return size;
      continue;
    }
    let lines = 0;
    for (const paragraph of text.split(/\r?\n/)) {
      let line = "";
      lines++;
      for (const word of paragraph.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (line && widthAt(next, size) > inner.width) {
          lines++;
          line = word;
        } else line = next;
      }
    }
    if (lines * size * 1.15 <= inner.height) return size;
  }
  return 4;
}

/** pdf-lib's setFontSize misses widget-level /DA; viewers read that one first. */
function setFontSize(field: PDFTextField, size: number) {
  field.setFontSize(size);
  const rewrite = (da: string | undefined) =>
    da && /[\d.]+\s+Tf/.test(da) ? da.replace(/[\d.]+(\s+Tf)/, `${size}$1`) : undefined;
  const own = rewrite(field.acroField.getDefaultAppearance());
  if (own) field.acroField.setDefaultAppearance(own);
  for (const widget of field.acroField.getWidgets()) {
    const next = rewrite(widget.getDefaultAppearance());
    if (next) widget.setDefaultAppearance(next);
  }
}

export type FillOptions = {
  values: Record<string, FieldValue>;
  /** Burn fields into the page so nothing stays editable. */
  flatten: boolean;
  /**
   * Bytes of a Unicode TrueType font for values Helvetica cannot draw
   * (Polish, Czech, Greek, Cyrillic...). Called only when needed.
   */
  loadUnicodeFont?: () => Promise<Uint8Array>;
};

/** Values that differ from the PDF's own, so untouched fields keep their original look. */
function changed(field: FormField, value: FieldValue | undefined): value is FieldValue {
  if (value === undefined) return false;
  return JSON.stringify(value) !== JSON.stringify(field.value);
}

export async function fillForm(bytes: Uint8Array | ArrayBuffer, options: FillOptions): Promise<Uint8Array> {
  const info = await readForm(bytes);
  if (info.encrypted) throw new Error("This PDF is password-protected. Unlock it first, then fill it.");
  if (info.fields.length === 0) throw new Error("This PDF has no form fields to fill.");
  const missing = missingRequired(info.fields, options.values);
  if (missing.length > 0) {
    throw new Error(`Fill the required field${missing.length === 1 ? "" : "s"}: ${missing.slice(0, 5).map((f) => f.label).join(", ")}${missing.length > 5 ? "…" : ""}.`);
  }

  const doc = await load(bytes);
  const form = doc.getForm();
  // A dynamic XFA layer would hide our values in Acrobat; the AcroForm is what we filled.
  if (form.hasXFA()) form.deleteXFA();

  const autoSized: Array<{ field: PDFTextField; meta: FormField; text: string }> = [];
  let needsUnicode = false;
  let unicodeText = "";
  for (const meta of info.fields) {
    const value = options.values[meta.name];
    if (meta.readOnly || meta.type === "signature" || !changed(meta, value)) continue;
    const field = form.getField(meta.name);
    switch (meta.type) {
      case "text": {
        const tf = field as PDFTextField;
        let text = String(value);
        if (!meta.multiline) text = text.replace(/[\r\n]+/g, " ");
        if (meta.maxLength !== undefined) text = [...text].slice(0, meta.maxLength).join("");
        if (!winAnsiOnly(text)) {
          needsUnicode = true;
          unicodeText += text;
        }
        // pdf-lib refuses to draw a field with no /DA; give it Acrobat's default.
        if (!tf.acroField.getDefaultAppearance()) tf.acroField.setDefaultAppearance("/Helv 0 Tf 0 g");
        tf.setText(text === "" ? undefined : text);
        if (meta.fontSize === 0 && text !== "" && !meta.comb) autoSized.push({ field: tf, meta, text });
        break;
      }
      case "checkbox": {
        const cb = field as PDFCheckBox;
        if (value === true) cb.check();
        else cb.uncheck();
        break;
      }
      case "radio": {
        const rg = field as PDFRadioGroup;
        const on = String(value);
        if (on === "") rg.clear();
        else {
          const exportValues = rg.acroField.dict.lookupMaybe(PDFName.of("Opt"), PDFArray)?.asArray().map(decode) ?? null;
          const widget = rg.acroField.getWidgets().find((w, i) => exportOf(w, i, exportValues) === on);
          const onName = widget?.getOnValue();
          if (!onName) throw new Error(`"${on}" is not an option of ${meta.label}.`);
          rg.acroField.setValue(onName);
          form.markFieldAsDirty(rg.ref);
        }
        break;
      }
      case "dropdown": {
        const dd = field as PDFDropdown;
        const choice = String(value);
        if (choice === "") dd.clear();
        else {
          if (!winAnsiOnly(choice)) {
            needsUnicode = true;
            unicodeText += choice;
          }
          // Typed text in an editable dropdown is a valid value too.
          if (!meta.options.includes(choice) && !meta.editable) throw new Error(`"${choice}" is not an option of ${meta.label}.`);
          if (!meta.options.includes(choice)) dd.enableEditing();
          dd.select(choice);
        }
        break;
      }
      case "listbox": {
        const ol = field as PDFOptionList;
        const picks = (Array.isArray(value) ? value : [String(value)]).filter((v) => meta.options.includes(v));
        if (picks.some((v) => !winAnsiOnly(v))) {
          needsUnicode = true;
          unicodeText += picks.join("");
        }
        if (picks.length === 0) ol.clear();
        else ol.select(meta.multiSelect ? picks : picks.slice(0, 1));
        break;
      }
    }
  }

  let font: PDFFont | undefined;
  if (needsUnicode) {
    if (!options.loadUnicodeFont) throw new Error("Some characters need a Unicode font that could not be loaded.");
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(await options.loadUnicodeFont(), { subset: false });
    const has = new Set(font.getCharacterSet());
    const lacking = [...new Set([...unicodeText].filter((ch) => ch.trim() && !has.has(ch.codePointAt(0)!)))];
    if (lacking.length > 0) {
      throw new Error(`These letters cannot be drawn yet: ${lacking.slice(0, 8).join(" ")}. Latin, Greek and Cyrillic work.`);
    }
  }
  if (autoSized.length > 0) {
    const measure = font ?? (await doc.embedFont(StandardFonts.Helvetica));
    for (const { field, meta, text } of autoSized) {
      const [x1, y1, x2, y2] = meta.widgets[0].rect;
      setFontSize(
        field,
        autoFontSize(text, { width: x2 - x1, height: y2 - y1 }, meta.multiline, (line, size) => {
          try {
            return measure.widthOfTextAtSize(line, size);
          } catch {
            return line.length * size * 0.55;
          }
        }),
      );
    }
  }
  form.updateFieldAppearances(font);
  if (options.flatten) {
    form.flatten({ updateFieldAppearances: false });
  }
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}
