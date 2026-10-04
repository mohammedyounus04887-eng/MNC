import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import {
  DEFAULT_ACCENT,
  isAccentKey,
  type AccentKey,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
} from "./model";

/**
 * Server side of workspaces. Two collections, and a deliberate asymmetry between them:
 *
 *   workspaces        — the organisation itself: name, accent, its own level names.
 *   workspaceMembers  — who is in it and in what role.
 *
 * `users.workspaceId` remains the AUTHORITY on which workspace a coach belongs to.
 * `workspaceMembers` is metadata about that membership, not a second answer to the same
 * question — see model.ts for why one fact with two sources is the thing to avoid.
 *
 * Server-only. Every write here goes through an API route on the Admin SDK, the shape D1
 * established and D38 kept; `firestore.rules` denies client writes to both collections.
 */

export const WORKSPACES = "workspaces";
export const WORKSPACE_MEMBERS = "workspaceMembers";

/** One membership row per (workspace, user), as a document id. */
export function workspaceMemberDocId(workspaceId: string, userId: string): string {
  return `${workspaceId}__${userId}`;
}

const toDate = (v: unknown): Date =>
  v instanceof Timestamp ? v.toDate() : new Date(0);

function toWorkspace(snap: DocumentSnapshot): Workspace | null {
  const d = snap.data();
  if (!d) return null;
  return {
    id: snap.id,
    name: (d.name as string) ?? "",
    // An unrecognised accent falls back to the product default rather than rendering
    // an undefined CSS variable, which paints as "no colour at all".
    accent: isAccentKey(d.accent) ? d.accent : DEFAULT_ACCENT,
    levelGroups: Array.isArray(d.levelGroups) ? (d.levelGroups as string[]) : [],
    ownerId: (d.ownerId as string) ?? "",
    createdAt: toDate(d.createdAt),
  };
}

export const workspaces = () => db.collection(WORKSPACES);
export const workspaceMembers = () => db.collection(WORKSPACE_MEMBERS);

export async function getWorkspace(id: string): Promise<Workspace | null> {
  if (!id) return null;
  return toWorkspace(await workspaces().doc(id).get());
}

/**
 * Creates a workspace and its owner's membership in one transaction.
 *
 * `tx` is accepted so the caller can fold this into a bigger transaction — signup needs
 * the workspace, the membership and the user row to land together or not at all, because
 * a user with a `workspaceId` pointing at a workspace that failed to write is invisible
 * to every scoped query in the app.
 */
export function writeWorkspace(
  tx: FirebaseFirestore.Transaction,
  params: { id: string; name: string; ownerId: string; accent?: AccentKey }
): void {
  tx.set(workspaces().doc(params.id), {
    name: params.name,
    accent: params.accent ?? DEFAULT_ACCENT,
    // Empty, always. RULES L8 — a level name only ever exists because a human typed it.
    levelGroups: [],
    ownerId: params.ownerId,
    createdAt: Timestamp.now(),
  });
}

export function writeMembership(
  tx: FirebaseFirestore.Transaction,
  params: { workspaceId: string; userId: string; role: WorkspaceRole }
): void {
  tx.set(workspaceMembers().doc(workspaceMemberDocId(params.workspaceId, params.userId)), {
    workspaceId: params.workspaceId,
    userId: params.userId,
    role: params.role,
    joinedAt: Timestamp.now(),
  });
}

export async function getMembership(
  workspaceId: string,
  userId: string
): Promise<WorkspaceMember | null> {
  const snap = await workspaceMembers()
    .doc(workspaceMemberDocId(workspaceId, userId))
    .get();
  const d = snap.data();
  if (!d) return null;
  return {
    workspaceId: d.workspaceId as string,
    userId: d.userId as string,
    role: d.role === "owner" ? "owner" : "member",
    joinedAt: toDate(d.joinedAt),
  };
}

export async function isWorkspaceOwner(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const workspace = await getWorkspace(workspaceId);
  // Checked against the workspace's own `ownerId` rather than the membership role, so a
  // stray membership row claiming "owner" cannot grant control of the settings.
  return workspace !== null && workspace.ownerId === userId;
}

export type SettingsUpdate = {
  name?: string;
  accent?: AccentKey;
  levelGroups?: string[];
};

/**
 * Updates the organisation's own settings. Owner-only, re-checked here rather than
 * trusted from the caller — the route is reachable directly.
 *
 * Returns null when the caller is not the owner, which the route answers as a 404 so the
 * endpoint cannot be used to discover whether a workspace exists.
 */
export async function updateWorkspaceSettings(
  workspaceId: string,
  actorId: string,
  update: SettingsUpdate
): Promise<Workspace | null> {
  if (!(await isWorkspaceOwner(workspaceId, actorId))) return null;

  const data: Record<string, unknown> = {};
  if (update.name !== undefined) data.name = update.name;
  if (update.accent !== undefined) data.accent = update.accent;
  if (update.levelGroups !== undefined) data.levelGroups = update.levelGroups;
  if (Object.keys(data).length === 0) return getWorkspace(workspaceId);

  await workspaces().doc(workspaceId).update(data);
  return getWorkspace(workspaceId);
}

/**
 * Everyone in a workspace. Used by the settings screen's member count and, later, by the
 * recognition wall's audience.
 *
 * Queries `users` by `workspaceId` rather than reading `workspaceMembers`, because
 * `users.workspaceId` is the authority — a membership row that somehow disagreed would
 * otherwise show a coach in a list they are not actually in.
 */
export async function countWorkspaceMembers(workspaceId: string): Promise<number> {
  const snap = await db
    .collection("users")
    .where("workspaceId", "==", workspaceId)
    .count()
    .get();
  return snap.data().count;
}
