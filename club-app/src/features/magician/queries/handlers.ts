import { collection, getDocs, query, where } from "firebase/firestore";
import { toast } from "sonner";
import { db } from "@/lib/firebase";
import { summarizeMoney } from "@/lib/paymentSplit";
import type { QueryIntent } from "./types";
import { speak } from "./tts";

// ─── Magician query handlers ──────────────────────────────────────────
// Each handler:
//   1. Fetches the data with a one-shot query (no live listeners)
//   2. Speaks a short answer via TTS
//   3. Shows a toast with the same answer (visual fallback)
//   4. For navigation queries, calls back to the parent (Reception) so
//      it can open the right modal / screen.

const todayStr = () => new Date().toISOString().slice(0, 10);
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export interface QueryHandlerCallbacks {
    onOpenTodayReport: () => void;
    onOpenMemberProfile: (memberId: string) => void;
    onPrintTodayReport: () => void;
}

export interface QueryHandlerContext {
    clubId: string;
    callbacks: QueryHandlerCallbacks;
}

function announce(text: string) {
    toast.message(text, { duration: 5000 });
    speak(text);
}

async function countToday(clubId: string, collectionName: string): Promise<number> {
    const snap = await getDocs(
        query(collection(db, `clubs/${clubId}/${collectionName}`), where("date", "==", todayStr()))
    );
    return snap.size;
}

// The three money answers must reconcile with each other. They used to be three
// independent sums of three raw fields over the same documents, with no deleted
// filter — the only place in the app where nothing at all forced cash + UPI to
// equal the total. One read, one shared summary.
async function moneyToday(clubId: string) {
    const snap = await getDocs(
        query(collection(db, `clubs/${clubId}/payments`), where("date", "==", todayStr()))
    );
    const payments = snap.docs.map(d => d.data() as any).filter(p => !p.deleted);
    return summarizeMoney(payments);
}

async function todayAttendanceCount(clubId: string): Promise<number> {
    // Members with lastVisit === today (same source TodayActivityDrawer uses).
    const snap = await getDocs(collection(db, `clubs/${clubId}/members`));
    return snap.docs.filter((d) => (d.data() as any).lastVisit === todayStr()).length;
}

async function activeMemberCount(clubId: string): Promise<number> {
    const snap = await getDocs(collection(db, `clubs/${clubId}/members`));
    return snap.docs.filter((d) => {
        const data = d.data() as any;
        return data.status === "active" || data.isActiveMember === true;
    }).length;
}

async function memberActivityToday(clubId: string, memberId: string): Promise<{
    cameToday: boolean;
    checkInTime: string;
    orders: { name: string; price: number }[];
    walletDebits: number;
}> {
    // Attendance — same path useTodayAttendance uses
    const attSnap = await getDocs(
        query(
            collection(db, `clubs/${clubId}/members/${memberId}/attendance`),
            where("date", "==", todayStr()),
        )
    );
    const memberAtt = attSnap.docs.find((d) => (d.data() as any).type === "member");
    const cameToday = !!memberAtt;
    const checkInTime = memberAtt
        ? ((memberAtt.data() as any).checkInTime?.toDate?.()?.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) ?? "")
        : "";

    // Today's orders for this member
    const orderSnap = await getDocs(
        query(
            collection(db, `clubs/${clubId}/orders`),
            where("date", "==", todayStr()),
            where("memberId", "==", memberId),
        )
    );
    const orders = orderSnap.docs.flatMap((d) => {
        const data = d.data() as any;
        return (data.items ?? []).map((it: any) => ({
            name: it.productName || it.itemName || "Item",
            price: it.price || it.pricePerUnit || 0,
        }));
    });

    return { cameToday, checkInTime, orders, walletDebits: 0 };
}

// ─── dispatcher ────────────────────────────────────────────────────────

export async function executeQuery(intent: QueryIntent, ctx: QueryHandlerContext): Promise<void> {
    switch (intent.kind) {
        case "report_today":
            announce("Opening today's report");
            ctx.callbacks.onOpenTodayReport();
            return;

        case "print_report":
            announce("Printing today's report");
            ctx.callbacks.onPrintTodayReport();
            return;

        case "amount_cash_today": {
            const m = await moneyToday(ctx.clubId);
            announce(`Cash collected today: ${inr(m.cashCollected)}`);
            return;
        }
        case "amount_upi_today": {
            const m = await moneyToday(ctx.clubId);
            announce(`U P I collected today: ${inr(m.upiCollected)}`);
            return;
        }
        case "amount_total_today": {
            const m = await moneyToday(ctx.clubId);
            announce(`Total collected today: ${inr(m.totalCollected)}`);
            return;
        }
        case "count_shakes_today": {
            const n = await countToday(ctx.clubId, "orders");
            announce(`${n} shake order${n === 1 ? "" : "s"} today`);
            return;
        }
        case "count_guests_today": {
            const n = await countToday(ctx.clubId, "guestEntries");
            announce(`${n} guest${n === 1 ? "" : "s"} today`);
            return;
        }
        case "count_attendance_today": {
            const n = await todayAttendanceCount(ctx.clubId);
            announce(`${n} member${n === 1 ? "" : "s"} came today`);
            return;
        }
        case "count_absent_today": {
            const [active, here] = await Promise.all([
                activeMemberCount(ctx.clubId),
                todayAttendanceCount(ctx.clubId),
            ]);
            const absent = Math.max(0, active - here);
            announce(`${absent} of ${active} active members have not come yet today`);
            return;
        }

        case "member_today": {
            if (!intent.member) {
                if (intent.memberCandidates && intent.memberCandidates.length > 0) {
                    announce(`Found ${intent.memberCandidates.length} matches for "${intent.memberSpoken}" — be more specific`);
                } else {
                    announce(`Sorry, I could not find "${intent.memberSpoken}"`);
                }
                return;
            }
            const m = intent.member;
            const act = await memberActivityToday(ctx.clubId, m.id);
            if (!act.cameToday) {
                announce(`${m.name} has not come today`);
                return;
            }
            const orderSummary = act.orders.length === 0
                ? "no orders yet"
                : act.orders.length === 1
                    ? `ordered ${act.orders[0].name}`
                    : `ordered ${act.orders.length} items including ${act.orders[0].name}`;
            announce(`${m.name} checked in at ${act.checkInTime}, ${orderSummary}`);
            return;
        }

        case "member_profile": {
            if (!intent.member) {
                announce(`Sorry, I could not find "${intent.memberSpoken}"`);
                return;
            }
            announce(`Opening ${intent.member.name}'s profile`);
            ctx.callbacks.onOpenMemberProfile(intent.member.id);
            return;
        }
    }
}
