/**
 * Files shared to the installed app from another app (Android's share sheet,
 * a desktop "Open with"). The service worker catches the share before it
 * leaves the device, keeps the files here in IndexedDB, and the /share page
 * takes them out. Nothing is sent anywhere.
 */

/** Where the share sheet posts; the service worker answers it on the device. */
export const SHARE_ACTION = "/share-target";
/** The form field the manifest names for shared files. */
export const SHARE_FIELD = "files";

const DB = "ihateupload-share";
const STORE = "inbox";
/** Shares nobody opened are dropped after a day. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Entry = { id: string; at: number; files: { name: string; type: string; lastModified: number; data: Blob }[] };

/** The real files in a share: empty slots and text fields are skipped. */
export function sharedFiles(entries: Iterable<FormDataEntryValue>): File[] {
  const out: File[] = [];
  for (const value of entries) if (typeof value !== "string" && value.size > 0) out.push(value as File);
  return out;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

/** Keeps the files and returns the id the /share page asks for. */
export async function putShared(files: File[], now = Date.now()): Promise<string> {
  const db = await open();
  try {
    const old = (await run(db, "readonly", (s) => s.getAll())) as Entry[];
    for (const e of old) if (now - e.at > MAX_AGE_MS) await run(db, "readwrite", (s) => s.delete(e.id));
    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: Entry = {
      id,
      at: now,
      files: files.map((f) => ({ name: f.name, type: f.type, lastModified: f.lastModified, data: f })),
    };
    await run(db, "readwrite", (s) => s.put(entry));
    return id;
  } finally {
    db.close();
  }
}

/** The shared files, removed from the inbox as they are taken. */
export async function takeShared(id: string): Promise<File[]> {
  const db = await open();
  try {
    const entry = (await run(db, "readonly", (s) => s.get(id))) as Entry | undefined;
    if (!entry) return [];
    await run(db, "readwrite", (s) => s.delete(id));
    return entry.files.map((f) => new File([f.data], f.name, { type: f.type, lastModified: f.lastModified }));
  } finally {
    db.close();
  }
}

/** The service worker's answer to a share: keep the files, then open /share on them. */
export async function receiveShare(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const files = sharedFiles(form.getAll(SHARE_FIELD));
    if (!files.length) return Response.redirect("/share?empty=1", 303);
    return Response.redirect(`/share?id=${encodeURIComponent(await putShared(files))}`, 303);
  } catch {
    return Response.redirect("/share?failed=1", 303);
  }
}
