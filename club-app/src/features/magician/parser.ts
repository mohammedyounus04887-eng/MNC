// ─── Magician grammar parser ───────────────────────────────────────────
// Pure, rule-based, no LLM. Receptionists are trained to use 5 patterns:
//
//   P1 — single:   "mark attendance for member 042"
//                  "order mango shake for member 042"
//   P2 — multi:    "mango shake for 042, 088, 103"
//   P3 — range:    "strawberry for 011 to 020"
//   P4 — combined: "mango for 042, 088. strawberry for 103. attendance for all."
//   P5 — "all":    "attendance and special for all"  (= every id mentioned)
//
// The whole pipeline runs in <5ms and is fully deterministic, so a
// receptionist who learns the patterns gets predictable results every time.

import type { User as Member, Product, MembershipPlan } from "@/types/firestore";
import type { ActionKind, FirstDayData, ParseResult, ParsedAction, RowStatus } from "./types";
import { parseOneDayShakeClause, parseDayRedeemClause, parseTopupClause, parsePlanRenewalClause, parseProductSaleClause } from "./payment/parsers";
import type { InventoryProductLite, PaymentIntent } from "./payment/types";
import { parseQueryClause } from "./queries/parsers";
import type { QueryIntent } from "./queries/types";

// ─── digit normalization ────────────────────────────────────────────────
// Web Speech often returns numbers as English words ("forty two") or with
// spaces ("0 4 2"). We collapse both into pure digit strings before
// pattern-matching.

const WORD_TO_DIGIT: Record<string, string> = {
    zero: "0", oh: "0", o: "0",
    one: "1", two: "2", three: "3", four: "4", five: "5",
    six: "6", seven: "7", eight: "8", nine: "9",
    ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
    fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
    twenty: "20", thirty: "30", forty: "40", fifty: "50",
    sixty: "60", seventy: "70", eighty: "80", ninety: "90",
    hundred: "100",
};

function normalizeDigits(input: string): string {
    let s = input.toLowerCase();
    // word → digit (one pass, simple lookup)
    s = s.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/g,
        (m) => WORD_TO_DIGIT[m] ?? m);
    // compose adjacent number words: "twenty 5" → "25", "forty two" → "42"
    s = s.replace(/\b([2-9]0)\s+(\d)\b/g, (_, tens, ones) => String(Number(tens) + Number(ones)));
    // Collapse digits ONLY when the first one is "0" (an unambiguous padded
    // ID like "0 4 2" → "042"). We must NOT collapse "1 2 3" because that
    // means three separate IDs; over-merging is the worst kind of error
    // because it silently picks the wrong member.
    s = s.replace(/\b0\s+(\d)(?:\s+(\d))?(?:\s+(\d))?(?:\s+(\d))?\b/g,
        (...m) => "0" + m.slice(1, 5).filter(Boolean).join(""));
    return s;
}

// ─── clause splitting ───────────────────────────────────────────────────

function splitClauses(transcript: string): string[] {
    // Sentence terminators + connecting words receptionists naturally use.
    // We treat each as a clause boundary.
    return transcript
        .split(/[.;!?]+|\bthen\b|\balso\b|\band also\b/i)
        .map((c) => c.trim())
        .filter(Boolean);
}

// ─── subject extraction (ids + names + ranges + "all") ────────────────
// A "subject" is a single member reference: either an id ("042"), a
// spoken name ("prasad"), or a range that we expand into ids.

type Subject =
    | { kind: "id"; value: string }
    | { kind: "name"; value: string };

// Words we strip off the front of each subject before classifying.
const SUBJECT_PREFIX_RE = /^(members?|id|number|the)\s+/i;

