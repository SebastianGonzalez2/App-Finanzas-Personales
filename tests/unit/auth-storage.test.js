import { describe, expect, it, vi } from 'vitest';
import { createAuthStorage, requestPersistentStorage } from '../../src/lib/authStorage.js';

function createMemoryLocalStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    keys: () => [...map.keys()],
  };
}

function createFakeIndexedDB({ failOpen = false, rejectOptions = false } = {}) {
  const data = new Map();
  const durabilities = [];

  const api = {
    data,
    durabilities,
    open() {
      const request = {};
      queueMicrotask(() => {
        if (failOpen) {
          request.error = new Error('IDB unavailable');
          request.onerror?.();
          return;
        }
        const db = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          close() {},
          transaction(_storeName, mode, options) {
            if (options !== undefined && rejectOptions) {
              throw new TypeError('Unsupported transaction options');
            }
            durabilities.push(options?.durability ?? 'default');
            const tx = { oncomplete: null, onerror: null, onabort: null };
            let pending = 0;
            const settle = () => {
              if (pending === 0) queueMicrotask(() => tx.oncomplete?.());
            };
            const store = {
              get(key) {
                pending += 1;
                const req = {};
                queueMicrotask(() => {
                  req.result = data.get(key);
                  req.onsuccess?.();
                  pending -= 1;
                  settle();
                });
                return req;
              },
              put(value, key) {
                pending += 1;
                const req = {};
                queueMicrotask(() => {
                  data.set(key, value);
                  req.onsuccess?.();
                  pending -= 1;
                  settle();
                });
                return req;
              },
              delete(key) {
                pending += 1;
                const req = {};
                queueMicrotask(() => {
                  data.delete(key);
                  req.onsuccess?.();
                  pending -= 1;
                  settle();
                });
                return req;
              },
            };
            tx.objectStore = () => store;
            return tx;
          },
        };
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  return api;
}

describe('authStorage (persistencia transaccional sin duplicación)', () => {
  it('persiste, lee y elimina el token exclusivamente en IndexedDB con durabilidad estricta', async () => {
    const idb = createFakeIndexedDB();
    const ls = createMemoryLocalStorage();
    const storageManager = { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(true) };
    const storage = createAuthStorage({ indexedDB: idb, localStorage: ls, storageManager });

    await storage.setItem('sb-test-auth-token', '{"access_token":"t1"}');
    expect(idb.data.get('sb-test-auth-token')).toBe('{"access_token":"t1"}');
    expect(ls.getItem('sb-test-auth-token')).toBeNull();
    expect(idb.durabilities).toContain('strict');

    expect(await storage.getItem('sb-test-auth-token')).toBe('{"access_token":"t1"}');

    await storage.removeItem('sb-test-auth-token');
    expect(idb.data.has('sb-test-auth-token')).toBe(false);
    expect(await storage.getItem('sb-test-auth-token')).toBeNull();
  });

  it('migra una sola vez desde localStorage hacia IndexedDB y elimina la copia anterior', async () => {
    const idb = createFakeIndexedDB();
    const ls = createMemoryLocalStorage({ 'sb-test-auth-token': '{"access_token":"legacy"}' });
    const storage = createAuthStorage({ indexedDB: idb, localStorage: ls, storageManager: null });

    expect(await storage.getItem('sb-test-auth-token')).toBe('{"access_token":"legacy"}');
    expect(idb.data.get('sb-test-auth-token')).toBe('{"access_token":"legacy"}');
    expect(ls.getItem('sb-test-auth-token')).toBeNull();
  });

  it('prefiere IndexedDB si ya existe un valor y limpia cualquier residuo previo en localStorage', async () => {
    const idb = createFakeIndexedDB();
    idb.data.set('sb-test-auth-token', '{"access_token":"fresh"}');
    const ls = createMemoryLocalStorage({ 'sb-test-auth-token': '{"access_token":"stale"}' });
    const storage = createAuthStorage({ indexedDB: idb, localStorage: ls, storageManager: null });

    expect(await storage.getItem('sb-test-auth-token')).toBe('{"access_token":"fresh"}');
    expect(ls.getItem('sb-test-auth-token')).toBeNull();
  });

  it('tolera navegadores que no aceptan opciones de durabilidad en transaction()', async () => {
    const idb = createFakeIndexedDB({ rejectOptions: true });
    const ls = createMemoryLocalStorage();
    const storage = createAuthStorage({ indexedDB: idb, localStorage: ls, storageManager: null });

    await storage.setItem('sb-test-auth-token', '{"access_token":"compat"}');
    expect(await storage.getItem('sb-test-auth-token')).toBe('{"access_token":"compat"}');
  });

  it('reabre una conexión IndexedDB cerrada por suspensión móvil antes de hacer fallback', async () => {
    const data = new Map([['sb-test-auth-token', '{"access_token":"persisted"}']]);
    let opens = 0;
    let firstConnectionBroken = false;
    const idb = {
      open() {
        const request = {};
        opens += 1;
        const connId = opens;
        queueMicrotask(() => {
          const db = {
            objectStoreNames: { contains: () => true },
            createObjectStore() {},
            close() {},
            transaction() {
              if (connId === 1 && firstConnectionBroken) {
                throw new Error('InvalidStateError: connection is closing');
              }
              const tx = { oncomplete: null, onerror: null, onabort: null };
              let pending = 0;
              const settle = () => {
                if (pending === 0) queueMicrotask(() => tx.oncomplete?.());
              };
              const store = {
                get(key) {
                  pending += 1;
                  const req = {};
                  queueMicrotask(() => {
                    req.result = data.get(key);
                    req.onsuccess?.();
                    pending -= 1;
                    settle();
                  });
                  return req;
                },
                put(value, key) {
                  pending += 1;
                  const req = {};
                  queueMicrotask(() => {
                    data.set(key, value);
                    req.onsuccess?.();
                    pending -= 1;
                    settle();
                  });
                  return req;
                },
              };
              tx.objectStore = () => store;
              return tx;
            },
          };
          request.result = db;
          request.onsuccess?.();
        });
        return request;
      },
    };
    const ls = createMemoryLocalStorage();
    const storage = createAuthStorage({ indexedDB: idb, localStorage: ls, storageManager: null });

    expect(await storage.getItem('sb-test-auth-token')).toBe('{"access_token":"persisted"}');
    expect(opens).toBe(1);

    // Simula suspensión móvil que invalida la conexión en caché sin emitir onclose.
    firstConnectionBroken = true;
    expect(await storage.getItem('sb-test-auth-token')).toBe('{"access_token":"persisted"}');
    expect(opens).toBe(2);
    expect(ls.getItem('sb-test-auth-token')).toBeNull();
  });

  it('hace fallback a localStorage como único almacén si IndexedDB no está disponible', async () => {
    const idb = createFakeIndexedDB({ failOpen: true });
    const ls = createMemoryLocalStorage();
    const storage = createAuthStorage({ indexedDB: idb, localStorage: ls, storageManager: null });

    await storage.setItem('sb-test-auth-token', '{"access_token":"fallback"}');
    expect(ls.getItem('sb-test-auth-token')).toBe('{"access_token":"fallback"}');
    expect(await storage.getItem('sb-test-auth-token')).toBe('{"access_token":"fallback"}');

    await storage.removeItem('sb-test-auth-token');
    expect(ls.getItem('sb-test-auth-token')).toBeNull();
  });

  it('devuelve undefined fuera del navegador cuando no existe ningún almacenamiento', () => {
    expect(createAuthStorage({ indexedDB: undefined, localStorage: null, storageManager: null })).toBeUndefined();
  });

  it('solicita almacenamiento persistente solo cuando aún no está concedido y tolera errores', async () => {
    const already = { persisted: vi.fn().mockResolvedValue(true), persist: vi.fn() };
    expect(await requestPersistentStorage(already)).toBe(true);
    expect(already.persist).not.toHaveBeenCalled();

    const granted = { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(true) };
    expect(await requestPersistentStorage(granted)).toBe(true);
    expect(granted.persist).toHaveBeenCalledOnce();

    const failing = { persisted: vi.fn().mockRejectedValue(new Error('denied')), persist: vi.fn() };
    expect(await requestPersistentStorage(failing)).toBe(false);
    expect(await requestPersistentStorage(null)).toBe(false);
  });
});
