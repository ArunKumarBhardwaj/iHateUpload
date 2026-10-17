import type { FinalPage, PreviewSettings } from "./runtime";
import type { ScanRequest } from "./scan.worker";
import type { Quad, RGBAImage } from "./types";

export type ScanClient = {
  detect(key: string, file: Blob): Promise<{ corners: Quad | null; width: number; height: number }>;
  preview(key: string, file: Blob, settings: PreviewSettings, side: number): Promise<RGBAImage>;
  final(key: string, file: Blob, settings: PreviewSettings, ocr: boolean): Promise<FinalPage>;
  forget(key: string): void;
  dispose(): void;
};

type Body<T> = T extends { id: number } ? Omit<T, "id"> : never;
type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; message: string };

/** Pixel work runs in a worker; browsers without one run the same code inline. */
export function createScanClient(): ScanClient {
  let worker: Worker | null = null;
  try {
    if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
      worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
    }
  } catch {
    worker = null;
  }
  if (!worker) return inlineClient();
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let next = 1;
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const reply = event.data;
    const p = pending.get(reply.id);
    if (!p) return;
    pending.delete(reply.id);
    if (reply.ok) p.resolve(reply.value);
    else p.reject(new Error(reply.message));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    for (const p of pending.values()) p.reject(new Error(event.message || "The scanner stopped."));
    pending.clear();
  };
  const w = worker;
  function call<T>(req: Body<ScanRequest>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ ...req, id });
    });
  }
  return {
    detect: (key, file) => call({ op: "detect", key, file }),
    preview: (key, file, settings, side) => call({ op: "preview", key, file, settings, side }),
    final: (key, file, settings, ocr) => call({ op: "final", key, file, settings, ocr }),
    forget: (key) => void call({ op: "forget", key }).catch(() => {}),
    dispose: () => w.terminate(),
  };
}

function inlineClient(): ScanClient {
  const runtime = import("./runtime");
  return {
    detect: async (key, file) => (await runtime).opDetect(key, file),
    preview: async (key, file, settings, side) => (await runtime).opPreview(key, file, settings, side),
    final: async (key, file, settings, ocr) => (await runtime).opFinal(key, file, settings, ocr),
    forget: (key) => void runtime.then((r) => r.forget(key)),
    dispose: () => {},
  };
}
