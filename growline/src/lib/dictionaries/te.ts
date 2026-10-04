/**
 * Telugu (తెలుగు) — typed against the English source, so `tsc` catches any key this file
 * forgets or misspells.
 *
 * Register: everyday spoken Telugu, the way a coach in Hyderabad or Vijayawada actually
 * talks — NOT the Sanskritised Telugu of a government notice. So "మళ్లీ ప్రయత్నించండి"
 * not "పునః యత్నించండి", "నెట్ లేదు" not "అంతర్జాల అనుసంధానం లేదు". Loanwords that
 * Telugu genuinely uses (టీమ్, సేవ్, నెట్, సిగ్నల్, క్యూఆర్) are written in Telugu
 * script; nothing stays in Latin letters.
 *
 * Length matters more here than in English. A Telugu cluster is wider than a Latin
 * letter at the same point size, and five of these strings share a bottom navigation bar
 * on a 360px phone — hence the one-word nav labels (హోమ్ · వ్యక్తులు · పని · టీమ్ ·
 * సందేశాలు) even where a two-word phrase would read slightly more precisely.
 *
 * No zero-width joiners anywhere: loanwords are declined in fully Telugu-ised forms
 * ("నంబరుతో", "ఇంగ్లీషులో") rather than the ZWNJ spellings a phone keyboard produces,
 * because an invisible character inside a source string is a bug nobody can see.
 */

import type { Dict } from "./en";

const te: Dict = {
  // Bottom navigation — one short word each so five fit on a 360px screen.
  "nav.home": "హోమ్",
  "nav.prospects": "వ్యక్తులు",
  "nav.log": "పని",
  "nav.team": "టీమ్",
  "nav.threads": "సందేశాలు",
  "nav.settings": "సెట్టింగ్స్",

  // Settings — the language section. "భాష" is the single word a coach who cannot read
  // the rest of the screen will scan for, so it stands alone with no qualifier.
  "settings.language.title": "భాష",
  "settings.language.help": "మీరు తేలికగా చదవగలిగే భాషను ఎంచుకోండి.",
  "settings.language.saving": "సేవ్ అవుతోంది…",
  "settings.language.error": "భాష మారలేదు. మళ్లీ ప్రయత్నించండి.",
  "settings.language.reportNote":
    "ఆరోగ్య రిపోర్టులు సరిగ్గా ప్రింట్ కావాలి కాబట్టి, ఇప్పటికి అవి ఇంగ్లీషులోనే ఉంటాయి.",

  // Log screen.
  "log.title": "ఈరోజు పని",
  // Telugu puts the count after the adverb: "వరుసగా 12 రోజులు" = "12 days in a row".
  "log.streakDays": "వరుసగా {days} రోజులు",

  // Prospects. "వ్యక్తులు" = people — plain, and it carries no sales flavour.
  "prospects.title": "వ్యక్తులు",
  "prospects.search": "పేరు లేదా నంబరుతో వెతకండి",
  "prospects.all": "అందరూ",
  "prospects.myQr": "నా క్యూఆర్ కోడ్",
  "prospects.addFirst": "మొదటి వ్యక్తిని చేర్చండి",
  "prospects.newPerson": "కొత్త వ్యక్తి",

  // Team.
  "team.title": "నా టీమ్",

  // Threads. "చూశాను" is what a person actually says when confirming they have seen a
  // message; the acknowledged state stays in the same first person and marks it finished.
  "threads.title": "సందేశాలు",
  "threads.acknowledge": "చూశాను",
  "threads.acknowledged": "చూసేశాను",
  // "ముందుకు పంపండి" was a calque — "send it forward". Native-speaker review, 2026-08-14:
  // this action IS the WhatsApp forward every coach does daily, and the word they say for
  // it is ఫార్వర్డ్ (standard Telugu-script spelling, same policy as టీమ్/సేవ్/నెట్).
  "threads.passItOn": "ఫార్వర్డ్ చేయండి",

  // Shared.
  "common.save": "సేవ్ చేయండి",
  "common.cancel": "రద్దు చేయండి",
  "common.retry": "మళ్లీ ప్రయత్నించండి",
  "common.offline": "నెట్ లేదు. సిగ్నల్ వచ్చాక మళ్లీ ప్రయత్నించండి.",
};

export default te;
