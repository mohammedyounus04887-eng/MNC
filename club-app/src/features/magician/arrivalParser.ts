import type { User as Member } from "@/types/firestore";
import type { Team } from "@/features/teams/useTeams";

// ─── Arrival intent parser ────────────────────────────────────────────
// Detects "X has arrived" / "Team A arrived without Y but Z wants W"
// patterns. Returns a list of (member, optional shake-override) pairs.
//
// Output feeds into Magician's regular review-gallery flow — each
// pair becomes a card. Shake field defaulted from member preferences
// (caller does that part); override here only applies when explicit.

export interface ArrivalResolution {
    member: Member;
    overrideShakeName?: string;   // e.g. "chocolate" when "but X wants chocolate"
    asVolunteer?: boolean;        // "and mark volunteer attendance" / "as volunteer"
}

export interface ArrivalParseResult {
    resolutions: ArrivalResolution[];
    // Members the receptionist mentioned by name but we couldn't resolve.
    // The caller renders these as "needs_member" cards so the receptionist
    // can pick from candidates.
    unresolved: { spoken: string; candidates: Member[] }[];
    // For team-shape commands, expose which team triggered the expansion.
    triggeredTeam: Team | null;
}

// ── Two trigger shapes ──────────────────────────────────────────────────
// (a) Name-then-verb:   "Vignesh has arrived"     (existing)
// (b) Greeting-then-name: "Welcome Vignesh"       (new)
// Both produce the same intent.
const ARRIVAL_RE = /\b(?:has\s+arrived|have\s+arrived|arrived|here|entered|came|just\s+came|just\s+arrived|is\s+here|are\s+here)\b/i;
const GREETING_PREFIX_RE = /^(?:welcome(?:\s+back)?|hi|hello|hey|namaste|namaskar|greet|greetings|good\s+(?:morning|afternoon|evening))\s+/i;

// Implicit-order verbs: "Give Vignesh a mango shake" → translates to
// "Vignesh has arrived but wants mango shake" — runs through the normal
// arrival flow with the shake as an override.
const IMPLICIT_ORDER_RE = /^(?:give|make|send|pour|fix|prepare|get|hand)\s+(.+?)\s+(?:a|an|the|his|her|their)\s+(.+?)$/i;

// Natural "X wants/needs/will have Y" — same translation as above.
const WANTS_RE = /^(.+?)\s+(?:wants?|needs?|will\s+have|will\s+take|would\s+like)\s+(?:a|an|the|his|her)?\s*(.+?)$/i;

