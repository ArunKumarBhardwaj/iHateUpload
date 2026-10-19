import type { FaqItem } from "@/lib/tool-faq";

/** Search-intent landing pages that open Compress PDF with a target size set. */
export type CompressTarget = {
  slug: string;
  targetKb: number;
  label: string;
  seoTitle: string;
  seoDescription: string;
  /** Who usually needs this size; shown under the heading. */
  intro: string;
  faq: FaqItem[];
};

function target(
  slug: string,
  targetKb: number,
  label: string,
  intro: string,
  faq: FaqItem[],
): CompressTarget {
  return {
    slug,
    targetKb,
    label,
    seoTitle: `Compress PDF to ${label} Free — No Upload`,
    seoDescription: `Compress a PDF to ${label} or less in your browser. Target size is already set: drop the file and download. Text stays selectable, nothing is uploaded.`,
    intro,
    faq,
  };
}

const SHARED_FAQ: FaqItem[] = [
  {
    q: "Is my PDF uploaded anywhere?",
    a: "No. The PDF is read and rewritten inside this browser tab. Nothing is sent to a server, and the page keeps working offline once it has loaded.",
  },
  {
    q: "What if my PDF cannot get that small?",
    a: "The tool steps image quality down until the file fits. If it would have to wreck the images to get there, it stops and gives you the smallest readable version with a note saying the target was not reached.",
  },
];

export const COMPRESS_TARGETS: CompressTarget[] = [
  target(
    "compress-pdf-to-100kb",
    100,
    "100 KB",
    "Job portals, exam forms and government sites often cap uploads at 100 KB. This page opens Compress PDF with a 100 KB target already set.",
    [
      {
        q: "How do I compress a PDF to 100 KB?",
        a: "Drop your PDF on this page. The target is already 100 KB, so press Compress PDF and download the result. You can change the target or the level before you start.",
      },
      {
        q: "Will the text still be readable at 100 KB?",
        a: "Yes. Only images are resampled and re-encoded; text, links and form fields are kept as they are, so text stays sharp and selectable at any size.",
      },
      ...SHARED_FAQ,
    ],
  ),
  target(
    "compress-pdf-to-200kb",
    200,
    "200 KB",
    "200 KB is a common limit for application forms and certificate uploads. This page opens Compress PDF with a 200 KB target already set.",
    [
      {
        q: "How do I reduce a PDF to 200 KB?",
        a: "Drop your PDF here and press Compress PDF. The 200 KB target is already chosen; the download is the largest, sharpest version that fits under it.",
      },
      {
        q: "Can I compress several PDFs to 200 KB at once?",
        a: "Yes. Choose more than one PDF and each one is compressed to the target on its own, then you can download them one by one or as a ZIP.",
      },
      ...SHARED_FAQ,
    ],
  ),
  target(
    "compress-pdf-to-500kb",
    500,
    "500 KB",
    "500 KB keeps photos and scans looking good while fitting most form and portal limits. This page opens Compress PDF with a 500 KB target already set.",
    [
      {
        q: "How do I make a PDF 500 KB or smaller?",
        a: "Drop the PDF on this page and press Compress PDF. The 500 KB target is set for you, and the tool stops at the best quality that fits.",
      },
      {
        q: "Does compressing to 500 KB remove pages or links?",
        a: "No. Every page stays, and text, links, bookmarks and form fields are kept. Only embedded images are made smaller.",
      },
      ...SHARED_FAQ,
    ],
  ),
  target(
    "compress-pdf-to-1mb",
    1024,
    "1 MB",
    "1 MB is a common cap for email attachments on portals and support forms. This page opens Compress PDF with a 1 MB target already set.",
    [
      {
        q: "How do I compress a PDF to under 1 MB?",
        a: "Drop the PDF here and press Compress PDF. The target is already 1 MB; images are made just small enough to fit, so quality stays as high as possible.",
      },
      {
        q: "My PDF is already under 1 MB. What happens?",
        a: "If compressing would not make the file smaller, you get your original file back unchanged.",
      },
      ...SHARED_FAQ,
    ],
  ),
  target(
    "compress-pdf-to-2mb",
    2048,
    "2 MB",
    "2 MB is a frequent upload limit for visa, insurance and HR portals. This page opens Compress PDF with a 2 MB target already set.",
    [
      {
        q: "How do I compress a large PDF to 2 MB?",
        a: "Drop the PDF on this page and press Compress PDF. The work runs in a background worker in this tab, so large photo PDFs do not freeze the page.",
      },
      {
        q: "Can I pick a different size?",
        a: "Yes. The target buttons go from 100 KB to 5 MB, and you can type any custom size in KB.",
      },
      ...SHARED_FAQ,
    ],
  ),
];

export function getCompressTarget(slug: string): CompressTarget | undefined {
  return COMPRESS_TARGETS.find((t) => t.slug === slug);
}
