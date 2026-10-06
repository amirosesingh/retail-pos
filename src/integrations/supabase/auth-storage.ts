/**
 * Auth-only storage that does not compete with the POS workspace for the
 * browser's small localStorage quota. IndexedDB is shared by tabs and has a
 * much larger quota; sessionStorage and memory keep sign-in usable when a
 * browser blocks IndexedDB entirely.
 */
const DB_NAME = "retail-pos-auth";
const STORE_NAME = "tokens";
const memory = new Map<string, string>();

function openAuthDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Auth storage is unavailable"));
  });
}

async function idbRead(key: string): Promise<string | null> {
  const db = await openAuthDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () =>
        resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error("Auth storage read failed"));
    });
  } finally {
    db.close();
  }
}

async function idbWrite(key: string, value: string | null): Promise<void> {
  const db = await openAuthDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      if (value === null) transaction.objectStore(STORE_NAME).delete(key);
      else transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Auth storage write failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Auth storage write was cancelled"));
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
    try {
      const value = await idbRead(key);
      if (value !== null) {
        memory.set(key, value);
        return value;
      }
    } catch {
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
    }
    return legacy;
  },

  async setItem(key: string, value: string): Promise<void> {
    memory.set(key, value);
    if (typeof window === "undefined") return;
    try {
      await idbWrite(key, value);
      removeLegacyLocal(key);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* unavailable */
      }
      return;
    } catch {
      // Private browsing or browser policy can block IndexedDB. A tab-scoped
      // session is safer than failing a valid login with QuotaExceededError.
    }
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Memory already holds the session for this page lifetime.
    }
  },

  async removeItem(key: string): Promise<void> {
    memory.delete(key);
    if (typeof window === "undefined") return;
    await idbWrite(key, null).catch(() => undefined);
    removeLegacyLocal(key);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* unavailable */
    }
  },
};
