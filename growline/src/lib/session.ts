import { cookies } from "next/headers";
import { cache } from "react";
import { auth, db } from "./firebase-admin";
import { requireFederationSession } from "./integration/federation-service";
import { growlineFederationService } from "./integration/federation-runtime";
import { getUserById, type AppUser } from "./users";

/**
 * Sessions, on Firebase Auth.
 *
 * Replaces the custom HS256 JWT from DECISIONS.md D2. The *shape* is unchanged
 * on purpose — one httpOnly cookie, a cheap presence check in `proxy.ts`, real
 * verification in the authenticated layout and every API route — so route
 * protection behaves exactly as it did and only the verification swaps.
 *
 * A Firebase ID token lives about an hour, which is useless for a coach who opens
 * the app twice a week. So the browser trades its ID token for a **session
 * cookie** (`createSessionCookie`), which Firebase issues for up to 14 days and
 * which can be checked against revocation server-side.
 *
 * ## Why signup tokens are gone
 *
 * D2 minted a 20-minute "signup" JWT to carry a verified phone through profile
 * setup. Firebase already issues exactly that artifact — an ID token proving this
 * person controls this number — so `verifyPhoneToken` replaces it.
 *
 * The session cookie is deliberately NOT set until the user document exists.
 * Otherwise a half-signed-up user would hold a valid session with no profile, and
 * the authenticated layout — which redirects to logout when `getSessionUser()`
 * returns null — would throw them straight back out of signup.
 */

export const SESSION_COOKIE = "gl_session";

// Firebase caps session cookies at 14 days. D2 used 30; this is the ceiling the
// platform allows, and the user re-verifies by SMS after it, which is the point.
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;

export async function setSessionCookie(idToken: string) {
  const cookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MS });
  const store = await cookies();
  store.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Ends the session for real: revokes on the Auth backend, then drops the cookie.
 *
 * Deleting the cookie only stops *this* browser from sending it again. A session
 * cookie is a signed JWT, not a row we can delete, so a copy taken off a shared
 * phone before the logout stays valid for the rest of its 14 days — precisely the
 * window a logout exists to close. `revokeRefreshTokens` stamps
 * `tokensValidAfterTime` on the Auth user, and the `checkRevoked` verification
 * below then refuses every cookie whose `auth_time` predates the stamp. That flag
 * was doing half a job until something finally set the stamp.
 *
 * Firebase revocation is per-user, so this also signs the coach out of the phone
 * in their pocket, not just the club laptop they are standing at. Deliberate, with
 * the reasoning under "Logout revokes on the Auth backend" in DECISIONS.md — and
 * the button says so in plain words.
 *
 * Order matters. The cookie is the only thing that still names the uid, so it
 * stays put when the revoke fails; dropping it would turn the coach's retry into a
 * silent no-op while their other devices stayed signed in. Returns false in that
 * case so the caller keeps them on the screen instead of showing a login page.
 */
export async function endSession(): Promise<boolean> {
  const uid = await getSessionUserId();

  // Nothing verifiable behind this cookie — expired, already revoked, or never
  // valid. Clearing it is still right, and revoking on an *unverified* uid would
  // let a replayed dead cookie sign a coach out of their live devices.
  if (!uid) {
    // A revoked cookie may retry only existing durable logout delivery. It cannot create new revocations.
    const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
    if (cookie) {
      let previous: Awaited<ReturnType<typeof auth.verifySessionCookie>> | null = null;
      try {
        previous = await auth.verifySessionCookie(cookie, false);
      } catch { /* Unverifiable cookies carry no authority. */ }
      if (previous) {
        try {
          const result = await growlineFederationService().flush(previous.uid);
          if (result.propagated !== true) return false;
        } catch { return false; }
      }
    }
    await clearSessionCookie();
    return true;
  }

  try {
    const federation = await growlineFederationService().invalidate(uid, "logout");
    if (federation.propagated !== true) return false;
    await auth.revokeRefreshTokens(uid);
  } catch {
    return false;
  }
  await clearSessionCookie();
  return true;
}

export async function getSessionUserId(): Promise<string | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    // checkRevoked costs one Identity Toolkit round trip per protected request.
    // It buys two things, and both are worth it: a disabled account stops working
    // immediately, and so does a logged-out one (`endSession`) instead of living
    // out its 14 days. Cache the answer and the TTL becomes the exact length of
    // time a revoked cookie keeps working — read the logout decision in
    // DECISIONS.md before trying it.
    const decoded = await auth.verifySessionCookie(cookie, true);
    await requireFederationSession(db, decoded);
    return decoded.uid;
  } catch {
    return null;
  }
}

/** Per-request cached: layout + page can both call this with one read. */
export const getSessionUser = cache(async (): Promise<AppUser | null> => {
  const uid = await getSessionUserId();
  if (!uid) return null;
  return getUserById(uid);
});

/**
 * Verifies a freshly-minted ID token from the sign-in flow.
 *
 * Returns the uid plus whichever verified identifier the token carries. The uid
 * becomes the user document id (D34). A phone in the token is trusted because
 * Firebase verified it over SMS; an email is trusted as the sign-in identity the
 * password proved (D82). A token carrying NEITHER identifies nobody we can
 * attach a coach record to — anonymous auth, for instance — and is refused.
 *
 * The phone-only shape this replaces meant an email token failed with "could not
 * be verified", which read as an outage rather than a policy.
 */
export async function verifyAuthToken(
  idToken: string
): Promise<{ uid: string; phone: string | null; email: string | null } | null> {
  try {
    const decoded = await auth.verifyIdToken(idToken, true);
    await requireFederationSession(db, decoded);
    const phone = decoded.phone_number ?? null;
    const email = decoded.email ?? null;
    if (!phone && !email) return null;
    return { uid: decoded.uid, phone, email };
  } catch {
    return null;
  }
}
