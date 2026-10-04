import { NextResponse } from "next/server";
import { setSessionCookie, verifyAuthToken } from "@/lib/session";
import { getUserById } from "@/lib/users";

/**
 * Trades a verified Firebase ID token for a session cookie.
 *
 * Replaces POST /api/auth/verify-otp. Firebase has already verified the SMS code
 * (or the email password, D82) by the time this is called, so there is nothing to
 * check here — only a token signature, which is what makes the custom OTP table
 * redundant.
 *
 * For a brand-new number the Firebase Auth user now exists but the user document
 * does not. No session cookie is issued in that case: the client keeps the ID
 * token and presents it to /api/auth/complete-signup, so a half-signed-up user is
 * never holding a session with no profile behind it.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  if (!idToken) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  const verified = await verifyAuthToken(idToken);
  if (!verified) {
    return NextResponse.json(
      { error: "That sign-in could not be verified. Please try again." },
      { status: 401 }
    );
  }

  const user = await getUserById(verified.uid);
  if (!user) return NextResponse.json({ isNewUser: true });

  await setSessionCookie(idToken);
  return NextResponse.json({ isNewUser: false });
}
