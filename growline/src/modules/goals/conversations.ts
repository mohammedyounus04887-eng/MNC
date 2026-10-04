import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { getUserById } from "@/lib/users";
import { isBlockerKey } from "./model";
import {
  MAX_ACTION,
  MAX_ACTIONS,
  MAX_CHANGE_NOTE,
  type BlockerAction,
  type ConversationStatus,
} from "./conversation-types";

export {
  MAX_ACTION,
  MAX_ACTIONS,
  MAX_CHANGE_NOTE,
  type BlockerAction,
  type ConversationStatus,
};

/**
 * The conversation around a target (A3): proposed → accepted, and the actions that answer
 * the coach's blockers.
 *
 * ## Why this is its own collection rather than fields on `targets`
 *
 * Two reasons, and the second is the one that made the decision.
 *
 * Practically: `targets` is existing, working code outside the file set this work was
 * authorised to touch, and bolting an acceptance state onto it would mean editing the
 * queries, the type and every screen that reads them.
 *
 * Structurally: a target and the agreement about it have different lifetimes and different
 * owners. The target is a number the upline maintains; the conversation is a negotiation
 * belonging equally to both. Keeping them apart means a target that already exists — every
 * target set before this feature — is simply one with no conversation yet, rather than a
 * row missing required fields. Nothing needed backfilling.
 *
 * ## "Proposed until accepted" is DERIVED, never stored twice
 *
 * The target holds the number; this holds whether it was agreed. A screen shows "proposed"
 * when there is no accepted conversation for that target. Storing a status on both would
 * give two answers to one question, which is the drift D-series keeps warning about.
 */

export const GOAL_CONVERSATIONS = "goalConversations";

export const goalConversations = () => db.collection(GOAL_CONVERSATIONS);

export type GoalConversation = {
  targetId: string;
  coachId: string;
  uplineId: string;
  month: string;
  status: ConversationStatus;
  /** The number the upline put forward. Kept so a later edit is visibly a NEW proposal. */
  proposedPoints: number;
  /** The downline's words when asking to talk again. */
  changeNote: string;
  actions: BlockerAction[];
  createdAt: Date;
  respondedAt: Date | null;
};

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

function toConversation(snap: DocumentSnapshot): GoalConversation | null {
  const d = snap.data();
  if (!d) return null;
  const status = d.status;
  return {
    targetId: snap.id,
    coachId: (d.coachId as string) ?? "",
    uplineId: (d.uplineId as string) ?? "",
    month: (d.month as string) ?? "",
    // Anything unrecognised reads as "proposed" — the state that asks for a human, which
    // is the safe direction for a value nobody wrote deliberately.
    status:
      status === "accepted" || status === "change-requested"
        ? (status as ConversationStatus)
        : "proposed",
    proposedPoints: typeof d.proposedPoints === "number" ? d.proposedPoints : 0,
    changeNote: (d.changeNote as string) ?? "",
    actions: Array.isArray(d.actions)
      ? (d.actions as unknown[]).flatMap((a) => {
          const row = a as Record<string, unknown>;
          const action = typeof row.action === "string" ? row.action.trim() : "";
          if (!action) return [];
          const blocker = isBlockerKey(row.blocker) ? row.blocker : "other";
          return [{ blocker, action, done: row.done === true } as BlockerAction];
        })
      : [],
    createdAt: toDate(d.createdAt) ?? new Date(0),
    respondedAt: toDate(d.respondedAt),
  };
}

export async function getConversation(targetId: string): Promise<GoalConversation | null> {
  return toConversation(await goalConversations().doc(targetId).get());
}

export async function getConversations(targetIds: string[]): Promise<Map<string, GoalConversation>> {
  const found = new Map<string, GoalConversation>();
  if (targetIds.length === 0) return found;
  const snaps = await db.getAll(...targetIds.map((id) => goalConversations().doc(id)));
  for (const snap of snaps) {
    const conversation = toConversation(snap);
    if (conversation) found.set(conversation.targetId, conversation);
  }
  return found;
}

function cleanActions(raw: unknown): BlockerAction[] {
  if (!Array.isArray(raw)) return [];
  const out: BlockerAction[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_ACTIONS) break;
    const row = (entry ?? {}) as Record<string, unknown>;
    const action = typeof row.action === "string" ? row.action.trim().slice(0, MAX_ACTION) : "";
    // An action with no words is a row somebody started and abandoned, not an error.
    if (!action) continue;
    out.push({
      blocker: isBlockerKey(row.blocker) ? row.blocker : "other",
      action,
      done: row.done === true,
    });
  }
  return out;
}

