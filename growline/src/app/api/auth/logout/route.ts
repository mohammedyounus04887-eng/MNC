import { NextResponse } from "next/server";
import { clearSessionCookie, endSession } from "@/lib/session";

/**
 * POST is the real logout — the coach pressed the button, so the session dies on
 * the Auth backend too (`endSession`), not only in this browser.
 *
 * GET clears the cookie and nothing else, on purpose. It is the loop-breaker the
 * authenticated layout redirects to when a cookie outlives the session behind it,
 * and a `SameSite=lax` cookie still rides along on a cross-site *top-level*
 * navigation — so revoking here would let any page on the internet sign a visiting
 * coach out of every device they own with one redirect. Clearing a cookie is a safe
 * thing for a GET to do; ending sessions is not.
 */
export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) {
    return NextResponse.json({ error: "Logout requires a same-origin request." }, { status: 403 });
  }
  if (!(await endSession())) {
    // The cookie is deliberately still set (see `endSession`), so this coach is
    // still logged in and the button keeps them here to try again.
    return NextResponse.json(
      { error: "Could not log out. Please try again." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}

// Stale cookie with an unverifiable session would otherwise loop between the
// proxy redirect and the layout redirect.
export async function GET(req: Request) {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", req.url));
}
