/**
 * Free text a coach types, checked before it is stored.
 *
 * ## Why `trim()` is not enough, and why this is not a regex literal
 *
 * `String.prototype.trim` follows the ECMAScript WhiteSpace definition, which
 * excludes U+200B..U+200D, U+2060 and U+FEFF. `src/lib/threads.ts` records what that
 * cost: a body of one zero-width space survived the trim and delivered a blank card,
 * plus a push notification, to an entire line. A qualification title has the same
 * shape of problem — a blank one names a thing nobody can identify, on a card their
 * whole line is looking at.
 *
 * The codepoints are listed as numbers rather than written into a character class,
 * for the reason that file gives: a class containing the actual characters is
 * invisible in the source, so nobody can review it and a careless paste changes what
 * it matches without showing a diff anyone can read.
 *
 * The stored string keeps its original characters. U+200D (zero-width joiner) is
 * meaningful in Devanagari and Kannada conjuncts and in emoji sequences, so
 * stripping it would corrupt legitimate Indic spelling to fix a blank-input bug.
 *
 * PURE — imported by client components. No database, no Node built-ins (E2).
 */

const INVISIBLE_CODEPOINTS = new Set([
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZERO WIDTH NON-JOINER
  0x200d, // ZERO WIDTH JOINER
  0x2060, // WORD JOINER
  0xfeff, // ZERO WIDTH NO-BREAK SPACE / BOM
]);

export function hasVisibleText(text: string): boolean {
  for (const ch of text) {
    if (INVISIBLE_CODEPOINTS.has(ch.codePointAt(0)!)) continue;
    if (/\s/.test(ch)) continue;
    return true;
  }
  return false;
}

export type TextCheck = { ok: true; value: string } | { ok: false; error: string };

export function checkText(
  raw: unknown,
  max: number,
  what: { empty: string; long: string }
): TextCheck {
  if (typeof raw !== "string") return { ok: false, error: what.empty };
  const value = raw.trim();
  if (!hasVisibleText(value)) return { ok: false, error: what.empty };
  if (value.length > max) return { ok: false, error: what.long };
  return { ok: true, value };
}
