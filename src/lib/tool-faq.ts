import type { ToolId } from "@/lib/tools";

export type FaqItem = { q: string; a: string };

/** Per-tool FAQ shown on the tool page and as FAQPage JSON-LD. Answers must match what the tool really does. */
export const TOOL_FAQ: Record<ToolId, FaqItem[]> = {
  "image-to-pdf": [
    {
      q: "Are my photos uploaded when I make a PDF?",
      a: "No. The PDF is built in your browser tab from the images you pick, and the images never leave your device.",
    },
    {
      q: "Which image types can I use?",
      a: "JPG, PNG and WebP. Each image becomes one page sized to the image.",
    },
    {
      q: "Can I choose the page order?",
      a: "Yes. The pages follow the order of the file list, so reorder the images before you click Create PDF.",
    },
  ],
  "png-to-pdf": [
    {
      q: "Does my PNG leave my device?",
      a: "No. The PDF is created in this browser tab, so the PNG files are never sent to a server.",
    },
    {
      q: "Can I combine several PNGs into one PDF?",
      a: "Yes. Add as many PNGs as you like and arrange them in the list. They become pages in that order.",
    },
    {
      q: "Is each page the size of its image?",
      a: "Yes. Each page is created at the pixel size of its PNG, with the image filling the page.",
    },
  ],
  "merge-pdf": [
    {
      q: "Are my PDFs uploaded to merge them?",
      a: "No. The files are combined inside your browser, so nothing is sent to a server.",
    },
    {
      q: "How do I set the order of the merged file?",
      a: "Reorder the files in the list before merging. The output follows that order, and each file keeps its own page order.",
    },
    {
      q: "How many files do I need?",
      a: "At least two PDFs. You can add more than two and merge them all into a single file.",
    },
  ],
  "pdf-to-jpg": [
    {
      q: "Is my PDF sent anywhere to make the images?",
      a: "No. Each page is drawn in your browser and saved as an image on your device.",
    },
    {
      q: "What resolutions can I choose?",
      a: "72, 150, 300 or 600 DPI. The default is 150 DPI.",
    },
    {
      q: "Can I control the JPG quality and which pages are exported?",
      a: "Yes. Pick Small, Balanced or Best for quality, and type a page range like 1-3, 7 or leave it empty for every page. You can download single images or all pages as a zip.",
    },
    {
      q: "Can I get PNG instead of JPG?",
      a: "Yes. Switch the format to PNG in the options, or use the PDF to PNG tool.",
    },
  ],
  "pdf-to-word": [
    {
      q: "Is my PDF uploaded during conversion?",
      a: "No. The Word file is built in your browser tab, and the PDF stays on your device.",
    },
    {
      q: "What is the difference between Editable text and Exact layout?",
      a: "Editable text turns paragraphs, headings, lists and tables into real Word content that reflows. Exact layout places each block in a text box where it sat on the page, so it looks the same and the text is still editable but does not reflow.",
    },
    {
      q: "Can it convert scanned PDFs?",
      a: "Yes, in Editable text mode pages with no text are read with OCR in your browser. You can pick the OCR language in the options.",
    },
    {
      q: "Is there a way to keep the pages as pictures?",
      a: "Yes. The Page images mode puts each page into the Word file as a picture. It looks the same, but the text cannot be edited.",
    },
  ],
  "pdf-to-pptx": [
    {
      q: "Is my PDF uploaded to make the slides?",
      a: "No. The PDF is read and the PowerPoint file is built in your browser tab. Nothing is sent anywhere.",
    },
    {
      q: "Can I edit the slides?",
      a: "Yes. Text lands in real text boxes with its font, size, colour and bullets, tables become real PowerPoint tables, and pictures and drawn shapes stay separate objects you can move or delete. Choose Page pictures instead if every slide must look exactly like the PDF.",
    },
    {
      q: "What slide size do I get?",
      a: "Same as the PDF page by default. You can also pick widescreen 16:9 or standard 4:3; each page is then scaled to fit and centred on its slide.",
    },
    {
      q: "Does it work on scanned PDFs?",
      a: "Yes. Pages with no text are read with OCR in your browser, in the language you pick, so the slide gets real text.",
    },
    {
      q: "Will it open in Keynote and Google Slides?",
      a: "Yes. The file is a standard .pptx, so PowerPoint, Keynote, Google Slides and LibreOffice Impress all open it.",
    },
  ],
  "pdf-to-excel": [
    {
      q: "Does my PDF get uploaded to find the tables?",
      a: "No. Tables are detected and the workbook is built in your browser, so the PDF stays on your device.",
    },
    {
      q: "Will numbers and dates be real Excel values?",
      a: "By default, yes. Numbers, dates and percentages become typed cells instead of text. You can turn this off in the options.",
    },
    {
      q: "How are sheets arranged?",
      a: "Choose one sheet per table, one per page, or everything on one sheet. By default a table that runs over several pages is joined into one table.",
    },
    {
      q: "Can I get CSV instead of XLSX, or limit the pages?",
      a: "Yes. The output can be an Excel workbook or CSV files, and you can enter a page range. Scanned pages are read with OCR in your browser.",
    },
  ],
  "pdf-to-png": [
    {
      q: "Are my pages uploaded to be turned into PNG?",
      a: "No. The pages are rendered in your browser and saved on your device.",
    },
    {
      q: "What resolutions are available?",
      a: "72, 150, 300 or 600 DPI. The default is 150 DPI, and higher values give larger images.",
    },
    {
      q: "Can I convert only some pages?",
      a: "Yes. Type a page range such as 1-3, 7, or leave it empty to convert every page. You can download images one by one or as a zip.",
    },
  ],
  "compress-pdf": [
    {
      q: "Is my PDF uploaded to be compressed?",
      a: "No. Compression runs in your browser, so the file never leaves your device and there is no server queue.",
    },
    {
      q: "What do the compression levels mean?",
      a: "Light keeps images print-sharp and suits contracts and CVs. Medium makes a smaller file for email. Smallest shrinks the most, for upload portals with tight limits.",
    },
    {
      q: "Can I compress to a specific size?",
      a: "Yes. Pick a target of 100 KB, 200 KB, 500 KB, 1 MB, 2 MB or 5 MB, or enter your own. If the target can't be reached without ruining the images, you get the smallest readable version.",
    },
    {
      q: "Will the text still be selectable?",
      a: "Yes. Images are resampled and recompressed, while text, links and forms stay as they were.",
    },
  ],
  "split-pdf": [
    {
      q: "Is my PDF uploaded when I split it?",
      a: "No. The new files are built in your browser from the PDF on your device.",
    },
    {
      q: "How can I split a PDF?",
      a: "Every page, by page ranges, in half, by file size in MB, by bookmarks, or by text, which starts a new file at each page containing a phrase you enter.",
    },
    {
      q: "How do I get the results?",
      a: "Download the files one by one, or grab them all together as a zip.",
    },
  ],
  "extract-pages": [
    {
      q: "Does my PDF leave my device when I extract pages?",
      a: "No. The new PDF is assembled in your browser, and the original is not changed.",
    },
    {
      q: "How do I choose the pages?",
      a: "Type page numbers and ranges like 1-3, 7, 9-. A trailing dash means up to the last page.",
    },
    {
      q: "In what order do the pages appear?",
      a: "In their original document order, with duplicates removed.",
    },
  ],
  "protect-pdf": [
    {
      q: "Is my password or PDF sent to a server?",
      a: "No. The PDF is encrypted in your browser, so neither the file nor the password leaves your device.",
    },
    {
      q: "What encryption is used?",
      a: "AES-256. Anyone opening the file will need the password you set.",
    },
    {
      q: "Can I also limit printing or copying?",
      a: "Yes. You can switch off printing, copying, editing and annotating, and optionally set a separate owner password. If you restrict the file and leave the owner password empty, a random one is made that nobody knows.",
    },
    {
      q: "Do I have to confirm the password?",
      a: "Yes. You type it twice so a typo does not lock you out of your own file.",
    },
  ],
  "unlock-pdf": [
    {
      q: "Is my PDF or password uploaded to unlock it?",
      a: "No. The decryption happens in your browser, so the file and password stay on your device.",
    },
    {
      q: "Can it open a PDF if I forgot the password?",
      a: "No. If the file needs a password to open, you must enter the correct one. This tool does not guess or crack passwords.",
    },
    {
      q: "What about PDFs with only editing or printing restrictions?",
      a: "If the PDF opens without a password and only has owner restrictions, the tool detects that and can remove them without a password.",
    },
  ],
  "rotate-pdf": [
    {
      q: "Does my PDF get uploaded for rotating?",
      a: "No. Pages are rotated in your browser and the file stays on your device.",
    },
    {
      q: "Which turns can I apply?",
      a: "90, 180 or 270 degrees, and you can also mirror pages. You can limit it to a page range, or turn single pages by their own amount.",
    },
    {
      q: "Does rotating hurt text quality?",
      a: "No. Pages are turned, not re-rendered, so text stays text.",
    },
  ],
  "organize-pdf": [
    {
      q: "Is my PDF uploaded to rearrange it?",
      a: "No. The reordered PDF is built in your browser from the file on your device.",
    },
    {
      q: "What can I change?",
      a: "You can reorder pages and remove pages, then save the result as a new PDF.",
    },
    {
      q: "Do I need to keep at least one page?",
      a: "Yes. At least one page must remain before you can save.",
    },
  ],
  "sign-pdf": [
    {
      q: "Is my signature or document uploaded?",
      a: "No. You place the signature in your browser and the signed PDF is created on your device.",
    },
    {
      q: "How can I create a signature?",
      a: "Draw it, type it, or upload an image of it, then drag and size it on the page. You can also place a typed date or text stamp.",
    },
    {
      q: "Is this a certified digital signature?",
      a: "No. It places your signature image or text on the page like a stamp. It does not add a cryptographic certificate signature.",
    },
  ],
  "fill-pdf-form": [
    {
      q: "Is my form uploaded while I fill it?",
      a: "No. The PDF is read and filled in your browser tab, and the filled copy is made on your device. Nothing is sent anywhere.",
    },
    {
      q: "Which fields can I fill?",
      a: "Text boxes, multi-line boxes, checkboxes, radio buttons, dropdowns, list boxes and date fields. Read-only fields stay locked, character limits are kept, and required fields are marked until you fill them.",
    },
    {
      q: "Will the values show up in Acrobat, Chrome and Preview?",
      a: "Yes. Every filled field gets a fresh appearance, so the values show in Adobe Acrobat, Chrome, Edge, Firefox and macOS Preview without the viewer having to redraw anything.",
    },
    {
      q: "What does Flatten do?",
      a: "It turns the values into part of the page, so the form can no longer be changed. The text stays selectable and searchable. Choose Keep editable if someone still needs to change it.",
    },
    {
      q: "My PDF has no boxes to fill. What now?",
      a: "If a PDF has no form fields, use Edit PDF to add text anywhere on the page, or Sign PDF to add a signature.",
    },
  ],
  "edit-pdf": [
    {
      q: "Is my PDF uploaded while I edit it?",
      a: "No. Editing and saving happen in your browser tab, and scans are read with OCR on your device.",
    },
    {
      q: "Does editing a line really remove the old text?",
      a: "Yes. When you replace a line, its original letters are removed from the file instead of being covered up.",
    },
    {
      q: "What else can I add?",
      a: "You can click lines to change them, use find and replace across pages, and add text, images, highlights and rectangles.",
    },
    {
      q: "Can I edit a scanned PDF?",
      a: "Yes. Pages without selectable text are read with OCR first, which can take a while on long scans.",
    },
  ],
  "crop-pdf": [
    {
      q: "Is my PDF uploaded to crop it?",
      a: "No. Cropping is done in your browser, so the file stays on your device.",
    },
    {
      q: "Can I crop each page differently?",
      a: "Yes. By default one crop box applies to all pages, and you can turn that off to set a separate box per page.",
    },
    {
      q: "How do I set the crop area?",
      a: "Drag the box on the page preview to the area you want to keep.",
    },
  ],
  "redact-pdf": [
    {
      q: "Is my PDF sent anywhere to find sensitive data?",
      a: "No. Scanning and redaction both run in your browser, and the document never leaves your device.",
    },
    {
      q: "What can it find automatically?",
      a: "Email addresses, phone numbers, card numbers, Aadhaar, PAN, IFSC codes, bank accounts, IBAN, US SSN and dates of birth. You can also add your own words or /regex/ patterns.",
    },
    {
      q: "Is the redacted content really removed?",
      a: "Yes. The covered content is destroyed in your browser, not just painted over. You review the matches and can untick any to keep, or draw boxes by hand.",
    },
    {
      q: "Does it clean other data?",
      a: "By default it also clears the title, author and other metadata, and drops invisible text layers from untouched pages. Both can be switched off.",
    },
  ],
  "compare-pdfs": [
    {
      q: "Are my two PDFs uploaded for comparison?",
      a: "No. Both are read and compared in your browser tab.",
    },
    {
      q: "What does the comparison show?",
      a: "Side-by-side page previews that flip together, plus a line-by-line text diff you can download.",
    },
    {
      q: "Which file is on which side?",
      a: "The first file in the list is the left side, so reorder the files to swap them.",
    },
  ],
  "extract-text": [
    {
      q: "Is my file uploaded to pull out the text?",
      a: "No. Text is read, and any OCR is run, in your browser. Your files stay on your device.",
    },
    {
      q: "Does it work on scans and photos?",
      a: "Yes. With OCR turned on, scanned PDFs and PNG, JPG or WebP images are read as well. You can choose the OCR language.",
    },
    {
      q: "What do I get?",
      a: "A .txt file with the text. You can add several files at once.",
    },
  ],
  "extract-images": [
    {
      q: "Does my PDF leave my device?",
      a: "No. The embedded pictures are pulled out in your browser.",
    },
    {
      q: "What size are the extracted images?",
      a: "Each picture is saved at its own native size, not at the size it appears on the page. JPEGs are saved exactly as they sit in the PDF.",
    },
    {
      q: "Can I skip tiny images or pick only some?",
      a: "Yes. You can hide pictures below a minimum pixel size and untick any you do not want. Download one image, or a zip if there are several.",
    },
  ],
  "header-footer": [
    {
      q: "Is my PDF uploaded to add headers?",
      a: "No. The text is stamped onto the pages in your browser, so the file stays on your device.",
    },
    {
      q: "What placeholders can I use?",
      a: "Type {page} for the page number, {pages} for the total and {date} for the date. You can put text on the left, center and right.",
    },
    {
      q: "Can I choose where it appears?",
      a: "Yes. Choose header, footer or both, set size, color, bold and margin, limit it to a page range, and skip the first page.",
    },
  ],
  "reverse-pages": [
    {
      q: "Is my PDF uploaded to reverse it?",
      a: "No. The page order is flipped in your browser, so the file stays on your device.",
    },
    {
      q: "What exactly happens to the order?",
      a: "The last page becomes the first, and so on. There are no options to set.",
    },
    {
      q: "Is the content changed?",
      a: "No. Only the page order changes.",
    },
  ],
  "delete-blank": [
    {
      q: "Does my PDF get uploaded to find blank pages?",
      a: "No. Pages are checked in your browser and the file stays on your device.",
    },
    {
      q: "How does it decide a page is blank?",
      a: "It draws each page and drops the ones that are near-white. If no page looks blank, or every page does, it tells you instead of saving a file.",
    },
    {
      q: "Does it work on scans?",
      a: "Yes. The check looks at the rendered page, so empty scanned pages are caught too.",
    },
  ],
  "insert-blank": [
    {
      q: "Is my PDF uploaded to add a blank page?",
      a: "No. The blank page is inserted in your browser, so the file stays on your device.",
    },
    {
      q: "Where is the blank page placed?",
      a: "After the page number you enter. Use 0 to insert it at the start.",
    },
    {
      q: "Can I add more than one blank page?",
      a: "This tool inserts one blank page per run. Run it again for more.",
    },
  ],
  "invert-pdf": [
    {
      q: "Is my PDF uploaded to change its colors?",
      a: "No. The colors are changed in your browser and the file stays on your device.",
    },
    {
      q: "Which modes are there?",
      a: "Dark mode, invert, sepia and grayscale.",
    },
    {
      q: "Will the text stay selectable?",
      a: "It can. The default vector method keeps text as text. The raster method turns pages into images at a DPI you choose.",
    },
  ],
  "n-up": [
    {
      q: "Is my PDF uploaded to make n-up sheets?",
      a: "No. The sheets are built in your browser from the file on your device.",
    },
    {
      q: "How many pages fit on a sheet?",
      a: "Presets are 2, 4, 6, 9 and 16 pages per sheet, laid out in columns and rows. You can also set the grid yourself.",
    },
    {
      q: "What sheet options can I change?",
      a: "Paper (A4, Letter, Legal or A3), orientation, margin, gap, a border around each page, and whether pages fill across or down.",
    },
  ],
  "page-size": [
    {
      q: "Does my PDF leave my device when I change the page size?",
      a: "No. Every page is resized in your browser.",
    },
    {
      q: "Which sizes are available?",
      a: "A4, Letter, Legal, A3, A5, Tabloid or a custom size.",
    },
    {
      q: "What is the difference between letterbox, fit and stretch?",
      a: "Letterbox keeps the whole page and adds margins. Fit fills the sheet and clips what overflows. Stretch ignores the aspect ratio.",
    },
  ],
  "watermark-pdf": [
    {
      q: "Is my PDF uploaded to add a watermark?",
      a: "No. The watermark is drawn onto the pages in your browser, so the file stays on your device.",
    },
    {
      q: "What can I customize?",
      a: "The text (the default is CONFIDENTIAL), size, angle, color, opacity and position. You can place it once or tile it across the page.",
    },
    {
      q: "Can I limit it to some pages?",
      a: "Yes. Type a page range, or leave it empty to stamp every page. The preview shows page 1.",
    },
  ],
  "page-numbers": [
    {
      q: "Is my PDF uploaded to add page numbers?",
      a: "No. The numbers are stamped in your browser, so the file stays on your device.",
    },
    {
      q: "What number styles are there?",
      a: "1 / N, 1, Page 1, Page 1 of N and roman numerals (i). You can pick the size and the starting number.",
    },
    {
      q: "Can I skip the cover page or change the position?",
      a: "Yes. There is a skip-first-page option, and you can put the numbers at the header, footer or any corner.",
    },
  ],
  "bates-numbering": [
    {
      q: "Is my PDF uploaded for Bates numbering?",
      a: "No. The numbers are stamped in your browser, so the files stay on your device.",
    },
    {
      q: "What does a Bates number look like?",
      a: "A prefix, a zero-padded counter and an optional suffix, such as ABC000001. You set the prefix, suffix, starting number and number of digits.",
    },
    {
      q: "Does the count continue across files?",
      a: "Yes. The counter runs on from one file to the next, in the order the files are listed.",
    },
    {
      q: "Is the number real text?",
      a: "Yes. It is stamped as selectable text. You can also add a white plate behind it so it reads on dark pages.",
    },
  ],
  "repair-pdf": [
    {
      q: "Is my damaged PDF uploaded?",
      a: "No. The file is read and rebuilt in your browser tab. Nothing is sent anywhere, which matters most for files you cannot open to check what is inside.",
    },
    {
      q: "What kinds of damage can it fix?",
      a: "Broken or missing cross-reference tables, wrong pointers, junk before the PDF header, a missing end of file, damaged object streams, streams with the wrong length, a destroyed document catalog, and downloads that were cut short.",
    },
    {
      q: "How does it decide which repair to keep?",
      a: "It runs three independent rebuilds: a structural re-save that keeps bookmarks and forms, a salvage that rebuilds the page list from the pages that survived, and a rebuild from what a PDF reader can still see. Each result is reopened and the one with the most readable pages and text wins.",
    },
    {
      q: "Can it bring back pages that are not in the file any more?",
      a: "No tool can. If a download stopped early, the missing pages are simply not there. Repair keeps every page that survived, leaves out pages that were cut off, and tells you how many.",
    },
    {
      q: "Does it work on password-protected PDFs?",
      a: "Remove the password first with Unlock PDF, then repair the unlocked copy.",
    },
  ],
  "flatten-pdf": [
    {
      q: "Is my PDF uploaded to flatten it?",
      a: "No. Flattening runs in your browser, so the file stays on your device.",
    },
    {
      q: "What is the difference between the two modes?",
      a: "Form mode burns the form fields into the page so they can no longer be edited. Full mode turns every page into a picture, so nothing underneath can be copied, edited or clicked.",
    },
    {
      q: "What resolution does full flatten use?",
      a: "Between 96 and 400 DPI. The default is 150 DPI.",
    },
    {
      q: "Can it remove other things?",
      a: "Yes. You can also strip annotations, forms, metadata, JavaScript and attachments. Metadata and JavaScript removal are on by default.",
    },
  ],
  "ocr-pdf": [
    {
      q: "Is my scan uploaded for OCR?",
      a: "No. The Tesseract OCR engine runs in your browser tab, so your pages stay on your device.",
    },
    {
      q: "Which languages are supported?",
      a: "English, Hindi, English + Hindi, Spanish, French, German, Portuguese, Italian, Arabic, Bengali and Chinese.",
    },
    {
      q: "What does the result look like?",
      a: "The original pages stay as images with an invisible text layer on top, so you can search and copy. You can output the searchable PDF, a text file, or both.",
    },
    {
      q: "Is OCR fast?",
      a: "It runs on your own device, so long scans take a while. By default it skips pages that already have selectable text.",
    },
  ],
  "strip-metadata": [
    {
      q: "Is my PDF uploaded to remove its metadata?",
      a: "No. The properties are cleared in your browser, so the file stays on your device.",
    },
    {
      q: "What is removed?",
      a: "Hidden document properties such as author and title. To see or change individual fields instead, use the Edit Metadata tool.",
    },
    {
      q: "Does it change how the pages look?",
      a: "No. Only the document properties change.",
    },
  ],
  "edit-metadata": [
    {
      q: "Is my PDF uploaded to edit its properties?",
      a: "No. The properties are read and written in your browser, so the file stays on your device.",
    },
    {
      q: "Which fields can I change?",
      a: "Title, author, subject, keywords, creator, producer, creation and modified dates, and custom properties.",
    },
    {
      q: "What about the XMP data?",
      a: "You can update it to match your edits or remove it. The standard Info properties and the XMP packet are kept in agreement.",
    },
    {
      q: "Can I clear everything at once?",
      a: "Yes. Use Strip everything to empty all fields.",
    },
  ],
  "ask-pdf": [
    {
      q: "Is my PDF uploaded when I use Ask PDF?",
      a: "The PDF file itself is not uploaded. Its text is extracted in your browser, and that text plus your chat messages are sent to Google Gemini to produce answers.",
    },
    {
      q: "Does the text go through your server?",
      a: "By default, yes: the text and chat pass through our server to Google. If you enter your own Gemini key, they go straight from your browser to Google instead, without our server.",
    },
    {
      q: "How many PDFs can I ask about, and does it remember the conversation?",
      a: "Up to 10 PDFs at once, with follow-up questions in the same chat. The model is told to answer only from the documents and to name the file and page it used.",
    },
    {
      q: "Can it read scanned PDFs?",
      a: "Not directly. It needs selectable text, so run a scanned PDF through OCR PDF first. Very long documents are cut to fit a text limit.",
    },
  ],
  "word-to-pdf": [
    {
      q: "Is my Word file uploaded?",
      a: "No. The .docx is read and the PDF is built in your browser tab, so the document stays on your device.",
    },
    {
      q: "Will it match Microsoft Word exactly?",
      a: "Not always. The layout is a close approximation and complex documents may differ from what Word would produce.",
    },
    {
      q: "Which files are accepted?",
      a: "Modern .docx files. You can convert more than one at a time.",
    },
  ],
  "excel-to-pdf": [
    {
      q: "Is my spreadsheet uploaded?",
      a: "No. The workbook is read and the PDF is drawn in your browser, so it stays on your device.",
    },
    {
      q: "Which spreadsheet formats work?",
      a: ".xlsx and .xls files.",
    },
    {
      q: "What can I control in the PDF?",
      a: "Which sheets to include, paper size, orientation and margins, an optional title and footer, zebra shading, and whether to shrink text to fit the page width or wrap it.",
    },
  ],
  "pptx-to-pdf": [
    {
      q: "Is my presentation uploaded?",
      a: "No. The .pptx is read and the PDF is made in your browser tab, so the slides stay on your device.",
    },
    {
      q: "What ends up in the PDF?",
      a: "One page per slide, with shapes, pictures and backgrounds drawn and text kept as real selectable text.",
    },
    {
      q: "Are hidden slides included?",
      a: "Not by default. There is an option to include slides marked hidden.",
    },
  ],
  "markdown-to-pdf": [
    {
      q: "Is my Markdown file uploaded?",
      a: "No. The .md file is read and the PDF is drawn in your browser, so it stays on your device.",
    },
    {
      q: "What formatting is supported?",
      a: "Headings, lists and code blocks, plus math written between dollar signs as LaTeX, which is on by default.",
    },
    {
      q: "What can I adjust?",
      a: "Paper size, orientation, margins, font (sans, serif or mono), font size, line spacing, a table of contents and numbered headings.",
    },
  ],
  "csv-to-pdf": [
    {
      q: "Is my CSV uploaded?",
      a: "No. The file is read and the PDF is drawn in your browser, so the data stays on your device.",
    },
    {
      q: "Can I shape the table before printing?",
      a: "Yes. You can sort by a column, filter rows by text, and hide columns, with a preview before you create the PDF.",
    },
    {
      q: "What page options are there?",
      a: "Paper size, orientation and margins, an optional title and footer, and zebra shading. Tables default to landscape.",
    },
  ],
  "html-to-pdf": [
    {
      q: "Is my HTML file uploaded?",
      a: "No. The file is read and the PDF is made in your browser tab, so it stays on your device.",
    },
    {
      q: "Do scripts run?",
      a: "No. Scripts are not run. The text and headings of the page are converted.",
    },
    {
      q: "Can I convert a live web address?",
      a: "No. This tool takes an HTML file from your device, not a URL.",
    },
  ],
  "scan-to-pdf": [
    {
      q: "Are my scans uploaded?",
      a: "No. The camera image or photo is processed and the PDF is built in your browser, so the pages stay on your device.",
    },
    {
      q: "How does it clean up the page?",
      a: "It can detect the page corners automatically, which you can drag to adjust, and correct the perspective. Filters are Original, Document, B&W, Grayscale and Photo, with brightness and contrast controls.",
    },
    {
      q: "Can the PDF be searchable?",
      a: "Yes. A searchable text layer made with OCR is on by default, and you can choose the language.",
    },
    {
      q: "Which page sizes can I pick?",
      a: "A4, Letter or Original. You can also rotate and reorder the pages.",
    },
  ],
  "heic-to-jpg": [
    {
      q: "Are my iPhone photos uploaded?",
      a: "No. The HEIC photos are converted in your browser, so they never leave your device.",
    },
    {
      q: "Can I convert many at once?",
      a: "Yes. Add several HEIC or HEIF photos and download the JPG files.",
    },
    {
      q: "What about HEIC files that are secretly JPG?",
      a: "Files that are already JPEG inside are recognized and passed through the normal JPG path.",
    },
  ],
  "heic-to-pdf": [
    {
      q: "Are my iPhone photos uploaded to make the PDF?",
      a: "No. The photos are converted and the PDF is built in your browser tab, so they stay on your device.",
    },
    {
      q: "Can I put several photos in one PDF?",
      a: "Yes. Add multiple HEIC photos and they become pages in one PDF.",
    },
    {
      q: "Can I choose the page order?",
      a: "Yes. The pages follow the order in the file list, so reorder before creating the PDF.",
    },
  ],
  "compress-image": [
    {
      q: "Are my images uploaded to be compressed?",
      a: "No. Compression runs in your browser, so the images stay on your device.",
    },
    {
      q: "Which formats work and how much does it shrink?",
      a: "JPG, PNG and WebP. Images are limited to 1920 pixels on the longest side and compressed toward about 1 MB. The savings depend on the image.",
    },
    {
      q: "What if the result is not smaller?",
      a: "Then the original file is kept, so you never get a bigger file back.",
    },
    {
      q: "Can I hit an exact size?",
      a: "Use the Compress Image to Size tool for a target such as 100 KB or 200 KB.",
    },
  ],
  "resize-image": [
    {
      q: "Are my images uploaded to resize them?",
      a: "No. Resizing happens in your browser, so the images stay on your device.",
    },
    {
      q: "How do I choose the new size?",
      a: "Set a maximum edge in pixels: 1920, 1280, 800 or 640, or a custom value from 16 to 10000. The longest side is scaled to that and the proportions are kept.",
    },
    {
      q: "Will it enlarge small images?",
      a: "No. Only images larger than the maximum edge are scaled down.",
    },
    {
      q: "What format do I get back?",
      a: "PNG files stay PNG. Other images are saved as JPG.",
    },
  ],
  "webp-to-jpg": [
    {
      q: "Are my WebP files uploaded?",
      a: "No. They are converted in your browser, so the images stay on your device.",
    },
    {
      q: "What happens to transparent areas?",
      a: "JPG has no transparency, so transparent areas are filled with white.",
    },
    {
      q: "Can I convert a batch?",
      a: "Yes. Add several WebP images and download the JPG files.",
    },
  ],
  "png-to-jpg": [
    {
      q: "Are my PNGs uploaded?",
      a: "No. The conversion happens in your browser, so the images stay on your device.",
    },
    {
      q: "What happens to transparent areas?",
      a: "JPG has no transparency, so transparent areas are filled with white.",
    },
    {
      q: "Why convert PNG to JPG?",
      a: "JPG files are usually smaller, and more apps and forms accept them. The conversion is lossy, so fine detail can soften slightly.",
    },
  ],
  "jpg-to-png": [
    {
      q: "Are my JPGs uploaded?",
      a: "No. The conversion happens in your browser, so the images stay on your device.",
    },
    {
      q: "Will the image quality improve?",
      a: "No. PNG is lossless, so it keeps the pixels as they are, but it cannot restore detail already lost in the JPG. The file is usually larger.",
    },
    {
      q: "Can I convert several images at once?",
      a: "Yes. Add multiple JPG or JPEG files and download the PNG files.",
    },
  ],
  "jpg-to-webp": [
    {
      q: "Are my images uploaded?",
      a: "No. They are converted to WebP in your browser, so they stay on your device.",
    },
    {
      q: "Which inputs are accepted?",
      a: "JPG and PNG images.",
    },
    {
      q: "Does every browser support WebP output?",
      a: "Most do. If your browser cannot encode WebP, the tool reports it instead of giving you a wrong file.",
    },
  ],
  "crop-image": [
    {
      q: "Is my photo uploaded to crop it?",
      a: "No. Cropping happens in your browser tab, so the photo stays on your device.",
    },
    {
      q: "How do I choose the area?",
      a: "Drag the crop box over the photo, then click Crop image.",
    },
    {
      q: "What format is the cropped file?",
      a: "It keeps the format of the original: JPG, PNG or WebP.",
    },
  ],
  "rotate-image": [
    {
      q: "Is my photo uploaded to rotate it?",
      a: "No. Rotating happens in your browser tab, so the photo stays on your device.",
    },
    {
      q: "What can I do to the photo?",
      a: "Turn it 90, 180 or 270 degrees, and flip it horizontally or vertically.",
    },
    {
      q: "Can I rotate many photos at once?",
      a: "Yes. Add several photos and the same turn or flip is applied to each. They keep their original format.",
    },
  ],
  "compress-to-size": [
    {
      q: "Is my photo uploaded to reach a size?",
      a: "No. The photo is compressed in your browser, so it stays on your device.",
    },
    {
      q: "Which sizes can I aim for?",
      a: "Presets of 50, 100, 200, 500 KB or 1 MB, or a custom value between 20 KB and 8192 KB.",
    },
    {
      q: "How does it reach the target?",
      a: "It lowers the JPG quality and, if that is not enough, reduces the dimensions. If the target cannot be met, you get an error instead of an oversized file.",
    },
    {
      q: "What format is the output?",
      a: "JPG. A JPG that is already under the target is returned unchanged.",
    },
  ],
};
