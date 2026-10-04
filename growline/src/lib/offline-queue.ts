/**
 * Offline queue (Section 4.3), which covers BOTH prospect capture and daily logs —
 * "Prospect capture and daily logs must work offline and sync when connectivity
 * returns". Walk & talk happens where the network is weak, and the evening log gets
 * written wherever the coach happens to be.
 *
 * Prospects are keyed by a clientId so a retried POST can never duplicate a person.
 * Logs are keyed by their day, so re-saving the same evening overwrites rather than
 * queueing twice — last write for a day wins, which is what a coach correcting a
 * number expects.
 */

const DB_NAME = "growline";
const DB_VERSION = 2;
const STORE = "pending_prospects";
const STORE_LOGS = "pending_logs";

export type PendingProspect = {
  clientId: string;
  name: string;
  phone: string;
  age: number | null;
  gender: string | null;
  heightCm: number | null;
  weightKg: number | null;
  /**
   * The coach's consent tick, carried through the queue (RULES P6 + S5).
   *
   * It has to be stored with the capture rather than re-asked on sync: the person was
   * standing there when the coach ticked it, and by the time the queue drains — hours
   * later, on a different screen — nobody can confirm anything. A queued capture that
   * lost its consent would be refused by the API on replay and silently stuck in the
   * queue forever, which is the failure mode this field prevents.
   */
  consentGiven: boolean;
  savedAt: number;
};

export type PendingLog = {
  /** "YYYY-MM-DD" in the coach's timezone — one queued log per day. */
  dayKey: string;
  servings: number;
  memberships: number;
  sessions: number;
  invites: number;
  followupsDone: number;
  note: string | null;
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Guarded individually so upgrading a v1 database (which already has the
      // prospects store) adds only what is missing and loses nothing queued.
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "clientId" });
      }
      if (!db.objectStoreNames.contains(STORE_LOGS)) {
        db.createObjectStore(STORE_LOGS, { keyPath: "dayKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const isQueueSupported = () =>
  typeof indexedDB !== "undefined" && typeof window !== "undefined";

export async function queueProspect(item: PendingProspect): Promise<void> {
  await tx(STORE, "readwrite", (s) => s.put(item) as IDBRequest<IDBValidKey>);
}

export async function listQueued(): Promise<PendingProspect[]> {
  const rows = await tx<PendingProspect[]>(STORE, "readonly", (s) => s.getAll());
  return rows.sort((a, b) => b.savedAt - a.savedAt);
}

async function removeQueued(clientId: string): Promise<void> {
  await tx(STORE, "readwrite", (s) => s.delete(clientId) as unknown as IDBRequest<undefined>);
}

export async function queueDailyLog(item: PendingLog): Promise<void> {
  await tx(STORE_LOGS, "readwrite", (s) => s.put(item) as IDBRequest<IDBValidKey>);
}

export async function listQueuedLogs(): Promise<PendingLog[]> {
  const rows = await tx<PendingLog[]>(STORE_LOGS, "readonly", (s) => s.getAll());
  return rows.sort((a, b) => b.savedAt - a.savedAt);
}

async function removeQueuedLog(key: string): Promise<void> {
  await tx(
    STORE_LOGS,
    "readwrite",
    (s) => s.delete(key) as unknown as IDBRequest<undefined>
  );
}

export type SyncResult = { synced: number; remaining: number };

/**
 * Pushes queued captures to the server. A 4xx other than 429 means the row will
 * never be accepted (bad data) — drop it rather than retry forever. Network
 * failures and 5xx/429 keep the item queued for the next attempt.
 */
export async function syncQueue(): Promise<SyncResult> {
  if (!isQueueSupported()) return { synced: 0, remaining: 0 };
  let synced = 0;

  for (const item of await listQueued()) {
    const outcome = await push("/api/prospects", "POST", item);
    if (outcome === "done" || outcome === "drop") {
      await removeQueued(item.clientId);
      if (outcome === "done") synced++;
      continue;
    }
    break;
  }

  // Logs sync even if prospects stopped early: a queued evening log is small and
  // independent, and a stuck prospect should not hold the coach's streak hostage.
  for (const log of await listQueuedLogs()) {
    const { dayKey: key, savedAt, ...counts } = log;
    void savedAt;
    const outcome = await push("/api/logs", "PUT", { dayKey: key, ...counts });
    if (outcome === "done" || outcome === "drop") {
      await removeQueuedLog(key);
      if (outcome === "done") synced++;
      continue;
    }
    break;
  }

  const remaining =
    (await listQueued()).length + (await listQueuedLogs()).length;
  return { synced, remaining };
}

type PushOutcome = "done" | "drop" | "retry";

/**
 * A 4xx other than 429 means the row will never be accepted (bad data, or a day now
 * too old to backfill) — drop it rather than retry forever. Network failures, 5xx and
 * 429 keep the item queued. A 401 keeps it too: the coach is signed out, not wrong.
 */
async function push(
  url: string,
  method: "POST" | "PUT",
  body: unknown
): Promise<PushOutcome> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return "done";
    if (res.status === 401) return "retry";
    if (res.status >= 400 && res.status < 500 && res.status !== 429) return "drop";
    return "retry";
  } catch {
    return "retry";
  }
}

export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
