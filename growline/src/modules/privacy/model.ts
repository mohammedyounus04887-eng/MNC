/**
 * The privacy notice's publication gate (v2 §5.4).
 *
 * ## Why a notice can be missing but must never be half-written
 *
 * DPDP Rules 2025 require a notice to name the entity that holds the data, a grievance
 * officer a person can actually reach, and a postal address. None of those is derivable
 * from code — they are facts about a company. Everything else in the notice IS derivable,
 * and is written.
 *
 * So the page has two states and no third: fully published, or absent. If any required
 * fact is missing the route 404s, exactly as the admin panel and demo mode do when their
 * configuration is absent. A notice that says "grievance officer: TBD" is worse than no
 * notice at all — it is a document that looks like a legal commitment while failing the
 * one duty it exists to discharge, and it is the kind of thing that gets screenshotted.
 *
 * The day those four values are set, the notice and every link to it appear together.
 *
 * PURE ONLY — no database (RULES E2). The page is a server component but the gate is
 * also read by the layout to decide whether to render links.
 */

export type PrivacyContact = {
  /** The legal entity that is the Data Fiduciary — not the product name. */
  entityName: string;
  /** A named human, per DPDP Rules 2025. "Support team" does not satisfy it. */
  grievanceOfficer: string;
  grievanceEmail: string;
  /** Postal address of the entity. Required; an email alone does not satisfy the rule. */
  postalAddress: string;
};

export type PrivacyEnv = {
  entityName?: string;
  grievanceOfficer?: string;
  grievanceEmail?: string;
  postalAddress?: string;
};

const clean = (v: string | undefined): string => (v ?? "").trim();

/**
 * The four facts, or null.
 *
 * All-or-nothing on purpose: three out of four is still a notice that cannot be acted
 * on. Returning null is what makes the route 404 rather than publish a gap.
 */
export function privacyContact(env: PrivacyEnv): PrivacyContact | null {
  const entityName = clean(env.entityName);
  const grievanceOfficer = clean(env.grievanceOfficer);
  const grievanceEmail = clean(env.grievanceEmail);
  const postalAddress = clean(env.postalAddress);

  if (!entityName || !grievanceOfficer || !grievanceEmail || !postalAddress) return null;
  // A grievance address that cannot receive mail fails the duty as surely as a missing
  // one, and this is the cheapest possible check against a placeholder being deployed.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(grievanceEmail)) return null;
  if ([entityName, grievanceOfficer, postalAddress].some((value) => /^(tbd|todo|placeholder|to be (confirmed|provided))$/i.test(value))) return null;

  return { entityName, grievanceOfficer, grievanceEmail, postalAddress };
}

export function privacyEnv(): PrivacyEnv {
  return {
    entityName: process.env.PRIVACY_ENTITY_NAME,
    grievanceOfficer: process.env.PRIVACY_GRIEVANCE_OFFICER,
    grievanceEmail: process.env.PRIVACY_GRIEVANCE_EMAIL,
    postalAddress: process.env.PRIVACY_POSTAL_ADDRESS,
  };
}

/** Whether the notice exists in this deployment, for gating links to it. */
export function privacyNoticePublished(): boolean {
  return process.env.PRIVACY_NOTICE_APPROVED === "true" &&
    Boolean(process.env.PRIVACY_NOTICE_VERSION?.trim()) && privacyContact(privacyEnv()) !== null;
}

/*
 * The retention window the notice has to state as a number.
 *
 * RE-EXPORTED, not restated. The first draft wrote `= 180` as a fresh literal under a
 * comment claiming it was stated once, which would have made the notice a third
 * independent copy — and the copy that goes stale silently, because nothing else in the
 * suite compares a legal document to a purge job.
 *
 * `functions/src/index.ts` keeps its own `RETENTION_DAYS = 180` because Cloud Functions
 * are a separate package that cannot import from `src/`. That duplication is pre-existing
 * and pinned by the retention tests; this does not add a fourth.
 *
 * The report-link window is NOT re-exported here, deliberately. `@/lib/report` reaches
 * the Firestore admin client transitively, and pulling that into this module would make
 * the publication gate unimportable from anything a client component touches (RULES E2) —
 * the first attempt did exactly that and the unit suite failed on the admin boot guard.
 * The page is a server component and imports `REPORT_TTL_DAYS` straight from the source.
 */
export { RETENTION_DAYS as HEALTH_RETENTION_DAYS } from "@/modules/retention/model";
