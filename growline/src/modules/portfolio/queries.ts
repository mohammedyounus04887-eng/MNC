import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { getUserById, type AppUser } from "@/lib/users";
import {
  EMPTY_PORTFOLIO,
  checkHeadline,
  checkSlug,
  checkStory,
  type Portfolio,
} from "./model";

/**
 * Server side of the public portfolio (F9).
 *
 * ## Two collections, and why the second one exists
 *
 *   portfolios/{userId}        the page. One per coach, keyed by uid, so a coach can no
 *                              more have two portfolios than they can have two accounts.
 *   portfolioSlugs/{slug}      the reservation. The SLUG IS THE DOCUMENT ID, which is what
 *                              makes claiming it atomic.
 *
 * Uniqueness cannot be a query. "Is this slug free?" followed by "write it" is two
 * operations, and two coaches typing the same name at a club launch both read "free" and
 * both write — D41 is the same lesson learned on referral codes, and the fix is the same:
 * the contended name is a document id, and `create()` on an existing id fails.
 *
 * ## Reads are server-only, so the rules stay deny-all
 *
 * The public page is server-rendered with the admin SDK. No browser ever queries
 * `portfolios` directly, so there is nothing to open up in `firestore.rules` and the
 * safest rule — the default deny — is also the correct one. A published page is public
 * because a server chose to render it, not because a collection is world-readable.
 */

export const PORTFOLIOS = "portfolios";
export const PORTFOLIO_SLUGS = "portfolioSlugs";

export const portfolios = () => db.collection(PORTFOLIOS);
export const portfolioSlugs = () => db.collection(PORTFOLIO_SLUGS);

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

function toPortfolio(userId: string, snap: DocumentSnapshot | null): Portfolio {
  const d = snap?.data();
  if (!d) return { userId, ...EMPTY_PORTFOLIO, updatedAt: null };
  return {
    userId,
    slug: (d.slug as string) ?? "",
    headline: (d.headline as string) ?? "",
    story: (d.story as string) ?? "",
    published: d.published === true,
    isPro: d.isPro === true,
    updatedAt: toDate(d.updatedAt),
  };
}

export async function getOwnPortfolio(userId: string): Promise<Portfolio> {
  return toPortfolio(userId, await portfolios().doc(userId).get());
}

export type PublicPortfolio = {
  portfolio: Portfolio;
  coach: Pick<AppUser, "id" | "name" | "photoUrl" | "city" | "referralCode">;
};

/**
 * The page a prospect sees.
 *
 * Returns null for an unclaimed slug AND for a claimed-but-unpublished one — the same
 * answer, deliberately. Distinguishing them would turn this into a directory of every
 * coach who has ever reserved a name, and "that page is not published yet" tells a
 * stranger something about somebody who chose not to be visible.
 */
export async function getPublicPortfolio(slug: string): Promise<PublicPortfolio | null> {
  const check = checkSlug(slug);
  // Format-check BEFORE any read. Slugs live at the root of the site, so every stray URL
  // in the app reaches this function; without this each one would cost a Firestore read.
  if (!check.ok) return null;

  const claim = await portfolioSlugs().doc(check.value).get();
  const userId = claim.data()?.userId as string | undefined;
  if (!userId) return null;

  const [portfolio, coach] = await Promise.all([
    getOwnPortfolio(userId),
    getUserById(userId),
  ]);

  if (!coach || !portfolio.published) return null;
  // A claim pointing at a slug the portfolio no longer uses is stale — serve nothing
  // rather than somebody's page under a name they gave up.
  if (portfolio.slug !== check.value) return null;

  return {
    portfolio,
    coach: {
      id: coach.id,
      name: coach.name,
      photoUrl: coach.photoUrl,
      city: coach.city,
      referralCode: coach.referralCode,
    },
  };
}

export type SaveResult = { ok: true; portfolio: Portfolio } | { ok: false; error: string };

/**
 * Saves whatever the coach edited. Partial, like the goal sheet: an absent key means
 * unchanged, never cleared.
 *
 * The slug is the only field that can fail for a reason outside the coach's control, so
 * it is handled first and on its own — there is no state in which the story saved and the
 * link name silently did not.
 */
export async function saveOwnPortfolio(
  userId: string,
  update: Partial<{
    slug: unknown;
    headline: unknown;
    story: unknown;
    published: unknown;
  }>
): Promise<SaveResult> {
  const fields: Record<string, unknown> = {};

  if (update.headline !== undefined) {
    const c = checkHeadline(update.headline);
    if (!c.ok) return { ok: false, error: c.error };
    fields.headline = c.value;
  }
  if (update.story !== undefined) {
    const c = checkStory(update.story);
    if (!c.ok) return { ok: false, error: c.error };
    fields.story = c.value;
  }
  if (update.published !== undefined) {
    // Strict boolean, no coercion — `Boolean("false")` is true, and publishing a page
    // the coach meant to keep private is the one mistake this field must not make.
    if (typeof update.published !== "boolean") {
      return { ok: false, error: "Could not save that setting." };
    }
    fields.published = update.published;
  }

  if (update.slug !== undefined) {
    const claimed = await claimSlug(userId, update.slug);
    if (!claimed.ok) return claimed;
    fields.slug = claimed.value;
  }

  if (Object.keys(fields).length > 0) {
    await portfolios()
      .doc(userId)
      .set({ ...fields, updatedAt: Timestamp.now() }, { merge: true });
  }

  return { ok: true, portfolio: await getOwnPortfolio(userId) };
}

type ClaimResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Takes a slug for this coach, releasing whichever one they held before.
 *
 * Both halves are in one transaction. Half of this — claiming the new name without
 * releasing the old — would leave a coach holding two names forever and slowly exhaust
 * the good ones; the other half would free a name that is still printed on a poster.
 *
 * Re-claiming a slug you already hold succeeds and does nothing. A coach who opens the
 * editor and presses save without touching the field must not be told their own link name
 * is taken.
 */
async function claimSlug(userId: string, raw: unknown): Promise<ClaimResult> {
  const check = checkSlug(raw);
  if (!check.ok) return check;
  const slug = check.value;

  try {
    await db.runTransaction(async (tx) => {
      const ref = portfolioSlugs().doc(slug);
      const existing = await tx.get(ref);

      if (existing.exists) {
        if (existing.data()?.userId === userId) return; // already theirs
        throw new Error("SLUG_TAKEN");
      }

      const current = (await tx.get(portfolios().doc(userId))).data()?.slug as
        | string
        | undefined;

      tx.create(ref, { userId, claimedAt: Timestamp.now() });
      if (current && current !== slug) tx.delete(portfolioSlugs().doc(current));
    });
  } catch (e) {
    if ((e as Error).message === "SLUG_TAKEN") {
      return { ok: false, error: "Somebody already has that link name. Try another." };
    }
    // A create() that lost the race throws ALREADY_EXISTS rather than our own error —
    // same outcome for the coach, and it is the case the transaction exists to catch.
    if (/ALREADY_EXISTS|already exists/i.test((e as Error).message)) {
      return { ok: false, error: "Somebody already has that link name. Try another." };
    }
    throw e;
  }

  return { ok: true, value: slug };
}

/** For the editor's live "is this free?" hint. Never the basis of a write — see D41. */
export async function isSlugFree(slug: string, forUserId: string): Promise<boolean> {
  const check = checkSlug(slug);
  if (!check.ok) return false;
  const snap = await portfolioSlugs().doc(check.value).get();
  return !snap.exists || snap.data()?.userId === forUserId;
}
