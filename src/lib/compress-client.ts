import type { CompressPlan } from "@/lib/compress-plans";
import type {
  CompressMessage,
  CompressRequest,
} from "@/lib/compress-pdf.worker";

/**
 * Runs one compression in a worker so a 100-page scan never freezes the
 * tab. Browsers without module workers run the same engine inline.
 */
export async function compressInWorker(
  bytes: Uint8Array,
  plan: CompressPlan,
  onProgress: (fraction: number) => void,
  targetBytes?: number,
): Promise<{ bytes: Uint8Array; fit: boolean }> {
  if (typeof Worker === "undefined") {
    return compressInline(bytes, plan, onProgress, targetBytes);
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL("./compress-pdf.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return compressInline(bytes, plan, onProgress, targetBytes);
  }
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<CompressMessage>) => {
        const message = event.data;
        if (message.type === "progress") onProgress(message.value);
        else if (message.type === "done") {
          resolve({ bytes: new Uint8Array(message.bytes), fit: message.fit });
        } else reject(new Error(message.message));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        reject(new Error(event.message || "The compressor stopped."));
      };
      const copy = bytes.slice().buffer as ArrayBuffer;
      const request: CompressRequest = { bytes: copy, plan, targetBytes };
      worker.postMessage(request, [copy]);
    });
  } finally {
    worker.terminate();
  }
}

async function compressInline(
  bytes: Uint8Array,
  plan: CompressPlan,
  onProgress: (fraction: number) => void,
  targetBytes?: number,
) {
  const [{ createWasmCodec }, engine] = await Promise.all([
    import("@/lib/compress-codec"),
    import("@/lib/compress-engine"),
  ]);
  const codec = createWasmCodec();
  if (targetBytes) {
    return engine.compressPdfToTarget(bytes, targetBytes, codec, onProgress);
  }
  const { bytes: out } = await engine.compressPdfBytes(bytes, plan, codec, onProgress);
  return { bytes: out, fit: true };
}
