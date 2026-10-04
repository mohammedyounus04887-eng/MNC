/**
 * English — the SOURCE dictionary. Every other language is typed against this one, so
 * `tsc` refuses a translation with a missing or misspelled key. That is the whole
 * reason the shape is a flat object of literal strings rather than nested objects: a
 * flat key is unambiguous to a translator and exact to the compiler.
 *
 * ## Rules that apply to every string in here
 *
 * - Simple words (v1 §4.6 / RULES S6). "My Team", "Today's Work", "New Person" — never
 *   "CRM", "pipeline", "engagement". This audience's English is functional, and the
 *   translations are read by people whose English is not the point at all.
 * - No income wording anywhere (RULES L4). Not in a label, not in a celebration.
 * - No company or rank names (RULES L1).
 * - Keep them SHORT. A Kannada or Tamil rendering of an English phrase is routinely
 *   40% longer, and these sit in a five-item bottom nav on a 360px screen.
 *
 * Placeholders use `{name}` style and are substituted by `t()`. A translator must keep
 * the braces and the name inside them exactly; the words around them may move anywhere
 * the target language needs, which is the point of naming them rather than using %s.
 */

const en = {
  // Bottom navigation — on every screen, so the highest-value strings in the app.
  "nav.home": "Home",
  "nav.prospects": "Prospects",
  "nav.log": "Log",
  "nav.team": "Team",
  "nav.threads": "Threads",
  "nav.settings": "Settings",

  // Settings — the language section, which has to be findable by someone who cannot
  // read the rest of the screen.
  "settings.language.title": "Language",
  "settings.language.help": "Choose the language you read most easily.",
  "settings.language.saving": "Saving…",
  "settings.language.error": "Could not change the language. Please try again.",
  "settings.language.reportNote":
    "Wellness reports stay in English for now, so they print correctly.",

  // Log screen.
  "log.title": "Today's Work",
  "log.streakDays": "{days}-day streak",

  // Prospects.
  "prospects.title": "Prospects",
  "prospects.search": "Search by name or number",
  "prospects.all": "All",
  "prospects.myQr": "My QR code",
  "prospects.addFirst": "Add first person",
  "prospects.newPerson": "New Person",

  // Team.
  "team.title": "My Team",

  // Threads.
  "threads.title": "Threads",
  "threads.acknowledge": "Acknowledge",
  "threads.acknowledged": "Acknowledged",
  "threads.passItOn": "Pass it on",

  // Shared.
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.retry": "Try again",
  "common.offline": "No connection. Try again when you have signal.",
} as const;

/**
 * The contract every other dictionary must satisfy.
 *
 * `Record<keyof typeof en, string>` rather than `typeof en`: the values must be strings,
 * not the same literal strings — otherwise a translation would only typecheck if it were
 * still in English.
 */
export type Dict = Record<keyof typeof en, string>;
export type MessageKey = keyof typeof en;

export default en satisfies Dict;
