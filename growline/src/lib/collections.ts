import { createHash } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase-admin";

/**
 * Collection names and document-id construction.
 *
 * ## Why the ids look like this
 *
 * Firestore has no unique constraints. The Prisma schema had SIX, and every one of
 * them protects a correctness property somebody already reasoned through:
 *
 *   unique(coachId, clientId)      D6  — a retried offline sync must not create
 *                                        the same person twice
 *   unique(prospectId, inputsHash) D20 — two concurrent renders must not mint two
 *                                        live 90-day bearer tokens to one person's
 *                                        health data
 *   unique(userId, logDate)        D26 — one log per coach per day *in their own
 *                                        timezone*
 *   unique(coachId, month)             — one target per coach per month
 *   unique(pushSubscriptions.endpoint) — one row per device, or it is notified twice
 *   unique(users.referralCode)     D41 — two coaches sharing a code means one of
 *                                        them silently receives the other's QR
 *                                        captures and downlines
 *
 * The only mechanism Firestore offers that is equally strong is the document id
 * itself: a `set()` on a deterministic id is an upsert, and two racing writers
 * converge on one document instead of creating two. So each constraint becomes an
 * id. Do not replace these with auto-ids and a query — the query is not atomic and
 * the constraint quietly stops existing.
 *
 * `referralCode` is the one that cannot be the owning document's id, because the
 * user document is already keyed by the Auth uid (D34). It gets a RESERVATION
 * document instead — `referralCodes/{CODE}` — created in the same transaction as the
 * user, so the create fails if the code is taken. See D41.
 *
 * Two more from the Prisma schema resolve without work here:
 *   users.phone      — Firebase Auth's Phone provider allows one account per number,
 *                      and the user doc id IS that account's uid, so a duplicate
 *                      would need two Auth accounts on one number. Auth prevents it.
 *   reports.token    — 26 chars over a 33-char alphabet (~131 bits) from a CSPRNG.
 *                      A reservation collection here would cost a write on every
 *                      report to defend against a collision far rarer than silent
 *                      disk corruption. Deliberately not defended; see D41.
 */

export const COLLECTIONS = {
  users: "users",
  prospects: "prospects",
  reports: "reports",
  dailyLogs: "dailyLogs",
  targets: "targets",
  proofs: "proofs",
  /**
   * Reservation documents for referral codes (D41). The document ID *is* the code,
   * which is what makes claiming one atomic. Holds only the owning uid — resolving
   * `/join/<code>` is then two document reads and no query.
   */
  referralCodes: "referralCodes",
  /**
   * Web Push subscriptions (D22). Carried over as-is so Prisma can go; v2.1b
   * replaces the whole mechanism with FCM and retires this collection.
   */
  pushSubscriptions: "pushSubscriptions",
  // Not yet written to. Named here so v2.4–v2.6 do not invent variants.
  threads: "threads",
  threadReceipts: "threadReceipts",
  subscriptions: "subscriptions",
  portfolios: "portfolios",
  fcmTokens: "fcmTokens",
} as const;

const SEPARATOR = "__";

/**
 * Firestore rejects ids containing "/", the ids "." and "..", ids over 1500 bytes,
 * and anything matching `__.*__`. `clientId` arrives from the browser (D6), so it
 * is attacker-influenced and gets checked rather than trusted.
 */
function assertValidDocId(id: string, what: string): string {
  if (!id || id.includes("/") || id === "." || id === "..") {
    throw new Error(`Invalid ${what} document id: ${JSON.stringify(id)}`);
  }
  if (/^__.*__$/.test(id)) {
    throw new Error(`Reserved ${what} document id: ${JSON.stringify(id)}`);
  }
  if (Buffer.byteLength(id, "utf8") > 1500) {
    throw new Error(`${what} document id exceeds 1500 bytes`);
  }
  return id;
}

/** D6. Null clientId (QR self-fills, created online in one shot) gets an auto-id. */
export function prospectDocId(coachId: string, clientId: string | null): string | null {
  if (!clientId) return null;
  return assertValidDocId(`${coachId}${SEPARATOR}${clientId}`, "prospect");
}

