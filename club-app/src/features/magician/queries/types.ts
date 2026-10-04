import type { User as Member } from "@/types/firestore";

// ─── Magician query intents ───────────────────────────────────────────
// Queries are read-only: receptionist asks a question, Magician answers
// via TTS + a toast OR by navigating to a relevant screen. No DB writes,
// no face-verify gate.

export type QueryKind =
    // Today aggregates
    | "report_today"           // open the full TodayReportModal
    | "count_attendance_today" // how many members came
    | "count_absent_today"     // how many members did NOT come
    | "count_shakes_today"     // total shake orders today
    | "count_guests_today"     // total guest entries today
    | "amount_cash_today"      // ₹ cash collected today
    | "amount_upi_today"       // ₹ UPI collected today
    | "amount_total_today"     // ₹ all payments today
    | "print_report"           // trigger print of today's report
    // Member-specific
    | "member_today"           // did X come today? + what did they do
    | "member_profile";        // open the member's profile screen

export interface QueryIntent {
    kind: QueryKind;
    // Member-specific queries carry the resolved member (or null if no match)
    member?: Member | null;
    memberCandidates?: Member[];  // when name was ambiguous
    memberSpoken?: string;        // raw text as heard
}
