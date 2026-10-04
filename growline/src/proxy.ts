import { NextResponse, type NextRequest } from "next/server";
import { RESERVED_SLUGS } from "@/modules/portfolio/model";

// Cheap cookie-presence gate only. Real JWT verification lives in the
// authenticated layout and every API route (Next 16 auth-near-routes pattern).
const SESSION_COOKIE = "gl_session";
// /c/<code> is the prospect's self-fill form and /r/<token> is their wellness
// snapshot — both are opened by people with no account (F2 Mode B, F3/F4).
// `/demo` is public because it is reached BEFORE there is a session — it is the thing
// that creates one. It exists at all only when DEMO_MODE is set; the page itself calls
// notFound() otherwise, so listing it here does not open anything in production.
const PUBLIC_PATHS = [
  /^\/login$/,
  /^\/federation$/,
  /^\/join(\/|$)/,
  /^\/c(\/|$)/,
  /^\/r(\/|$)/,
  /^\/demo$/,
  // The privacy notice is read by prospects who have no account and never will —
  // it is linked from the QR form and from every report page. "privacy" is a
  // RESERVED_SLUG, so `isPortfolioPath` correctly refuses to treat it as a coach's
  // page, which means without this line it would redirect to /login: a legal notice
  // that exists, renders, and cannot be read by the people it was written for (D68).
  // It 404s of its own accord until the grievance details are configured.
  /^\/privacy$/,
  // The deployment's own health readout (D83). Public for the same D68 reason as
  // /privacy: "status" is a RESERVED_SLUG, so without this line the proxy would
  // bounce the one page built to explain production failures to /login — in
  // exactly the situations where nobody can log in.
  /^\/status$/,
];

/**
 * Is this a coach's public portfolio (F9)?
 *
 * Portfolios live at the ROOT — `growline.in/priyasharma` — because that URL gets
 * printed on posters and read down a phone. The cost lands here: this gate cannot tell
 * a coach's page from `/settings` by shape alone, and a rule as loose as "any single
 * segment is public" would unauthenticate every app route in one line.
 *
 * `RESERVED_SLUGS` is exactly the distinction, and it already exists for the other half
 * of the same problem — it is what stops a coach claiming a name a route would shadow.
 * Using it in both places means the two can never disagree, and the test that builds the
 * expected list by READING `src/app/` keeps it true as routes are added: a new
 * `src/app/pricing/` fails the suite until "pricing" is reserved, which is the same
 * moment it stops being publicly reachable here.
 *
 * Deliberately strict about shape. Only a lowercase single segment qualifies, so
 * `/Settings`, `/settings/x` and anything with a dot are never mistaken for a coach.
 *
 * Being "public" here only means the auth redirect is skipped. The page itself still
 * 404s unless the slug is claimed AND the coach published it.
 */
function isPortfolioPath(pathname: string): boolean {
  const m = /^\/([a-z0-9][a-z0-9-]*)$/.exec(pathname);
  return m !== null && !RESERVED_SLUGS.has(m[1]);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const isPublic =
    PUBLIC_PATHS.some((re) => re.test(pathname)) || isPortfolioPath(pathname);

  // Note: the snapshot HTML keeps Next's own `no-cache, must-revalidate` — Next
  // sets Cache-Control on dynamic page responses itself and overrides both this
  // proxy and next.config headers. Revalidation is enforced, but the response is
  // not marked `private`. The card/preview/PDF routes DO carry `private, no-store`
  // because a Route Handler controls its own headers. See DECISIONS.md D17.
  if (!hasSession && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  /**
   * `/login` is NOT redirected away when a cookie is present, deliberately.
   *
   * It used to be, and that turned a dead-but-present cookie into a redirect
   * loop. This gate can only see that a cookie EXISTS — verifying it needs the
   * Admin SDK, which cannot run here — so "has cookie" and "is signed in" are
   * different questions, and a revoked or expired session answers yes to the
   * first and no to the second. The cycle was:
   *
   *   /            -> layout cannot verify -> /api/auth/logout
   *   /api/auth/logout -> clears the cookie -> /login
   *   /login       -> cookie still on THIS request -> /
   *
   * and round again. Sending a signed-in coach from /login to home was a
   * convenience; bouncing a signed-out one between three routes is a lockout.
   * The authenticated layout is the only thing that can actually decide, so it
   * is the only thing that decides.
   */
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