/** D20. Identity of a report is the inputs that produced it, never a fresh id. */
export function reportDocId(prospectId: string, inputsHash: string): string {
  return assertValidDocId(`${prospectId}${SEPARATOR}${inputsHash}`, "report");
}

/** D26. `dayKey` is the coach's local day ("YYYY-MM-DD"), not a UTC day. */
export function dailyLogDocId(userId: string, dayKey: string): string {
  return assertValidDocId(`${userId}${SEPARATOR}${dayKey}`, "dailyLog");
}

/** month is "YYYY-MM". */
export function targetDocId(coachId: string, month: string): string {
  return assertValidDocId(`${coachId}${SEPARATOR}${month}`, "target");
}

/**
 * `unique(endpoint)` from the push_subscriptions table, as a document id.
 *
 * The endpoint is a push-service URL, so it cannot be an id directly — it
 * contains "/" and can exceed the 1500-byte limit. Hashing keeps the uniqueness
 * guarantee the constraint existed for: a device that re-subscribes replaces its
 * own row instead of accumulating duplicates and sending the same notification
 * twice.
 */
export function pushSubscriptionDocId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

/** D41. The code itself is the reservation document's id, so claiming it is atomic. */
export function referralCodeDocId(code: string): string {
  return assertValidDocId(code.trim().toUpperCase(), "referralCode");
}

/**
 * One receipt per person per thread, as a document id (F8).
 *
 * Same reasoning as the constraints above: a coach who taps acknowledge twice — or
 * whose tap is retried on a flaky connection — must not create two receipts, because
 * the ack COUNT is what the sender is watching. An auto-id plus a "have they already?"
 * query is not atomic, and the number the sender trusts would drift upward.
 */
export function threadReceiptDocId(threadId: string, userId: string): string {
  return assertValidDocId(`${threadId}${SEPARATOR}${userId}`, "threadReceipt");
}

/**
 * Ordered ancestors, nearest first: `uplinePath[0]` is the direct upline.
 *
 * This is what replaces `isInDownline()`, which walked the tree with one query per
 * hop for up to 100 hops. It also lets an upline count their whole line's activity
 * with a single `array-contains` instead of a `groupBy` Firestore cannot express
 * (see PLAN_V2.1a.md §5).
 *
 * Cycle-guarded: a corrupt `uplineId` chain must not hang the migration.
 */
export function buildUplinePath(
  userId: string,
  uplineById: Map<string, string | null>
): string[] {
  const path: string[] = [];
  const seen = new Set<string>([userId]);
  let current = uplineById.get(userId) ?? null;
  while (current && !seen.has(current)) {
    path.push(current);
    seen.add(current);
    current = uplineById.get(current) ?? null;
  }
  return path;
}

export type UserDoc = {
  phone: string;
  name: string;
  photoUrl: string | null;
  city: string | null;
  referralCode: string;
  levelName: string | null;
  uplineId: string | null;
  /** Nearest ancestor first. See buildUplinePath. */
  uplinePath: string[];
  /** Firestore cannot count children; maintained on signup. */
  directDownlineCount: number;
  /** The privacy toggle. Default false is a hard requirement (v1 §5.4). */
  shareProspects: boolean;
  plan: string;
  trialEndsAt: Timestamp | null;
  followupPushOn: string | null;
  createdAt: Timestamp;
};

export type ProspectDoc = {
  coachId: string;
  /** Denormalised from the coach so an upline query needs no join. */
  coachUplinePath: string[];
  clientId: string | null;
  name: string;
  phone: string;
  age: number | null;
  gender: string | null;
  heightCm: number | null;
  weightKg: number | null;
  stage: string;
  nextFollowupAt: Timestamp | null;
  source: string;
  notes: string | null;
  /**
   * When this person agreed to their details being kept (v2 §5.2, RULES P6).
   *
   * A timestamp rather than a boolean, because "did they consent" and "when" are
   * different questions and only the second one is answerable to a regulator. Under
   * DPDP the burden is on us to show consent was obtained, and `true` with no date
   * cannot be corroborated against anything.
   *
   * Null means NOT RECORDED, which is not the same as refused. Every prospect captured
   * before this field existed has null, and the migration deliberately leaves them that
   * way rather than backfilling a consent nobody actually gave.
   */
  consentAt: Timestamp | null;
  createdAt: Timestamp;
};

