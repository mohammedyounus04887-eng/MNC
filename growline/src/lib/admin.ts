/**
 * Who may open the admin panel (F12).
 *
 * ## An environment variable, not a database flag
 *
 * A Firestore `admins/{uid}` document would be more convenient — add an admin without a
 * deploy. That convenience is the reason not to do it: it makes "who can see every
 * coach's data" writable by anything that can write to the database, and it makes an
 * admin promotion invisible in version control. An env allowlist means becoming an admin
 * requires a deployment, reviewed by whoever does deployments. That friction is the
 * feature.
 *
 * There will be one to three admins. The operational cost is nil.
 *
 * ## The rule that governs everything in the panel
 *
 * **No prospect names and no prospect phone numbers, anywhere, ever.** Counts only.
 *
 * The whole F11 model — the toggle, the Security Rules, D48's closing of the users
 * collection — exists so that a coach's prospects stay theirs. An admin screen listing
 * prospect identities would be a second, unlogged path around all of it, available to
 * whoever holds the deploy key. The panel exists to answer "is the business working",
 * and that question is answered entirely by counts.
 *
 * Support requests are the obvious pressure on this rule ("a coach asked us to find
 * their prospect"). The answer is that the coach has the data on their own screen; we do
 * not need a copy, and having one makes us a target.
 */

/** Uids from `ADMIN_UIDS`, comma-separated. Blank in every environment by default. */
function allowlist(): string[] {
  return (process.env.ADMIN_UIDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isAdmin(uid: string | null | undefined): boolean {
  if (!uid) return false;
  const allowed = allowlist();
  // An empty allowlist grants nothing. Stated explicitly because the alternative — an
  // unset variable meaning "everybody is an admin" — is the kind of default that ships.
  if (allowed.length === 0) return false;
  return allowed.includes(uid);
}

/** Whether an admin panel exists at all in this deployment, for the 404 gate. */
export function adminEnabled(): boolean {
  return allowlist().length > 0;
}
