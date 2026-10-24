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

## Results (live, 2026-10-24, real Gemini through our server)

| doc | pages | numbers kept | English left in real sentences | Spanish function words |
|---|---|---|---|---|
| invoice | 1 -> 1 | 100% | 0% | 18 |
| letter | 2 -> 2 | 100% | 0% | 11 |
| memo-pdflib | 1 -> 1 | 100% | 20% (radios, portal: same in Spanish) | 15 |
| brochure | 1 -> 1 | 100% | 25% (a web address and "morning" in a name) | 12 |
| report-chart | 1 -> 1 | 100% | 0% | 8 |
| contract | 2 -> 2 | 100% | 0% | 21 |

The corpus pads pages with random word lists ("Wagon pepper morning…"); the model leaves those as they are, so they are not counted.
The first live run, with a prompt that said to keep text with "nothing to translate", left short headings and job titles in English;
the prompt now asks for every heading and label (733ef8f).

### iLovePDF (Translate PDF, Keep layout, Standard AI)

Signed out it translated one file (the invoice), then showed "Upgrade to Premium" on the second. On the invoice:

| | ours | iLovePDF |
|---|---|---|
| numbers kept | 27/27 | 26/27 (8.25% became 8,25%) |
| English left | none | none |
| layout | original sizes kept in every row, text inside the page | dates, three table rows and the tax line shrunk to tiny text; row sizes uneven; FACTURA runs past the right margin |
| file size | 90.7 KB | 36.7 KB |
