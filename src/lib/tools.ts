export type ToolId =
  | "image-to-pdf"
  | "merge-pdf"
  | "pdf-to-jpg"
  | "compress-pdf"
  | "split-pdf"
  | "extract-pages"
  | "protect-pdf"
  | "unlock-pdf"
  | "rotate-pdf"
  | "organize-pdf"
  | "sign-pdf"
  | "fill-pdf-form"
  | "edit-pdf"
  | "crop-pdf"
  | "redact-pdf"
  | "compare-pdfs"
  | "extract-text"
  | "extract-images"
  | "header-footer"
  | "reverse-pages"
  | "delete-blank"
  | "insert-blank"
  | "invert-pdf"
  | "n-up"
  | "page-size"
  | "pdf-to-png"
  | "pdf-to-word"
  | "pdf-to-pptx"
  | "pdf-to-html"
  | "pdf-to-markdown"
  | "pdf-to-excel"
  | "watermark-pdf"
  | "page-numbers"
  | "flatten-pdf"
  | "repair-pdf"
  | "alternate-mix"
  | "pdf-to-zip"
  | "pdf-to-pdfa"
  | "png-to-pdf"
  | "ocr-pdf"
  | "word-to-pdf"
  | "excel-to-pdf"
  | "pptx-to-pdf"
  | "markdown-to-pdf"
  | "csv-to-pdf"
  | "html-to-pdf"
  | "scan-to-pdf"
  | "strip-metadata"
  | "edit-metadata"
  | "bates-numbering"
  | "ask-pdf"
  | "translate-pdf"
  | "summarize-pdf"
  | "heic-to-jpg"
  | "heic-to-pdf"
  | "compress-image"
  | "resize-image"
  | "webp-to-jpg"
  | "png-to-jpg"
  | "jpg-to-png"
  | "jpg-to-webp"
  | "crop-image"
  | "rotate-image"
  | "compress-to-size"
  | "exam-photo";

export type ToolDefinition = {
  id: ToolId;
  slug: ToolId;
  title: string;
  shortTitle: string;
  description: string;
  accept: string;
  multiple: boolean;
  /** Input order changes the output, so the file list offers reordering. */
  ordered: boolean;
  actionLabel: string;
  /** Search-intent title (template appends `| iHateUpload`). */
  seoTitle: string;
  seoDescription: string;
  /** Crawlable how-to steps for the tool page. */
  seoHowTo: [string, string, string];
  showInNav: boolean;
  kind: "image" | "pdf";
  ui:
    | "none"
    | "md-to-pdf"
    | "excel-to-pdf"
    | "csv-to-pdf"
    | "html-to-pdf"
    | "pptx-to-pdf"
    | "password"
    | "password-confirm"
    | "rotate"
    | "split"
    | "pdf-image"
    | "pdf-png"
    | "pdf-to-word"
    | "pdf-to-pptx"
    | "pdf-to-html"
    | "pdf-to-markdown"
    | "pdf-to-excel"
    | "organize"
    | "resize"
    | "compress"
    | "extract"
    | "sign"
    | "fill-form"
    | "edit"
    | "crop"
    | "redact"
    | "compare"
    | "header-footer"
    | "protect"
    | "unlock"
    | "extract-images"
    | "extract-text"
    | "insert-blank"
    | "invert"
    | "flatten"
    | "nup"
    | "alternate-mix"
    | "pdf-to-zip"
    | "pdfa"
    | "page-size"
    | "watermark"
    | "page-numbers"
    | "bates-numbering"
    | "metadata"
    | "ocr"
    | "ask"
    | "translate"
    | "summarize"
    | "scan"
    | "image-crop"
    | "image-turn"
    | "target-kb";
};

