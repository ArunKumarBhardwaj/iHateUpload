import { VERSIONED_ASSET } from "./wasm-assets";

export const CACHE = "ihateupload-static-v2";
export const IMMUTABLE = /\.(?:woff2?|png|svg|ico)$/;
/** Fetched fresh when online. The manifest is here so installed apps see new features like the share target. */
export const CODE = /\.(?:js|css|mjs|wasm|webmanifest)$/;

export type CachePolicy = "skip" | "network-first" | "cache-first";

export function cachePolicy(input: {
  method: string;
  mode: string;
  url: string;
  origin: string;
}): CachePolicy {
  if (input.method !== "GET") return "skip";
  const url = new URL(input.url);
  if (url.origin !== input.origin) return "skip";
  if (input.mode === "navigate") return "skip";
  if (VERSIONED_ASSET.test(url.pathname)) return "cache-first";
  if (CODE.test(url.pathname)) return "network-first";
  if (IMMUTABLE.test(url.pathname)) return "cache-first";
  return "skip";
}

export async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline");
  }
}

export async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
