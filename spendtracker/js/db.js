// IndexedDB wrapper for connections, usage rows, subscriptions and settings.
//
// Same philosophy as papergen/js/db.js: this is a static site with no
// server, so everything lives in this browser. API keys are stored here in
// plaintext IndexedDB — fine for Tushar's own keys while prototyping, wrong
// for anyone else's (see the Build Kickstarter's "Fastest Path" section).
// Use Settings → Export/Import to move data between browsers.

const DB_NAME = "spendtracker";
const DB_VERSION = 1;
const STORE_CONNECTIONS = "connections";
const STORE_USAGE = "usage";
const STORE_SUBS = "subscriptions";
const STORE_SETTINGS = "settings";

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_CONNECTIONS)) {
        db.createObjectStore(STORE_CONNECTIONS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_USAGE)) {
        // id = `${connectionId}|${date}|${model}` so a re-sync overwrites in place.
        const us = db.createObjectStore(STORE_USAGE, { keyPath: "id" });
        us.createIndex("connectionId", "connectionId", { unique: false });
        us.createIndex("member", "member", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SUBS)) {
        db.createObjectStore(STORE_SUBS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return _dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(store, value) {
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve(value);
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

function makeStore(name) {
  return {
    async all() {
      const store = await tx(name, "readonly");
      return reqToPromise(store.getAll());
    },
    async get(id) {
      const store = await tx(name, "readonly");
      return reqToPromise(store.get(id));
    },
    async put(row) {
      const store = await tx(name, "readwrite");
      store.put(row);
      return txDone(store, row);
    },
    async putMany(rows) {
      const store = await tx(name, "readwrite");
      for (const r of rows) store.put(r);
      return txDone(store, rows.length);
    },
    async remove(id) {
      const store = await tx(name, "readwrite");
      store.delete(id);
      return txDone(store);
    },
    async clear() {
      const store = await tx(name, "readwrite");
      store.clear();
      return txDone(store);
    }
  };
}

const ConnectionsDB = makeStore(STORE_CONNECTIONS);
const SubsDB = makeStore(STORE_SUBS);

const UsageDB = {
  ...makeStore(STORE_USAGE),

  async deleteWhere(indexName, value) {
    const store = await tx(STORE_USAGE, "readwrite");
    const keys = await reqToPromise(store.index(indexName).getAllKeys(IDBKeyRange.only(value)));
    for (const k of keys) store.delete(k);
    return txDone(store, keys.length);
  },

  // Replace a connection's rows inside [fromDate, ∞) with a fresh pull, so a
  // model that disappeared from the provider's report doesn't linger.
  async replaceForConnection(connectionId, fromDate, rows) {
    const store = await tx(STORE_USAGE, "readwrite");
    const existing = await reqToPromise(store.index("connectionId").getAll(IDBKeyRange.only(connectionId)));
    for (const r of existing) if (!fromDate || r.date >= fromDate) store.delete(r.id);
    for (const r of rows) store.put(r);
    return txDone(store, rows.length);
  }
};

const SETTINGS_DEFAULTS = {
  currency: "INR",          // display currency: INR | USD
  fxRate: 88,               // ₹ per $1 — edit in Settings; there's no live FX feed
  monthlyBudget: 0,         // in display-agnostic INR; 0 = no budget alert
  renewalLeadDays: 3,       // alert this many days before a renewal
  whatsappOptIn: false,     // explicit opt-in, never default-on (PRD)
  whatsappNumber: "",
  memberName: "Tushar",     // how "my" data is labelled when pooled with teammates
  autoSyncHours: 6
};

const SettingsDB = {
  async getAll() {
    const store = await tx(STORE_SETTINGS, "readonly");
    const rows = await reqToPromise(store.getAll());
    const out = { ...SETTINGS_DEFAULTS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  },
  async set(key, value) {
    const store = await tx(STORE_SETTINGS, "readwrite");
    store.put({ key, value });
    return txDone(store);
  },
  async setMany(obj) {
    const store = await tx(STORE_SETTINGS, "readwrite");
    for (const [key, value] of Object.entries(obj)) store.put({ key, value });
    return txDone(store);
  }
};
