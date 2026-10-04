import { NextResponse } from "next/server";
import { setSessionCookie, verifyAuthToken } from "@/lib/session";
import { createUser, getUserByPhone, getUserById, getUserByReferralCode } from "@/lib/users";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  // The ID token replaces D2's short-lived signup JWT: same job — carrying a
  // verified phone through profile setup — but minted and signed by Firebase.
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  const verified = idToken ? await verifyAuthToken(idToken) : null;
  if (!verified) {
    return NextResponse.json(
      { error: "Your session expired. Please sign in again." },
      { status: 401 }
    );
  }
  const { uid } = verified;

  /**
   * The coach's contact number, which every report, portfolio and WhatsApp link
   * prints — signing in with an email does not remove the product's need for it.
   *
   * A phone-auth token carries a number Firebase verified over SMS; that one wins
   * unconditionally. An email token (D82) carries none, so the number comes from
   * the form instead — UNVERIFIED, and accepted anyway: the interim trade is
   * "coach can exist" over "number is proven", and the uniqueness guard below
   * still stops two accounts claiming the same number. When OTP returns, numbers
   * entered this way can be verified without any schema change.
   */
  let phone = verified.phone;
  if (!phone) {
    const digits = String(body?.phone ?? "")
      .replace(/\D/g, "")
      .replace(/^91(?=\d{10}$)/, "")
      .replace(/^0(?=\d{10}$)/, "");
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return NextResponse.json(
        { error: "Please enter your 10-digit mobile number." },
        { status: 400 }
      );
    }
    phone = `+91${digits}`;
  }

  const name = String(body?.name ?? "").trim();
  const city = String(body?.city ?? "").trim();
  const rawPhoto = typeof body?.photoUrl === "string" ? body.photoUrl : "";
  const photoUrl =
    rawPhoto.startsWith("data:image/") && rawPhoto.length < 200_000 ? rawPhoto : null;
  const refInput = String(body?.referralCode ?? "").trim().toUpperCase();

  if (name.length < 2 || name.length > 60) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (city.length < 2 || city.length > 60) {
    return NextResponse.json({ error: "Please enter your city." }, { status: 400 });
  }

  const upline = refInput ? await getUserByReferralCode(refInput) : null;
  if (refInput && !upline) {
    return NextResponse.json(
      { error: "That referral code doesn't match any coach. Check it or leave it empty." },
      { status: 400 }
    );
  }

  // Two guards, not one. The uid check catches a double submit of this form; the
  // phone check catches a number that already has an account under a different
  // uid — which is what a migrated user hitting signup instead of login looks like.
  if (await getUserById(uid)) {
    return NextResponse.json({ error: "This account already exists. Log in instead." }, { status: 409 });
  }
  if (await getUserByPhone(phone)) {
    return NextResponse.json(
      { error: "This number already has an account. Log in instead." },
      { status: 409 }
    );
  }

  try {
    await createUser({ uid, phone, name, city, photoUrl, upline });
  } catch (error) {
    if (error instanceof Error && error.message === "SPONSOR_WORKSPACE_REQUIRED") {
      return NextResponse.json({ error: "This sponsor's workspace is unavailable. Ask your sponsor to contact the administrator." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "USER_ALREADY_EXISTS") {
      return NextResponse.json({ error: "This account already exists. Log in instead." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "PHONE_ALREADY_EXISTS") {
      return NextResponse.json(
        { error: "This number already has an account. Log in instead." },
        { status: 409 }
      );
    }
    throw error;
  }
  await setSessionCookie(idToken);
  return NextResponse.json({ ok: true });
}