export const TOOLS: ToolDefinition[] = [
  {
    id: "image-to-pdf",
    slug: "image-to-pdf",
    title: "Image to PDF",
    shortTitle: "JPG → PDF",
    description:
      "Turn JPG or PNG photos into a single PDF. Runs entirely on your device.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "JPG to PDF Converter Free — No Upload",
    seoDescription:
      "Convert JPG, PNG, or WebP to PDF online free. No upload, no signup, no watermark — files stay in your browser.",
    seoHowTo: [
      "Choose one or more JPG, PNG, or WebP images.",
      "Click Create PDF to build the document on this device.",
      "Download your PDF — nothing was uploaded.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
  {
    id: "png-to-pdf",
    slug: "png-to-pdf",
    title: "PNG to PDF",
    shortTitle: "PNG → PDF",
    description:
      "Turn PNG images into a single PDF. Same local path as Image to PDF.",
    accept: "image/png,.png",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "PNG to PDF Converter Free — No Upload",
    seoDescription:
      "Convert PNG to PDF online free. Build the document in your browser — no upload, no watermark.",
    seoHowTo: [
      "Choose one or more PNG images.",
      "Click Create PDF to build the document locally.",
      "Download the PDF.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
  {
    id: "merge-pdf",
    slug: "merge-pdf",
    title: "Merge PDF",
    shortTitle: "Merge PDF",
    description:
      "Combine multiple PDFs into one file. Order stays as you picked. No upload.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: true,
    actionLabel: "Merge PDFs",
    seoTitle: "Merge PDF Online Free — No Upload",
    seoDescription:
      "Merge PDF files online free in your browser. Combine multiple PDFs privately — no upload, no watermark, no signup.",
    seoHowTo: [
      "Add at least two PDF files in the order you want.",
      "Click Merge PDFs to combine them locally.",
      "Download the single merged PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "none",
  },
  {
    id: "pdf-to-jpg",
    slug: "pdf-to-jpg",
    title: "PDF to JPG",
    shortTitle: "PDF → JPG",
    description:
      "Export every PDF page as a JPG image. Useful for sharing or editing.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to JPG",
    seoTitle: "PDF to JPG Converter Free — No Upload",
    seoDescription:
      "Convert PDF to JPG online free, many PDFs at once. Export every page as an image in your browser — no upload, no watermark.",
    seoHowTo: [
      "Drop one PDF or many into the workspace.",
      "Pick a resolution and JPG quality, or switch to PNG, then click Convert to JPG.",
      "Download the images, or all pages as one zip.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "pdf-image",
  },
  {
    id: "pdf-to-word",
    slug: "pdf-to-word",
    title: "PDF to Word",
    shortTitle: "PDF → Word",
    description:
      "Turn a PDF into a Word file you can edit. Paragraphs, lists, tables and pictures stay in order.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to Word",
    seoTitle: "PDF to Word Converter Free — No Upload",
    seoDescription:
      "Convert PDF to editable Word (.docx) online free. Keeps headings, lists, tables and pictures, reads scanned pages, and runs in your browser — no upload, no watermark.",
    seoHowTo: [
      "Drop one or more PDF files into the workspace.",
      "Pick the layout (Editable text or Exact layout), then click Convert to Word.",
      "Download the .docx. Nothing was uploaded.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "pdf-to-word",
  },
  {
    id: "pdf-to-pptx",
    slug: "pdf-to-pptx",
    title: "PDF to PowerPoint",
    shortTitle: "PDF → PowerPoint",
    description:
      "Turn each PDF page into a slide you can edit: real text boxes, tables, pictures and shapes where they were on the page.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to PowerPoint",
    seoTitle: "PDF to PowerPoint Converter Free — Editable PPTX, No Upload",
    seoDescription:
      "Convert PDF to editable PowerPoint (.pptx) online free. Text boxes, tables, pictures and shapes land where they were, scans are read with OCR, and it runs in your browser — no upload.",
    seoHowTo: [
      "Drop one or more PDF files into the workspace.",
      "Pick editable slides or page pictures, a slide size and the pages, then click Convert to PowerPoint.",
      "Download the .pptx and edit it in PowerPoint, Keynote or Google Slides.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "pdf-to-pptx",
  },
  {
    id: "pdf-to-html",
    slug: "pdf-to-html",
    title: "PDF to HTML",
    shortTitle: "PDF → HTML",
    description:
      "Turn a PDF into a web page: real headings, paragraphs, lists, tables and pictures, or an exact copy of each page with selectable text.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to HTML",
    seoTitle: "PDF to HTML Converter Free — Clean, Responsive HTML, No Upload",
    seoDescription:
      "Convert PDF to HTML online free. Clean semantic markup with headings, lists, tables and inline images, or an exact page layout with selectable text. Runs in your browser — nothing is uploaded.",
    seoHowTo: [
      "Drop one or more PDF files into the workspace.",
      "Pick a reflowing page, an exact layout or page pictures, whether you want one .html file or a zip, and the pages.",
      "Click Convert to HTML, check the preview, and download the page.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "pdf-to-html",
  },
  {
    id: "pdf-to-markdown",
    slug: "pdf-to-markdown",
    title: "PDF to Markdown",
    shortTitle: "PDF → Markdown",
    description:
      "Turn a PDF into clean Markdown: # headings, lists, pipe tables, links and pictures. Ready for GitHub, Notion, Obsidian or an AI prompt.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to Markdown",
    seoTitle: "PDF to Markdown Converter Free — Tables, Headings, No Upload",
    seoDescription:
      "Convert PDF to Markdown online free, many files at once. Real headings, nested lists, GitHub tables, links and pictures; scans read with OCR. Runs in your browser — no upload, no sign-up.",
    seoHowTo: [
      "Drop one or more PDF files into the workspace.",
      "Pick one .md file, or a zip that keeps the pictures, and the pages.",
      "Click Convert to Markdown, copy the text or download the files.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "pdf-to-markdown",
  },
  {
    id: "pdf-to-excel",
    slug: "pdf-to-excel",
    title: "PDF to Excel",
    shortTitle: "PDF → Excel",
    description:
      "Turn the tables in a PDF into an Excel workbook. Numbers, dates and percentages arrive as real cells, not text.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to Excel",
    seoTitle: "PDF to Excel Converter Free — No Upload",
    seoDescription:
      "Convert PDF tables to Excel (.xlsx) online free. Numbers, dates and percentages become real cells, tables that run over pages join into one sheet, scanned pages are read with OCR, and nothing is uploaded.",
    seoHowTo: [
      "Drop one or more PDF files into the workspace.",
      "Choose one sheet per table or per page, and which pages to read, then click Convert to Excel.",
      "Download the .xlsx. Nothing was uploaded.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "pdf-to-excel",
  },
  {
    id: "pdf-to-png",
    slug: "pdf-to-png",
    title: "PDF to PNG",
    shortTitle: "PDF → PNG",
    description:
      "Export every PDF page as a PNG image. Stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to PNG",
    seoTitle: "PDF to PNG Converter Free — No Upload",
    seoDescription:
      "Convert PDF to PNG online free, many PDFs at once. Export every page as a PNG in your browser — no upload.",
    seoHowTo: [
      "Drop one PDF or many into the workspace.",
      "Pick a resolution (72 to 600 DPI), then click Convert to PNG.",
      "Download the images, or all pages as one zip.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "pdf-png",
  },
  {
    id: "compress-pdf",
    slug: "compress-pdf",
    title: "Compress PDF",
    shortTitle: "Compress PDF",
    description:
      "Shrink PDF size for email and uploads. Text stays selectable. Processing stays on this device.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Compress PDF",
    seoTitle: "Compress PDF Online Free — No Upload",
    seoDescription:
      "Compress PDF online free, or to an exact size like 200 KB or 1 MB. Images shrink to print or email sharpness, text stays selectable — no upload, no daily limits.",
    seoHowTo: [
      "Choose the PDF you want to shrink.",
      "Pick Light for print, Medium for email, or set a target size like 500 KB.",
      "Download the smaller PDF. Text, links, and forms stay as they were.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "compress",
  },
  {
    id: "split-pdf",
    slug: "split-pdf",
    title: "Split PDF",
    shortTitle: "Split PDF",
    description:
      "Split one PDF by page, range, half or size, or let it find where each document starts in a combined scan.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Split PDF",
    seoTitle: "Split PDF Online Free — No Upload",
    seoDescription:
      "Split PDF online free into separate pages, or smart-split a combined scan into its documents. Runs in your browser — no upload, no signup.",
    seoHowTo: [
      "Choose the PDF you want to split.",
      "Pick how to split, then click Split PDF to build the files locally.",
      "Download individual pages or grab them all as a zip.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "split",
  },
  {
    id: "extract-pages",
    slug: "extract-pages",
    title: "Extract Pages",
    shortTitle: "Extract Pages",
    description:
      "Pull the pages you want into a new PDF. The rest stays behind. No upload.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Extract pages",
    seoTitle: "Extract PDF Pages Free — No Upload",
    seoDescription:
      "Extract PDF pages online free. Keep only the pages you need in a new file — private, in your browser, no upload.",
    seoHowTo: [
      "Choose the PDF you want pages from.",
      "Type the pages to keep, like 1-3, 7.",
      "Download the new PDF with only those pages.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "extract",
  },
  {
    id: "protect-pdf",
    slug: "protect-pdf",
    title: "Protect PDF",
    shortTitle: "Protect PDF",
    description:
      "Add a password so opening the PDF requires it. Encryption stays on this device.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Protect PDF",
    seoTitle: "Protect PDF with Password Free — No Upload",
    seoDescription:
      "Password-protect a PDF online free. Encrypt PDFs in your browser — no upload, no signup.",
    seoHowTo: [
      "Choose the PDF to protect.",
      "Enter and confirm a password.",
      "Download the encrypted PDF created on this device.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "protect",
  },
  {
    id: "unlock-pdf",
    slug: "unlock-pdf",
    title: "Unlock PDF",
    shortTitle: "Unlock PDF",
    description:
      "Remove password protection from a PDF you can open. Runs locally.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Unlock PDF",
    seoTitle: "Unlock PDF Online Free — No Upload",
    seoDescription:
      "Unlock PDF online free when you know the password. Remove PDF password in your browser — files stay private.",
    seoHowTo: [
      "Choose a password-protected PDF you can open.",
      "Enter the correct password.",
      "Download the unlocked PDF created locally.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "unlock",
  },
  {
    id: "rotate-pdf",
    slug: "rotate-pdf",
    title: "Rotate PDF",
    shortTitle: "Rotate PDF",
    description:
      "Rotate or mirror pages by 90°, 180°, or 270°. Text stays text. Processing stays on this device.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Rotate PDF",
    seoTitle: "Rotate PDF Online Free — No Upload",
    seoDescription:
      "Rotate PDF pages online free by 90°, 180°, or 270°. Fix sideways scans in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF with pages that need rotating.",
      "Pick 90°, 180°, or 270°.",
      "Download the rotated PDF.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "rotate",
  },
  {
    id: "organize-pdf",
    slug: "organize-pdf",
    title: "Organize PDF",
    shortTitle: "Organize PDF",
    description:
      "Reorder or remove pages, then save a new PDF. Nothing is uploaded.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Save PDF",
    seoTitle: "Organize PDF Pages Free — No Upload",
    seoDescription:
      "Organize PDF pages online free. Reorder or delete pages in your browser — private and free.",
    seoHowTo: [
      "Choose a PDF to reorganize.",
      "Move or remove pages in the list.",
      "Save and download the new PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "organize",
  },
  {
    id: "sign-pdf",
    slug: "sign-pdf",
    title: "Sign PDF",
    shortTitle: "Sign PDF",
    description:
      "Draw, type, or stamp a signature on a page. The ink stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Sign PDF",
    seoTitle: "Sign PDF Online Free — No Upload",
    seoDescription:
      "Sign a PDF online free. Draw, type, or stamp your signature in the browser — no upload, no watermark.",
    seoHowTo: [
      "Choose the PDF you want to sign.",
      "Draw, type, or upload a signature and place it on the page.",
      "Download the signed PDF created on this device.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "sign",
  },
  {
    id: "fill-pdf-form",
    slug: "fill-pdf-form",
    title: "Fill PDF form",
    shortTitle: "Fill form",
    description:
      "Type into the boxes, tick, pick and date a PDF form, then keep it editable or flatten it. The form stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Save filled PDF",
    seoTitle: "Fill PDF Form Online Free — No Upload",
    seoDescription:
      "Fill a PDF form online free. Text boxes, checkboxes, radio buttons, dropdowns and dates, filled in your browser. Keep it editable or flatten it. No upload.",
    seoHowTo: [
      "Choose a PDF form with fillable fields.",
      "Type, tick and pick right on the page. Required fields are marked.",
      "Keep the fields editable or flatten them, then download the filled PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "fill-form",
  },
  {
    id: "edit-pdf",
    slug: "edit-pdf",
    title: "Edit PDF",
    shortTitle: "Edit PDF",
    description:
      "Click words on a page to change them. Find and replace across pages. The old letters are removed from the file; scans are read with OCR in this tab.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Save PDF",
    seoTitle: "Edit PDF Online Free — Add Text, No Upload",
    seoDescription:
      "Edit a PDF online free. Click a line to change it in your browser. The old letters are deleted from the file, not hidden. No upload.",
    seoHowTo: [
      "Choose the PDF you want to mark up.",
      "Click a line to change it. Scans are read first. Or add text, an image, or a highlight.",
      "Download the PDF. The original letters under an edit are gone from the file, not just covered.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "edit",
  },
  {
    id: "crop-pdf",
    slug: "crop-pdf",
    title: "Crop PDF",
    shortTitle: "Crop PDF",
    description:
      "Trim margins on every page. The crop box stays on this device.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Crop PDF",
    seoTitle: "Crop PDF Online Free — No Upload",
    seoDescription:
      "Crop PDF pages online free. Trim margins in your browser — no upload, no watermark.",
    seoHowTo: [
      "Choose one PDF or several. The same crop applies to every file.",
      "Drag the crop box to the area you want to keep.",
      "Download the cropped PDFs, one by one or as a zip.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "crop",
  },
  {
    id: "redact-pdf",
    slug: "redact-pdf",
    title: "Redact PDF",
    shortTitle: "Redact PDF",
    description:
      "Find emails, phones, cards, Aadhaar, PAN and more, or draw boxes. The covered pixels are destroyed in this tab.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Redact PDF",
    seoTitle: "Redact PDF Online Free — No Upload",
    seoDescription:
      "Redact a PDF online free. Auto-find emails, phones, cards, Aadhaar, PAN, IBAN and SSN, or draw boxes. Pixels are destroyed in your browser — no upload.",
    seoHowTo: [
      "Choose one PDF or several. The first one is shown for review.",
      "Scan for personal info and untick anything to keep, or draw boxes over what must disappear.",
      "Download the redacted PDFs. Boxes you drew and the kinds of data you accepted are blacked out in every file.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "redact",
  },
  {
    id: "compare-pdfs",
    slug: "compare-pdfs",
    title: "Compare PDFs",
    shortTitle: "Compare PDFs",
    description:
      "Put two PDFs side by side and read a text-line diff. Stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: true,
    actionLabel: "Compare PDFs",
    seoTitle: "Compare PDFs Online Free — No Upload",
    seoDescription:
      "Compare two PDFs online free. Synced page previews and a text diff in your browser — no upload.",
    seoHowTo: [
      "Choose the two PDFs to compare. First file is the left side.",
      "Flip pages together, then run the text diff.",
      "Download the line diff. The files never left this tab.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "compare",
  },
  {
    id: "extract-text",
    slug: "extract-text",
    title: "Extract Text",
    shortTitle: "Extract text",
    description:
      "Copy the text out of a PDF into a .txt file. Scans and photos can be read with OCR. Stays in this tab.",
    accept: "application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
    multiple: true,
    ordered: false,
    actionLabel: "Extract text",
    seoTitle: "Extract Text from PDF Free — No Upload",
    seoDescription:
      "Extract text from a PDF online free. Copy selectable words in your browser — no upload.",
    seoHowTo: [
      "Choose a PDF with selectable text.",
      "Click Extract text. The words stay on this device.",
      "Download the .txt file.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "extract-text",
  },
  {
    id: "extract-images",
    slug: "extract-images",
    title: "Extract Images",
    shortTitle: "Extract images",
    description:
      "Pull embedded images out of a PDF at their native size. Stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Extract images",
    seoTitle: "Extract Images from PDF Free — No Upload",
    seoDescription:
      "Extract images from PDFs online free, many files at once. Pull embedded pictures in your browser — no upload.",
    seoHowTo: [
      "Choose one PDF or several that contain images.",
      "Click Extract images. Each picture is saved at its own size.",
      "Download the image, or a zip if there are several.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "extract-images",
  },
  {
    id: "header-footer",
    slug: "header-footer",
    title: "Headers and Footers",
    shortTitle: "Headers",
    description:
      "Add left, center, and right headers or footers. {page} {pages} {date} stay in this tab.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Add headers",
    seoTitle: "Add Headers and Footers to PDF Free — No Upload",
    seoDescription:
      "Add headers and footers to a PDF online free. Left, center, and right text in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF that needs a header or footer.",
      "Type left, center, and right text. Use {page}, {pages}, or {date}.",
      "Download the stamped PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "header-footer",
  },
  {
    id: "reverse-pages",
    slug: "reverse-pages",
    title: "Reverse Pages",
    shortTitle: "Reverse pages",
    description:
      "Flip the page order of a PDF. Last page becomes first. Stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Reverse pages",
    seoTitle: "Reverse PDF Page Order Free — No Upload",
    seoDescription:
      "Reverse PDF pages online free. Flip the page order in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF to reverse.",
      "Click Reverse pages. The last page becomes the first.",
      "Download the reversed PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "none",
  },
  {
    id: "delete-blank",
    slug: "delete-blank",
    title: "Delete Blank Pages",
    shortTitle: "Delete blanks",
    description:
      "Drop near-white pages from a PDF. The scan stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Delete blanks",
    seoTitle: "Delete Blank PDF Pages Free — No Upload",
    seoDescription:
      "Delete blank PDF pages online free. Drop empty pages in your browser — no upload.",
    seoHowTo: [
      "Choose a PDF that has empty pages.",
      "Click Delete blanks. Near-white pages are dropped.",
      "Download the tighter PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "none",
  },
  {
    id: "insert-blank",
    slug: "insert-blank",
    title: "Insert Blank Pages",
    shortTitle: "Insert blank",
    description:
      "Insert a blank page after a page you pick. Stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Insert blank",
    seoTitle: "Insert Blank PDF Pages Free — No Upload",
    seoDescription:
      "Insert a blank page into a PDF online free. Add empty pages in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF.",
      "Pick the page to insert after. Use 0 to insert at the start.",
      "Download the PDF with the new blank page.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "insert-blank",
  },
  {
    id: "invert-pdf",
    slug: "invert-pdf",
    title: "Invert / Grayscale",
    shortTitle: "Invert",
    description:
      "Dark mode, invert, sepia or grayscale. Text can stay selectable. Runs in this tab.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Apply",
    seoTitle: "Invert or Grayscale PDF Free — No Upload",
    seoDescription:
      "Dark mode, invert, sepia or grayscale a PDF online free. Text stays selectable. Runs in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF.",
      "Pick dark mode, invert, sepia or grayscale.",
      "Download the recoloured PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "invert",
  },
  {
    id: "n-up",
    slug: "n-up",
    title: "N-up",
    shortTitle: "N-up",
    description:
      "Put 2, 4, or 9 pages on each sheet. Stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Make n-up",
    seoTitle: "N-up PDF Pages Free — No Upload",
    seoDescription:
      "Put 2, 4, or 9 PDF pages on one sheet online free. N-up in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF.",
      "Pick 2, 4, or 9 pages per sheet.",
      "Download the n-up PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "nup",
  },
  {
    id: "alternate-mix",
    slug: "alternate-mix",
    title: "Alternate & Mix Pages",
    shortTitle: "Alternate & mix",
    description:
      "Interleave pages from two or more PDFs: fronts and backs from a duplex scan, or any files turn by turn. Stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: true,
    actionLabel: "Mix pages",
    seoTitle: "Alternate & Mix PDF Pages Free — Interleave PDFs, No Upload",
    seoDescription:
      "Interleave pages from two or more PDFs online free. Reverse the back sides of a duplex scan, take N pages per turn, handle unequal lengths. No upload.",
    seoHowTo: [
      "Add two or more PDFs. The list order is the turn order.",
      "Set pages per turn, tick Reverse for a file scanned back to front, and choose what happens when one file is shorter.",
      "Click Mix pages and download the interleaved PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "alternate-mix",
  },
  {
    id: "pdf-to-zip",
    slug: "pdf-to-zip",
    title: "PDF to ZIP",
    shortTitle: "PDF → ZIP",
    description:
      "Pack PDFs into one ZIP, or cut each one into single pages or parts first. Name the files with a pattern. Stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: true,
    actionLabel: "Create ZIP",
    seoTitle: "PDF to ZIP Free — Bundle or Split PDFs into a ZIP, No Upload",
    seoDescription:
      "Put PDFs in a ZIP online free, or split every PDF into single pages inside the ZIP. Name pattern, folders and compression level, all in your browser. No upload.",
    seoHowTo: [
      "Add the PDFs. Card order is the order inside the ZIP.",
      "Keep files whole, or cut them into single pages or parts. Set the name pattern, folder and compression.",
      "Click Create ZIP and download the archive.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "pdf-to-zip",
  },
  {
    id: "page-size",
    slug: "page-size",
    title: "Page Size",
    shortTitle: "Page size",
    description:
      "Fit or letterbox every page to A4 or Letter. Stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Resize pages",
    seoTitle: "Change PDF Page Size to A4 or Letter Free — No Upload",
    seoDescription:
      "Resize PDF pages to A4 or Letter online free. Fit or letterbox in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF.",
      "Pick A4 or Letter, then fit or letterbox.",
      "Download the resized PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "page-size",
  },
  {
    id: "watermark-pdf",
    slug: "watermark-pdf",
    title: "Watermark PDF",
    shortTitle: "Watermark",
    description:
      "Stamp DRAFT or CONFIDENTIAL on your pages, once or tiled. Processing stays here.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Add watermark",
    seoTitle: "Watermark PDF Online Free — No Upload",
    seoDescription:
      "Add a text watermark to a PDF online free. Stamp DRAFT or CONFIDENTIAL in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF to watermark.",
      "Type the stamp, set size, angle, colour and opacity, and place it once or tile it. The preview shows page 1.",
      "Download the watermarked PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "watermark",
  },
  {
    id: "page-numbers",
    slug: "page-numbers",
    title: "Page Numbers",
    shortTitle: "Page numbers",
    description:
      "Add page numbers to a PDF, or switch to Bates numbering across a whole set. The stamp runs in this tab.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: true,
    actionLabel: "Add page numbers",
    seoTitle: "Add Page Numbers to PDF Free — No Upload",
    seoDescription:
      "Add page numbers to a PDF online free. Number pages in your browser — no upload, no watermark.",
    seoHowTo: [
      "Choose the PDF that needs numbers.",
      "Pick where the numbers sit.",
      "Download the numbered PDF.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "page-numbers",
  },
  {
    id: "bates-numbering",
    slug: "bates-numbering",
    title: "Bates Numbering",
    shortTitle: "Bates numbering",
    description:
      "Stamp ABC000001-style Bates numbers that run on across every file you add. Real selectable text.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: true,
    actionLabel: "Apply Bates numbers",
    seoTitle: "Bates Numbering for PDF Free — No Upload",
    seoDescription:
      "Bates number PDFs online free. Prefix, padded counter and suffix that continue across files, as real text — in your browser, no upload.",
    seoHowTo: [
      "Add the PDFs in the order they should be numbered.",
      "Set the prefix, starting number, digits, suffix and where the stamp sits.",
      "Download the numbered PDFs. The counter runs on from one file to the next.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "bates-numbering",
  },
  {
    id: "repair-pdf",
    slug: "repair-pdf",
    title: "Repair PDF",
    shortTitle: "Repair PDF",
    description:
      "Fix a PDF that will not open, is cut short, or shows missing pages. Three rebuilds run in this tab and the one that recovers the most is kept.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Repair PDF",
    seoTitle: "Repair PDF Online Free — Fix Corrupted PDF, No Upload",
    seoDescription:
      "Repair a damaged or corrupted PDF online free. Rebuilds broken indexes, truncated downloads and missing catalogs in your browser, and tells you what was wrong. No upload.",
    seoHowTo: [
      "Choose the PDF that will not open or looks broken. You can add several.",
      "Click Repair PDF. Three different rebuilds run in your browser and the best one is kept.",
      "Read what was wrong and how many pages came back, then download the repaired PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "none",
  },
  {
    id: "pdf-to-pdfa",
    slug: "pdf-to-pdfa",
    title: "PDF to PDF/A",
    shortTitle: "PDF/A",
    description:
      "Make an archive-ready PDF/A-1b, 2b or 3b. Fonts are embedded, colours tagged and scripts removed, in this tab.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to PDF/A",
    seoTitle: "PDF to PDF/A Converter Online Free — No Upload",
    seoDescription:
      "Convert PDF to PDF/A-1b, PDF/A-2b or PDF/A-3b online free, many files at once. Fonts embedded, veraPDF-valid output, made in your browser. No upload, no sign-up.",
    seoHowTo: [
      "Choose one or more PDFs. They stay on your device.",
      "Pick PDF/A-2b (most portals), 1b (strict, older systems) or 3b (keeps attachments). Click Convert to PDF/A.",
      "Download the archive copies. Each one says what was changed to make it conform.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "pdfa",
  },
  {
    id: "flatten-pdf",
    slug: "flatten-pdf",
    title: "Flatten PDF",
    shortTitle: "Flatten",
    description:
      "Burn form fields into the page, or turn every page into a picture. Strip scripts, attachments and metadata. Runs in this tab.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Flatten PDF",
    seoTitle: "Flatten PDF Online Free — No Upload",
    seoDescription:
      "Flatten a PDF online free: lock form fields, or rasterise pages at 96 to 400 DPI and strip metadata, scripts and attachments. In your browser — no upload.",
    seoHowTo: [
      "Choose the PDF to flatten.",
      "Pick form flatten or a full rasterise, and what to strip. Click Flatten PDF.",
      "Download the flattened PDF.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "flatten",
  },
  {
    id: "ocr-pdf",
    slug: "ocr-pdf",
    title: "OCR PDF",
    shortTitle: "OCR PDF",
    description:
      "Make a scanned PDF searchable. Hindi keeps its letters. Tesseract runs in this tab. Slow on long scans.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Make searchable",
    seoTitle: "OCR PDF Online Free — Searchable Scans, No Upload",
    seoDescription:
      "OCR PDFs online free, many at once. Make scanned pages searchable, including Hindi. Runs in your browser — no upload, no Premium.",
    seoHowTo: [
      "Choose one scanned PDF or a whole batch.",
      "Pick the language. Optionally keep a text file too.",
      "Download the searchable PDF. Original pages stay as images with invisible words on top.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "ocr",
  },
  {
    id: "strip-metadata",
    slug: "strip-metadata",
    title: "Strip Metadata",
    shortTitle: "Strip metadata",
    description:
      "Remove author, titles, and hidden properties from a PDF. Stays on this device.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Strip metadata",
    seoTitle: "Remove PDF Metadata Free — No Upload",
    seoDescription:
      "Strip PDF metadata online free. Remove author and hidden properties in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF to clean.",
      "Click Strip metadata.",
      "Download the cleaned PDF.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "none",
  },
  {
    id: "edit-metadata",
    slug: "edit-metadata",
    title: "Edit Metadata",
    shortTitle: "Edit metadata",
    description:
      "See and change a PDF's title, author, dates, custom properties and XMP. Or strip it all. Stays on this device.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Save metadata",
    seoTitle: "Edit PDF Metadata Free — No Upload",
    seoDescription:
      "Edit PDF metadata online free: title, author, subject, keywords, dates, custom properties and XMP. Runs in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF. Its current properties fill in below.",
      "Edit or clear any field, add custom properties, or press Strip everything.",
      "Download the PDF. The Info dictionary and XMP packet are kept in agreement.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "metadata",
  },
  {
    id: "translate-pdf",
    slug: "translate-pdf",
    title: "Translate PDF",
    shortTitle: "Translate",
    description:
      "Translate a PDF into 24 languages and keep its layout: the words change, the pictures, tables and colours stay. Gemini does the translating.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Translate PDF",
    seoTitle: "Translate PDF Free — Keep the Layout, 24 Languages",
    seoDescription:
      "Translate PDF documents free into Spanish, French, German, Hindi and 20 more languages, keeping the layout, tables and pictures. Text goes to Google Gemini; the PDF itself never leaves your browser.",
    seoHowTo: [
      "Drop one or more PDFs into the workspace. The file stays on your device.",
      "Pick the language. The text is sent to Google Gemini through our server, or straight from your browser with your own key.",
      "Click Translate PDF and download the translated copy, laid out like the original.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "translate",
  },
  {
    id: "summarize-pdf",
    slug: "summarize-pdf",
    title: "Summarize PDF",
    shortTitle: "Summarize",
    description:
      "Get a short, standard or detailed summary of a PDF, with the page each point comes from. Every figure is checked against the PDF. Gemini writes it.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Summarize PDF",
    seoTitle: "Summarize PDF Free — AI Summary With Page Numbers",
    seoDescription:
      "Summarize PDF documents free with AI: key points with page numbers, section by section, in 25 languages. Every figure is checked against the PDF. The file itself never leaves your browser.",
    seoHowTo: [
      "Drop one or more PDFs into the workspace. The file stays on your device; scans are read with OCR.",
      "Pick the length and language. The page text goes to Google Gemini through our server, or straight from your browser with your own key.",
      "Read the summary, copy it or save it as Markdown. Any figure the PDF does not show is marked.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "summarize",
  },
  {
    id: "ask-pdf",
    slug: "ask-pdf",
    title: "Ask PDF",
    shortTitle: "Ask PDF",
    description:
      "Chat with up to 10 PDFs. The files stay here; their extracted text and your chat are sent to Google Gemini, through our server or straight from your browser with your own key.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Ask",
    seoTitle: "Chat With PDFs Free — The File Is Never Uploaded",
    seoDescription:
      "Ask follow-up questions about up to 10 PDFs. The PDF files are never uploaded; text is read in your browser.",
    seoHowTo: [
      "Choose up to 10 PDFs with selectable text.",
      "Ask a question, then follow-ups. The extracted text and your chat go to Google Gemini, via our server or with your own key straight from your browser.",
      "Read the answers and save the chat. The PDF files themselves were never uploaded.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "ask",
  },
  {
    id: "word-to-pdf",
    slug: "word-to-pdf",
    title: "Word to PDF",
    shortTitle: "Word → PDF",
    description:
      "Turn a .docx into a PDF in this tab. Layout is good enough, not Acrobat.",
    accept:
      ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "Word to PDF Converter Free — No Upload",
    seoDescription:
      "Convert Word to PDF online free in your browser. No upload. Layout is simple and private.",
    seoHowTo: [
      "Choose one or more .docx files.",
      "Click Create PDF. Conversion runs locally.",
      "Download the PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "none",
  },
  {
    id: "excel-to-pdf",
    slug: "excel-to-pdf",
    title: "Excel to PDF",
    shortTitle: "Excel → PDF",
    description:
      "Turn a spreadsheet into a simple PDF table. Runs on this device.",
    accept:
      ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "Excel to PDF Converter Free — No Upload",
    seoDescription:
      "Convert Excel to PDF online free in your browser. Spreadsheet stays on your device.",
    seoHowTo: [
      "Choose one or more spreadsheet files.",
      "Click Create PDF to draw a simple table locally.",
      "Download the PDF.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "excel-to-pdf",
  },
  {
    id: "pptx-to-pdf",
    slug: "pptx-to-pdf",
    title: "PowerPoint to PDF",
    shortTitle: "PPTX → PDF",
    description:
      "Turn slides into a PDF, one page per slide. Shapes, pictures and backgrounds are drawn; text stays selectable. Stays in this tab.",
    accept:
      ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "PowerPoint to PDF Converter Free — No Upload",
    seoDescription:
      "Convert PPTX to PDF online free. Slides stay in your browser — no upload.",
    seoHowTo: [
      "Choose one or more .pptx files.",
      "Click Create PDF. Each slide becomes a page with its shapes, pictures and real text.",
      "Download the PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "pptx-to-pdf",
  },
  {
    id: "markdown-to-pdf",
    slug: "markdown-to-pdf",
    title: "Markdown to PDF",
    shortTitle: "Markdown → PDF",
    description:
      "Turn a .md file into a PDF. Headings, lists, and code stay in this tab.",
    accept: ".md,.markdown,text/markdown,text/plain",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "Markdown to PDF Converter Free — No Upload",
    seoDescription:
      "Convert Markdown to PDF online free. The .md file stays in your browser — no upload.",
    seoHowTo: [
      "Choose a Markdown file.",
      "Click Create PDF. Headings and lists are drawn locally.",
      "Download the PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "md-to-pdf",
  },
  {
    id: "csv-to-pdf",
    slug: "csv-to-pdf",
    title: "CSV to PDF",
    shortTitle: "CSV → PDF",
    description:
      "Turn a CSV into a PDF table. Sort, search and hide columns first. Stays in this tab.",
    accept: ".csv,text/csv,text/plain",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "CSV to PDF Converter Free — No Upload",
    seoDescription:
      "Convert a CSV to a PDF table online free. The file stays in your browser — no upload.",
    seoHowTo: [
      "Choose a CSV file.",
      "Sort or search the preview, then click Create PDF.",
      "Download the PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "csv-to-pdf",
  },
  {
    id: "html-to-pdf",
    slug: "html-to-pdf",
    title: "HTML to PDF",
    shortTitle: "HTML → PDF",
    description:
      "Turn a local HTML file into a PDF. Text and headings stay. Scripts do not run.",
    accept: ".html,.htm,text/html",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "HTML to PDF Converter Free — No Upload",
    seoDescription:
      "Convert a local HTML file to PDF online free. The file stays in your browser — no upload.",
    seoHowTo: [
      "Choose an .html file from this device.",
      "Click Create PDF. The page is read locally.",
      "Download the PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "html-to-pdf",
  },
  {
    id: "scan-to-pdf",
    slug: "scan-to-pdf",
    title: "Scan to PDF",
    shortTitle: "Scan to PDF",
    description:
      "Snap a page with the camera, or drop a photo. The PDF stays in this tab.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    ordered: true,
    actionLabel: "Make PDF",
    seoTitle: "Scan Document to PDF Free — No Upload",
    seoDescription:
      "Scan a document to PDF online free. Use the camera or a photo. Nothing is uploaded.",
    seoHowTo: [
      "Allow the camera, or drop a photo of the page.",
      "Capture each page you need.",
      "Download the PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "scan",
  },
  {
    id: "heic-to-jpg",
    slug: "heic-to-jpg",
    title: "HEIC to JPG",
    shortTitle: "HEIC → JPG",
    description:
      "Convert iPhone HEIC photos to JPG in your browser. No upload, no account.",
    accept: ".heic,.heif,.jpg,.jpeg,image/heic,image/heif,image/jpeg",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to JPG",
    seoTitle: "HEIC to JPG Converter Free — No Upload",
    seoDescription:
      "Convert HEIC to JPG online free without uploading. iPhone photos stay on your device — unlimited, no watermark.",
    seoHowTo: [
      "Add one or more HEIC or HEIF photos from your iPhone.",
      "Click Convert to JPG — conversion runs in this tab.",
      "Download the JPG files.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
  {
    id: "heic-to-pdf",
    slug: "heic-to-pdf",
    title: "HEIC to PDF",
    shortTitle: "HEIC → PDF",
    description:
      "Turn iPhone HEIC photos into a PDF for forms and email. Stays on this device.",
    accept: ".heic,.heif,.jpg,.jpeg,image/heic,image/heif,image/jpeg",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "HEIC to PDF Converter Free — No Upload",
    seoDescription:
      "Convert HEIC to PDF online free for forms and email. iPhone photos never leave your browser.",
    seoHowTo: [
      "Add HEIC photos you want in a PDF.",
      "Click Create PDF to build the document locally.",
      "Download the PDF for forms or email.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
  {
    id: "compress-image",
    slug: "compress-image",
    title: "Compress Image",
    shortTitle: "Compress",
    description:
      "Shrink JPG, PNG, and WebP for email, WhatsApp, or web. Private and free.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    ordered: false,
    actionLabel: "Compress images",
    seoTitle: "Compress Image Online Free — No Upload",
    seoDescription:
      "Compress image online free for email, WhatsApp, or web. Shrink JPG, PNG, and WebP in your browser — no upload, no watermark.",
    seoHowTo: [
      "Choose JPG, PNG, or WebP images to shrink.",
      "Click Compress images — work stays on this device.",
      "Download the compressed files.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
  {
    id: "resize-image",
    slug: "resize-image",
    title: "Resize Image",
    shortTitle: "Resize",
    description:
      "Scale JPG, PNG, or WebP to a max edge for forms, email, or web. Private.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    ordered: false,
    actionLabel: "Resize images",
    seoTitle: "Resize Image Online Free — No Upload",
    seoDescription:
      "Resize image online free by max edge. Scale JPG, PNG, or WebP in your browser — no upload, no watermark.",
    seoHowTo: [
      "Choose the images to resize.",
      "Pick a max edge size (or enter a custom pixel value).",
      "Download the resized images.",
    ],
    showInNav: true,
    kind: "image",
    ui: "resize",
  },
  {
    id: "webp-to-jpg",
    slug: "webp-to-jpg",
    title: "WebP to JPG",
    shortTitle: "WebP → JPG",
    description:
      "Convert WebP images to JPG so older apps and forms accept them.",
    accept: "image/webp,.webp",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to JPG",
    seoTitle: "WebP to JPG Converter Free — No Upload",
    seoDescription:
      "Convert WebP to JPG online free. Make WebP images work in older apps and forms — no upload, no watermark.",
    seoHowTo: [
      "Add one or more WebP images.",
      "Click Convert to JPG.",
      "Download the JPG files.",
    ],
    showInNav: false,
    kind: "image",
    ui: "none",
  },
  {
    id: "png-to-jpg",
    slug: "png-to-jpg",
    title: "PNG to JPG",
    shortTitle: "PNG → JPG",
    description:
      "Convert PNG images to JPG for smaller files and wider app support.",
    accept: "image/png,.png",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to JPG",
    seoTitle: "PNG to JPG Converter Free — No Upload",
    seoDescription:
      "Convert PNG to JPG online free for smaller files and wider support. Runs in your browser — no upload.",
    seoHowTo: [
      "Add PNG images to convert.",
      "Click Convert to JPG.",
      "Download the JPG files.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
  {
    id: "jpg-to-png",
    slug: "jpg-to-png",
    title: "JPG to PNG",
    shortTitle: "JPG → PNG",
    description:
      "Convert JPG images to PNG when you need lossless pixels or transparency later.",
    accept: "image/jpeg,.jpg,.jpeg",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to PNG",
    seoTitle: "JPG to PNG Converter Free — No Upload",
    seoDescription:
      "Convert JPG to PNG online free. Keep lossless pixels for editing — no upload, no watermark.",
    seoHowTo: [
      "Add JPG or JPEG images.",
      "Click Convert to PNG.",
      "Download the PNG files.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
  {
    id: "jpg-to-webp",
    slug: "jpg-to-webp",
    title: "JPG to WebP",
    shortTitle: "JPG → WebP",
    description:
      "Turn a JPG or PNG into WebP in this tab. Smaller files for the web.",
    accept: "image/jpeg,image/png,.jpg,.jpeg,.png",
    multiple: true,
    ordered: false,
    actionLabel: "Convert to WebP",
    seoTitle: "JPG to WebP Converter Free — No Upload",
    seoDescription:
      "Convert JPG or PNG to WebP in your browser. No upload. Smaller files for pages and chats.",
    seoHowTo: [
      "Add JPG or PNG images.",
      "Click Convert to WebP.",
      "Download the WebP files.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
  {
    id: "crop-image",
    slug: "crop-image",
    title: "Crop Image",
    shortTitle: "Crop",
    description:
      "Drag a box on the photo. The rest stays in this tab and never uploads.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: false,
    ordered: false,
    actionLabel: "Crop image",
    seoTitle: "Crop Image Online Free — No Upload",
    seoDescription:
      "Crop a JPG, PNG, or WebP in your browser. No upload. Download the cut photo.",
    seoHowTo: [
      "Add a photo.",
      "Drag the crop box.",
      "Click Crop image and download.",
    ],
    showInNav: true,
    kind: "image",
    ui: "image-crop",
  },
  {
    id: "rotate-image",
    slug: "rotate-image",
    title: "Rotate Image",
    shortTitle: "Rotate",
    description:
      "Turn a photo 90 degrees or flip it. The file stays in this tab.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    ordered: false,
    actionLabel: "Rotate images",
    seoTitle: "Rotate Image Online Free — No Upload",
    seoDescription:
      "Rotate or flip JPG, PNG, or WebP in your browser. No upload. Download the turned photos.",
    seoHowTo: [
      "Add photos.",
      "Pick a turn or flip.",
      "Click Rotate images and download.",
    ],
    showInNav: true,
    kind: "image",
    ui: "image-turn",
  },
  {
    id: "compress-to-size",
    slug: "compress-to-size",
    title: "Compress Image to Size",
    shortTitle: "To size",
    description:
      "Shrink a photo to 50, 100, 200, or 500 KB for a form. Nothing leaves this tab.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    ordered: false,
    actionLabel: "Compress to size",
    seoTitle: "Compress Image to 100KB or 200KB — No Upload",
    seoDescription:
      "Compress a photo to a KB target in your browser. Hit 50, 100, 200, or 500 KB. No upload.",
    seoHowTo: [
      "Add photos.",
      "Pick a KB target.",
      "Click Compress to size and download.",
    ],
    showInNav: true,
    kind: "image",
    ui: "target-kb",
  },
  {
    id: "exam-photo",
    slug: "exam-photo",
    title: "Exam Photo & Signature Resizer",
    shortTitle: "Exam photo",
    description:
      "Resize photo and signature for SSC, UPSC, NEET, JEE, IBPS and more. Exact pixels and KB, checked before you download.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: false,
    ordered: false,
    actionLabel: "Make photo",
    seoTitle: "Exam Photo & Signature Resizer (SSC, UPSC, NEET, JEE, IBPS) — No Upload",
    seoDescription:
      "Resize your photo and signature to the exact pixels and KB your exam form asks for. Presets for SSC, UPSC, NEET, JEE, CUET, IBPS, SBI, RRB and PAN, checked before download. Nothing is uploaded.",
    seoHowTo: [
      "Pick your exam or form; its photo and signature rules load.",
      "Add your photo and signature. Drag and zoom to frame the photo.",
      "Check the green ticks for size, pixels and format, then download.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
];

export function getTool(slug: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}
