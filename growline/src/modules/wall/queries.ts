import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { getUserById, type AppUser } from "@/lib/users";
import {
  CARD_TTL_DAYS,
  WALL_STREAK_DAYS,
  isCardKind,
  isLive,
  type CardKind,
  type WallCard,
} from "./model";

/**
 * Server side of the Recognition Wall (Feature B).
 *
 * ## Three collections
 *
 *   recognitions/{cardId}              one card. Read by workspace, sorted by earnedAt.
 *   recognitions/{cardId}/claps/{uid}  one document per clapper — its EXISTENCE is the
 *                                      clap, so "one 👏 per person" is structural, not a
 *                                      count somebody has to keep honest.
 *   wallPrefs/{userId}                 { optOut: true } and nothing else. Absent = in.
 *
 * ## The card id is deterministic, so a card cannot be minted twice
 *
 * `{earnerId}__{kind}__{key}` — where key is the thing that makes this instance unique
 * (the month for a target, the day count for a streak, "once" for the first-* kinds).
 * `create()` on an existing id fails silently here, which is exactly right: the events
 * that mint cards fire on writes that can be retried, and a retry must not clap twice.
 *
 * ## Why claps are a subcollection and the count is a counter
 *
 * The count is what forty cards on a wall need; the subcollection is what "have I
 * clapped this?" and "never twice" need. Reading forty subcollections to render a wall
 * would be forty extra queries, so `claps` on the card is bumped with `increment` in the
 * same transaction that creates the clap document. They cannot drift because they are
 * one write.
 *
 * ## No Security Rules block — same reasoning as portfolios and tiers
 *
 * All reads are server-side. The catch-all deny is the rule.
 */

export const RECOGNITIONS = "recognitions";
export const WALL_PREFS = "wallPrefs";
export const recognitions = () => db.collection(RECOGNITIONS);
export const wallPrefs = () => db.collection(WALL_PREFS);

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

function toCard(snap: DocumentSnapshot): Omit<WallCard, "clappedByMe"> | null {
  const d = snap.data();
  if (!d || !isCardKind(d.kind)) return null;
  const earnedAt = toDate(d.earnedAt);
  if (!earnedAt) return null;
  return {
    id: snap.id,
    workspaceId: (d.workspaceId as string) ?? "",
    earnerId: (d.earnerId as string) ?? "",
    earnerName: (d.earnerName as string) ?? "",
    earnerPhotoUrl: (d.earnerPhotoUrl as string | null) ?? null,
    kind: d.kind,
    value: typeof d.value === "number" ? d.value : null,
    earnedAt,
    claps: typeof d.claps === "number" ? d.claps : 0,
  };
}

/** Whether a coach has turned the wall off. Absent = in. */
export async function isOptedOut(userId: string): Promise<boolean> {
  const snap = await wallPrefs().doc(userId).get();
  return snap.data()?.optOut === true;
}

export async function setOptOut(userId: string, optOut: boolean): Promise<void> {
  // A strict boolean at the route; here it is already one. `set` rather than delete on
  // opt-in so the doc records the choice was made — nothing else reads that, but a
  // deleted pref and a never-set pref being indistinguishable is a debugging trap.
  await wallPrefs()
    .doc(userId)
    .set({ optOut, updatedAt: Timestamp.now() }, { merge: true });
}

function cardId(earnerId: string, kind: CardKind, key: string): string {
  return `${earnerId}__${kind}__${key}`;
}

/**
 * Mints a card. Idempotent per (earner, kind, key). Never throws — a recognition that
 * fails to post must not break the daily log save or the target write that triggered it.
 *
 * Refuses when the earner has opted out. That is the WRITE half of opt-out; the read
 * half in `getWall` covers cards minted before they opted out.
 *
 * Takes the loaded user rather than an id when the caller has it, so the events on hot
 * paths (log save, stage move) do not pay a `users` read they already paid.
 */
export async function mint(params: {
  earner: AppUser | string;
  kind: CardKind;
  key: string;
  value?: number | null;
}): Promise<void> {
  try {
    const earner =
      typeof params.earner === "string" ? await getUserById(params.earner) : params.earner;
    if (!earner || !earner.workspaceId) return;
    if (await isOptedOut(earner.id)) return;

    await recognitions()
      .doc(cardId(earner.id, params.kind, params.key))
      .create({
        workspaceId: earner.workspaceId,
        earnerId: earner.id,
        earnerName: earner.name,
        earnerPhotoUrl: earner.photoUrl,
        kind: params.kind,
        value: params.value ?? null,
        earnedAt: Timestamp.now(),
        claps: 0,
      });
  } catch (e) {
    // ALREADY_EXISTS is the idempotency working. Anything else is logged, not thrown.
    if (!/ALREADY_EXISTS|already exists/i.test((e as Error).message)) {
      console.error(`wall.mint(${params.kind}) failed:`, e);
    }
  }
}

