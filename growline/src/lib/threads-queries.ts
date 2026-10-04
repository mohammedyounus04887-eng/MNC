import {
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import {
  threadReceiptDocId,
  threadReceipts,
  threads,
  users,
} from "./collections";
import { PLATFORM_SCOPE, canRead, type ThreadScope } from "./threads";
import type { AppUser } from "./users";

/**
 * Database side of threads (F8), and the single place the read rules live for the app.
 *
 * Every read re-derives who is allowed to see a thread from the reader's own
 * `uplinePath` rather than from anything the client sent. `firestore.rules` states
 * the same rule independently — the app's copy is for correctness of what we render,
 * the rules' copy is what stops a hand-written query, and neither substitutes for the
 * other.
 *
 * ## Why the inbox is a query on the SENDER
 *
 * A thread stores no recipient list. A coach receives it if the sender is one of
 * their ancestors, which the reader already knows (D36), so the inbox is
 * `senderId in <my uplinePath>`. One document per broadcast however large the line,
 * nothing to fan out at send time, and a coach who joins tomorrow sees what their
 * upline sent last week. See ThreadDoc in collections.ts for the alternative and why
 * it fails.
 *
 * ## Counters
 *
 * `seenCount` and `ackCount` live on the thread and move by `increment` inside the
 * same transaction as the receipt. Firestore cannot count, and the sender is watching
 * these numbers live — a counter that drifts is worse than no counter, which is why
 * the receipt id is deterministic (threadReceiptDocId) and a repeated tap is a no-op
 * rather than a second increment.
 */

/** Firestore's `in` takes at most 30 values. */
const IN_LIMIT = 30;
const INBOX_PAGE = 30;
const SENT_PAGE = 30;

/** Coach scopes plus the admin-only platform scope. */
export type AppThreadScope = ThreadScope | typeof PLATFORM_SCOPE;

export type AppThread = {
  id: string;
  senderId: string;
  senderName: string;
  senderPhotoUrl: string | null;
  scope: AppThreadScope;
  body: string;
  linkUrl: string | null;
  originalSenderId: string | null;
  originalSenderName: string | null;
  seenCount: number;
  ackCount: number;
  createdAt: Date;
};

/** A thread as it appears in one reader's inbox: the thread plus their own receipt. */
export type InboxThread = AppThread & { acked: boolean; seen: boolean };

const toDate = (v: unknown): Date =>
  v instanceof Timestamp ? v.toDate() : new Date(0);

function toAppThread(snap: DocumentSnapshot): AppThread | null {
  const d = snap.data();
  if (!d) return null;
  return {
    id: snap.id,
    senderId: d.senderId,
    senderName: d.senderName ?? "",
    senderPhotoUrl: d.senderPhotoUrl ?? null,
    /**
     * Anything unrecognised is treated as the NARROWEST scope. A corrupt or
     * future-written value must not widen an audience.
     *
     * `platform` has to be listed explicitly: without it this normaliser would quietly
     * rewrite every Real V announcement to "direct", and `canRead` would then hide it
     * from everyone whose direct upline was not the admin — i.e. from almost everybody.
     */
    scope:
      d.scope === "all" || d.scope === PLATFORM_SCOPE
        ? (d.scope as AppThreadScope)
        : "direct",
    body: d.body ?? "",
    linkUrl: d.linkUrl ?? null,
    originalSenderId: d.originalSenderId ?? null,
    originalSenderName: d.originalSenderName ?? null,
    seenCount: d.seenCount ?? 0,
    ackCount: d.ackCount ?? 0,
    createdAt: toDate(d.createdAt),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * How many coaches a broadcast would reach right now.
 *
 * "direct" is the counter already maintained on the user (D36). "all" is a count
 * query on `uplinePath array-contains me` — a single-field filter, so it needs no
 * composite index, and `count()` bills far less than reading the documents.
 */
export async function audienceCount(
  coach: AppUser,
  scope: ThreadScope
): Promise<number> {
  if (scope === "direct") return coach.directDownlineCount;
  const snap = await users()
    .where("uplinePath", "array-contains", coach.id)
    .count()
    .get();
  return snap.data().count;
}

export async function getThread(id: string): Promise<AppThread | null> {
  return toAppThread(await threads().doc(id).get());
}

export async function createThread(params: {
  sender: AppUser;
  /**
   * Widened to include the platform scope so the admin route can reuse this. The
   * coach-facing route validates with `isThreadScope`, which does not admit "platform", so
   * widening the type here does not widen what a coach can send.
   */
  scope: AppThreadScope;
  body: string;
  linkUrl: string | null;
  /** Present only when forwarding; carries the original author, not this hop. */
  original?: { id: string; name: string } | null;
  /**
   * Overrides the displayed sender name. Used only by platform announcements, which come
   * FROM GROWLINE rather than from whichever staff member pressed the button — see
   * `createPlatformThread`.
   */
  displayName?: string;
}): Promise<AppThread> {
  const { sender, scope, body, linkUrl, original, displayName } = params;
  const ref = threads().doc();
  await ref.set({
    senderId: sender.id,
    // Denormalised so an inbox of 30 threads costs no user reads. A coach who later
    // changes their name leaves older threads showing the name they sent under, which
    // is the honest record of who wrote it at the time.
    senderName: displayName ?? sender.name,
    // No photo on an announcement: a staff member's face on a product notice is both
    // confusing and a way to learn who the admins are.
    senderPhotoUrl: displayName ? null : sender.photoUrl,
    scope,
    body,
    linkUrl,
    originalSenderId: original?.id ?? null,
    originalSenderName: original?.name ?? null,
    seenCount: 0,
    ackCount: 0,
    createdAt: Timestamp.now(),
  });
  return (await getThread(ref.id))!;
}

/**
 * A Real V announcement to every coach (F12). Only reachable from the admin-gated route.
 *
 * No push fan-out: a notification to every user on the platform from one button press is
 * not something to fire without a rate-limited job behind it, and the announcement is in
 * every inbox the moment it is written. Deliberate omission, not an oversight.
 */
export const PLATFORM_SENDER_NAME = "Growline";

export async function createPlatformThread(params: {
  sender: AppUser;
  body: string;
  linkUrl: string | null;
}): Promise<AppThread> {
  /**
   * Displayed as from "Growline", not from the staff member who sent it.
   *
   * Two reasons, and the second is the one that matters. An announcement attributed to
   * "Root Coach" reads as a message from another coach, which is confusing and undermines
   * it. And it would tell every user on the platform which account is an admin — a
   * standing invitation to go after that one phone number.
   *
   * `senderId` still records the actual person, so the audit log and the document agree
   * about who did it. Only the display name is the product's.
   */
  return createThread({
    ...params,
    scope: PLATFORM_SCOPE,
    displayName: PLATFORM_SENDER_NAME,
  });
}

/**
 * Re-broadcast: a NEW thread from this coach, carrying the original attribution.
 *
 * Deliberately a copy rather than a pointer. The forwarded message then reaches this
 * coach's line by exactly the same `senderId in uplinePath` rule as anything else
 * they send — no special case in the query, in the rules, or in the UI — and the
 * original sender's ack count keeps counting only the people they wrote to
 * themselves, which is the number they can act on.
 *
 * Returns null when the coach may not read the source, so forwarding cannot be used
 * to fetch a thread that was never addressed to them.
 */
export async function rebroadcast(params: {
  sender: AppUser;
  threadId: string;
  scope: ThreadScope;
}): Promise<AppThread | null> {
  const { sender, threadId, scope } = params;
  const source = await getThread(threadId);
  if (!source) return null;
  if (!canRead(source, sender)) return null;
  // Forwarding your own thread would put two copies in your line's inbox.
  if (source.senderId === sender.id) return null;

  return createThread({
    sender,
    scope,
    body: source.body,
    linkUrl: source.linkUrl,
    original: {
      id: source.originalSenderId ?? source.senderId,
      name: source.originalSenderName ?? source.senderName,
    },
  });
}

/**
 * Threads addressed to this coach, newest first, with their own ack state.
 *
 * `uplinePath` is chunked at 30 because that is Firestore's `in` ceiling and D36
 * allows a chain far deeper than that. Chunks are merged and re-sorted in memory,
 * then trimmed — correct at any depth, and one query for the overwhelmingly common
 * case of a coach with a handful of ancestors.
 */
export async function listInbox(reader: AppUser): Promise<InboxThread[]> {
  /**
   * Platform announcements are fetched separately and unconditionally.
   *
   * They come from an admin who is nowhere in this coach's `uplinePath`, so the
   * sender-based query cannot reach them — and the early return for a coach with no upline
   * would have hidden them from exactly the people most likely to be new. A root coach
   * with no line still gets Real V's announcements.
   */
  const platformQuery = threads()
    .where("scope", "==", PLATFORM_SCOPE)
    .orderBy("createdAt", "desc")
    .limit(INBOX_PAGE)
    .get();

  const batches = await Promise.all([
    platformQuery,
    ...chunk(reader.uplinePath, IN_LIMIT).map((ids) =>
      threads()
        .where("senderId", "in", ids)
        .orderBy("createdAt", "desc")
        .limit(INBOX_PAGE)
        .get()
    ),
  ]);

  const all = batches
    .flatMap((snap) => snap.docs)
    .map(toAppThread)
    .filter((t): t is AppThread => t !== null)
    // The scope narrowing the query cannot express: a "direct" thread from a
    // grandparent is in the result set but is not addressed to this reader.
    .filter((t) => canRead(t, reader))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, INBOX_PAGE);

  if (all.length === 0) return [];

  // Receipts by deterministic id — getAll, not a query, so there is no index and no
  // `in` ceiling to work around.
  const refs = all.map((t) =>
    threadReceipts().doc(threadReceiptDocId(t.id, reader.id))
  );
  const receipts = await db.getAll(...refs);
  const ackedBy = new Set<string>();
  const seenBy = new Set<string>();
  for (const r of receipts) {
    const d = r.data();
    if (!d) continue;
    if (d.ackedAt) ackedBy.add(d.threadId as string);
    if (d.seenAt) seenBy.add(d.threadId as string);
  }

  return all.map((t) => ({
    ...t,
    acked: ackedBy.has(t.id),
    seen: seenBy.has(t.id),
  }));
}

/**
 * Records "seen" for several threads at once.
 *
 * Called from the client after the inbox paints, with only the ids that have no
 * receipt yet — so the usual cost is one or two transactions, not one per row on
 * screen. Bounded by the inbox page size regardless.
 *
 * It is a batch because it must be ONE request. A fetch per card would put thirty
 * requests on a 3G connection the moment a coach opens the tab, to move a counter
 * somebody else is watching; that is the wrong trade on this audience's network.
 *
 * Deliberately NOT done during the server render. Marking a message read is a write,
 * and a render that writes fires again on every refresh and re-render — the count
 * would then measure renders rather than readers.
 */
export async function markSeenMany(
  reader: AppUser,
  threadIds: string[]
): Promise<number> {
  const ids = threadIds.slice(0, INBOX_PAGE);
  const results = await Promise.all(
    ids.map((threadId) =>
      recordReceipt({ reader, threadId, ack: false }).catch(() => "denied" as const)
    )
  );
  return results.filter((r) => r === "recorded").length;
}

/** What this coach has sent, newest first, with live seen and ack counts. */
export async function listSent(senderId: string): Promise<AppThread[]> {
  const snap = await threads()
    .where("senderId", "==", senderId)
    .orderBy("createdAt", "desc")
    .limit(SENT_PAGE)
    .get();
  return snap.docs.map(toAppThread).filter((t): t is AppThread => t !== null);
}

export type ReceiptOutcome = "recorded" | "already" | "denied" | "missing";

/**
 * Records that this reader has seen, or acknowledged, a thread.
 *
 * One transaction, and it is the transaction that makes the counters trustworthy: the
 * receipt is read and written together with the increment, so two taps that race
 * produce one receipt and one increment rather than two of each. `ack` implies seen —
 * a coach who taps acknowledge has plainly seen it, and recording otherwise would let
 * `ackCount` exceed `seenCount`, which reads as a bug to the sender.
 *
 * Authorization is re-derived here, not assumed from the fact that the id was known:
 * a thread id in a URL must not be enough to inflate someone else's ack count.
 */
export async function recordReceipt(params: {
  reader: AppUser;
  threadId: string;
  ack: boolean;
}): Promise<ReceiptOutcome> {
  const { reader, threadId, ack } = params;
  const threadRef = threads().doc(threadId);
  const receiptRef = threadReceipts().doc(threadReceiptDocId(threadId, reader.id));

  return db.runTransaction(async (tx) => {
    const threadSnap = await tx.get(threadRef);
    const thread = toAppThread(threadSnap);
    if (!thread) return "missing";
    if (!canRead(thread, reader)) return "denied";
    // A sender is not part of their own audience; counting them would tell them
    // one more person acknowledged than actually did.
    if (thread.senderId === reader.id) return "denied";

    const existing = await tx.get(receiptRef);
    const data = existing.data();
    const hadSeen = Boolean(data?.seenAt);
    const hadAck = Boolean(data?.ackedAt);

    if (hadAck || (!ack && hadSeen)) return "already";

    const now = Timestamp.now();
    const counters: Record<string, FieldValue> = {};
    if (!hadSeen) counters.seenCount = FieldValue.increment(1);
    if (ack && !hadAck) counters.ackCount = FieldValue.increment(1);

    tx.set(
      receiptRef,
      {
        threadId,
        userId: reader.id,
        userName: reader.name,
        seenAt: data?.seenAt ?? now,
        ackedAt: ack ? now : (data?.ackedAt ?? null),
      },
      { merge: true }
    );
    if (Object.keys(counters).length > 0) tx.update(threadRef, counters);

    return "recorded";
  });
}

/**
 * Who the broadcast should be pushed to.
 *
 * Returns ids only — the caller sends. Capped, and the cap is deliberate: a push per
 * recipient is the most expensive thing a single tap can trigger in this app, and a
 * senior coach with a line of thousands would otherwise fan one button press into
 * thousands of requests inside one HTTP handler. Beyond the cap the thread is still
 * delivered — it is in every recipient's inbox the moment it is written, and the
 * Firestore listener surfaces it without a push. Only the buzz is dropped, and the
 * route logs how many.
 */
export const PUSH_FANOUT_CAP = 200;

export async function recipientIds(
  sender: AppUser,
  scope: ThreadScope
): Promise<{ ids: string[]; total: number }> {
  const q =
    scope === "direct"
      ? users().where("uplineId", "==", sender.id)
      : users().where("uplinePath", "array-contains", sender.id);

  // The total comes from count(), not from the limited read — `snap.size` can never
  // exceed the limit, so reporting it as the total would silently under-report every
  // line bigger than the cap, which is exactly the case the log exists for.
  // `select()` with no fields fetches ids only: no document bodies over the wire.
  const [idSnap, countSnap] = await Promise.all([
    q.select().limit(PUSH_FANOUT_CAP).get(),
    q.count().get(),
  ]);
  return { ids: idSnap.docs.map((d) => d.id), total: countSnap.data().count };
}
