(() => {
  // src/lib/wasm-assets.ts
  var TESSERACT_VERSION = "7.0.0";
  var TESSDATA_VERSION = "4.0.0_best_int";
  var PDFJS_VERSION = "6.2.108";
  var TESSERACT_DIR = `/tesseract/${TESSERACT_VERSION}`;
  var TESSDATA_DIR = `/tessdata/${TESSDATA_VERSION}`;
  var PDFJS_DIR = `/pdfjs/${PDFJS_VERSION}`;
  var VERSIONED_ASSET = /^\/(?:tesseract|tessdata|pdfjs)\//;

  // src/lib/sw-cache.ts
  var CACHE = "ihateupload-static-v2";
  var IMMUTABLE = /\.(?:woff2?|png|svg|ico|webmanifest)$/;
  var CODE = /\.(?:js|css|mjs|wasm)$/;
  function cachePolicy(input) {
    if (input.method !== "GET")
      return "skip";
    const url = new URL(input.url);
    if (url.origin !== input.origin)
      return "skip";
    if (input.mode === "navigate")
      return "skip";
    if (VERSIONED_ASSET.test(url.pathname))
      return "cache-first";
    if (CODE.test(url.pathname))
      return "network-first";
    if (IMMUTABLE.test(url.pathname))
      return "cache-first";
    return "skip";
  }
  async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok)
        await cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request);
      if (cached)
        return cached;
      throw new Error("offline");
    }
  }
  async function cacheFirst(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached)
      return cached;
    const response = await fetch(request);
    if (response.ok)
      await cache.put(request, response.clone());
    return response;
  }

  // src/sw.ts
  self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
  });
  self.addEventListener("fetch", (event) => {
    const request = event.request;
    const policy = cachePolicy({
      method: request.method,
      mode: request.mode,
      url: request.url,
      origin: self.location.origin
    });
    if (policy === "network-first") {
      event.respondWith(networkFirst(request));
      return;
    }
    if (policy === "cache-first") {
      event.respondWith(cacheFirst(request));
    }
  });
})();