// "X's usual" / "Reorder for X" / "Same as yesterday for X" — pure
// arrival, the preference + history fallback fills in the right shake.
const USUAL_RE = /^(?:reorder\s+for|same\s+as\s+(?:yesterday|last\s+time)\s+for|usual\s+for)\s+(.+?)$/i;
const POSSESSIVE_USUAL_RE = /^(.+?)(?:'s|s)?\s+usual$/i;

// Modifier: receptionist tacks "and mark volunteer attendance" or similar
// onto the end (or "as volunteer" mid-phrase). When detected, every
// resolved arrival in this batch ALSO gets a volunteer attendance write.
const VOLUNTEER_MODIFIER_RE = /\b(?:as\s+volunteer(?:s)?|mark\s+(?:as\s+)?volunteer(?:\s+attendance)?|volunteer\s+attendance|volunteer(?:ing)?\s+check[\s-]?in)\b/i;

// ── Volunteer DEPARTURE (sign-out) ─────────────────────────────────────
// "Bye Sujata" / "Sign out Sujata" / "Sujata is leaving" / "Sujata is done"
const DEPARTURE_PREFIX_RE = /^(?:bye|goodbye|sign\s+(?:out|off)|check\s+out|see\s+you|catch\s+you)\s+/i;
const DEPARTURE_SUFFIX_RE = /\b(?:is\s+leaving|are\s+leaving|leaving\s+now|going\s+home|going\s+now|done\s+for\s+today|finished\s+for\s+today)\b/i;

export interface VolunteerSignOutResult {
    member: Member;
}

export function parseVolunteerSignOutIntent(input: ParseArrivalInput): VolunteerSignOutResult[] | null {
    const { transcript, members, matchByName, matchMemberByDigits } = input;
    const t = transcript.trim();

    let subjectPart: string;
    if (DEPARTURE_PREFIX_RE.test(t)) {
        subjectPart = t.replace(DEPARTURE_PREFIX_RE, "").trim();
    } else if (DEPARTURE_SUFFIX_RE.test(t)) {
        subjectPart = t.replace(DEPARTURE_SUFFIX_RE, "").trim();
    } else {
        return null;
    }

    subjectPart = subjectPart
        .replace(/[.!?]+$/, "")
        .replace(/\b(?:has|have|is|are|just|now|the)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!subjectPart) return null;

    const pieces = subjectPart.split(/\s*(?:,|\band\b)\s*/).map((p) => p.trim()).filter(Boolean);
    const resolved: Member[] = [];
    for (const piece of pieces) {
        const digits = piece.match(/\d+/)?.[0];
        if (digits) {
            const m = matchMemberByDigits(digits);
            if (m) { resolved.push(m); continue; }
        }
        const cleaned = piece.replace(/^(?:member|id|number)\s+/i, "").trim();
        if (!cleaned) continue;
        const candidates = matchByName(cleaned, members);
        if (candidates.length === 1) resolved.push(candidates[0]);
    }
    if (resolved.length === 0) return null;
    return resolved.map((m) => ({ member: m }));
}

// "Team A" / "team named A" / "the A team"
const TEAM_NAME_RE = /\bteam\s+([a-z0-9 ]+?)(?:\s+(?:has|have|arrived|here|entered|came|without|but)|$)/i;

// "without X and Y" — excluded members
const WITHOUT_RE = /\bwithout\s+(.+?)(?:\s+but\b|$)/i;

// "but X wants Y" or "but X and Y want Z" — per-member shake overrides
const BUT_RE = /\bbut\s+(.+?)\s+wants?\s+(.+?)$/i;

export interface ParseArrivalInput {
    transcript: string;
    members: Member[];
    teams: Team[];
    matchByName: (q: string, members: Member[]) => Member[];
    matchMemberByDigits: (d: string) => Member | null;
}

export function parseArrivalIntent(input: ParseArrivalInput): ArrivalParseResult | null {
    const { transcript, members, teams, matchByName, matchMemberByDigits } = input;
    const original = transcript.trim();
    const asVolunteer = VOLUNTEER_MODIFIER_RE.test(original);

    // ── Pre-translate natural phrasings to the canonical "X has arrived"
    //    form so the existing pipeline handles them unchanged. ──────────
    let t = original;

    // "Reorder for Prasad" / "Prasad's usual" → "Welcome Prasad"
    const usualMatch = t.match(USUAL_RE) || t.match(POSSESSIVE_USUAL_RE);
    if (usualMatch) {
        t = `Welcome ${usualMatch[1].trim()}`;
    }

    // "Give Vignesh a mango" → "Vignesh has arrived but wants mango"
    // Only fires when the leading token is a known verb (give/make/send…),
    // so "Vignesh has arrived" still falls through to the normal path.
    const implicitOrder = t.match(IMPLICIT_ORDER_RE);
    if (implicitOrder) {
        const name = implicitOrder[1].trim();
        const item = implicitOrder[2].trim().replace(/\s+shake$/i, "").trim();
        // "his/her/their usual" → no override; preference fills in.
        if (/^usual$/i.test(item) || /^the\s+usual$/i.test(implicitOrder[2])) {
            t = `Welcome ${name}`;
        } else {
            t = `${name} has arrived but wants ${item}`;
        }
    }

    // "Prasad wants mango" → "Prasad has arrived but wants mango"
    // Only if NOT already a "has arrived" form, and the leading words look
    // like a single member reference (not multi-clause).
    if (!ARRIVAL_RE.test(t) && !GREETING_PREFIX_RE.test(t)) {
        const wantsMatch = t.match(WANTS_RE);
        if (wantsMatch) {
            const name = wantsMatch[1].trim();
            const item = wantsMatch[2].trim().replace(/\s+shake$/i, "").trim();
            if (/^usual$/i.test(item)) {
                t = `Welcome ${name}`;
            } else {
                t = `${name} has arrived but wants ${item}`;
            }
        }
    }

    if (GREETING_PREFIX_RE.test(t)) {
        // Strip greeting then ensure the verb is present
        t = t.replace(GREETING_PREFIX_RE, "").trim();
        if (!ARRIVAL_RE.test(t)) {
            // Inject "have arrived" right after the subject list — before
            // any "but X wants Y" tail.
            const butIdx = t.search(/\bbut\b/i);
            const withoutIdx = t.search(/\bwithout\b/i);
            const tailIdx = Math.min(...[butIdx, withoutIdx].filter((i) => i >= 0)) ?? -1;
            if (tailIdx > 0 && Number.isFinite(tailIdx)) {
                t = t.slice(0, tailIdx).trim() + " have arrived " + t.slice(tailIdx);
            } else {
                t = t + " have arrived";
            }
        }
    } else if (!ARRIVAL_RE.test(t)) {
        return null;
    }

    // ── Team-shaped path ──────────────────────────────────────────────
    const teamMatch = t.match(TEAM_NAME_RE);
    if (teamMatch) {
        const teamQuery = teamMatch[1].trim().toLowerCase();
        const team = teams.find((tm) => tm.name.toLowerCase() === teamQuery)
            ?? teams.find((tm) => tm.name.toLowerCase().includes(teamQuery))
            ?? teams.find((tm) => teamQuery.includes(tm.name.toLowerCase()));
        if (!team) return null;
        const result = resolveFromMemberIds(team, team.memberIds, members, teams, t, matchByName, matchMemberByDigits);
        if (asVolunteer) result.resolutions.forEach((r) => { r.asVolunteer = true; });
        return result;
    }

    // ── Free-list path: "Soumya, Krishna, Divya and Vignesh have arrived"
    // Strip the verb, "and mark volunteer attendance" tail, any
    // "but/without" tails, and filler words so what's left is just the
    // comma-separated subject list.
    let subjectPart = t
        .replace(ARRIVAL_RE, " ")
        .replace(VOLUNTEER_MODIFIER_RE, " ")
        .replace(WITHOUT_RE, " ")
        .replace(BUT_RE, " ")
        .replace(/\band\s+(?=$|\s*$)/i, " ")   // dangling "and" left after stripping volunteer
        .replace(/\b(?:has|have|the|is|are|just|now)\b/gi, " ")
        .replace(/[.!?]+$/, "")
        .trim();

    // Smart split on commas / "and" — exactly the same shape extractSubjects
    // uses in parser.ts.
    const pieces = subjectPart.split(/\s*(?:,|\band\b)\s*/).map((p) => p.trim()).filter(Boolean);
    if (pieces.length === 0) return null;

    const resolutions: ArrivalResolution[] = [];
    const unresolved: { spoken: string; candidates: Member[] }[] = [];
    for (const piece of pieces) {
        // Try id first
        const digits = piece.match(/\d+/)?.[0];
        if (digits) {
            const m = matchMemberByDigits(digits);
            if (m) { resolutions.push({ member: m }); continue; }
        }
        const cleaned = piece.replace(/^(?:member|id|number)\s+/i, "").replace(/[.,;]/g, "").trim();
        if (!cleaned) continue;
        const candidates = matchByName(cleaned, members);
        if (candidates.length === 1) resolutions.push({ member: candidates[0] });
        else unresolved.push({ spoken: cleaned, candidates: candidates.slice(0, 6) });
    }

    if (resolutions.length === 0 && unresolved.length === 0) return null;

    // Apply overrides + volunteer modifier
    applyOverrides(t, resolutions, matchByName, members);
    if (asVolunteer) resolutions.forEach((r) => { r.asVolunteer = true; });

    return { resolutions, unresolved, triggeredTeam: null };
}

function resolveFromMemberIds(
    team: Team,
    memberIds: string[],
    members: Member[],
    teams: Team[],
    transcript: string,
    matchByName: (q: string, members: Member[]) => Member[],
    matchMemberByDigits: (d: string) => Member | null,
): ArrivalParseResult {
    let resolved: Member[] = memberIds
        .map((id) => members.find((m) => m.id === id))
        .filter((m): m is Member => !!m);

    // "without X and Y" — exclude
    const without = transcript.match(WITHOUT_RE);
    if (without) {
        const excludedText = without[1];
        const excludedNames = excludedText.split(/\s*(?:,|\band\b)\s*/).map((s) => s.trim()).filter(Boolean);
        for (const name of excludedNames) {
            const cands = matchByName(name, resolved);
            if (cands.length === 1) {
                resolved = resolved.filter((m) => m.id !== cands[0].id);
            }
        }
    }

    const resolutions: ArrivalResolution[] = resolved.map((m) => ({ member: m }));
    applyOverrides(transcript, resolutions, matchByName, members);
    return { resolutions, unresolved: [], triggeredTeam: team };
}

function applyOverrides(
    transcript: string,
    resolutions: ArrivalResolution[],
    matchByName: (q: string, members: Member[]) => Member[],
    members: Member[],
) {
    // "but X wants Y" or "but X and Y want Z"
    const m = transcript.match(BUT_RE);
    if (!m) return;
    const namesText = m[1];
    const shakeName = m[2].trim().replace(/\b(?:shake|today|please)\b/gi, "").trim();
    const names = namesText.split(/\s*(?:,|\band\b)\s*/).map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
        const cands = matchByName(name, members);
        if (cands.length !== 1) continue;
        const target = resolutions.find((r) => r.member.id === cands[0].id);
        if (target) target.overrideShakeName = shakeName;
    }
}
