export const MAX_HANDOFF_ATTEMPTS = 8;
export const INTEGRATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Origin only: navigation never carries a token, code, member ID or arbitrary path. */
export function clubNavigationUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return `${url.origin}/login`;
  } catch { return null; }
}

export function parseClubEnrollment(value: string, legacyClubId = ""): { clubId: string; code: string } | null {
  let clubId = legacyClubId.trim();
  let code = value.trim();
  if (code.startsWith("GL1.")) {
    if (code.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(code.slice(4))) return null;
    try {
      const decoded: unknown = JSON.parse(atob(code.slice(4).replace(/-/g, "+").replace(/_/g, "/")));
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
      const fields = decoded as Record<string, unknown>;
      if (Object.keys(fields).some((key) => key !== "clubId" && key !== "code") || typeof fields.clubId !== "string" || typeof fields.code !== "string") return null;
      clubId = fields.clubId;
      code = fields.code;
    } catch { return null; }
  }
  return INTEGRATION_ID.test(clubId) && /^[A-Za-z0-9_-]{20,128}$/.test(code) ? { clubId, code } : null;
}

export function mayStartHandoff(stage: string, existingStatus?: string): boolean {
  return existingStatus !== undefined || stage === "member";
}

/** User-facing messages omit server implementation codes and private match evidence. */
export function handoffMessage(status: string | undefined, error?: string): string {
  if (status === "SUCCEEDED") return "Added to Club. Your Club membership is ready; plans and payments are managed in Club.";
  if (status === "MANUAL_REVIEW_REQUIRED") return "The Club administrator needs to review this match. No new membership has been added.";
  if (status === "FAILED_FINAL") return "The Club could not complete this transfer. Ask the Club administrator for help.";
  if (status === "PENDING") return "Waiting for the Club to confirm. Retry safely to check the same transfer.";
  if (error === "MEMBER_STAGE_REQUIRED") return "Move this person to Member before adding them to Club.";
  if (error === "ACTIVE_DUAL_VERIFIED_LINK_REQUIRED") return "This Club link is no longer active. Check your linked Clubs in Settings.";
  if (error === "IDEMPOTENCY_CONFLICT") return "This transfer no longer matches the saved request. Ask the Club administrator to review it.";
  if (error === "NOT_AUTHENTICATED") return "Sign in again to continue.";
  return "Club transfer is unavailable right now. Check the connection and try again.";
}
