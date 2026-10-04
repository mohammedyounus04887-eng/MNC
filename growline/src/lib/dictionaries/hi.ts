/**
 * Hindi (हिन्दी) — typed against the English source, so `tsc` catches any key this file
 * forgets or misspells.
 *
 * Register: everyday spoken Hindi, the way a coach in a tier-2 city actually talks —
 * NOT the Sanskritised officialese of government forms. So "सेव करें" not "सहेजें",
 * "दोबारा कोशिश करें" not "पुनः प्रयास करें", "सेहत" not "स्वास्थ्य". Loanwords that
 * Hindi genuinely uses (टीम, सेव, इंटरनेट, सिग्नल) are written in Devanagari.
 *
 * ONE deliberate exception: **QR stays in Latin**. Native-speaker review, 2026-08-14 —
 * every UPI app's Hindi UI (GPay, PhonePe, Paytm) and every shop-counter sticker writes
 * "QR कोड", so the two Latin letters are recognised as a picture while "क्यूआर" makes a
 * semi-literate reader stop and sound it out. Do not "fix" this back to Devanagari.
 *
 * Length matters more here than in English. Devanagari renders wider than Latin at the
 * same point size, and five of these strings share a bottom navigation bar on a 360px
 * phone — hence the one-word nav labels (होम · लोग · काम · टीम · संदेश) even where a
 * two-word phrase would read slightly more precisely.
 */

import type { Dict } from "./en";

const hi: Dict = {
  // Bottom navigation — kept to one short word each so five fit on a 360px screen.
  "nav.home": "होम",
  "nav.prospects": "लोग",
  "nav.log": "काम",
  "nav.team": "टीम",
  "nav.threads": "संदेश",
  "nav.settings": "सेटिंग",

  // Settings — the language section. "भाषा" is the one word a coach who cannot read the
  // rest of the screen will scan for, so it stands alone with no qualifier.
  "settings.language.title": "भाषा",
  "settings.language.help": "जिस भाषा में आपको पढ़ना आसान लगे, वही चुनें।",
  "settings.language.saving": "सेव हो रहा है…",
  "settings.language.error": "भाषा नहीं बदल पाई। दोबारा कोशिश करें।",
  "settings.language.reportNote":
    "सेहत की रिपोर्ट अभी अंग्रेज़ी में ही रहेंगी, ताकि वे सही छपें।",

  // Log screen.
  "log.title": "आज का काम",
  // Hindi puts the count after the adverb: "लगातार 12 दिन" = "12 days in a row".
  "log.streakDays": "लगातार {days} दिन",

  // Prospects. The nav label is "लोग"; the screen title warms it to "मेरे लोग", matching
  // "मेरी टीम".
  "prospects.title": "मेरे लोग",
  "prospects.search": "नाम या नंबर से खोजें",
  "prospects.all": "सभी",
  // QR in Latin on purpose — see the header note.
  "prospects.myQr": "मेरा QR कोड",
  "prospects.addFirst": "पहला व्यक्ति जोड़ें",
  "prospects.newPerson": "नया व्यक्ति",

  // Team.
  "team.title": "मेरी टीम",

  // Threads. "देख लिया" is what a person actually says when confirming they have seen a
  // message; the acknowledged state adds "है" to read as a state rather than an action.
  "threads.title": "संदेश",
  "threads.acknowledge": "देख लिया",
  "threads.acknowledged": "देख लिया है",
  "threads.passItOn": "आगे भेजें",

  // Shared.
  "common.save": "सेव करें",
  "common.cancel": "रद्द करें",
  "common.retry": "दोबारा कोशिश करें",
  "common.offline": "इंटरनेट नहीं है। सिग्नल आने पर दोबारा कोशिश करें।",
};

export default hi;
