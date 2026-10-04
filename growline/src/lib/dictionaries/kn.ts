/**
 * Kannada (ಕನ್ನಡ) — typed against `Dict`, so the compiler is the completeness check.
 *
 * Translation notes for whoever reviews this next:
 *
 * - These are spoken-Karnataka renderings, not literal ones. Where English used a word
 *   the app itself invented ("Prospects", "Log", "Threads"), the Kannada uses the plain
 *   word a coach would actually say for that thing — ಜನರು (people), ಕೆಲಸ (work),
 *   ಸಂದೇಶ (message) — because the whole point of the localisation is that the label is
 *   obvious without English.
 * - Bottom-nav strings are kept to 2–4 glyph clusters. Kannada runs longer than English
 *   and five of these share a 360px row.
 * - Loanwords that Kannada speakers genuinely use (ನಂಬರ್, ಪ್ರಿಂಟ್, ಸಿಗ್ನಲ್, ಕೋಡ್) are
 *   written in Kannada script, never Latin.
 * - No money, earnings or rank wording anywhere (RULES L1, L4).
 */

import type { Dict } from "./en";

const kn: Dict = {
  // Bottom navigation — every one of these is short on purpose.
  "nav.home": "ಮುಖಪುಟ",
  "nav.prospects": "ಜನರು",
  "nav.log": "ಕೆಲಸ",
  "nav.team": "ತಂಡ",
  "nav.threads": "ಸಂದೇಶ",
  "nav.settings": "ಸೆಟ್ಟಿಂಗ್ಸ್",

  // Settings — the language section. "ಭಾಷೆ" is the word a Kannada reader scans for.
  "settings.language.title": "ಭಾಷೆ",
  "settings.language.help": "ನಿಮಗೆ ಸುಲಭವಾಗಿ ಓದಲು ಬರುವ ಭಾಷೆಯನ್ನು ಆರಿಸಿ.",
  "settings.language.saving": "ಉಳಿಸುತ್ತಿದೆ…",
  "settings.language.error": "ಭಾಷೆ ಬದಲಾಗಲಿಲ್ಲ. ಇನ್ನೊಮ್ಮೆ ಪ್ರಯತ್ನಿಸಿ.",
  // ಸ್ವಾಸ್ಥ್ಯ was the Sanskrit-flavoured word — the cognate of Hindi स्वास्थ्य, which
  // hi.ts's own header already rejects in favour of सेहत. Karnataka says ಆರೋಗ್ಯ.
  // ಇಂಗ್ಲಿಷಿನಲ್ಲೇ over ಇಂಗ್ಲಿಷ್‌ನಲ್ಲೇ so the source carries no zero-width joiner.
  // Native-speaker review 2026-08-14 (one reviewer; the second never ran — see STATUS).
  "settings.language.reportNote":
    "ಆರೋಗ್ಯ ವರದಿಗಳು ಸರಿಯಾಗಿ ಪ್ರಿಂಟ್ ಆಗಲು ಸದ್ಯಕ್ಕೆ ಇಂಗ್ಲಿಷಿನಲ್ಲೇ ಇರುತ್ತವೆ.",

  // Log screen. "ಸತತ N ದಿನ" = "N days in a row" — the natural way to say a streak.
  "log.title": "ಇಂದಿನ ಕೆಲಸ",
  "log.streakDays": "ಸತತ {days} ದಿನ",

  // Prospects.
  "prospects.title": "ಜನರು",
  "prospects.search": "ಹೆಸರು ಅಥವಾ ನಂಬರ್ ಹುಡುಕಿ",
  "prospects.all": "ಎಲ್ಲ",
  "prospects.myQr": "ನನ್ನ ಕ್ಯೂಆರ್ ಕೋಡ್",
  "prospects.addFirst": "ಮೊದಲ ವ್ಯಕ್ತಿ ಸೇರಿಸಿ",
  "prospects.newPerson": "ಹೊಸ ವ್ಯಕ್ತಿ",

  // Team.
  "team.title": "ನನ್ನ ತಂಡ",

  // Threads. Acknowledge is "ನೋಡಿದೆ" (I have seen it) — what a person actually taps;
  // the settled state answers back in the second person, "ನೋಡಿದ್ದೀರಿ".
  "threads.title": "ಸಂದೇಶಗಳು",
  "threads.acknowledge": "ನೋಡಿದೆ",
  "threads.acknowledged": "ನೋಡಿದ್ದೀರಿ",
  "threads.passItOn": "ಮುಂದೆ ಕಳಿಸಿ",

  // Shared.
  "common.save": "ಉಳಿಸಿ",
  "common.cancel": "ರದ್ದು",
  "common.retry": "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
  "common.offline": "ಸಂಪರ್ಕ ಇಲ್ಲ. ಸಿಗ್ನಲ್ ಸಿಕ್ಕಾಗ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
};

export default kn;
