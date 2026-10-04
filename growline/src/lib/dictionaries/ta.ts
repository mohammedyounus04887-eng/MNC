/**
 * Tamil (தமிழ்) — typed against the English source, so `tsc` catches a missing key.
 *
 * Register choices, so the next translator keeps the file consistent:
 *
 * - Spoken Tamil Nadu register, not literary Tamil. "புது நபர்" over "புதிய நபர்",
 *   "எல்லாம்" over "அனைத்தும்" — a coach standing on a road, not a government notice.
 * - Short action buttons use the bare imperative stem ("சேமி", "ரத்துசெய்") the way the
 *   Tamil Android UI does. Full sentences use the polite plural ("…செய்யுங்கள்").
 * - Loanwords that Tamil speakers genuinely use are written in Tamil script ("சிக்னல்").
 *   "QR" stays in Latin: it is a technical mark that Tamil-language payment apps also
 *   leave in Latin, and it is what is physically printed on the code being scanned.
 * - Keys are in the same order as en.ts.
 */

import type { Dict } from "./en";

const ta: Dict = {
  // Bottom navigation — five of these share a 360px row, so every label is kept to the
  // shortest natural word rather than the most complete one.
  "nav.home": "முகப்பு",
  "nav.prospects": "நபர்கள்",
  "nav.log": "பதிவு",
  "nav.team": "குழு",
  "nav.threads": "செய்திகள்",
  "nav.settings": "அமைப்புகள்",

  // Settings — the language section. "மொழி" is the one word a coach who cannot read the
  // rest of the screen will still recognise.
  "settings.language.title": "மொழி",
  "settings.language.help": "நீங்கள் எளிதாகப் படிக்கும் மொழியைத் தேர்ந்தெடுங்கள்.",
  "settings.language.saving": "சேமிக்கிறது…",
  "settings.language.error": "மொழியை மாற்ற முடியவில்லை. மீண்டும் முயற்சி செய்யுங்கள்.",
  "settings.language.reportNote":
    "சரியாக அச்சிட, ஆரோக்கிய அறிக்கைகள் இப்போதைக்கு ஆங்கிலத்தில்தான் இருக்கும்.",

  // Log screen.
  "log.title": "இன்றைய வேலை",
  "log.streakDays": "{days} நாள் தொடர்ச்சி",

  // Prospects. "நபர்" (person) throughout — it matches the plain English of the source
  // and stays shorter than "தொடர்புகள்".
  "prospects.title": "நபர்கள்",
  "prospects.search": "பெயர் அல்லது எண்ணைத் தேடுங்கள்",
  "prospects.all": "எல்லாம்",
  "prospects.myQr": "என் QR குறியீடு",
  "prospects.addFirst": "முதல் நபரைச் சேர்",
  "prospects.newPerson": "புது நபர்",

  // Team.
  "team.title": "என் குழு",

  // Threads.
  "threads.title": "செய்திகள்",
  "threads.acknowledge": "பார்த்தேன்",
  "threads.acknowledged": "பார்த்தாயிற்று",
  "threads.passItOn": "குழுவுக்கு அனுப்பு",

  // Shared.
  "common.save": "சேமி",
  "common.cancel": "ரத்துசெய்",
  "common.retry": "மீண்டும் முயற்சி",
  "common.offline": "இணைப்பு இல்லை. சிக்னல் வந்ததும் மீண்டும் முயற்சி செய்யுங்கள்.",
};

export default ta;
