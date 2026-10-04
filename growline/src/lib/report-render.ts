import { cache } from "react";
import { getReportByToken } from "./reports";
import { getProspectById } from "./prospects";
import { getUserById } from "./users";
import { isValidReportToken } from "./report-token";
import { isReportExpired, parseSnapshot, type ReportSnapshot } from "./report";

export type LoadedReport = {
  id: string;
  token: string;
  snapshot: ReportSnapshot;
  firstName: string;
  prospectId: string;
  coachId: string;
  coach: {
    name: string;
    photoUrl: string | null;
    city: string | null;
    phone: string;
  };
};

/**
 * Shared loader for every public report surface (page, PNG, preview, PDF) so the
 * token check, the expiry check and the first-name-only rule can never drift
 * apart between them.
 */
export const loadReportForRender = cache(
  async (token: string): Promise<LoadedReport | null> => {
    if (!isValidReportToken(token)) return null;
    const row = await getReportByToken(token);
    if (!row) return null;

    // Firestore has no joins. `coachId` is denormalised onto the report, so the
    // prospect and the coach load in parallel rather than in a chain — this path
    // serves every public surface (page, PNG, preview, PDF) and is the one a
    // prospect waits on over a weak connection.
    const [prospect, coach] = await Promise.all([
      getProspectById(row.prospectId),
      row.coachId ? getUserById(row.coachId) : Promise.resolve(null),
    ]);
    if (!prospect || !coach) return null;

    if (isReportExpired(row.createdAt)) return null;
    const snapshot = parseSnapshot(row.metricsJson);
    if (!snapshot) return null;

    return {
      id: row.id,
      token: row.token,
      snapshot,
      // First name only: these images end up in group chats.
      firstName: prospect.name.trim().split(/\s+/)[0],
      prospectId: prospect.id,
      coachId: prospect.coachId,
      coach: {
        name: coach.name,
        photoUrl: coach.photoUrl,
        city: coach.city,
        phone: coach.phone,
      },
    };
  }
);
