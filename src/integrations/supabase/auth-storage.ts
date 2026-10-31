/**
 * Auth-only storage that does not compete with the POS workspace for the
 * browser's small localStorage quota. IndexedDB is shared by tabs and has a
 * much larger quota; sessionStorage and memory keep sign-in usable when a
 * browser blocks IndexedDB entirely.
 */
const DB_NAME = "retail-pos-auth";
const STORE_NAME = "tokens";
const memory = new Map<string, string | null>();
const revisions = new Map<string, number>();
const STORAGE_TIMEOUT_MS = 2500;
const removedKey = (key: string) => `pos.auth.removed:${key}`;
const advance = (key: string) => {
  const revision = (revisions.get(key) ?? 0) + 1;
  revisions.set(key, revision);
  return revision;
};

function openAuthDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error("Auth storage open timed out")), STORAGE_TIMEOUT_MS);
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, 1); }
    catch (error) { fail(error); return; }
    request.onupgradeneeded = () => {
      if (settled) {
        try { request.transaction?.abort(); } catch { /* already closed */ }
        return;
      }
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => fail(request.error ?? new Error("Auth storage is unavailable"));
    request.onblocked = () => fail(new Error("Auth storage is blocked by another page"));
  });
}

async function idbRead(key: string): Promise<string | null> {
  const db = await openAuthDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      let settled = false;
      const finish = (error: unknown, value: string | null = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => {
        finish(new Error("Auth storage read timed out"));
        try { transaction.abort(); } catch { /* already finished */ }
      }, STORAGE_TIMEOUT_MS);
      let request: IDBRequest;
      try { request = transaction.objectStore(STORE_NAME).get(key); }
      catch (error) { finish(error); return; }
      request.onsuccess = () => finish(null, typeof request.result === "string" ? request.result : null);
      request.onerror = () => finish(request.error ?? new Error("Auth storage read failed"));
      transaction.onabort = () => finish(transaction.error ?? new Error("Auth storage read was cancelled"));
      transaction.onerror = () => finish(transaction.error ?? new Error("Auth storage read failed"));
    });
  } finally {
    db.close();
  }
}

async function idbWrite(key: string, value: string | null, current: () => boolean): Promise<void> {
  const db = await openAuthDb();
  try {
    if (!current()) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => {
        finish(new Error("Auth storage write timed out"));
        try { transaction.abort(); } catch { /* already finished */ }
      }, STORAGE_TIMEOUT_MS);
      try {
        if (value === null) transaction.objectStore(STORE_NAME).delete(key);
        else transaction.objectStore(STORE_NAME).put(value, key);
      } catch (error) { finish(error); return; }
      transaction.oncomplete = () => finish();
      transaction.onerror = () => finish(transaction.error ?? new Error("Auth storage write failed"));
      transaction.onabort = () => finish(transaction.error ?? new Error("Auth storage write was cancelled"));
    });
  } finally {
    db.close();
  }
}

const sessionRead = (key: string) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const removeLegacyLocal = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* a full or disabled localStorage must not break authentication */
  }
};

export const externalAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window === "undefined") return memory.get(key) ?? null;
    if (memory.has(key)) return memory.get(key) ?? null;
    if (sessionRead(removedKey(key)) === "1") return null;
    // A write that could not commit to IndexedDB belongs to this tab. Prefer
    // that existing fallback over an older persistent value after a reload.
    const savedFallback = sessionRead(key);
    if (savedFallback !== null) { memory.set(key, savedFallback); return savedFallback; }
    const revision = revisions.get(key) ?? 0;
    try {
      const value = await idbRead(key);
      if ((revisions.get(key) ?? 0) !== revision) return memory.get(key) ?? null;
      if (value !== null) {
        memory.set(key, value);
        return value;
      }
    } catch {
      if ((revisions.get(key) ?? 0) !== revision) return memory.get(key) ?? null;
      const fallback = sessionRead(key);
      if (fallback !== null) return fallback;
    }

    // One-time migration from releases that stored GoTrue sessions beside
    // catalogue/UI state in localStorage.
    let legacy: string | null = null;
    try {
      legacy = localStorage.getItem(key);
    } catch {
      /* unavailable */
    }
    if (legacy !== null) {
      await this.setItem(key, legacy);
      removeLegacyLocal(key);
      return memory.get(key) ?? null;
    }
    return legacy;
  },

  async setItem(key: string, value: string): Promise<void> {
    const revision = advance(key);
    const current = () => revisions.get(key) === revision;
    memory.set(key, value);
    if (typeof window === "undefined") return;
    try {
      await idbWrite(key, value, current);
      if (!current()) return;
      removeLegacyLocal(key);
      try {
        sessionStorage.removeItem(removedKey(key));
        sessionStorage.removeItem(key);
      } catch {
        /* unavailable */
      }
      return;
    } catch {
      // Private browsing or browser policy can block IndexedDB. A tab-scoped
      // session is safer than failing a valid login with QuotaExceededError.
    }
    if (!current()) return;
    try {
      sessionStorage.setItem(key, value);
      sessionStorage.removeItem(removedKey(key));
    } catch {
      // Memory already holds the session for this page lifetime.
    }
  },

  async removeItem(key: string): Promise<void> {
    const revision = advance(key);
    const current = () => revisions.get(key) === revision;
    // This is an explicit caller removal, never a timeout-driven deletion.
    memory.set(key, null);
    if (typeof window === "undefined") return;
    removeLegacyLocal(key);
    try {
      sessionStorage.setItem(removedKey(key), "1");
      sessionStorage.removeItem(key);
    } catch {
      /* unavailable */
    }
    await idbWrite(key, null, current).catch(() => undefined);
  },
};