export type ConversationResult =
  | { ok: true; conversation: GoalConversation }
  | { ok: false; error: string };

/**
 * The upline puts a number forward, with actions answering the blockers.
 *
 * Always lands as "proposed", even when re-proposing over an accepted one: changing the
 * number after somebody agreed to it means they have not agreed to THIS number, and
 * silently keeping the old acceptance would make the tap that matters meaningless.
 */
export async function propose(params: {
  targetId: string;
  coachId: string;
  uplineId: string;
  month: string;
  proposedPoints: number;
  actions?: unknown;
}): Promise<ConversationResult> {
  const coach = await getUserById(params.coachId);
  // Re-derived, not trusted: only the DIRECT upline sets a target (F7), and this is
  // reachable directly.
  if (!coach || coach.uplineId !== params.uplineId) {
    return { ok: false, error: "Not found" };
  }

  await goalConversations().doc(params.targetId).set(
    {
      coachId: params.coachId,
      uplineId: params.uplineId,
      month: params.month,
      status: "proposed" satisfies ConversationStatus,
      proposedPoints: Math.max(0, Math.round(params.proposedPoints || 0)),
      changeNote: "",
      actions: cleanActions(params.actions),
      createdAt: Timestamp.now(),
      respondedAt: null,
    },
    { merge: false }
  );

  return { ok: true, conversation: (await getConversation(params.targetId))! };
}

/**
 * The downline accepts. This one tap is the point of the whole feature — a target somebody
 * agreed to gets worked; one pushed at them does not.
 *
 * Only the coach the target is FOR may accept, re-checked here. An upline accepting on
 * their downline's behalf would be the imposed quota wearing the agreement's clothes.
 */
export async function accept(
  targetId: string,
  actorId: string
): Promise<ConversationResult> {
  const conversation = await getConversation(targetId);
  if (!conversation) return { ok: false, error: "Not found" };
  if (conversation.coachId !== actorId) return { ok: false, error: "Not found" };
  if (conversation.status === "accepted") {
    // Idempotent: a double tap on a slow connection is agreement, not an error.
    return { ok: true, conversation };
  }

  await goalConversations().doc(targetId).update({
    status: "accepted" satisfies ConversationStatus,
    respondedAt: Timestamp.now(),
  });
  return { ok: true, conversation: (await getConversation(targetId))! };
}

/**
 * The downline asks to talk again instead of accepting.
 *
 * A3 requires this: without it, "not accepted" is indistinguishable from "not looked at
 * yet", and the feature fails silently for exactly the coach who most needs the
 * conversation. It reopens the discussion rather than rejecting the target.
 */
export async function requestChange(
  targetId: string,
  actorId: string,
  note: unknown
): Promise<ConversationResult> {
  const conversation = await getConversation(targetId);
  if (!conversation) return { ok: false, error: "Not found" };
  if (conversation.coachId !== actorId) return { ok: false, error: "Not found" };

  const changeNote =
    typeof note === "string" ? note.trim().slice(0, MAX_CHANGE_NOTE) : "";

  await goalConversations().doc(targetId).update({
    status: "change-requested" satisfies ConversationStatus,
    changeNote,
    respondedAt: Timestamp.now(),
  });
  return { ok: true, conversation: (await getConversation(targetId))! };
}

/**
 * Ticking an action off. Either party may — the coach usually does it, and an upline
 * marking "joined Tuesday's session" after seeing them there is the same fact.
 */
export async function setActionDone(
  targetId: string,
  actorId: string,
  index: number,
  done: boolean
): Promise<ConversationResult> {
  const conversation = await getConversation(targetId);
  if (!conversation) return { ok: false, error: "Not found" };
  if (conversation.coachId !== actorId && conversation.uplineId !== actorId) {
    return { ok: false, error: "Not found" };
  }
  if (!Number.isInteger(index) || index < 0 || index >= conversation.actions.length) {
    return { ok: false, error: "No such action." };
  }

  const actions = conversation.actions.map((a, i) => (i === index ? { ...a, done } : a));
  await goalConversations().doc(targetId).update({ actions });
  return { ok: true, conversation: (await getConversation(targetId))! };
}
