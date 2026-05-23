import * as SQLite from "expo-sqlite";

const STORE_KEY = "edumos.offline.store.v1";

const memoryStore = {
  users: {},
  classrooms: {},
  studentClassrooms: {},
  participants: {},
  sections: {},
  resources: {},
  quizzes: {},
  gradeColumns: {},
  grades: {},
  pendingWrites: [],
  hostedPackages: {},
  connectedPackages: {}
};

function canUseLocalStorage() {
  return typeof globalThis !== "undefined" && !!globalThis.localStorage;
}

let sqliteDb = null;

function getSQLiteDb() {
  if (canUseLocalStorage()) return null;
  if (sqliteDb) return sqliteDb;
  try {
    sqliteDb = SQLite.openDatabaseSync("edumos-offline.db");
    sqliteDb.execSync("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);");
    return sqliteDb;
  } catch (_error) {
    return null;
  }
}

function readStore() {
  if (!canUseLocalStorage()) {
    const db = getSQLiteDb();
    if (!db) return { ...memoryStore };
    try {
      const row = db.getFirstSync("SELECT value FROM kv WHERE key = ?", STORE_KEY);
      return row?.value ? { ...memoryStore, ...JSON.parse(row.value) } : { ...memoryStore };
    } catch (_error) {
      return { ...memoryStore };
    }
  }
  try {
    const raw = globalThis.localStorage.getItem(STORE_KEY);
    return raw ? { ...memoryStore, ...JSON.parse(raw) } : { ...memoryStore };
  } catch (_error) {
    return { ...memoryStore };
  }
}

function writeStore(store) {
  Object.assign(memoryStore, store);
  if (!canUseLocalStorage()) {
    const db = getSQLiteDb();
    if (!db) return;
    try {
      db.runSync("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", STORE_KEY, JSON.stringify(store));
    } catch (_error) {}
    return;
  }
  try {
    globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (_error) {
    // Keep the in-memory copy for this session if storage quota is full.
  }
}

export function getOfflineStore() {
  return readStore();
}

export function setOfflineStore(updater) {
  const current = readStore();
  const next = typeof updater === "function" ? updater(current) : updater;
  writeStore({ ...memoryStore, ...next });
  return next;
}

export function getCollection(name) {
  return readStore()[name] || {};
}

export function setCollectionItem(name, key, value) {
  setOfflineStore(store => ({
    ...store,
    [name]: {
      ...(store[name] || {}),
      [key]: value
    }
  }));
}

export function deleteCollectionItem(name, key) {
  setOfflineStore(store => {
    const nextCollection = { ...(store[name] || {}) };
    delete nextCollection[key];
    return { ...store, [name]: nextCollection };
  });
}

export function queueWrite(write) {
  setOfflineStore(store => ({
    ...store,
    pendingWrites: [
      ...(store.pendingWrites || []).filter(item => !write.localId || item.localId !== write.localId),
      {
        ...write,
        queuedAt: Date.now(),
        localId: write.localId || `local_${Date.now()}_${Math.random().toString(36).slice(2)}`
      }
    ]
  }));
}

export function replacePendingWrites(pendingWrites) {
  setOfflineStore(store => ({ ...store, pendingWrites }));
}

export function isOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function listenForOnline(callback) {
  if (typeof globalThis === "undefined" || !globalThis.addEventListener) return () => {};
  globalThis.addEventListener("online", callback);
  return () => globalThis.removeEventListener("online", callback);
}

export function getPendingWriteCount() {
  return (readStore().pendingWrites || []).length;
}