function extractSubjects(clause: string, sessionIds: string[], members: Member[]): { subjects: Subject[]; usesAll: boolean } {
    const lc = clause.toLowerCase();
    const usesAll = /\bfor\s+(all|everyone|all of them)\b/.test(lc);
    if (usesAll) {
        const ids = Array.from(new Set(sessionIds));
        return { subjects: ids.map((v) => ({ kind: "id" as const, value: v })), usesAll };
    }

    // Pull the slice after "for" — that's our subject list. If no "for",
    // use the whole clause minus action/item words (still useful when the
    // receptionist drops "for" in fast speech).
    const forMatch = lc.match(/\bfor\s+(.+)$/);
    let subjectPart = forMatch ? forMatch[1] : lc;
    subjectPart = subjectPart.replace(/[.!?]+$/, "").trim();

    // Strip action / order verbs that may sit in the subject slice when
    // there's no "for" — e.g. "mark attendance prasad" → "prasad".
    subjectPart = subjectPart
        .replace(/\b(mark attendance|attendance|check ?in|order|shake|present|arrived|arrival|give|make)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // Split on commas / "and" / Oxford comma. Each piece is one subject.
    const pieces = subjectPart.split(/\s*(?:,|\band\b)\s*/).map((p) => p.trim()).filter(Boolean);

    const subjects: Subject[] = [];
    for (const rawPiece of pieces) {
        // Strip "member(s)" / "id" / "number" / "the" prefix first so it
        // doesn't fail downstream pattern matches.
        const piece = rawPiece.replace(SUBJECT_PREFIX_RE, "").trim();
        if (!piece) continue;

        // Range: "011 to 020"
        const rangeMatch = piece.match(/^(\d+)\s*(?:to|through|-)\s*(\d+)$/);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            if (end < start || end - start > 100) continue;
            const width = Math.max(rangeMatch[1].length, rangeMatch[2].length);
            for (let n = start; n <= end; n++) {
                subjects.push({ kind: "id", value: String(n).padStart(width, "0") });
            }
            continue;
        }

        // Space-separated digit groups: "011 012 013" → three ids.
        // The fix for "1, 2, 3" → "123" bug: receptionists who say
        // "one two three" without commas still mean three separate ids.
        if (/^\d+(\s+\d+)+$/.test(piece)) {
            for (const sub of piece.split(/\s+/)) {
                subjects.push({ kind: "id", value: sub });
            }
            continue;
        }

        // Single id
        if (/^\d+$/.test(piece)) {
            subjects.push({ kind: "id", value: piece });
            continue;
        }

        // Mixed: "1 Prasad", "Prasad 1", "MNC 42" — receptionist says both
        // the id and the name to skip disambiguation when names collide.
        // ID wins; the spoken name is discarded (the review card shows the
        // real name + photo so the receptionist verifies visually).
        const mixedMatch = piece.match(/\d+/);
        if (mixedMatch && /[a-z]/i.test(piece)) {
            subjects.push({ kind: "id", value: mixedMatch[0] });
            continue;
        }

        // Name (must contain a letter, ≥2 chars)
        if (piece.length >= 2 && /[a-z]/.test(piece)) {
            // Smart split: receptionists often forget commas in fast speech
            // ("vignesh shek sujata ashwini"). If the piece is 2+ words AND
            // each individual word resolves to exactly one member, treat
            // them as separate names. If splitting introduces ambiguity,
            // keep it as one phrase (e.g. "Arun Kumar" stays whole because
            // splitting would make each word ambiguous).
            const words = piece.split(/\s+/);
            if (words.length >= 2) {
                const individualMatches = words.map((w) => matchByName(w, members));
                const allUnique = individualMatches.every((ms) => ms.length === 1);
                if (allUnique) {
                    for (const w of words) subjects.push({ kind: "name", value: w });
                    continue;
                }
            }
            subjects.push({ kind: "name", value: piece });
        }
    }
    return { subjects, usesAll };
}

// ─── action detection ───────────────────────────────────────────────────

const ATTENDANCE_KEYWORDS = ["mark attendance", "attendance", "check in", "checkin", "present", "arrived", "arrival"];
const ORDER_KEYWORDS = ["order", "shake for", "give", "make"];

