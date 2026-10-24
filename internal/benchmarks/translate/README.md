# Translate PDF: proof and head-to-head with iLovePDF (2026-10-24)

Synthetic corpus documents from `../pdf-to-word/realistic/corpus`, translated from English into Spanish.

```
bun internal/benchmarks/translate/direct.ts in.pdf out.pdf [upper|long]   # engine only, stand-in translator
node internal/benchmarks/translate/prove.mjs 43128 --stub                 # local build without a Gemini key: /api/translate answered in the browser
node internal/benchmarks/translate/prove.mjs https://www.ihateupload.com  # live, real Gemini through our server
node internal/benchmarks/translate/rival-ilovepdf.mjs                     # iLovePDF signed out, Keep layout, To: Spanish (stops at the Premium wall)
```

Checks per file: same page count, every number of the source still in the output, share of English words of 5+ letters left
(names and brands stay, so never 0), Spanish function words present, and that only JSON text was POSTed to /api/translate.

How it works: the shared document engine finds each paragraph and table cell (list markers included), the texts go to Gemini in
batches as a JSON list, then on the original PDF the old glyphs in each box are deleted and the translation is drawn in the same
box (Liberation Sans, Caladea for serif sources, Noto Sans Devanagari for Hindi/Marathi/Nepali), shrunk only when the free space
around it runs out. Scans get a white patch under the new words.
