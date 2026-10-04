// ─── Magician shared types ─────────────────────────────────────────────
// A voice-driven input layer for the Reception tab. Parses spoken
// commands into structured actions, lets the receptionist review/edit,
// then fires the SAME hooks (useCheckInMember + usePlaceOrder) that
// manual clicking already uses. Magician owns no business logic.

import type { User as Member, Product } from "@/types/firestore";

export type ActionKind =
    | "attendance" | "order" | "both" | "first_day"
    | "oneday_shake" | "day_redeem" | "topup" | "plan_renewal" | "product_sale";

// Status of one parsed row after validation against the member DB +
// today's specials. The review UI renders different chrome per status.
export type RowStatus =
    | "ready"           // member matched + item resolved (or attendance-only)
    | "needs_member"    // no digit match, or matched to nothing in DB
    | "needs_item"      // order action but couldn't resolve a shake
    | "needs_couple"    // member is half of a couple → ask "both / only A / only B"
    | "duplicate";      // same member + same action appears earlier in this batch

export interface ParsedAction {
    id: string;                     // stable local id for React keys
    rawSegment: string;             // the slice of transcript that produced this
    memberIdSpoken: string;         // digits as heard ("042") or name as heard
    memberMatch: Member | null;
    candidates?: Member[];          // present when name matched ≥2 members
    action: ActionKind;
    itemName: string | null;        // shake name as heard ("mango")
    itemMatch: Product | null;
    status: RowStatus;
    // Couple resolution (only set if status was "needs_couple" and got resolved)
    coupleChoice?: "both" | "self" | "partner";
    // First Day specific data (set when action === "first_day")
    firstDay?: FirstDayData;
    // Paid-intent data (set when action is one of the payment kinds)
    payment?: import("./payment/types").PaymentIntent;
    // Set when the transcript included "and mark volunteer attendance" or
    // "as volunteer" — submit then ALSO writes a type=volunteer record to
    // the member's attendance subcollection.
    asVolunteer?: boolean;
}

export interface FirstDayData {
    name: string;                   // guest's full name (editable)
    phoneDigits: string;            // raw digits, 10+ for Indian mobile
    inviterRaw: string | null;      // text/digits as spoken
    inviterMatch: Member | null;    // resolved to single inviter
    inviterCandidates?: Member[];   // present when ambiguous
    // Set after the receptionist captures the face in the review card
    capturedFile?: File;
    capturedDataUrl?: string;
    // Set after duplicate-check finds a prior First Day on this phone
    existingMatch?: { date: string; entryId: string; count: number };
    // Receptionist's resolution of the duplicate prompt
    duplicateChoice?: "mark_again" | "new_photo" | "ignore";
}

export interface ParseResult {
    transcript: string;
    actions: ParsedAction[];
    warnings: string[];
}

// Shape passed from review UI → submit handler. After edits/disambiguation
// every action is guaranteed to have memberMatch (for non-first_day kinds)
// and itemMatch (for orders).
export interface ConfirmedAction {
    memberMatch: Member | null;     // null for first_day (guest, no member doc yet)
    action: ActionKind;
    itemMatch: Product | null;
    coupleChoice?: "both" | "self" | "partner";
    firstDay?: FirstDayData;        // set when action === "first_day"
    payment?: import("./payment/types").PaymentIntent;  // set when paid intent
    asVolunteer?: boolean;          // also write volunteer attendance record
}