function detectAction(clause: string): ActionKind | null {
    const lc = clause.toLowerCase();
    const hasAttendance = ATTENDANCE_KEYWORDS.some((k) => lc.includes(k));
    const hasOrder = ORDER_KEYWORDS.some((k) => lc.includes(k));
    if (hasAttendance && hasOrder) return "both";
    if (hasAttendance) return "attendance";
    // Ordering a shake at reception ALWAYS implies the member just arrived,
    // so attendance is auto-marked alongside the order. This mirrors the
    // manual flow: receptionist checks the member in, then takes the order.
    if (hasOrder) return "both";
    return null;
}

// ─── item matching ──────────────────────────────────────────────────────
// We always try today's specials first because that's what receptionists
// reach for ("mango", "special"). If nothing matches, fall back to any
// product whose name shares ≥1 word with the clause.

function matchItem(clause: string, products: Product[]): Product | null {
    const lc = clause.toLowerCase();

    // Direct phrase match: "special" / "today's special" → first special product
    if (/\b(today'?s special|special shake|the special|special)\b/.test(lc)) {
        const first = products[0];
        if (first) return first;
    }

    // Score each product by how many of its name-words appear in the clause
    let best: { product: Product; score: number } | null = null;
    for (const p of products) {
        const nameWords = p.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        let score = 0;
        for (const w of nameWords) {
            if (lc.includes(w)) score += 1;
        }
        if (score > 0 && (!best || score > best.score)) {
            best = { product: p, score };
        }
    }
    return best?.product ?? null;
}

// ─── member matching ────────────────────────────────────────────────────
// Receptionist says "member zero four two" → we normalized to "042".
// Members in DB have `memberId` like "MNC-042". We match on the digit
// suffix after stripping the prefix.

function matchMember(spokenDigits: string, members: Member[]): Member | null {
    const target = spokenDigits.replace(/^0+/, "") || "0"; // numeric form for compare
    // Build a digit-only key from each member's memberId
    for (const m of members) {
        if (!m.memberId) continue;
        const digitsOnly = m.memberId.replace(/\D/g, "");
        if (!digitsOnly) continue;
        // match if numeric values equal (handles MNC-042 vs spoken "42" or "042")
        if (digitsOnly.replace(/^0+/, "") === target) return m;
    }
    return null;
}

// ─── name matching (fuzzy, returns candidates) ─────────────────────────
// Receptionist may say "prasad" when there are 3 Prasads in the system —
// we return all reasonable candidates and let the review card disambiguate.
// Scoring tiers are kept simple and explainable on purpose.

function matchByName(query: string, members: Member[]): Member[] {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];
    const qWords = q.split(/\s+/).filter(Boolean);

    const scored: { member: Member; score: number }[] = [];
    for (const m of members) {
        if (!m.name) continue;
        const name = m.name.toLowerCase();
        const nameWords = name.split(/\s+/).filter(Boolean);

        let score = 0;
        if (name === q) score = 100;
        else if (qWords.every((w) => nameWords.includes(w))) score = 95;
        else if (nameWords.some((w) => w === q)) score = 90;
        else if (name.includes(q)) score = 80;
        else if (nameWords.some((w) => w.startsWith(q))) score = 70;
        else if (qWords.some((w) => nameWords.some((nw) => nw.startsWith(w)))) score = 50;

        if (score > 0) scored.push({ member: m, score });
    }

    if (scored.length === 0) return [];
    scored.sort((a, b) => b.score - a.score);
    // Keep top tier (within 10 points of the best) so close ties surface
    // as candidates instead of one being silently chosen.
    const top = scored[0].score;
    return scored.filter((s) => s.score >= top - 10).map((s) => s.member);
}

// ─── first day parsing ─────────────────────────────────────────────────
// Receptionist patterns:
//   "first day for David, number 9876543210, invited by Prasad"
//   "new first day David Kumar phone 9876543210 by 042"
//   "first day David 9 8 7 6 5 4 3 2 1 0 invited by Prasad"

