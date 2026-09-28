import type { SyncOp } from "./sync-outbox";

export type BrowserSyncBatch = {
  id: string;
  context: string;
  ops: SyncOp[];
  createdAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
};

const DATABASE = "retail-pos-browser-sync";
const STORE = "pending-batches";
const MAX_BATCH_BYTES = 6 * 1024 * 1024;
let pendingCount = 0;
let hydrated: Promise<void> | null = null;

const available = () => typeof indexedDB !== "undefined";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage could not open."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage stopped."));
  });
}

export async function hydrateBrowserOutbox(): Promise<void> {
  if (hydrated) return hydrated;
  hydrated = (async () => {
    if (!available()) return;
    const db = await openDatabase();
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).count();
      pendingCount = await new Promise<number>((resolve, reject) => {
        request.onsuccess = () => resolve(Number(request.result ?? 0));
        request.onerror = () => reject(request.error ?? new Error("Offline changes could not be read."));
      });
    } finally {
      db.close();
    }
  })().catch(() => undefined);
  return hydrated;
}

export function wakeBrowserOutbox(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("pos:browser-outbox-changed"));
}

export async function persistBrowserBatch(
  context: string,
  ops: SyncOp[],
  { wake = true }: { wake?: boolean } = {},
): Promise<string | null> {
  if (!available() || !ops.length) return null;
  const batch: BrowserSyncBatch = {
    id: crypto.randomUUID(), context: context.slice(0, 160), ops,
    createdAt: new Date().toISOString(), attempts: 0,
  };
  if (new TextEncoder().encode(JSON.stringify(batch)).byteLength > MAX_BATCH_BYTES)
    throw new Error("This offline operation is too large to store safely.");
  await hydrateBrowserOutbox();
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(batch);
    await transactionDone(transaction);
    pendingCount += 1;
    if (wake) wakeBrowserOutbox();
    return batch.id;
  } finally {
    db.close();
  }
}

export async function pendingBrowserBatches(limit = 25): Promise<BrowserSyncBatch[]> {
  await hydrateBrowserOutbox();
  if (!available()) return [];
  const now = Date.now();
  const take = Math.max(1, Math.min(limit, 100));
  const db = await openDatabase();
  try {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).index("createdAt").openCursor();
    return await new Promise<BrowserSyncBatch[]>((resolve, reject) => {
      const rows: BrowserSyncBatch[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= take) return resolve(rows);
        const batch = cursor.value as BrowserSyncBatch;
        const delay = batch.lastAttemptAt
          ? Math.min(60_000, 1_000 * 2 ** Math.min(batch.attempts, 6))
          : 0;
        if (!batch.lastAttemptAt || Date.parse(batch.lastAttemptAt) + delay <= now) rows.push(batch);
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error("Offline changes could not be read."));
    });
  } finally {
    db.close();
  }
}

export const browserPendingCount = () => pendingCount;

export async function acknowledgeBrowserBatch(id: string): Promise<void> {
  if (!available()) return;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    await transactionDone(transaction);
    pendingCount = Math.max(0, pendingCount - 1);
  } finally { db.close(); }
}

export async function failBrowserBatch(id: string, error: unknown): Promise<void> {
  if (!available()) return;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result as BrowserSyncBatch | undefined;
      if (!current) return;
      store.put({
        ...current,
        attempts: current.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: String((error as { message?: unknown })?.message ?? error).slice(0, 500),
      } satisfies BrowserSyncBatch);
    };
    await transactionDone(transaction);
  } finally { db.close(); }
}
