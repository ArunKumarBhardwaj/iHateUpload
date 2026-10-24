/// <reference lib="webworker" />

import { receiveShare, SHARE_ACTION } from "./lib/share-inbox";
import { CACHE, cacheFirst, cachePolicy, networkFirst } from "./lib/sw-cache";

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // A file shared from another app: answered here, on the device. It never reaches the network.
  if (request.method === "POST" && new URL(request.url).pathname === SHARE_ACTION) {
    event.respondWith(receiveShare(request));
    return;
  }
  const policy = cachePolicy({
    method: request.method,
    mode: request.mode,
    url: request.url,
    origin: self.location.origin,
  });
  if (policy === "network-first") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (policy === "cache-first") {
    event.respondWith(cacheFirst(request));
  }
});
