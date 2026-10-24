import { expect, test } from "bun:test";

import { CACHE, cachePolicy } from "./sw-cache";

const origin = "https://www.ihateupload.com";

test("keeps the live cache name", () => {
  expect(CACHE).toBe("ihateupload-static-v2");
});

test("skips writes, other hosts, and navigations", () => {
  expect(
    cachePolicy({
      method: "POST",
      mode: "cors",
      url: `${origin}/app.js`,
      origin,
    }),
  ).toBe("skip");
  expect(
    cachePolicy({
      method: "GET",
      mode: "cors",
      url: "https://cdn.example/app.js",
      origin,
    }),
  ).toBe("skip");
  expect(
    cachePolicy({
      method: "GET",
      mode: "navigate",
      url: `${origin}/tools/merge-pdf`,
      origin,
    }),
  ).toBe("skip");
});

test("network-first for same-origin js, css, and mjs", () => {
  expect(
    cachePolicy({
      method: "GET",
      mode: "cors",
      url: `${origin}/_next/static/chunks/app.js`,
      origin,
    }),
  ).toBe("network-first");
  expect(
    cachePolicy({
      method: "GET",
      mode: "cors",
      url: `${origin}/app.css`,
      origin,
    }),
  ).toBe("network-first");
  expect(
    cachePolicy({
      method: "GET",
      mode: "cors",
      url: `${origin}/pdf.worker.min.mjs`,
      origin,
    }),
  ).toBe("network-first");
});

test("cache-first for fonts, images, and the manifest", () => {
  expect(
    cachePolicy({
      method: "GET",
      mode: "cors",
      url: `${origin}/icon.png`,
      origin,
    }),
  ).toBe("cache-first");
  expect(
    cachePolicy({
      method: "GET",
      mode: "cors",
      url: `${origin}/site.webmanifest`,
      origin,
    }),
  ).toBe("network-first");
});

test("leaves HTML tool routes uncached", () => {
  expect(
    cachePolicy({
      method: "GET",
      mode: "same-origin",
      url: `${origin}/tools/compress-to-size`,
      origin,
    }),
  ).toBe("skip");
});

test("cache-first for the version-pinned OCR and pdf.js engine files", () => {
  for (const path of [
    "/tesseract/7.0.0/worker.min.js",
    "/tesseract/7.0.0/tesseract-core-simd-lstm.wasm.js",
    "/tessdata/4.0.0_best_int/eng.traineddata.gz",
    "/pdfjs/6.2.108/wasm/openjpeg.wasm",
    "/pdfjs/6.2.108/cmaps/UniGB-UCS2-H.bcmap",
  ]) {
    expect(
      cachePolicy({ method: "GET", mode: "cors", url: `${origin}${path}`, origin }),
    ).toBe("cache-first");
  }
});
