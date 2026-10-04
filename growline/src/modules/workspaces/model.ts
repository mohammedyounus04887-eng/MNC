/**
 * Organisation workspaces — the multi-tenant foundation.
 *
 * ## What a workspace is
 *
 * One organisation. Every coach belongs to exactly one, and no data of any kind crosses
 * between them. Other leaders will want Growline for their own groups, and shipping a
 * separate app per group is maintenance suicide — so it is one codebase with hard
 * isolation instead.
 *
 * ## Where the boundary is actually enforced
 *
 * `users.workspaceId` is the single source of truth for which organisation a coach is in.
 * It is written in the SAME transaction that creates the user, so a coach cannot exist
 * without one — an unassigned user would be a row no workspace-scoped query could ever
 * see, which is a worse failure than a loud one.
 *
 * `workspaceMembers` carries the membership metadata (role, when they joined). It is
 * deliberately NOT the authority on which workspace somebody is in: two sources for that
 * one fact is how they drift apart, and the Security Rules need the answer in a single
 * `get()` on the user document they already read.
 *
 * ## PURE ONLY
 *
 * No database import — the settings screen is a client component (RULES E2). Everything
 * here is types, constants and validation that both sides share.
 */

/** The one workspace every pre-existing coach was placed into by the backfill. */
export const FOUNDING_WORKSPACE_ID = "ws_founding000000000000";

export type WorkspaceRole = "owner" | "member";

/**
 * Accent colours, restricted to the Growline palette (v2 §4).
 *
 * A free colour picker would let an organisation choose something that fails contrast on
 * the dark base, or that collides with the meanings the palette already assigns — green
 * means money and gains, heat means an alert. Both are conventions a coach reads without
 * thinking, and a workspace that repaints them has broken the app's grammar for its own
 * users. So the choice is a short list of colours that are already known to work.
 *
 * Gold is the default because it is the product's own accent; a workspace that never
 * touches this setting looks exactly like Growline.
 */
export const ACCENT_KEYS = ["gold", "platinum", "info", "gemGreen", "pink"] as const;
export type AccentKey = (typeof ACCENT_KEYS)[number];
export const DEFAULT_ACCENT: AccentKey = "gold";

export const ACCENTS: Record<AccentKey, { label: string; cssVar: string }> = {
  gold: { label: "Champagne gold", cssVar: "--gold" },
  platinum: { label: "Platinum", cssVar: "--platinum" },
  info: { label: "Blue", cssVar: "--info" },
  gemGreen: { label: "Green", cssVar: "--gem-green-text" },
  pink: { label: "Pink", cssVar: "--gem-pink-text" },
};

export function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === "string" && (ACCENT_KEYS as readonly string[]).includes(value);
}

export const MAX_WORKSPACE_NAME = 60;
export const MAX_LEVEL_GROUP_NAME = 40;
export const MAX_LEVEL_GROUPS = 12;

export type Workspace = {
  id: string;
  name: string;
  accent: AccentKey;
  /**
   * The organisation's own words for its levels — ALWAYS typed by a human, never
   * pre-filled and never suggested.
   *
   * RULES L1 and L8: no direct-selling or nutrition company's rank names may appear
   * anywhere in this app, and the only way one can appear is a coach typing it. Offering
   * a starter list would be the app supplying them, which is the thing forbidden. So this
   * starts empty and stays empty until somebody writes their own.
   */
  levelGroups: string[];
  ownerId: string;
  createdAt: Date;
};

export type WorkspaceMember = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: Date;
};

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

export function checkWorkspaceName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, error: "Give the group a name." };
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: "Give the group a name." };
  if (name.length > MAX_WORKSPACE_NAME) {
    return { ok: false, error: `Keep the name under ${MAX_WORKSPACE_NAME} characters.` };
  }
  return { ok: true, name };
}

export type LevelGroupsCheck =
  | { ok: true; levelGroups: string[] }
  | { ok: false; error: string };

/**
 * Level names, cleaned but never invented.
 *
 * Blanks are dropped rather than rejected, because the editor is a list of rows and an
 * empty row is somebody deleting one, not an error to argue with. Duplicates are dropped
 * for the same reason — two rows reading the same thing is a slip, and a level list with
 * a repeat in it is unusable on a progress screen.
 */
export function checkLevelGroups(raw: unknown): LevelGroupsCheck {
  if (!Array.isArray(raw)) return { ok: false, error: "Could not read those level names." };

  const cleaned: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    if (name.length === 0) continue;
    if (name.length > MAX_LEVEL_GROUP_NAME) {
      return {
        ok: false,
        error: `Keep each level name under ${MAX_LEVEL_GROUP_NAME} characters.`,
      };
    }
    if (cleaned.some((existing) => existing.toLowerCase() === name.toLowerCase())) continue;
    cleaned.push(name);
  }

  if (cleaned.length > MAX_LEVEL_GROUPS) {
    return { ok: false, error: `That is more than ${MAX_LEVEL_GROUPS} levels.` };
  }
  return { ok: true, levelGroups: cleaned };
}

/**
 * Whether a reader may see something belonging to `workspaceId`.
 *
 * The app's copy of the boundary. `firestore.rules` states the same thing independently —
 * this one decides what we render, that one stops a hand-written query, and neither
 * substitutes for the other.
 */
export function sameWorkspace(
  readerWorkspaceId: string | null | undefined,
  documentWorkspaceId: string | null | undefined
): boolean {
  // A missing id on either side is never a match. Two unassigned rows are not "in the
  // same workspace" — they are both broken, and treating them as equal would make the
  // isolation hole widest exactly where the data is worst.
  if (!readerWorkspaceId || !documentWorkspaceId) return false;
  return readerWorkspaceId === documentWorkspaceId;
}
