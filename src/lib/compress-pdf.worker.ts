import { createWasmCodec } from "@/lib/compress-codec";
import { compressPdfBytes, compressPdfToTarget } from "@/lib/compress-engine";
import type { CompressPlan } from "@/lib/compress-plans";

export type CompressRequest = {
  bytes: ArrayBuffer;
  plan: CompressPlan;
  /** When set, the ladder runs instead of plan until the file fits. */
  targetBytes?: number;
};

export type CompressMessage =
  | { type: "progress"; value: number }
  | { type: "done"; bytes: ArrayBuffer; fit: boolean }
  | { type: "error"; message: string };

const codec = createWasmCodec();
const post = (message: CompressMessage, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<CompressRequest>) => {
  const { bytes, plan, targetBytes } = event.data;
  const input = new Uint8Array(bytes);
  const onProgress = (value: number) => post({ type: "progress", value });
  try {
    const result = targetBytes
      ? await compressPdfToTarget(input, targetBytes, codec, onProgress)
      : {
          ...(await compressPdfBytes(input, plan, codec, onProgress)),
          fit: true,
        };
    const out = result.bytes.slice().buffer as ArrayBuffer;
    post({ type: "done", bytes: out, fit: result.fit }, [out]);
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : "Compression failed.",
    });
  }
};
