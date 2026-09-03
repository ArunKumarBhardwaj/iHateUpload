export type CompressWorkerRequest = {
  bytes: ArrayBuffer;
  quality: number;
};

export type CompressWorkerResponse = {
  bytes: ArrayBuffer;
  replaced: number;
};

self.onmessage = async (event: MessageEvent<CompressWorkerRequest>) => {
  const { PDFDocument, PDFName, PDFRawStream } = await import(
    "@cantoo/pdf-lib"
  );
  const doc = await PDFDocument.load(event.data.bytes, {
    ignoreEncryption: true,
  });
  let replaced = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") {
      continue;
    }
    const filter = object.dict.get(PDFName.of("Filter"))?.toString() ?? "";
    if (!filter.includes("DCTDecode")) continue;
    const source = object.getContents();
    if (source.length < 400 || typeof createImageBitmap !== "function") continue;
    try {
      const bitmap = await createImageBitmap(
        new Blob([source.buffer as ArrayBuffer], { type: "image/jpeg" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close();
        continue;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: event.data.quality,
      });
      if (blob.size >= source.length) continue;
      const next = new Uint8Array(await blob.arrayBuffer());
      object.contents = next;
      object.dict.set(PDFName.of("Length"), doc.context.obj(next.length));
      replaced += 1;
    } catch {
      continue;
    }
  }
  const bytes = await doc.save({ useObjectStreams: true });
  const response: CompressWorkerResponse = {
    bytes: bytes.buffer as ArrayBuffer,
    replaced,
  };
  (self as unknown as Worker).postMessage(response, [response.bytes]);
};
