# Fill PDF form — proof and head-to-head (2026-10-20)

Synthetic fixtures only (`gen.ts` → `fx/form.pdf`, `fx/plain.pdf`).

```
bun internal/benchmarks/fill-form/gen.ts
bunx next build && bunx next start --port 43127
node internal/benchmarks/fill-form/prove.mjs 43127      # our page, 21 checks
bun internal/benchmarks/fill-form/verify.ts out/filled-editable.pdf out/filled-flat.pdf out/filled-unicode.pdf
node internal/benchmarks/fill-form/render-chrome.mjs     # Chrome PDF viewer screenshots
node internal/benchmarks/fill-form/rival.mjs             # ihatepdf.cv/fill-pdf-form, same values
bun internal/benchmarks/fill-form/verify.ts out/rival-editable.pdf out/rival-flat.pdf
```

Their tool hands the file to a save helper Playwright cannot see, so `rival.mjs` reads the
bytes from `window._lastDownloadedFile`, which their tool sets right before saving.

| | Ours | ihatepdf.cv |
|---|---|---|
| read-back checks (verify.ts, 24 + unicode) | 25/25 | 18/24 (PIN missing, newline lost, 1 of 2 list picks) |
| required name empty | save blocked, field flagged | saved |
| read-only Case ID | locked | editable |
| "Łukasz Ωmega Дмитрий" | drawn (embedded Liberation Sans) | no file |
| time to file | ~110 ms | ~65 ms |
