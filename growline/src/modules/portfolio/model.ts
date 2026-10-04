/**
 * The public portfolio (v1 §F9) — the page a prospect lands on from a wellness report.
 *
 * ## What this page is for
 *
 * It is the coach's first impression, and it is the only screen in Growline a prospect
 * ever sees on purpose. F3 calls the report a marketing asset; this is the other half of
 * it. A prospect who reads their numbers and wants to know who sent them arrives here.
 *
 * ## Why the slug is claimed the way a referral code is
 *
 * The URL gets printed. It rides on every report, it goes on a QR poster on a club wall,
 * and coaches read it out loud. That makes it the one identifier in the app that cannot
 * be reassigned later without breaking paper — so it is claimed transactionally through a
 * reservation document, the same shape D41 established for referral codes, and it is
 * never silently changed underneath somebody.
 *
 * ## PURE ONLY — no database import
 *
 * The editor is a client component (RULES E2).
 */

export const MIN_SLUG = 3;
export const MAX_SLUG = 30;
export const MAX_STORY = 600;
export const MAX_HEADLINE = 80;

/**
 * Slugs live at the root of the site, so every one of these would be shadowed by a real
 * route and the coach's printed link would quietly lead nowhere.
 *
 * Deliberately generous. It costs a coach nothing to pick a different name today; it
 * costs them a reprinted poster if a route added next month steals theirs. Everything the
 * app currently serves is here, plus the words a growing product reaches for — pricing,
 * help, blog, about — because the point is to block the route that does not exist yet.
 */
export const RESERVED_SLUGS = new Set([
  // Routes that exist today
  "api", "admin", "login", "logout", "demo", "join", "c", "r", "p", "federation",
  "settings", "team", "targets", "threads", "log", "prospects", "goals",
  "more", "workspace", "leaderboards", "qualifications", "duplication",
  "voice-log", "who-to-call", "portfolio", "plans", "wall", "status",
  // Next.js and web conventions
  "_next", "static", "public", "favicon", "robots", "sitemap", "manifest",
  "assets", "images", "icons", "fonts", "sw", "well-known",
  // Words a growing product takes
  "about", "blog", "help", "support", "pricing", "plans", "terms", "privacy",
  "legal", "contact", "careers", "press", "download", "app", "web", "home",
  "signup", "signin", "register", "account", "profile", "me", "user", "users",
  "dashboard", "search", "explore", "new", "edit", "delete", "invite",
  "refer", "share", "report", "reports", "billing", "upgrade", "subscribe",
  "growline", "realv", "official", "verified", "test", "null", "undefined",
]);

export type SlugCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates and normalises a slug.
 *
 * Lowercase letters, digits and single hyphens. Not because anything technical requires
 * it, but because this string is read out loud over a phone and typed by somebody who has
 * never seen it written. Mixed case and underscores lose that game.
 */
export function checkSlug(raw: unknown): SlugCheck {
  if (typeof raw !== "string") return { ok: false, error: "Pick a link name." };
  const value = raw.trim().toLowerCase();

  if (value.length === 0) return { ok: false, error: "Pick a link name." };
  if (value.length < MIN_SLUG) {
    return { ok: false, error: `A link name needs at least ${MIN_SLUG} letters.` };
  }
  if (value.length > MAX_SLUG) {
    return { ok: false, error: `Keep the link name under ${MAX_SLUG} letters.` };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    return {
      ok: false,
      error: "Use small letters, numbers and hyphens only — no spaces or symbols.",
    };
  }
  if (RESERVED_SLUGS.has(value)) {
    return { ok: false, error: "That name is taken by the app. Please pick another." };
  }
  return { ok: true, value };
}

/**
 * A first suggestion, from the coach's own name.
 *
 * Only ever a SUGGESTION shown in an editable field — never auto-claimed. Two coaches
 * named Priya Sharma would race for the same slug, and the loser would be told their own
 * name is taken by a claim they never made.
 */
export function suggestSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, MAX_SLUG)
    .replace(/^-+|-+$/g, "");
  // A name with no Latin characters at all — a coach who typed their name in Kannada —
  // leaves nothing to build on, and an empty suggestion is more honest than a random one.
  return base.length >= MIN_SLUG && !RESERVED_SLUGS.has(base) ? base : "";
}

export type Portfolio = {
  userId: string;
  slug: string;
  /** One line under the name. Their words, not a job title we supplied. */
  headline: string;
  story: string;
  /** Whether the page answers at all. A coach who has not written anything is not live. */
  published: boolean;
  isPro: boolean;
  updatedAt: Date | null;
};

export const EMPTY_PORTFOLIO: Omit<Portfolio, "userId" | "updatedAt"> = {
  slug: "",
  headline: "",
  story: "",
  published: false,
  isPro: false,
};

export type TextCheck = { ok: true; value: string } | { ok: false; error: string };

function checkText(raw: unknown, max: number, label: string): TextCheck {
  if (raw === undefined || raw === null) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, error: `Could not read your ${label}.` };
  const value = raw.trim();
  if (value.length > max) {
    return { ok: false, error: `Keep your ${label} under ${max} characters.` };
  }
  return { ok: true, value };
}

export const checkHeadline = (raw: unknown) => checkText(raw, MAX_HEADLINE, "headline");
export const checkStory = (raw: unknown) => checkText(raw, MAX_STORY, "story");

/**
 * Whether there is enough on the page to be worth showing a stranger.
 *
 * A slug alone renders a page with a name and two buttons, which is not a bad first
 * impression — but a coach should decide to publish rather than discover they already
 * have. `published` is the switch; this only decides whether to encourage it.
 */
export function readyToPublish(p: Pick<Portfolio, "slug" | "story">): boolean {
  return p.slug.length > 0 && p.story.trim().length > 0;
}

/** The public URL, for display and for the copy button. Never built by string-concat. */
export function portfolioUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/${slug}`;
}
