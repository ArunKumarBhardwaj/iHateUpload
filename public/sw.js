(() => {
  // src/lib/share-inbox.ts
  var SHARE_ACTION = "/share-target";
  var SHARE_FIELD = "files";
  var DB = "ihateupload-share";
  var STORE = "inbox";
  var MAX_AGE_MS = 24 * 60 * 60 * 1000;
  function sharedFiles(entries) {
    const out = [];
    for (const value of entries)
      if (typeof value !== "string" && value.size > 0)
        out.push(value);
    return out;
  }
  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function run(db, mode, work) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function putShared(files, now = Date.now()) {
    const db = await open();
    try {
      const old = await run(db, "readonly", (s) => s.getAll());
      for (const e of old)
        if (now - e.at > MAX_AGE_MS)
          await run(db, "readwrite", (s) => s.delete(e.id));
      const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const entry = {
        id,
        at: now,
        files: files.map((f) => ({ name: f.name, type: f.type, lastModified: f.lastModified, data: f }))
      };
      await run(db, "readwrite", (s) => s.put(entry));
      return id;
    } finally {
      db.close();
    }
  }
  async function receiveShare(request) {
    try {
      const form = await request.formData();
      const files = sharedFiles(form.getAll(SHARE_FIELD));
      if (!files.length)
        return Response.redirect("/share?empty=1", 303);
      return Response.redirect(`/share?id=${encodeURIComponent(await putShared(files))}`, 303);
    } catch {
      return Response.redirect("/share?failed=1", 303);
    }
  }

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
    if (request.method === "POST" && new URL(request.url).pathname === SHARE_ACTION) {
      event.respondWith(receiveShare(request));
      return;
    }
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