export type ReportDoc = {
  prospectId: string;
  /** Denormalised: the public report route resolves by token with no prospect read. */
  coachId: string;
  token: string;
  metricsJson: string;
  inputsHash: string;
  sentAt: Timestamp | null;
  createdAt: Timestamp;
};

export type DailyLogDoc = {
  userId: string;
  /** Local day. The doc id carries this too; the field exists so it is queryable. */
  dayKey: string;
  logDate: Timestamp;
  uplinePath: string[];
  servings: number;
  memberships: number;
  sessions: number;
  invites: number;
  followupsDone: number;
  note: string | null;
  createdAt: Timestamp;
};

export type TargetDoc = {
  coachId: string;
  setById: string;
  uplinePath: string[];
  month: string;
  targetPoints: number;
  progressPoints: number;
  status: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type ProofDoc = {
  targetId: string;
  coachId: string;
  requestedById: string;
  requestNote: string | null;
  status: string;
  mediaUrl: string | null;
  submitNote: string | null;
  comment: string | null;
  createdAt: Timestamp;
  submittedAt: Timestamp | null;
  reviewedAt: Timestamp | null;
};

/**
 * A broadcast from one coach to their line (F8). One-way by design — v1 §5.5 / RULES
 * S3 forbid group chat, so there is no reply field and no thread of replies to hang
 * off this. Acknowledgement is the only response, and it is a count.
 *
 * ## How a downline finds threads addressed to them
 *
 * There is no audience array. A thread is addressed by WHO SENT IT: a coach receives
 * it if the sender is one of their own ancestors, which they already know from their
 * `uplinePath` (D36). So the inbox query is `senderId in <my uplinePath>` — no
 * fan-out at send time, no array that grows with the size of a line, and a thread
 * costs exactly one document however many thousand people it reaches.
 *
 * The alternative — writing the recipient list onto the thread — breaks on the two
 * things that actually happen: a line of a few thousand exceeds what belongs in one
 * document, and anyone who joins after the send would never see it.
 *
 * `scope` then narrows it: "all" reaches every descendant, "direct" only the sender's
 * direct downlines. Both are resolved against the reader, not stored per recipient.
 */
export type ThreadDoc = {
  senderId: string;
  /** Denormalised so the inbox needs no user read per row. */
  senderName: string;
  senderPhotoUrl: string | null;
  /** "direct" = my direct downlines only. "all" = my entire line, any depth. */
  scope: string;
  body: string;
  /**
   * An optional link — a video, a voice note, a poster hosted anywhere. NOT an
   * upload: Storage is deny-all until something legitimately uploads (D49), and F8's
   * "video link" is satisfied by a URL. Revisit when Storage is switched on.
   */
  linkUrl: string | null;
  /**
   * Set only on a re-broadcast, so the attribution line ("via Asha") survives being
   * passed down a chain. Carries the ORIGINAL author, not the previous hop — the
   * person a coach is being asked to trust is whoever wrote it.
   */
  originalSenderId: string | null;
  originalSenderName: string | null;
  /** Maintained by increment alongside the receipt write; Firestore cannot count. */
  seenCount: number;
  ackCount: number;
  createdAt: Timestamp;
};

/** One per (thread, reader). Id is deterministic — see threadReceiptDocId. */
export type ThreadReceiptDoc = {
  threadId: string;
  userId: string;
  /** Denormalised so a sender's receipt list needs no user read per row. */
  userName: string;
  seenAt: Timestamp | null;
  ackedAt: Timestamp | null;
};

export const users = () => db.collection(COLLECTIONS.users);
export const prospects = () => db.collection(COLLECTIONS.prospects);
export const reports = () => db.collection(COLLECTIONS.reports);
export const dailyLogs = () => db.collection(COLLECTIONS.dailyLogs);
export const targets = () => db.collection(COLLECTIONS.targets);
export const proofs = () => db.collection(COLLECTIONS.proofs);
export const referralCodes = () => db.collection(COLLECTIONS.referralCodes);
export const threads = () => db.collection(COLLECTIONS.threads);
export const threadReceipts = () => db.collection(COLLECTIONS.threadReceipts);