const FIRST_DAY_RE = /\b(?:new\s+)?first\s*day\b/i;
const INVITER_RE = /\b(?:invited by|called by|brought by|referred by|by member|by)\s+(.+?)(?:[.,;]|$)/i;
const PHONE_FILLER_RE = /\b(?:number|num|phone|mobile|mob|whose number is|whose phone is|is)\b/gi;

function parseFirstDayClause(clause: string, members: Member[]): FirstDayData | null {
    if (!FIRST_DAY_RE.test(clause)) return null;

    let work = clause;

    // 1. Inviter — pull everything after "invited by ..." (or similar)
    let inviterRaw: string | null = null;
    const invMatch = work.match(INVITER_RE);
    if (invMatch && invMatch.index !== undefined) {
        inviterRaw = invMatch[1].trim();
        work = work.slice(0, invMatch.index).trim();
    }

    // 2. Phone — longest 10+ digit run (allow spaces between digits)
    let phoneDigits = "";
    const phoneMatch = work.match(/(\d[\d\s]{8,}\d)/);
    if (phoneMatch && phoneMatch.index !== undefined) {
        phoneDigits = phoneMatch[1].replace(/\D/g, "");
        work = (work.slice(0, phoneMatch.index) + " " + work.slice(phoneMatch.index + phoneMatch[0].length)).trim();
    }

    // 3. Name — what's left after stripping "first day", filler words, punctuation
    let name = work
        .replace(FIRST_DAY_RE, " ")
        .replace(/\b(?:for|of|the)\b/gi, " ")
        .replace(PHONE_FILLER_RE, " ")
        .replace(/[,.;]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    // Title-case the name for display
    name = name.split(" ").map((w) => w ? w[0].toUpperCase() + w.slice(1) : "").join(" ").trim();

    // 4. Resolve inviter — strip prefix words then try ID first, then name.
    //    "member 042" → "042" → id match; "Prasad" → name match.
    let inviterMatch: Member | null = null;
    let inviterCandidates: Member[] | undefined;
    if (inviterRaw) {
        const cleanedInviter = inviterRaw
            .replace(/[.,;]+$/, "")
            .replace(/^(?:member|the member|id|number|num)\s+/i, "")
            .trim();
        const justDigits = cleanedInviter.replace(/\D/g, "");
        if (justDigits && cleanedInviter.replace(/[^\w]/g, "").replace(/\d/g, "").length === 0) {
            // Cleaned text contained only digits (and maybe punctuation)
            inviterMatch = matchMember(justDigits, members);
        } else {
            const candidates = matchByName(cleanedInviter, members);
            if (candidates.length === 1) inviterMatch = candidates[0];
            else if (candidates.length > 1) inviterCandidates = candidates.slice(0, 6);
        }
    }

    return { name, phoneDigits, inviterRaw, inviterMatch, inviterCandidates };
}

// ─── main parse ─────────────────────────────────────────────────────────

export interface ParseInput {
    transcript: string;
    members: Member[];
    products: Product[];                  // today's available shakes
    plans?: MembershipPlan[];             // membership plans (for renewal intent)
    inventory?: InventoryProductLite[];   // inventory items (for product sale)
}

// Top-level "intent" detector that runs BEFORE the action parser. If
// the transcript matches a query pattern, the overlay short-circuits
// past the review-gallery stage and executes the read-only handler
// directly. Returns null if it's not a query (then normal parsing runs).
export function parseQueryIntent(input: ParseInput): QueryIntent | null {
    const { transcript, members } = input;
    const memberByDigits = (d: string) => matchMember(d, members);
    // Queries are usually one-clause sentences, so try the whole transcript
    // as a single clause first; only fall back to per-clause if needed.
    const whole = transcript.trim();
    return parseQueryClause({
        clause: whole, members,
        matchByName, matchMemberByDigits: memberByDigits,
    });
}

export function parseMagicianTranscript(input: ParseInput): ParseResult {
    const { transcript, members, products } = input;
    const plans = input.plans ?? [];
    const inventory = input.inventory ?? [];
    const warnings: string[] = [];
    const normalized = normalizeDigits(transcript);
    const clauses = splitClauses(normalized);

    // Carry context across clauses:
    //   sessionIds  → every member id mentioned so far ("for all" reuses these)
    //   lastItem    → most recently named shake (for clauses that say
    //                 "and for 088" without re-stating the item)
    const sessionIds: string[] = [];
    let lastItem: Product | null = null;

    interface PendingRow {
        rawSegment: string;
        subject: Subject;
        action: ActionKind;
        itemName: string | null;
        itemMatch: Product | null;
        firstDay?: FirstDayData;
        payment?: PaymentIntent;
    }
    const pending: PendingRow[] = [];

    // Helpers bound to this call's roster so the payment-intent parsers
    // can call them without needing to re-pass `members` every time.
    const memberByDigits = (d: string) => matchMember(d, members);

    for (const clause of clauses) {
        // Paid intents take priority over attendance/order detection so
        // "one-day shake" doesn't fall through to the regular order path.
        const oneDayIntent = parseOneDayShakeClause(clause, members, products, memberByDigits, matchByName, matchItem);
        if (oneDayIntent) {
            pending.push({
                rawSegment: clause,
                subject: { kind: "name", value: oneDayIntent.payload.kind === "oneday_shake" ? oneDayIntent.payload.member.name || "" : "" },
                action: "oneday_shake",
                itemName: null, itemMatch: null,
                payment: oneDayIntent,
            });
            continue;
        }
        const dayRedeemIntent = parseDayRedeemClause(clause, members, products, memberByDigits, matchByName, matchItem);
        if (dayRedeemIntent) {
            pending.push({
                rawSegment: clause,
                subject: { kind: "name", value: dayRedeemIntent.payload.kind === "day_redeem" ? dayRedeemIntent.payload.member.name || "" : "" },
                action: "day_redeem",
                itemName: null, itemMatch: null,
                payment: dayRedeemIntent,
            });
            continue;
        }
        const topupIntent = parseTopupClause(clause, members, memberByDigits, matchByName);
        if (topupIntent) {
            pending.push({
                rawSegment: clause,
                subject: { kind: "name", value: topupIntent.payload.kind === "topup" ? topupIntent.payload.member.name || "" : "" },
                action: "topup",
                itemName: null, itemMatch: null,
                payment: topupIntent,
            });
            continue;
        }
        if (plans.length > 0) {
            const planIntent = parsePlanRenewalClause(clause, members, plans, memberByDigits, matchByName);
            if (planIntent) {
                pending.push({
                    rawSegment: clause,
                    subject: { kind: "name", value: planIntent.payload.kind === "plan_renewal" ? planIntent.payload.member.name || "" : "" },
                    action: "plan_renewal",
                    itemName: null, itemMatch: null,
                    payment: planIntent,
                });
                continue;
            }
        }
        if (inventory.length > 0) {
            const saleIntent = parseProductSaleClause(clause, members, inventory, memberByDigits, matchByName);
            if (saleIntent) {
                pending.push({
                    rawSegment: clause,
                    subject: { kind: "name", value: saleIntent.payload.kind === "product_sale" ? saleIntent.payload.buyer.name || "" : "" },
                    action: "product_sale",
                    itemName: null, itemMatch: null,
                    payment: saleIntent,
                });
                continue;
            }
        }

        // First Day intent — also its own grammar.
        const fd = parseFirstDayClause(clause, members);
        if (fd) {
            pending.push({
                rawSegment: clause,
                subject: { kind: "name", value: fd.name || "(unnamed)" },
                action: "first_day",
                itemName: "First Day Shake",
                itemMatch: null,
                firstDay: fd,
            });
            continue;
        }

        const action = detectAction(clause);
        const item = matchItem(clause, products) ?? lastItem;

        if (!action && !item) {
            // No verb and no shake noun — nothing to do
            continue;
        }
        if (!action && item) {
            // Item-only clause ("mango for 042" or continuation "for 088")
            // → implicit order + attendance (same as explicit "order")
            const { subjects } = extractSubjects(clause, sessionIds, members);
            if (subjects.length === 0) continue;
            lastItem = item;
            for (const subj of subjects) {
                if (subj.kind === "id") sessionIds.push(subj.value);
                pending.push({
                    rawSegment: clause,
                    subject: subj,
                    action: "both",
                    itemName: item.name,
                    itemMatch: item,
                });
            }
            continue;
        }

        // We have an action verb (and possibly an item)
        if (item && (action === "order" || action === "both")) {
            lastItem = item;
        }

        const { subjects, usesAll } = extractSubjects(clause, sessionIds, members);
        if (subjects.length === 0) {
            warnings.push(`No member in: "${clause}"`);
            continue;
        }
        for (const subj of subjects) {
            if (!usesAll && subj.kind === "id") sessionIds.push(subj.value);
            pending.push({
                rawSegment: clause,
                subject: subj,
                action: action!,
                itemName: item?.name ?? null,
                itemMatch: (action === "attendance") ? null : item,
            });
        }
    }

    // Validate every pending row against the member DB
    const actions: ParsedAction[] = pending.map((p, idx) => {
        // Paid intents: validity is determined by the parser already
        // (member resolved, item resolved, amount > 0, no error string).
        if (p.payment) {
            const member = "member" in p.payment.payload ? p.payment.payload.member : null;
            return {
                id: `mg_${idx}_${p.action}`,
                rawSegment: p.rawSegment,
                memberIdSpoken: member?.name || "",
                memberMatch: member,
                action: p.action,
                itemName: null, itemMatch: null,
                status: p.payment.error ? "needs_member" : "ready",
                payment: p.payment,
            };
        }

        // First Day rows: status comes from whether name+phone parsed OK.
        // No member match — guest is brand new.
        if (p.action === "first_day" && p.firstDay) {
            const fd = p.firstDay;
            const status: RowStatus = (!fd.name || fd.phoneDigits.length < 5)
                ? "needs_member"   // missing required fields → reuse this state
                : "ready";
            return {
                id: `mg_${idx}_fd_${fd.phoneDigits || "x"}`,
                rawSegment: p.rawSegment,
                memberIdSpoken: fd.name || "(unnamed)",
                memberMatch: null,
                action: p.action,
                itemName: p.itemName,
                itemMatch: p.itemMatch,
                status,
                firstDay: fd,
            };
        }

        let memberMatch: Member | null = null;
        let candidates: Member[] | undefined;
        if (p.subject.kind === "id") {
            memberMatch = matchMember(p.subject.value, members);
        } else {
            const matched = matchByName(p.subject.value, members);
            if (matched.length === 1) memberMatch = matched[0];
            else if (matched.length > 1) candidates = matched.slice(0, 6);
        }

        let status: RowStatus;
        if (!memberMatch) status = "needs_member";
        else if (memberMatch.couplePartnerId) status = "needs_couple";
        else if ((p.action === "order" || p.action === "both") && !p.itemMatch) status = "needs_item";
        else status = "ready";

        return {
            id: `mg_${idx}_${p.subject.value}`,
            rawSegment: p.rawSegment,
            memberIdSpoken: p.subject.value,
            memberMatch,
            candidates,
            action: p.action,
            itemName: p.itemName,
            itemMatch: p.itemMatch,
            status,
        };
    });

    // Mark duplicates (same member + same action set)
    const seen = new Set<string>();
    for (const a of actions) {
        if (!a.memberMatch) continue;
        const key = `${a.memberMatch.id}|${a.action}|${a.itemMatch?.id ?? "att"}`;
        if (seen.has(key)) a.status = "duplicate";
        else seen.add(key);
    }

    return { transcript, actions, warnings };
}

// Exported for direct testing
export const __internal = { normalizeDigits, splitClauses, extractSubjects, detectAction, matchItem, matchMember, matchByName };
