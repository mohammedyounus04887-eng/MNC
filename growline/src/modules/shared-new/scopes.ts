/**
 * Scopes — the four groups a board (and, later, a qualification) can be drawn for.
 *
 * Pure: it takes plain fields rather than an `AppUser`, so a client component can
 * import it without dragging `@/lib/users` — and therefore `firebase-admin` — into
 * the browser bundle. That is E2's rule with a different driver.
 *
 * ## The four, and where each one comes from
 *
 *   org    the whole organisation. Keyed by the ROOT of the tree the coach sits in —
 *          the last entry of `uplinePath` (D36), or their own id if they are a root.
 *          Not "every user of Growline": two unrelated clubs on the same install are
 *          not one organisation, and a board that mixes them is meaningless to both.
 *
 *   line   the team a coach experiences as theirs: their direct upline and everyone
 *          below that upline. Keyed by the upline's id. A root coach's line is their
 *          own. Deliberately NOT "every ancestor's line" — a coach belongs to as many
 *          lines as they have ancestors, and offering eight of them in a filter is
 *          the opposite of the 30-second rule.
 *
 *   level  coaches carrying the same level name. Level names are FREE TEXT typed by
 *          the coach (D29, RULES L8): this module ships no names, no placeholders and
 *          no suggestion list, and a coach with no level name simply has no level
 *          scope. The groups that exist are exactly the ones people have typed.
 *
 *   club   the coaches a person actually shows up with. There is no club entity in
 *          the data model yet (F12 lists clubs/cohorts as unbuilt admin work), and
 *          this module is not allowed to invent a collection for one, so it is keyed
 *          on `city` — the only signal we hold for "who is near me". The UI says "My
 *          city" rather than "My club" because that is what it honestly is. When a
 *          club entity lands, only `scopeKeyFor` and the rule change.
 *
 * ## Normalisation
 *
 * `trim().toLowerCase()` and nothing else. It has to be reproducible in Security
 * Rules, which have `trim()` and `lower()` — so a rule can prove membership without
 * trusting the client. Anything cleverer (collapsing inner whitespace, stripping
 * punctuation) could not be restated there, and a membership check the rules cannot
 * express is a membership check that is not enforced.
 */

export const SCOPE_TYPES = ["org", "line", "level", "club"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export function isScopeType(v: string): v is ScopeType {
  return (SCOPE_TYPES as readonly string[]).includes(v);
}

/** The fields any scope decision needs. A subset of the user document, by design. */
export type ScopeSubject = {
  id: string;
  name: string;
  uplineId: string | null;
  uplinePath: string[];
  levelName: string | null;
  city: string | null;
};

export type Scope = {
  type: ScopeType;
  /** Stable identity of the group: a uid, or a normalised free-text label. */
  key: string;
  /** What to call it on screen. Never a rank name we invented (L8). */
  label: string;
};

export function normaliseScopeKey(value: string): string {
  return value.trim().toLowerCase();
}

/** The organisation root a coach belongs to. Their own id if they are the root. */
export function orgRootId(u: ScopeSubject): string {
  return u.uplinePath.length > 0 ? u.uplinePath[u.uplinePath.length - 1] : u.id;
}

/** The line a coach belongs to: their upline's, or their own if they are a root. */
export function lineOwnerId(u: ScopeSubject): string {
  return u.uplineId ?? u.id;
}

/**
 * The scope of a given type this coach belongs to, or null when they have none.
 *
 * Null is a real answer and the screen must teach rather than show an empty
 * dropdown: a coach who has never typed a level name has no level scope, and that
 * is a thing to explain, not an option to grey out.
 */
export function scopeFor(type: ScopeType, u: ScopeSubject): Scope | null {
  switch (type) {
    case "org":
      return { type, key: orgRootId(u), label: "Everyone" };
    case "line":
      return { type, key: lineOwnerId(u), label: "My team" };
    case "level": {
      const raw = u.levelName?.trim();
      if (!raw) return null;
      return { type, key: normaliseScopeKey(raw), label: raw };
    }
    case "club": {
      const raw = u.city?.trim();
      if (!raw) return null;
      return { type, key: normaliseScopeKey(raw), label: raw };
    }
  }
}

/** Is this coach inside the named scope? The app-side copy of the Security Rule. */
export function isInScope(scope: Scope, u: ScopeSubject): boolean {
  switch (scope.type) {
    case "org":
      return orgRootId(u) === scope.key;
    case "line":
      // Their own line, or the line of any ancestor — membership is broader than
      // `scopeFor` offers, so a coach can read a board their upline is shown.
      return u.id === scope.key || u.uplinePath.includes(scope.key);
    case "level":
      return !!u.levelName && normaliseScopeKey(u.levelName) === scope.key;
    case "club":
      return !!u.city && normaliseScopeKey(u.city) === scope.key;
  }
}

/** Everyone in `people` who belongs to `scope`. */
export function membersOf(scope: Scope, people: ScopeSubject[]): ScopeSubject[] {
  return people.filter((p) => isInScope(scope, p));
}
