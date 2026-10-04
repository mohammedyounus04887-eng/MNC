import { NextResponse } from "next/server";
import { auth } from "@/lib/firebase-admin";
import { setSessionCookie } from "@/lib/session";
import { getUserById } from "@/lib/users";
import { demoRole, isDemoMode } from "@/lib/demo";

/**
 * Signs in as one of the seeded demo coaches, with no SMS.
 *
 * This mints a REAL session — custom token, ID token, session cookie — so every screen
 * afterwards is the actual product under the actual Security Rules. See lib/demo.ts for
 * why that matters more than a faster shortcut would.
 *
 * ## 404, not 403, when demo mode is off
 *
 * A 403 confirms the route exists. On the production deployment this endpoint should be
 * indistinguishable from a typo, so it answers exactly as any unknown path would.
 */
export async function POST(req: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  // The uid comes from the fixed table, never from the request — so even with demo mode
  // on, this cannot mint a session for an arbitrary account.
  const role = demoRole((body ?? {})?.role);
  if (!role) {
    return NextResponse.json({ error: "Unknown demo role." }, { status: 400 });
  }

  // The seed has to have been run. Saying so plainly beats a 500 two screens later,
  // because the person hitting this is usually about to start a demo.
  const user = await getUserById(role.uid);
  if (!user) {
    return NextResponse.json(
      {
        error:
          "Demo data is missing. Run `npm run db:seed` then `npm run migrate:firestore`.",
      },
      { status: 409 }
    );
  }

  /**
   * Custom token exchanged for an ID token, which is the only way to obtain the ID token
   * `createSessionCookie` requires without a real sign-in. Against the emulator the host
   * comes from the env; against a real project it is the public Identity Toolkit
   * endpoint and the browser API key, which is already public by design.
   */
  const customToken = await auth.createCustomToken(role.uid);
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "fake-api-key";
  const endpoint = emulator
    ? `http://${emulator}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${key}`
    : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${key}`;

  const exchange = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const exchanged = (await exchange.json().catch(() => null)) as { idToken?: string } | null;
  if (!exchange.ok || !exchanged?.idToken) {
    return NextResponse.json(
      { error: "Could not start the demo session." },
      { status: 502 }
    );
  }

  await setSessionCookie(exchanged.idToken);
  return NextResponse.json({ ok: true, role: role.key, name: user.name });
}
