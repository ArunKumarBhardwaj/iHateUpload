# PDF to PDF/A: proof and head-to-head with iLovePDF (2026-10-24)

Synthetic files only (11 kinds, `gen.ts` + `gen-apps.mjs`). Validator: veraPDF 1.30 (`brew install verapdf`).

```
bun internal/benchmarks/pdfa/gen.ts                    # 8 pdf-lib fixtures -> fx/
node internal/benchmarks/pdfa/gen-apps.mjs             # Chrome print + LibreOffice (plain and PDF/A-2b); LibreOffice runs outside the sandbox
bun internal/benchmarks/pdfa/quick.ts [1b 2b 3b]       # dev loop: engine only, stand-in pictures, veraPDF per file
bunx next build && bunx next start --port 43128
node internal/benchmarks/pdfa/prove.mjs 43128          # real page: whole corpus per level, veraPDF on every download, 0 POST
node internal/benchmarks/pdfa/rival-ilovepdf.mjs [f]   # iLovePDF signed out (stops at the Premium wall after one file)
bun internal/benchmarks/pdfa/score.ts                  # veraPDF, text kept and PDFKit visual match vs source -> out/score.md
```

## Ours (production build, browser)

| level | valid (veraPDF) | batch of 11 | uploads |
|---|---|---|---|
| 2b | 11/11 | 0.32 s | 0 |
| 1b | 11/11 | 0.83 s | 0 |
| 3b | 11/11 | 0.33 s | 0 |

Text kept 100% on every file except chrome-report at 1b (98.6%: its page has see-through drawing, so it becomes a picture with an
invisible text layer, and that layer is WinAnsi only, so the Japanese line is lost from search). Visual match to the source in
PDFKit: 99.5% mean; cmyk-flyer 96.0% because DeviceCMYK is now tagged with a SWOP-like profile and Quartz's Generic CMYK differs.

Pages drawn as pictures: cjk-unembedded (a font the file does not carry, every level); in 1b only, chrome-report, layers and
transparency (PDF/A-1 has no transparency or layers). Everything else stays vector with selectable text.

## iLovePDF

`/convert-pdf-to-pdfa` is badged Premium. Signed out, one conversion goes through, then a modal says "PDF to PDF/A conversion is
a Premium feature" and asks to sign up. We did not get around it (no fresh profiles or cookie clearing), so only 2 of 33 runs
have an output: scan-ocr 2b (valid, 5.2 KB vs our 9.5 KB, visual 99.6 vs 100) and already-pdfa2b 2b (valid, 35.6 KB vs our 25 KB).

Why each part is written the way it is (TypeScript vs Rust/WASM, per component, with numbers): `decisions.tsv`.
They offer 1a/1b/2a/2b/2u/3a/3b/3u with "allow downgrade"; we offer 1b/2b/3b.
