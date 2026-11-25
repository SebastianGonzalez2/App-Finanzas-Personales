const DB_NAME = 'cifra-auth';
const STORE_NAME = 'kv';
const DB_VERSION = 1;

function safeLocalStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = 'cifra:storage-probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function readFallback(storage, key) {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeFallback(storage, key, value) {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage quota or privacy restrictions.
  }
}

function removeFallback(storage, key) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage restrictions during cleanup.
  }
}

function openTransaction(db, mode) {
  if (mode === 'readwrite') {
    try {
      return db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
    } catch {
      return db.transaction(STORE_NAME, 'readwrite');
    }
  }
  return db.transaction(STORE_NAME, mode);
}

export async function requestPersistentStorage(storageManager = globalThis.navigator?.storage) {
  try {
    if (!storageManager?.persist) return false;
    if (await storageManager.persisted?.()) return true;
    return Boolean(await storageManager.persist());
  } catch {
    return false;
  }
}

// Single-store transactional IndexedDB adapter for Supabase Auth.
// On Android PWAs, localStorage writes can be lazily flushed and lost on abrupt
// process termination from Recents. IndexedDB commits each write transactionally
// before resolving. Any legacy session found in localStorage is migrated once
// and removed from localStorage so tokens are never duplicated across stores.
export function createAuthStorage({
  indexedDB = globalThis.indexedDB,
  localStorage = safeLocalStorage(),
  storageManager = globalThis.navigator?.storage,
} = {}) {
  if (!indexedDB && !localStorage) return undefined;

  let dbPromise = null;
  let persistenceRequested = false;

  function ensurePersistence() {
    if (persistenceRequested) return;
    persistenceRequested = true;
    void requestPersistentStorage(storageManager);
  }

  function openDatabase() {
    if (!indexedDB) return Promise.resolve(null);
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        db.onclose = () => {
          dbPromise = null;
        };
        db.onerror = () => {
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB open failed'));
      };

      request.onblocked = () => {
        reject(new Error('IndexedDB open blocked'));
      };
    }).catch(() => {
      dbPromise = null;
      return null;
    });

    return dbPromise;
  }

  function runTransaction(db, mode, execute) {
    return new Promise((resolve, reject) => {
      const tx = openTransaction(db, mode);
      const store = tx.objectStore(STORE_NAME);
      let output;
      tx.oncomplete = () => resolve(output);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      execute(store, (value) => { output = value; });
    });
  }

  // Mobile browsers (especially WebKit/iOS Safari and frozen Android tabs) can close a cached
  // IDB connection while suspended without firing onclose. Reopen once before falling back.
  async function withDatabase(operation) {
    const reused = dbPromise !== null;
    let db = await openDatabase();
    if (!db) return { ok: false, value: null };

    try {
      return { ok: true, value: await operation(db) };
    } catch {
      dbPromise = null;
      if (!reused) return { ok: false, value: null };
      db = await openDatabase();
      if (!db) return { ok: false, value: null };
      try {
        return { ok: true, value: await operation(db) };
      } catch {
        dbPromise = null;
        return { ok: false, value: null };
      }
    }
  }

  return {
    async getItem(key) {
      const legacy = readFallback(localStorage, key);
      const result = await withDatabase(async (db) => {
        const stored = await runTransaction(db, 'readonly', (store, done) => {
          const request = store.get(key);
          request.onsuccess = () => done(typeof request.result === 'string' ? request.result : null);
        });
        if (stored !== null) {
          if (legacy !== null) removeFallback(localStorage, key);
          return stored;
        }
        if (legacy !== null) {
          const migrated = await runTransaction(db, 'readwrite', (store, done) => {
            const existing = store.get(key);
            existing.onsuccess = () => {
              if (typeof existing.result === 'string') {
                done(existing.result);
                return;
              }
              store.put(legacy, key);
              done(legacy);
            };
          });
          removeFallback(localStorage, key);
          ensurePersistence();
          return migrated;
        }
        return null;
      });
      return result.ok ? result.value : legacy;
    },

    async setItem(key, value) {
      const result = await withDatabase(async (db) => {
        await runTransaction(db, 'readwrite', (store) => {
          store.put(value, key);
        });
        removeFallback(localStorage, key);
        ensurePersistence();
      });
      if (!result.ok) writeFallback(localStorage, key, value);
    },

    async removeItem(key) {
      await withDatabase(async (db) => {
        await runTransaction(db, 'readwrite', (store) => {
          store.delete(key);
        });
      });
      removeFallback(localStorage, key);
    },
  };
}
