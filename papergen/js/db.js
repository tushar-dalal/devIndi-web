// IndexedDB wrapper for the question bank and paper history.
//
// Everything lives in the visitor's browser — this is a static site with no
// server (see devIndi/README.md), so there is no shared backend. Data stays
// on whichever device/browser Tushar is using. Use the Question Bank tab's
// Export/Import to move the bank between browsers or keep an off-device
// backup; there is no automatic sync.

const DB_NAME = "papergen";
const DB_VERSION = 1;
const STORE_QUESTIONS = "questions";
const STORE_PAPERS = "papers";

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_QUESTIONS)) {
        const qs = db.createObjectStore(STORE_QUESTIONS, { keyPath: "id" });
        qs.createIndex("subject", "subject", { unique: false });
        qs.createIndex("subtopicKey", "subtopicKey", { unique: false }); // "Subject|Domain|Subtopic"
        qs.createIndex("sourceBatch", "sourceBatch", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PAPERS)) {
        db.createObjectStore(STORE_PAPERS, { keyPath: "id" });
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

const QuestionsDB = {
  async addBatch(questions) {
    const store = await tx(STORE_QUESTIONS, "readwrite");
    for (const q of questions) {
      q.subtopicKey = `${q.subject}|${q.domain}|${q.subtopic}`;
      store.put(q);
    }
    return new Promise((resolve, reject) => {
      store.transaction.oncomplete = () => resolve(questions.length);
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  },

  async all() {
    const store = await tx(STORE_QUESTIONS, "readonly");
    return reqToPromise(store.getAll());
  },

  async count() {
    const store = await tx(STORE_QUESTIONS, "readonly");
    return reqToPromise(store.count());
  },

  async byPool(subject, domain, subtopic, minDifficulty, maxDifficulty) {
    const all = await this.all();
    return all.filter((q) =>
      q.subject === subject &&
      q.domain === domain &&
      q.subtopic === subtopic &&
      q.difficulty >= minDifficulty &&
      q.difficulty <= maxDifficulty
    );
  },

  async incrementUsage(ids) {
    const store = await tx(STORE_QUESTIONS, "readwrite");
    for (const id of ids) {
      const q = await reqToPromise(store.get(id));
      if (q) {
        q.usageCount = (q.usageCount || 0) + 1;
        store.put(q);
      }
    }
    return new Promise((resolve, reject) => {
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  },

  async deleteById(id) {
    const store = await tx(STORE_QUESTIONS, "readwrite");
    store.delete(id);
    return new Promise((resolve, reject) => {
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  },

  async deleteBatch(sourceBatch) {
    const store = await tx(STORE_QUESTIONS, "readwrite");
    const idx = store.index("sourceBatch");
    const keys = await reqToPromise(idx.getAllKeys(IDBKeyRange.only(sourceBatch)));
    for (const k of keys) store.delete(k);
    return new Promise((resolve, reject) => {
      store.transaction.oncomplete = () => resolve(keys.length);
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  },

  async clearAll() {
    const store = await tx(STORE_QUESTIONS, "readwrite");
    store.clear();
    return new Promise((resolve, reject) => {
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  }
};

const PapersDB = {
  async add(paper) {
    const store = await tx(STORE_PAPERS, "readwrite");
    store.put(paper);
    return new Promise((resolve, reject) => {
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  },

  async all() {
    const store = await tx(STORE_PAPERS, "readonly");
    const rows = await reqToPromise(store.getAll());
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
};
