import { LOG_FIELDS, MAX_COUNT, type DailyLogValues, type LogFieldKey } from "@/lib/daily-log";

/**
 * Turning a spoken sentence into the five counts (session 4, feature 1).
 *
 * PURE, and the testable core of the feature. Everything uncertain about speech is
 * pushed into here so the recorder component holds no judgement of its own, and so the
 * behaviour that matters — what happens when it mishears — is covered by unit tests
 * rather than by a microphone.
 *
 * ## The governing rule: never invent a number
 *
 * A parser that guesses is worse than no parser. These counts roll up to an upline,
 * feed the streak, and rank the boards; a fabricated "3 sessions" is a number the coach
 * will not recognise and cannot trace, and the moment that happens once they stop
 * trusting every other number the app shows them. So:
 *
 *   - Only digits and explicit English number words count. "a couple", "a few" and
 *     "some" are ignored — they are guesses wearing a number's clothes.
 *   - A keyword with no number nearby yields nothing, and is reported as heard-but-
 *     uncounted so the screen can say which one it could not make out.
 *   - Anything four digits or longer is discarded outright. Speech recognition renders
 *     years and phone numbers as digit runs, and "2026" is not twenty-six sessions.
 *   - Nothing is ever saved from this file. The coach sees every parsed number on a
 *     confirm screen and taps to accept it, so the parser's worst case is wasted taps
 *     rather than a wrong log.
 *
 * ## Why the LAST mention of a field wins
 *
 * "Five shakes — no, six shakes." In ten seconds of speech a repeat is far more likely
 * to be a correction than an addition, and summing would turn a self-correction into
 * eleven. Taking the last mention makes the obvious spoken repair work. A coach who
 * genuinely means to add fixes it on the confirm screen, where the number is already
 * in front of them.
 *
 * ## Language
 *
 * English number words only. This audience thinks in Kannada, Hindi and Marathi, and
 * v1 §8 parks localisation in Phase 2 — so the honest position is that the parser
 * understands one language today, the recorder says nothing about understanding any
 * other, and a note it cannot parse falls straight through to tap-in steppers with the
 * audio kept. Adding half-verified Hindi digits here would produce confident wrong
 * numbers, which is the one outcome the rule above forbids.
 */

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, nil: 0, none: 0, no: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * The words a coach actually says for each of F6's five counts.
 *
 * Deliberately plain (S6) and drawn from the labels already on the log form. No brand
 * or company vocabulary appears here or ever may (L1) — these are ordinary English
 * words for ordinary activities.
 */
const KEYWORDS: Record<LogFieldKey, string[]> = {
  servings: ["shake", "shakes", "serving", "servings", "served", "drinks", "drink"],
  memberships: ["member", "members", "membership", "memberships", "joined", "signup", "signups"],
  sessions: ["session", "sessions", "party", "parties", "class", "classes", "meeting", "meetings"],
  invites: ["invite", "invites", "invited", "invitation", "invitations", "inviting"],
  followupsDone: ["followup", "followups", "callback", "callbacks"],
};

/**
 * Multi-word phrases collapsed to a single token before matching.
 *
 * "Follow up" is two words to a speech recogniser and one idea to a coach. Longest
 * first, so "followed up with" does not get half-eaten by a shorter rule.
 */
const PHRASES: [RegExp, string][] = [
  [/\bfollow(?:ed)?[\s-]?ups?\b/g, "followup"],
  [/\bcall(?:ed)?[\s-]?backs?\b/g, "callback"],
  [/\bcalled\s+back\b/g, "callback"],
  [/\bsign(?:ed)?[\s-]?ups?\b/g, "signup"],
  [/\bnew\s+members?\b/g, "member"],
];

const FIELD_KEYS = LOG_FIELDS.map((f) => f.key);

/** Every keyword, mapped back to its field, for a single-pass lookup. */
const FIELD_BY_WORD = new Map<string, LogFieldKey>();
for (const key of FIELD_KEYS) {
  for (const word of KEYWORDS[key]) FIELD_BY_WORD.set(word, key);
}

/** How far back and forward a keyword will look for its number. */
const LOOK_BEHIND = 3;
const LOOK_AHEAD = 2;

