import type { FileItem, ResultItem } from "@/lib/job";
import type { ToolOptions } from "@/lib/tool-options";
import type { ToolId } from "@/lib/tools";
import {
  processAnnotatePdf,
  processEditMetadata,
  processAskPdf,
  processCropPdf,
  processScanToPdf,
  processFlattenPdf,
  processOcrPdf,
  processPngToPdf,
  processComparePdfs,
  processDeleteBlank,
  processExtractImages,
  processExtractText,
  processHeaderFooter,
  processInsertBlank,
  processInvertPdf,
  processNup,
  processPageSize,
  processRedactPdf,
  processReversePages,
  processSignPdf,
  processFillForm,
  processRepairPdf,
  processEditPdf,
  processStripMetadata,
  processWordToPdf,
} from "@/lib/extra-processors";
import {
  processCompressImage,
  processCompressPdf,
  processExtractPages,
  processHeicToJpg,
  processHeicToPdf,
  processImageToPdf,
  processCompressToSize,
  processCropImage,
  processJpgToPng,
  processJpgToWebp,
  processMergePdf,
  processOrganizePdf,
  processPdfToJpg,
  processPdfToPng,
  processPngToJpg,
  processProtectPdf,
  processResizeImage,
  processRotateImage,
  processRotatePdf,
  processSplitPdf,
  processUnlockPdf,
  processWebpToJpg,
} from "@/lib/processors";

/** Runs one tool on some files. The workbench and the workflow builder both call this. */
export async function runTool(
  id: ToolId,
  files: FileItem[],
  onProgress: (ratio: number) => void,
  options: ToolOptions,
): Promise<ResultItem[]> {
  switch (id) {
    case "heic-to-jpg":
      return processHeicToJpg(files, onProgress);
    case "heic-to-pdf":
      return processHeicToPdf(files, onProgress);
    case "compress-image":
      return processCompressImage(files, onProgress);
    case "resize-image":
      return processResizeImage(files, onProgress, options);
    case "webp-to-jpg":
      return processWebpToJpg(files, onProgress);
    case "png-to-jpg":
      return processPngToJpg(files, onProgress);
    case "jpg-to-png":
      return processJpgToPng(files, onProgress);
    case "jpg-to-webp":
      return processJpgToWebp(files, onProgress);
    case "crop-image":
      return processCropImage(files, onProgress, options);
    case "rotate-image":
      return processRotateImage(files, onProgress, options);
    case "compress-to-size":
      return processCompressToSize(files, onProgress, options);
    case "image-to-pdf":
      return processImageToPdf(files, onProgress);
    case "merge-pdf":
      return processMergePdf(files, onProgress);
    case "split-pdf":
      return processSplitPdf(files, onProgress, options);
    case "extract-pages":
      return processExtractPages(files, onProgress, options);
    case "pdf-to-jpg":
      return processPdfToJpg(files, onProgress, options);
    case "compress-pdf":
      return processCompressPdf(files, onProgress, options);
    case "protect-pdf":
      return processProtectPdf(files, onProgress, options);
    case "unlock-pdf":
      return processUnlockPdf(files, onProgress, options);
    case "rotate-pdf":
      return processRotatePdf(files, onProgress, options);
    case "organize-pdf":
      return processOrganizePdf(files, onProgress, options);
    case "sign-pdf":
      return processSignPdf(files, onProgress, options);
    case "fill-pdf-form":
      return processFillForm(files, onProgress, options);
    case "repair-pdf":
      return processRepairPdf(files, onProgress);
    case "edit-pdf":
      return processEditPdf(files, onProgress, options);
    case "crop-pdf":
      return processCropPdf(files, onProgress, options);
    case "redact-pdf":
      return processRedactPdf(files, onProgress, options);
    case "compare-pdfs":
      return processComparePdfs(files, onProgress, options);
    case "extract-text":
      return processExtractText(files, onProgress, options);
    case "extract-images":
      return processExtractImages(files, onProgress, options);
    case "header-footer":
      return processHeaderFooter(files, onProgress, options);
    case "reverse-pages":
      return processReversePages(files, onProgress);
    case "delete-blank":
      return processDeleteBlank(files, onProgress);
    case "insert-blank":
      return processInsertBlank(files, onProgress, options);
    case "invert-pdf":
      return processInvertPdf(files, onProgress, options);
    case "n-up":
      return processNup(files, onProgress, options);
    case "page-size":
      return processPageSize(files, onProgress, options);
    case "pdf-to-png":
      return processPdfToPng(files, onProgress, options);
    case "pdf-to-word":
      return import("@/lib/pdf-to-word/process").then((engine) =>
        engine.processPdfToWord(files, onProgress, options),
      );
    case "pdf-to-pptx":
      return import("@/lib/pdf-to-pptx/process").then((engine) =>
        engine.processPdfToPptx(files, onProgress, options),
      );
    case "pdf-to-excel":
      return import("@/lib/pdf-to-excel/process").then((engine) =>
        engine.processPdfToExcel(files, onProgress, options),
      );
    case "watermark-pdf":
    case "page-numbers":
    case "bates-numbering":
      return processAnnotatePdf(files, onProgress, options);
    case "flatten-pdf":
      return processFlattenPdf(files, onProgress, options);
    case "png-to-pdf":
      return processPngToPdf(files, onProgress);
    case "ocr-pdf":
      return processOcrPdf(files, onProgress, options);
    case "word-to-pdf":
      return processWordToPdf(files, onProgress);
    case "excel-to-pdf":
      return import("@/lib/doc-render/process").then((m) => m.processDocToPdf(files, onProgress, options));
    case "pptx-to-pdf":
      return import("@/lib/doc-render/process").then((m) => m.processDocToPdf(files, onProgress, options));
    case "markdown-to-pdf":
      return import("@/lib/doc-render/process").then((m) => m.processDocToPdf(files, onProgress, options));
    case "csv-to-pdf":
      return import("@/lib/doc-render/process").then((m) => m.processDocToPdf(files, onProgress, options));
    case "html-to-pdf":
      return import("@/lib/doc-render/process").then((m) => m.processDocToPdf(files, onProgress, options));
    case "scan-to-pdf":
      return processScanToPdf(files, onProgress, options);
    case "strip-metadata":
      return processStripMetadata(files, onProgress);
    case "edit-metadata":
      return processEditMetadata(files, onProgress, options);
    case "ask-pdf":
      return processAskPdf(files, onProgress, options);
  }
}
