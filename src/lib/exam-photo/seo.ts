import type { FaqItem } from "@/lib/tool-faq";

import type { ExamSpec, SlotSpec } from "./types";

function find(exam: ExamSpec, kind: SlotSpec["kind"]) {
  return exam.slots.find((s) => s.kind === kind);
}

function kb(slot: SlotSpec): string {
  return slot.minKb > 0 ? `${slot.minKb}–${slot.maxKb} KB` : `up to ${slot.maxKb} KB`;
}

function side(min: number, max: number | undefined): string {
  if (max === undefined) return `${min}`;
  return min === max ? `${min}` : `${min}–${max}`;
}

/** The pixel rule in words, as the notice states it. Shared by the FAQ and the rule table. */
export function pixelRule(slot: SlotSpec): string {
  const p = slot.pixels;
  if (!p) return "Not stated";
  const size = `${side(p.minWidth, p.maxWidth)} × ${side(p.minHeight, p.maxHeight)} pixels`;
  return p.maxWidth === undefined ? `At least ${size}` : size;
}

export function dpiRule(slot: SlotSpec): string | null {
  if (slot.minDpi) return `${slot.minDpi} DPI or more`;
  return slot.dpi ? `${slot.dpi} DPI` : null;
}

function px(slot: SlotSpec): string {
  if (!slot.pixels) return `no pixel size set by the notice (this tool makes ${slot.width} × ${slot.height})`;
  return pixelRule(slot).replace(/^At/, "at");
}

export function examSeo(exam: ExamSpec) {
  const photo = find(exam, "photo");
  const sign = find(exam, "signature");
  const hasPhoto = Boolean(photo);
  const sizes = [photo && `photo ${kb(photo)}`, sign && `signature ${kb(sign)}`]
    .filter(Boolean)
    .join(", ");
  return {
    sizes,
    heading: hasPhoto ? `${exam.name} Photo & Signature Resizer` : `${exam.name} Signature Resizer`,
    title: `${exam.name} ${hasPhoto ? "Photo and Signature" : "Signature"} Resize (${sizes}) — No Upload`,
    description: `Resize your ${exam.slots.map((s) => s.label.toLowerCase()).join(" and ")} for ${exam.name} (${exam.covers}): ${sizes}, JPG. Checked against the official rules before download, all in your browser.`,
  };
}

export function examFaq(exam: ExamSpec): FaqItem[] {
  const faq: FaqItem[] = [];
  for (const slot of exam.slots) {
    faq.push({
      q: `What is the ${exam.name} ${slot.label.toLowerCase()} size?`,
      a: `${kb(slot)}, JPG, ${px(slot)}${dpiRule(slot) ? `, ${dpiRule(slot)}` : ""}. ${(slot.rules ?? []).join(" ")} Source: ${exam.source.title} (${exam.source.date}).`.trim(),
    });
  }
  faq.push(
    {
      q: `Will the ${exam.name} portal accept the file?`,
      a: "Before download the tool reads the finished JPG back and checks its format, KB and pixel size against the rules above. Download when every line shows a green tick. Rules can change between cycles, so compare with your notice.",
    },
    {
      q: "Is my photo uploaded to your server?",
      a: "No. The photo and signature are resized inside this browser tab and never leave your device.",
    },
  );
  return faq;
}
