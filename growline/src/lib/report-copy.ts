/**
 * Every word that appears on a wellness report lives here.
 *
 * This file is the compliance surface. Nothing on a report may be typed by a
 * coach at runtime and nothing may be generated per-prospect: free text on the
 * report cannot be reviewed, so it cannot be compliant. If you are adding a
 * string to a report, add it here.
 *
 * Two rules that are easy to break by accident:
 *  1. The next-step line is chosen INDEPENDENTLY of the person's numbers.
 *     Copy that changes with a health estimate is advice-by-algorithm.
 *  2. No clinical category word ever describes the person. Labels say where the
 *     NUMBER sits. "Obesity" in particular is a scheduled condition under the
 *     Drugs and Magic Remedies (Objectionable Advertisements) Act 1954, and F3
 *     calls this report a marketing asset — so naming it is a legal problem.
 */

/** CLAUDE.md Section 5.2, verbatim. Never paraphrase, never merge with the line below. */
export const DISCLAIMER = "Estimates for general wellness only. Not medical advice.";

/**
 * Separate obligation: the Consumer Affairs / ASCI guidance for health-and-wellness
 * influencers requires saying this is not a substitute for professional advice and
 * encouraging a professional consult. The Section 5.2 line does neither, so both
 * lines travel together.
 */
export const NOT_A_DOCTOR =
  "Your coach is a wellness coach, not a medical professional. Talk to a doctor before changing your diet, exercise or medicine.";

/** Fixed. Given a text field here, someone would eventually type "Nutrition Consultant". */
export const COACH_ROLE = "Wellness Coach";

/** Prospect-facing title. Deliberately not "Report" — that invites pathology-report framing. */
export const REPORT_TITLE = "Your Wellness Snapshot";

export const BMI_STANDARD_NOTE =
  "Ranges follow the WHO Asia-Pacific classification for adults.";
export const BMI_NOT_DIAGNOSIS =
  "BMI is a rough guide, not a diagnosis. Only a doctor can say what it means for you.";

export const BODY_FAT_NOTE =
  "Worked out from height, weight, age and sex — not measured. A body scan or a doctor gives a truer figure.";

export const BMR_NOTE =
  "An estimate from a standard formula, not a measurement. Individual results vary.";

export const WEIGHT_RANGE_NOTE =
  "A general range for this height. It is not a target and not a goal.";

export const WATER_NOTE =
  "General guidance for adults, counting all fluids — water, tea, buttermilk and water in food. More in hot weather or with heavy activity. Thirst is a good guide. Some people are told by their doctor to drink less; follow your doctor.";

/**
 * Fixed pool, selected from a stable hash of the report id so the same report
 * always shows the same line — and so the line never varies with the numbers.
 * No income promise, no product claim, no medical advice, no comment on the body.
 */
const NEXT_STEPS = [
  "Small daily habits beat big plans. Pick one thing to start tomorrow morning.",
  "You took your numbers today — that is more than most people do. Take them again in 8 weeks and see.",
  "Sleep, water, walking and regular meal times move these numbers most. Start with whichever is easiest.",
  "Most people find it easier with someone to check in with. Ask your coach about their wellness club.",
  "Questions about your routine? Message your coach on WhatsApp — no obligation.",
] as const;

export function nextStepLine(reportId: string): string {
  let hash = 0;
  for (const ch of reportId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return NEXT_STEPS[Math.abs(hash) % NEXT_STEPS.length];
}

/**
 * The WhatsApp body is a SECONDARY control — it is editable plain text and a coach
 * may trim it, which is exactly why the numbers are not in it. The metrics live in
 * the image and behind the link, where a disclaimer is bound to them; numbers as
 * loose text would travel with nothing attached.
 */
export function whatsappMessage(opts: {
  firstName: string;
  url: string;
  coachName: string;
  /**
   * The coach's public page, when they have published one (F9).
   *
   * F9 requires this link to ride on every report sent, and it is the only reason the
   * portfolio has any distribution at all — a page nobody links to is a page nobody
   * visits. Omitted entirely when there is no published page rather than degraded to a
   * dead link, because a prospect who taps a 404 learns something worse about the coach
   * than they would have learned from no link.
   *
   * A URL, not free text: the rule at the top of this file is that nothing on a report
   * is typed by a coach at runtime, and a slug they chose is checked against a fixed
   * format before it can ever exist.
   */
  portfolioUrl?: string | null;
}): string {
  return [
    `Hi ${opts.firstName}, good to meet you. Here is your wellness snapshot:`,
    opts.url,
    ...(opts.portfolioUrl ? [`A bit about me: ${opts.portfolioUrl}`] : []),
    `— ${opts.coachName}`,
    // Last, so it is the line sitting directly above the message box when they read it.
    `(${DISCLAIMER})`,
  ].join("\n\n");
}

/**
 * Short forms for the image and PDF, where a full paragraph per metric would not
 * fit legibly. Same substance, fewer words — every hedge that changes how a number
 * should be read is still present. The two disclaimer lines above appear in full.
 */
export const SHORT_NOTES = {
  bmi: "A rough guide, not a diagnosis. WHO Asia-Pacific ranges.",
  bodyFat: "Worked out from your details — not measured.",
  bmr: "An estimate from a standard formula.",
  weightRange: "A general range, not a target.",
  water: "General adult guidance, counting all fluids.",
} as const;

/** Shown once to coaches, because the culture of this audience is group-forwarding. */
export const COACH_SHARING_NOTICE =
  "This snapshot has someone else's personal details. Send it to them, not to your group.";
