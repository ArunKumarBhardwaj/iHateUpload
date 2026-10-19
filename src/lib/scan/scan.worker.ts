/// <reference lib="webworker" />
import { forget, opDetect, opFinal, opPreview, type PreviewSettings } from "./runtime";

export type ScanRequest =
  | { id: number; op: "detect"; key: string; file: Blob }
  | { id: number; op: "preview"; key: string; file: Blob; settings: PreviewSettings; side: number }
  | { id: number; op: "final"; key: string; file: Blob; settings: PreviewSettings; ocr: boolean }
  | { id: number; op: "forget"; key: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const m = event.data;
  try {
    if (m.op === "detect") {
      scope.postMessage({ id: m.id, ok: true, value: await opDetect(m.key, m.file) });
    } else if (m.op === "preview") {
      const img = await opPreview(m.key, m.file, m.settings, m.side);
      scope.postMessage({ id: m.id, ok: true, value: img }, [img.data.buffer]);
    } else if (m.op === "final") {
      const page = await opFinal(m.key, m.file, m.settings, m.ocr);
      const transfer = [page.bytes.buffer, ...(page.ocr ? [page.ocr.bytes.buffer] : [])];
      scope.postMessage({ id: m.id, ok: true, value: page }, transfer as Transferable[]);
    } else {
      forget(m.key);
      scope.postMessage({ id: m.id, ok: true, value: null });
    }
  } catch (error) {
    scope.postMessage({
      id: m.id,
      ok: false,
      message: error instanceof Error ? error.message : "The page could not be read.",
    });
  }
};
