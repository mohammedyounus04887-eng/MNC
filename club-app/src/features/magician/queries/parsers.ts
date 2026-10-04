import type { User as Member } from "@/types/firestore";
import type { QueryIntent, QueryKind } from "./types";

// ─── Query-intent detection ────────────────────────────────────────────
// Read-only voice patterns. Detected BEFORE any action/payment parsing
// so questions never accidentally trigger a write.
//
// Detection is keyword-based + ordering-sensitive: more specific patterns
// (member name + "today") tried before generic catch-alls ("report").

// Today's report — generic open
const REPORT_OPEN_RE = /\b(show|open|display|give)\s+(me\s+)?(today'?s|today)\s+(report|summary)\b/i;
const PRINT_REPORT_RE = /\bprint\s+(today'?s|today|the)?\s*(report|summary)\b/i;

// Today aggregates
const CASH_TODAY_RE = /\b(how much|total)\s+cash\s+(collected\s+)?(today|so far)\b/i;
const UPI_TODAY_RE = /\b(how much|total)\s+upi\s+(collected\s+)?(today|so far)\b/i;
const TOTAL_TODAY_RE = /\b(how much|total)\s+(money|amount|revenue|collection|sales)\s+(collected\s+)?(today|so far)\b/i;
const SHAKES_TODAY_RE = /\bhow many\s+shakes?\s+(ordered\s+)?(today|so far)\b/i;
const GUESTS_TODAY_RE = /\bhow many\s+guests?\s+(today|so far)\b/i;
const ATTENDANCE_TODAY_RE = /\bhow many\s+(people|members?|attendees?)\s+(have\s+)?(come|came|arrived|attended)\s+(today)?\b/i;
const ABSENT_TODAY_RE = /\bhow many\s+(people|members?)\s+(have\s+)?(not\s+come|absent|missed|didn'?t come)\s+(today)?\b/i;

// Member queries — "did X come today" / "is X here" / "check X"
const MEMBER_CHECK_RE = /\b(did|has|is)\s+(.+?)\s+(come|arrived|here|present|been here|come today)\b/i;
const MEMBER_TODAY_RE = /\bcheck\s+(?:if\s+)?(?:have\s+)?(.+?)\s+(come|today|attended|present)\b/i;
const MEMBER_PROFILE_RE = /\b(show|open|display)\s+(me\s+)?(.+?)\s+profile\b/i;

interface ParseQueryInput {
    clause: string;
    members: Member[];
    matchByName: (q: string, members: Member[]) => Member[];
    matchMemberByDigits: (d: string) => Member | null;
}

export function parseQueryClause(input: ParseQueryInput): QueryIntent | null {
    const { clause, members, matchByName, matchMemberByDigits } = input;

    // ── Print first (could overlap with "show today's report" otherwise)
    if (PRINT_REPORT_RE.test(clause)) {
        return { kind: "print_report" };
    }

    // ── Today aggregates ────────────────────────────────────────────────
    if (REPORT_OPEN_RE.test(clause)) return { kind: "report_today" };
    if (CASH_TODAY_RE.test(clause)) return { kind: "amount_cash_today" };
    if (UPI_TODAY_RE.test(clause)) return { kind: "amount_upi_today" };
    if (TOTAL_TODAY_RE.test(clause)) return { kind: "amount_total_today" };
    if (SHAKES_TODAY_RE.test(clause)) return { kind: "count_shakes_today" };
    if (GUESTS_TODAY_RE.test(clause)) return { kind: "count_guests_today" };
    if (ABSENT_TODAY_RE.test(clause)) return { kind: "count_absent_today" };
    if (ATTENDANCE_TODAY_RE.test(clause)) return { kind: "count_attendance_today" };

    // ── Member profile ──────────────────────────────────────────────────
    const profileMatch = clause.match(MEMBER_PROFILE_RE);
    if (profileMatch) {
        const memberText = profileMatch[3].trim();
        return resolveMember("member_profile", memberText, members, matchByName, matchMemberByDigits);
    }

    // ── Member-today check ──────────────────────────────────────────────
    const checkMatch = clause.match(MEMBER_CHECK_RE);
    if (checkMatch) {
        const memberText = checkMatch[2].trim();
        return resolveMember("member_today", memberText, members, matchByName, matchMemberByDigits);
    }
    const todayMatch = clause.match(MEMBER_TODAY_RE);
    if (todayMatch) {
        const memberText = todayMatch[1].trim();
        return resolveMember("member_today", memberText, members, matchByName, matchMemberByDigits);
    }

    return null;
}

function resolveMember(
    kind: QueryKind,
    memberText: string,
    members: Member[],
    matchByName: (q: string, members: Member[]) => Member[],
    matchMemberByDigits: (d: string) => Member | null,
): QueryIntent {
    // Try id first if memberText is just digits / "member 42"
    const digits = memberText.replace(/\D/g, "");
    if (digits && /^(?:member\s+|id\s+)?(\d+)$/i.test(memberText.trim())) {
        const m = matchMemberByDigits(digits);
        return { kind, member: m, memberSpoken: memberText };
    }

    // Name match
    const clean = memberText
        .replace(/\b(?:come|today|here|present|profile|member|the|a|an)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    const candidates = matchByName(clean || memberText, members);
    if (candidates.length === 1) return { kind, member: candidates[0], memberSpoken: memberText };
    if (candidates.length > 1) return { kind, member: null, memberCandidates: candidates.slice(0, 6), memberSpoken: memberText };
    return { kind, member: null, memberSpoken: memberText };
}
