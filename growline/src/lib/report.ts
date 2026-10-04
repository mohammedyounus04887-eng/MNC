import { createHash } from "crypto";
import { upsertReport } from "./reports";
import { newReportToken } from "./report-token";
import {
  computeWellness,
  reportEligibility,
  type Eligibility,
  type Gender,
  type WellnessMetrics,
} from "./wellness";

/**
 * A report row is IMMUTABLE once created. If the coach later fills in a missing
 * age or weight, we mint a NEW report with a new link rather than rewriting the
 * old one — a prospect who already opened a link must never find that the
 * numbers silently changed underneath them.
 */

/**
 * Bump whenever the shape or the basis of the stored metrics changes. A snapshot
 * from an older version is treated as unreadable rather than rendered: the shapes
 * differ, and silently coercing them would either crash a render or — worse —
 * display a figure computed on a basis we have since corrected.
 *
 * v2: water guidance moved off the per-kg rule to EFSA/ICMR adult intake, changing
 *     `waterLitres` from a number to a {low, high} span.
 * v3: BMI band now derived from the rounded (displayed) figure, BMR rounded to the
 *     nearest 10, and implausible input combinations refused. v2 snapshots can hold
 *     a band that contradicts its own number, so they are retired rather than shown.
 */
export const REPORT_SNAPSHOT_VERSION = 3;

/**
 * A snapshot link stops working after this long. The link is a bearer credential
 * that outlives the conversation in chat backups and forwards, so it should not
 * be immortal. The coach can always issue a fresh one.
 */
export const REPORT_TTL_DAYS = 90;

export function isReportExpired(createdAt: Date, now = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > REPORT_TTL_DAYS * 86_400_000;
}

export type ReportInputs = {
  age: number | null;
  gender: Gender | null;
  heightCm: number | null;
  weightKg: number | null;
};

export type ReportSnapshot = {
  version: number;
  inputs: ReportInputs;
  metrics: WellnessMetrics;
};

type ProspectForReport = {
  id: string;
  /** Denormalised onto the report so public surfaces resolve the coach in one read. */
  coachId?: string | null;
  age: number | null;
  gender: string | null;
  heightCm: number | null;
  weightKg: number | null;
};

function toInputs(p: ProspectForReport): ReportInputs {
  const gender =
    p.gender === "male" || p.gender === "female" || p.gender === "other"
      ? p.gender
      : null;
  return { age: p.age, gender, heightCm: p.heightCm, weightKg: p.weightKg };
}

const isNullableNumber = (v: unknown) => v === null || typeof v === "number";

/**
 * Structural validation, not just a version check. A row written by a migration, a
 * manual database fix, or a future writer that forgot to bump the version could be
 * missing `inputs` — and reading through it would throw mid-render and hand the
 * coach a blank 500 with no way back to the editor.
 */
export function parseSnapshot(json: string): ReportSnapshot | null {
  try {
    const parsed = JSON.parse(json) as ReportSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== REPORT_SNAPSHOT_VERSION) return null;
    const { inputs, metrics } = parsed;
    if (!inputs || typeof inputs !== "object") return null;
    if (!metrics || typeof metrics !== "object") return null;
    if (
      !isNullableNumber(inputs.age) ||
      !isNullableNumber(inputs.heightCm) ||
      !isNullableNumber(inputs.weightKg)
    ) {
      return null;
    }
    if (!Array.isArray(metrics.missing)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Why a report could not be made, for the "add details" prompt. */
export function reportBlocker(prospect: ProspectForReport): Eligibility {
  return reportEligibility(toInputs(prospect));
}

const MISSING_LABELS: Record<string, string> = {
  age: "age",
  gender: "gender",
  height: "height",
  weight: "weight",
};

/**
 * One phrasing of "why not", shared by the coach's screen and the API, so the two
 * can never tell a coach to add a detail they have already filled in.
 */
export function eligibilityMessage(
  e: Eligibility
): { title: string; body: string } | null {
  if (e.ok) return null;
  if (e.reason === "under_age") {
    return {
      title: "No snapshot for under-18s",
      body: "Wellness snapshots are only made for adults. Nothing is calculated for someone under 18.",
    };
  }
  if (e.reason === "implausible") {
    return {
      title: "Please check the height and weight",
      body: "Those two numbers together don't look right, so no snapshot was made. Check them and save again.",
    };
  }
  const names = e.missing.map((m) => MISSING_LABELS[m]);
  const list =
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    title: "Add a few details to make their snapshot",
    body: `Add their ${list} and the snapshot is ready to send.`,
  };
}

/**
 * Returns the report matching the prospect's current details, creating one if
 * needed. Null when the prospect isn't eligible — we refuse rather than publish a
 * card with blanks in it.
 */
export async function ensureCurrentReport(prospect: ProspectForReport) {
  const inputs = toInputs(prospect);
  if (!reportEligibility(inputs).ok) return null;
  const metrics = computeWellness(inputs);
  const hash = inputsHash(inputs);

  const snapshot: ReportSnapshot = {
    version: REPORT_SNAPSHOT_VERSION,
    inputs,
    metrics,
  };

  /**
   * Upsert, not create. This runs during a GET page render, so two tabs or a save
   * racing a refresh would otherwise mint two rows — two live 90-day bearer
   * tokens to the same person's health data, only one of which the coach ever
   * sees or can mark as sent.
   *
   * The identity is now the document id (D35), so concurrent renders converge on
   * one document rather than relying on a database-level unique constraint that
   * Firestore does not have. An expired row is refreshed in place: same identity,
   * new token and timestamp.
   */
  return upsertReport({
    prospectId: prospect.id,
    coachId: prospect.coachId ?? null,
    inputsHash: hash,
    token: newReportToken(),
    metricsJson: JSON.stringify(snapshot),
  });
}

/** Stable identity for "a report of these inputs at this snapshot version". */
function inputsHash(inputs: ReportInputs): string {
  const canonical = JSON.stringify([
    REPORT_SNAPSHOT_VERSION,
    inputs.age,
    inputs.gender,
    inputs.heightCm,
    inputs.weightKg,
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
