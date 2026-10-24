# Batch for OCR, PDF to JPG/PNG, Crop, Redact and Extract images (2026-10-24)

These six tools took one file; iLovePDF caps the same tools at 1–2 files free and 10 on Premium. Now they take any number.

```
node internal/benchmarks/batch/gen.mjs                 # synthetic PDFs: text with emails/phones, scans, pictures, a locked file, two files named text-a.pdf
node internal/benchmarks/batch/prove.mjs 43128         # production build (or https://www.ihateupload.com): 10 checks, 0 POST
```

How each behaves with several files:
- PDF to JPG/PNG, OCR: same settings for every file; OCR loads its language data once for the batch.
- Crop: one crop box for every page of every file; a different crop per page stays one-file.
- Redact: drawn boxes go to the same spot in every file; the kinds of data accepted on the first file are found again in the others.
- Extract images: the size filter applies to all; unticked images in the grid apply to the first file.
- A file that fails (locked, unreadable, no pages in range) is skipped and named on the last result; same-named inputs get `-2`.
