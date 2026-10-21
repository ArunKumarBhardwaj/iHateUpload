# Workflows (chain steps) + batch

Synthetic corpus only: 20 three-page PDFs (text plus a photo-like JPEG) and 20 JPGs, generated in code.

```
bun internal/benchmarks/workflows/gen.ts DIR                      # writes DIR/pdf, DIR/img
bunx next build && bunx next start --port 43161                   # production build
node internal/benchmarks/workflows/prove.mjs --corpus DIR --out OUT [--shots]
node internal/benchmarks/workflows/smoke.mjs --corpus DIR         # all 41 settings panels, failure isolation, share link
node internal/benchmarks/workflows/rival.mjs --corpus DIR --out OUT   # probe of ihatepdf.cv/workflow
```

## Results (2026-10-21, production build, Chrome, one run)

| Chain | Input | Time | Output | Checks |
|---|---|---|---|---|
| Merge, Compress (medium), Protect | 20 PDFs, 2.40 MB | 3.9 s | 1 PDF, 451 KB, 60 pages | pdf.js: "No password given" without the password; 60 pages and text of docs 01, 10, 20 with it; /Encrypt present |
| Images to PDF (one PDF), Compress (medium) | 20 JPGs, 6.0 MB | 9.4 s | 1 PDF, 1.2 MB, 20 pages | pdf.js opens, 20 pages |

Both runs: 0 non-GET requests. Smoke: all 41 allowlisted tools open their settings with no file and no page error; a corrupt PDF among three good ones fails alone ("stopped at step 1") while the others finish; a share link taken after typing a password holds no password and reloads the steps.

## ihatepdf.cv /workflow (probed the same day)

- File input is `multiple=false`, `accept=application/pdf`: 20 PDFs are rejected by the input itself, images are not accepted, there is no image-to-PDF operation.
- 17 operations, 7 presets (Email Ready, Confidential, Print Ready, Archive, Draft Review, Standardize A4, Legal Bates), toolbar with undo/redo, history, save, export, step count and Run.
- 11 POSTs to l.clarity.ms (session recorder) during the visit.
- Not measured: their Run button could not be driven from the harness (the toolbar stayed dimmed after clicks), so there is no timing or output check for them.
