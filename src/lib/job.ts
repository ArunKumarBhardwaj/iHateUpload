export type FileItem = {
  id: string;
  name: string;
  size: number;
  file: File;
};

export type ResultItem = {
  id: string;
  name: string;
  size: number;
  blob: Blob;
  originalSize: number;
  /** Shown in the result panel when the output is text, not a file. */
  previewText?: string;
  /** One line under the result, e.g. when a target size was out of reach. */
  note?: string;
};

export type JobState =
  | { status: "idle" }
  | { status: "ready"; files: FileItem[] }
  | { status: "processing"; files: FileItem[]; progress: number }
  | { status: "done"; files: FileItem[]; results: ResultItem[] }
  | { status: "error"; message: string; files: FileItem[] };

export function createFileItems(fileList: FileList | File[]): FileItem[] {
  return Array.from(fileList).map((file) => ({
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    file,
  }));
}

export function idleJob(): JobState {
  return { status: "idle" };
}
