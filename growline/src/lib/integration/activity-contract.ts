import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export type ClubActivityRequest = {
  schemaVersion: 1; clubId: string; from: string; to: string;
  coaches: Array<{ linkId: string; workspaceId: string; growlineAuthUid: string }>;
};
export type CoachActivity = { linkId: string; displayName: string; logs: number; peopleMet: number; membersConverted: number };
const only = (value: Record<string, unknown>, fields: string[]) => Object.keys(value).every((field) => fields.includes(field));

export function validateClubActivityRequest(value: unknown, today: string): ClubActivityRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_ACTIVITY_REQUEST");
  const body = value as Record<string, unknown>;
  const validDay = (day: unknown): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  if (!only(body, ["schemaVersion", "clubId", "from", "to", "coaches"]) || body.schemaVersion !== 1 || typeof body.clubId !== "string" || !id.test(body.clubId) ||
      !validDay(body.from) || !validDay(body.to) || body.from > body.to || body.to > today || (Date.parse(body.to) - Date.parse(body.from)) / 86_400_000 >= 31 ||
      !Array.isArray(body.coaches) || body.coaches.length > 25) throw new Error("INVALID_ACTIVITY_REQUEST");
  const seen = new Set<string>();
  for (const value of body.coaches) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_ACTIVITY_REQUEST");
    const coach = value as Record<string, unknown>;
    if (!only(coach, ["linkId", "workspaceId", "growlineAuthUid"]) || [coach.linkId, coach.workspaceId, coach.growlineAuthUid].some((entry) => typeof entry !== "string" || !id.test(entry)) || seen.has(String(coach.linkId))) throw new Error("INVALID_ACTIVITY_REQUEST");
    seen.add(String(coach.linkId));
  }
  return body as ClubActivityRequest;
}

export function verifyClubActivityAssertion(authorization: string | null, body: ClubActivityRequest, config: {
  audience: string; clubProject: string; growlineProject: string; keyId: string; secret: string;
}, nowSeconds = Math.floor(Date.now() / 1000)): { clubAuthUid: string } {
  if (!config.audience || !config.clubProject || !config.growlineProject || !id.test(config.keyId) || config.secret.length < 32) throw new Error("ACTIVITY_CONFIGURATION_UNAVAILABLE");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 4096) throw new Error("UNAUTHORIZED_CLUB_SERVICE");
  const parts = authorization.slice(7).split(".");
  if (parts.length !== 3) throw new Error("UNAUTHORIZED_CLUB_SERVICE");
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try { header = JSON.parse(Buffer.from(parts[0], "base64url").toString()); claims = JSON.parse(Buffer.from(parts[1], "base64url").toString()); }
  catch { throw new Error("UNAUTHORIZED_CLUB_SERVICE"); }
  if (!header || !claims || header.alg !== "HS256" || header.typ !== "JWT" || claims.iss !== "club-service" || claims.aud !== config.audience ||
      claims.clubProject !== config.clubProject || claims.growlineProject !== config.growlineProject || claims.kid !== config.keyId ||
      typeof claims.clubAuthUid !== "string" || !id.test(claims.clubAuthUid) || typeof claims.iat !== "number" || typeof claims.exp !== "number" ||
      !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > nowSeconds || claims.exp <= nowSeconds || claims.exp - claims.iat > 120 ||
      claims.requestHash !== createHash("sha256").update(JSON.stringify(body)).digest("hex")) throw new Error("UNAUTHORIZED_CLUB_SERVICE");
  const expected = createHmac("sha256", config.secret).update(`${parts[0]}.${parts[1]}`).digest();
  const supplied = Buffer.from(parts[2], "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("UNAUTHORIZED_CLUB_SERVICE");
  return { clubAuthUid: claims.clubAuthUid };
}

/** Historical unscoped log rows are excluded; a workspace move cannot relabel them. */
export function summarizeApprovedLogs(rows: Array<Record<string, unknown>>, userId: string, workspaceId: string, from: string, to: string) {
  const eligible = rows.filter((row) => row.userId === userId && row.workspaceId === workspaceId && typeof row.dayKey === "string" && row.dayKey >= from && row.dayKey <= to);
  return { logs: eligible.length, membersConverted: eligible.reduce((sum, row) => sum + (typeof row.memberships === "number" && Number.isInteger(row.memberships) && row.memberships >= 0 && row.memberships <= 999 ? row.memberships : 0), 0) };
}

export function activeApprovedRelationship(link: Record<string, unknown> | undefined, user: Record<string, unknown> | undefined, coach: ClubActivityRequest["coaches"][number], clubId: string, clubProject: string, growlineProject: string): boolean {
  return !!link && !!user && link.status === "active" && link.clubId === clubId && link.clubProject === clubProject && link.growlineProject === growlineProject &&
    link.linkId === coach.linkId && link.workspaceId === coach.workspaceId && link.growlineAuthUid === coach.growlineAuthUid && user.workspaceId === coach.workspaceId &&
    link.verificationMethod === "dual_authenticated_consent" && link.activitySharingEnabled === true && typeof link.activityDisplayName === "string" &&
    link.activityDisplayName.trim().length > 0 && link.activityDisplayName.length <= 100 && user.disabled !== true;
}
