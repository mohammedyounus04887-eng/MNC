import type { BlockerKey } from "./model";

/**
 * The shapes and limits of a target conversation, with no database in them.
 *
 * Split out of `conversations.ts` for RULES E2: that file imports firebase-admin, and both
 * sides of this exchange are client components. A `import type` would erase, but the
 * length caps are runtime values a form needs for its `maxLength`, and importing those
 * from the query file would pull the admin SDK into the browser bundle.
 */

export type ConversationStatus = "proposed" | "accepted" | "change-requested";

export type BlockerAction = {
  /** The blocker this answers. Free text blockers are keyed "other". */
  blocker: BlockerKey | "other";
  /** What the upline asked them to do. Their words. */
  action: string;
  done: boolean;
};

export const MAX_ACTION = 200;
export const MAX_CHANGE_NOTE = 300;
export const MAX_ACTIONS = 8;