/** The event hooks. Each decides whether THIS event is card-worthy, then mints. */
export const onEvent = {
  /** Called after a prospect is created. Card only for the very first. */
  prospectCreated: (earner: AppUser, priorCount: number) =>
    priorCount === 0 ? mint({ earner, kind: "first-prospect", key: "once" }) : Promise.resolve(),

  /** Called after a stage move to "member". Card only for the very first. */
  becameMember: (earner: AppUser, priorMemberCount: number) =>
    priorMemberCount === 0 ? mint({ earner, kind: "first-member", key: "once" }) : Promise.resolve(),

  /** Called after a daily log save with the resulting streak. */
  streakReached: (earner: AppUser, streak: number) =>
    WALL_STREAK_DAYS.has(streak)
      ? mint({ earner, kind: "streak", key: String(streak), value: streak })
      : Promise.resolve(),

  /** Called when a target's progress crosses the target. */
  targetReached: (earnerId: string, month: string, points: number) =>
    mint({ earner: earnerId, kind: "target-reached", key: month, value: points }),

  /** Called from the signup transaction's caller when a coach gains a downline. */
  gainedDownline: (uplineId: string, newCount: number) =>
    newCount === 1 ? mint({ earner: uplineId, kind: "first-downline", key: "once" }) : Promise.resolve(),

  /** Called when a qualification is met. */
  qualified: (earnerId: string, qualificationId: string) =>
    mint({ earner: earnerId, kind: "qualified", key: qualificationId }),
};

export const WALL_PAGE = 40;

/**
 * The wall as one viewer sees it: their workspace's live cards, newest first, minus
 * anybody who has opted out, with "have I clapped this" resolved for the viewer.
 *
 * Opt-out is applied AFTER the query, on the earner set actually returned, so it costs
 * one `getAll` on `wallPrefs` for the distinct earners on the page — typically a handful
 * — rather than a filter Firestore cannot express.
 *
 * A viewer who has opted out sees nothing: opting out is leaving the room, not turning
 * invisible in it.
 */
export async function getWall(viewer: AppUser, now = new Date()): Promise<WallCard[]> {
  if (!viewer.workspaceId) return [];
  if (await isOptedOut(viewer.id)) return [];

  const since = Timestamp.fromMillis(now.getTime() - CARD_TTL_DAYS * 86_400_000);
  const snap = await recognitions()
    .where("workspaceId", "==", viewer.workspaceId)
    .where("earnedAt", ">=", since)
    .orderBy("earnedAt", "desc")
    .limit(WALL_PAGE)
    .get();

  const cards = snap.docs.map(toCard).filter((c): c is NonNullable<typeof c> => c !== null);
  if (cards.length === 0) return [];

  // Drop cards from anyone who has since opted out (the READ half of opt-out).
  const earnerIds = [...new Set(cards.map((c) => c.earnerId))];
  const prefSnaps = await db.getAll(...earnerIds.map((id) => wallPrefs().doc(id)));
  const optedOut = new Set(
    prefSnaps.filter((s) => s.data()?.optOut === true).map((s) => s.id)
  );

  const visible = cards.filter((c) => !optedOut.has(c.earnerId) && isLive(c.earnedAt, now));
  if (visible.length === 0) return [];

  // "Have I clapped this?" — one getAll over the viewer's would-be clap docs.
  const clapSnaps = await db.getAll(
    ...visible.map((c) => recognitions().doc(c.id).collection("claps").doc(viewer.id))
  );
  const clapped = new Set(clapSnaps.filter((s) => s.exists).map((s) => s.ref.parent.parent!.id));

  return visible.map((c) => ({ ...c, clappedByMe: clapped.has(c.id) }));
}

export type ClapResult = { ok: true; claps: number } | { ok: false; error: string };

/**
 * One 👏 per person per card, structurally: the clap is a document keyed by the
 * clapper's uid, created inside a transaction that also bumps the counter. A second tap
 * finds the document and returns the current count without writing — a double tap on a
 * slow connection is one clap, not two, and not an error.
 *
 * Only members of the card's workspace may clap it, and only while it is live.
 */
export async function clap(viewer: AppUser, cardId: string, now = new Date()): Promise<ClapResult> {
  const cardRef = recognitions().doc(cardId);
  const clapRef = cardRef.collection("claps").doc(viewer.id);

  try {
    return await db.runTransaction(async (tx) => {
      const [cardSnap, clapSnap] = await Promise.all([tx.get(cardRef), tx.get(clapRef)]);
      const card = toCard(cardSnap);
      if (!card || card.workspaceId !== viewer.workspaceId || !isLive(card.earnedAt, now)) {
        // Same answer for missing, foreign and expired: nothing about other workspaces
        // leaks through the error shape.
        return { ok: false as const, error: "Not found" };
      }
      if (clapSnap.exists) return { ok: true as const, claps: card.claps };

      tx.create(clapRef, { at: Timestamp.now() });
      tx.update(cardRef, { claps: FieldValue.increment(1) });
      return { ok: true as const, claps: card.claps + 1 };
    });
  } catch (e) {
    if (/ALREADY_EXISTS|already exists/i.test((e as Error).message)) {
      // Lost a race with our own retry. The clap landed; report the current count.
      const fresh = toCard(await cardRef.get());
      return { ok: true, claps: fresh?.claps ?? 0 };
    }
    throw e;
  }
}
