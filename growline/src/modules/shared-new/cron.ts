/**
 * The guard on every scheduler-called route in these modules.
 *
 * One copy, used by every scheduler-called route. `/api/leaderboards/rebuild` and
 * `/api/notifications/daily` each carried their own inline duplicate — this file's
 * original note said a check living in three places is a check that will be fixed in
 * two of them, and then left the other two alone because they belonged to merged work.
 * They were folded in on 2026-08-19, so there is now exactly one implementation.
 *
 * NOT the same thing as the Razorpay webhook's signature check, which compares an HMAC
 * with `node:crypto`'s `timingSafeEqual` over buffers. That one verifies a signature
 * over a body; this one compares a shared secret. Merging them would be a coincidence of
 * shape, not of purpose.
 *
 * FAILS CLOSED with no secret configured. These endpoints are not a data leak, but
 * each one makes the server read a large slice of the organisation on demand, as
 * often as anybody likes.
 */

export type CronCheck = { ok: true } | { ok: false; status: number; error: string };

/** Constant time, so the secret cannot be probed a character at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkCronSecret(req: Request, what: string): CronCheck {
  if (process.env.GROWLINE_JOBS_ENABLED !== "true") {
    return { ok: false, status: 503, error: `${what} are disabled on this server.` };
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) {
    return {
      ok: false,
      status: 503,
      error: `${what} are not configured on this server.`,
    };
  }
  const header =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-cron-secret") ??
    "";
  if (!timingSafeEqual(header, secret)) {
    return { ok: false, status: 401, error: "Not allowed" };
  }
  return { ok: true };
}
