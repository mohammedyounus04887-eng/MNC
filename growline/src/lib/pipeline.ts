/**
 * The prospect pipeline (F5): Spoken → Interested → Invited → Attended → Member.
 *
 * Plain words on purpose (Section 4.6) — these are the words a coach already uses
 * out loud, not funnel jargon. Moving a stage must be one tap (Section 4.1), so the
 * order here is what "advance" means.
 */

export const STAGES = [
  "spoken",
  "interested",
  "invited",
  "attended",
  "member",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  spoken: "Spoken",
  interested: "Interested",
  invited: "Invited",
  attended: "Attended",
  member: "Member",
};

/** What tapping "move forward" does. Null at the end of the pipeline. */
export function nextStage(stage: Stage): Stage | null {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export function previousStage(stage: Stage): Stage | null {
  const i = STAGES.indexOf(stage);
  return i > 0 ? STAGES[i - 1] : null;
}

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

/** Normalises whatever is in the database, so an unknown value can't crash a page. */
export function toStage(value: string | null | undefined): Stage {
  return isStage(value) ? value : "spoken";
}
