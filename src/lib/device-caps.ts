const FALLBACK_MEMORY_GB = 4;
const LARGE_BYTES = 18 * 1024 * 1024;
const LARGE_PAGES = 40;

export function deviceMemoryGb(): number {
  if (typeof navigator === "undefined") return FALLBACK_MEMORY_GB;
  const reported = (
    navigator as Navigator & { deviceMemory?: number }
  ).deviceMemory;
  return typeof reported === "number" && reported > 0
    ? reported
    : FALLBACK_MEMORY_GB;
}

export function shouldWarnLargeJob(bytes: number, pages: number): boolean {
  const memory = deviceMemoryGb();
  if (memory <= 2) return bytes > 8 * 1024 * 1024 || pages > 12;
  if (memory < 4) return bytes > LARGE_BYTES || pages > 24;
  return bytes > 40 * 1024 * 1024 || pages > LARGE_PAGES;
}
