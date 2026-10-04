import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ConfirmedAction, ParsedAction } from "./types";

// ─── logMagicianSession ────────────────────────────────────────────────
// One doc per voice session. Captures raw transcript, what the parser
// produced, what the receptionist actually confirmed/edited, and any
// rows that were removed. Used for debugging and trust ("what did the
// system hear vs what fired").

export async function logMagicianSession(args: {
    clubId: string;
    receptionistId: string;
    receptionistName: string;
    rawTranscript: string;
    parsed: ParsedAction[];
    confirmed: ConfirmedAction[];
    skippedCount: number;
}): Promise<void> {
    try {
        await addDoc(collection(db, `clubs/${args.clubId}/magicianLogs`), {
            timestamp: serverTimestamp(),
            receptionistId: args.receptionistId,
            receptionistName: args.receptionistName,
            rawTranscript: args.rawTranscript,
            parsedCount: args.parsed.length,
            parsed: args.parsed.map((p) => ({
                memberIdSpoken: p.memberIdSpoken,
                memberMatchedId: p.memberMatch?.id ?? null,
                memberMatchedCode: p.memberMatch?.memberId ?? null,
                action: p.action,
                itemName: p.itemName,
                itemMatchedId: p.itemMatch?.id ?? null,
                status: p.status,
            })),
            confirmedCount: args.confirmed.length,
            confirmed: args.confirmed.map((c) => ({
                memberId: c.memberMatch.id,
                memberCode: c.memberMatch.memberId ?? null,
                action: c.action,
                itemId: c.itemMatch?.id ?? null,
                coupleChoice: c.coupleChoice ?? null,
            })),
            skippedCount: args.skippedCount,
        });
    } catch (err) {
        // Audit logging is best-effort; never block the main submit flow.
        console.warn("[magician] audit log failed:", err);
    }
}