export type ParseResult = {
  /** A complete set, zeros included — the confirm screen needs every field. */
  values: DailyLogValues;
  /** Fields a number was actually attached to. Everything else is a zero we assumed. */
  heard: LogFieldKey[];
  /** Fields the coach clearly mentioned but with no number the parser would accept. */
  mentionedWithoutNumber: LogFieldKey[];
  /** The cleaned text the parse ran against. Empty when there was nothing to parse. */
  normalised: string;
};

export const EMPTY_PARSE: ParseResult = {
  values: {
    servings: 0,
    memberships: 0,
    sessions: 0,
    invites: 0,
    followupsDone: 0,
    note: null,
  },
  heard: [],
  mentionedWithoutNumber: [],
  normalised: "",
};

/** Lowercase, collapse the multi-word phrases, then strip everything but words and digits. */
export function normalise(transcript: string): string {
  let text = transcript.toLowerCase();
  for (const [pattern, replacement] of PHRASES) text = text.replace(pattern, replacement);
  return text.replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A token's numeric value, or null when it is not a number we will trust.
 *
 * Four digits or more is rejected rather than clamped: a clamp would turn a spoken
 * year into 999 shakes, which is a fabricated number with a straight face.
 */
function numberOf(token: string): number | null {
  if (/^\d+$/.test(token)) {
    if (token.length >= 4) return null;
    const n = Number(token);
    return n <= MAX_COUNT ? n : null;
  }
  const word = NUMBER_WORDS[token];
  return word === undefined ? null : word;
}

/**
 * Parses a transcript into counts.
 *
 * Returns zeros and an empty `heard` when nothing could be understood — which is a
 * real answer, not a failure, and the recorder renders it as "tap them in" rather
 * than as an error.
 */
export function parseSpokenLog(transcript: string | null | undefined): ParseResult {
  const normalised = normalise(transcript ?? "");
  if (!normalised) return { ...EMPTY_PARSE, values: { ...EMPTY_PARSE.values } };

  const tokens = normalised.split(" ");
  const numbers = tokens.map(numberOf);

  const values: DailyLogValues = { ...EMPTY_PARSE.values };
  const heard = new Set<LogFieldKey>();
  const mentioned = new Set<LogFieldKey>();

  // Indices already spent, so "five shakes five invites" cannot hand the same five to
  // both fields — the second keyword must find its own number or go uncounted.
  const used = new Set<number>();

  for (let i = 0; i < tokens.length; i++) {
    const field = FIELD_BY_WORD.get(tokens[i]);
    if (!field) continue;
    mentioned.add(field);

    let found: number | null = null;

    // Behind first: "five shakes" is how people speak. Nearest wins.
    for (let j = i - 1; j >= Math.max(0, i - LOOK_BEHIND); j--) {
      if (used.has(j)) continue;
      const n = numbers[j];
      if (n !== null) {
        found = n;
        used.add(j);
        break;
      }
      // Another keyword between us and the number means that number belongs to it.
      if (FIELD_BY_WORD.has(tokens[j])) break;
    }

    if (found === null) {
      for (let j = i + 1; j <= Math.min(tokens.length - 1, i + LOOK_AHEAD); j++) {
        if (used.has(j)) continue;
        const n = numbers[j];
        if (n !== null) {
          found = n;
          used.add(j);
          break;
        }
        if (FIELD_BY_WORD.has(tokens[j])) break;
      }
    }

    if (found === null) continue;

    // Last mention wins — a spoken repeat is a correction, not a sum.
    values[field] = found;
    heard.add(field);
  }

  return {
    values,
    heard: FIELD_KEYS.filter((k) => heard.has(k)),
    mentionedWithoutNumber: FIELD_KEYS.filter((k) => mentioned.has(k) && !heard.has(k)),
    normalised,
  };
}

/**
 * "5 shakes, 2 invites" — what the confirm screen says it heard, in the coach's words.
 *
 * Built from the parse rather than from the transcript, so it describes what will
 * actually be saved. A summary quoting speech the parser did not use would tell the
 * coach the app understood something it did not.
 */
export function describeHeard(result: ParseResult): string {
  if (result.heard.length === 0) return "";
  return result.heard
    .map((key) => {
      const label = LOG_FIELDS.find((f) => f.key === key)!.label.toLowerCase();
      return `${result.values[key]} ${label}`;
    })
    .join(", ");
}
