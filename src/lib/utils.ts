import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * iOS Safari does not read the blob at click time. It opens a confirmation
 * sheet and only fetches `href` after the user taps Download. Revoking in the
 * same turn leaves that sheet pointing at a dead URL, and the tap then does
 * nothing — no error, no indicator. Chrome and Firefox snapshot the bytes at
 * click, so the delay is harmless there. FileSaver.js keeps the URL for 40s
 * for the same reason; 60s covers a user who sits on the sheet.
 */
const DOWNLOAD_REVOKE_MS = 60_000;

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, DOWNLOAD_REVOKE_MS);
}
