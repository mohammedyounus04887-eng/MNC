/**
 * Everything the club holds about one member, as a single Excel file.
 *
 * A member's record is scattered across their own document, four
 * subcollections under it, and four club-level collections that merely
 * reference them. Answering "send me everything you have on me", handing a
 * leaver their history, or checking a disputed balance meant opening six
 * screens and copying by hand.
 *
 * One sheet per kind of record, plus a Summary that says what was found. Read
 * only — nothing here writes, so it is safe to run against a live club.
 */

import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { splitOf } from "@/lib/paymentSplit";

/** Firestore Timestamp | Date | ISO string -> "2026-07-24 18:05", or "". */
function fmtWhen(v: any): string {
    if (!v) return "";
    try {
        const d = v?.toDate ? v.toDate() : new Date(v);
        if (isNaN(d.getTime())) return "";
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch {
        return "";
    }
}

/** Firestore Timestamp | Date | ISO string -> "2026-07-24", or "". */
function fmtDay(v: any): string {
    const s = fmtWhen(v);
    return s ? s.slice(0, 10) : "";
}

const num = (v: any) => Number(v) || 0;

/** Docs in a subcollection under the member, oldest first. Never throws. */
async function subcollection(clubId: string, memberId: string, name: string): Promise<any[]> {
    try {
        const snap = await getDocs(collection(db, `clubs/${clubId}/members/${memberId}/${name}`));
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    } catch (e) {
        console.warn(`[exportMember] ${name} unavailable`, e);
        return [];
    }
}

/**
 * Club-level docs that name this member. The id written into `memberId` has
 * not always been the same thing — older rows carry the auth uid or the human
 * code — so match on any of them rather than silently returning nothing.
 */
async function clubLevel(clubId: string, name: string, ids: string[]): Promise<any[]> {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const id of ids) {
        if (!id) continue;
        try {
            const snap = await getDocs(query(collection(db, `clubs/${clubId}/${name}`), where("memberId", "==", id)));
            for (const d of snap.docs) {
                if (seen.has(d.id)) continue;
                seen.add(d.id);
                out.push({ id: d.id, ...(d.data() as any) });
            }
        } catch (e) {
            console.warn(`[exportMember] ${name} for ${id} unavailable`, e);
        }
    }
    return out;
}

const byDayDesc = (a: any, b: any) =>
    String(b.__sort || "").localeCompare(String(a.__sort || ""));

export interface MemberExportResult {
    fileName: string;
    counts: Record<string, number>;
}

/**
 * Build and download the workbook. Returns what was found so the caller can
 * tell the user, rather than leaving them guessing whether an empty sheet
 * means "no data" or "it failed".
 */
export async function downloadMemberData(
    clubId: string,
    memberId: string,
    clubName = "",
): Promise<MemberExportResult> {
    const XLSX = await import("xlsx");

    const memberSnap = await getDoc(doc(db, `clubs/${clubId}/members`, memberId));
    if (!memberSnap.exists()) throw new Error("That member no longer exists in this club.");
    const m: any = { id: memberSnap.id, ...memberSnap.data() };

    // Every id this member has been filed under.
    const ids = Array.from(new Set([memberId, m.uid, m.authUid, m.memberId].filter(Boolean).map(String)));

    const [attendance, transactions, weighIns, invoices, wallet, orders, payments] = await Promise.all([
        subcollection(clubId, memberId, "attendance"),
        subcollection(clubId, memberId, "transactions"),
        subcollection(clubId, memberId, "weighIns"),
        subcollection(clubId, memberId, "invoices"),
        subcollection(clubId, memberId, "wallet"),
        clubLevel(clubId, "orders", ids),
        clubLevel(clubId, "payments", ids),
    ]);

    // ── Profile: one label/value row per field, so nothing is lost to a
    //    column layout that did not anticipate it. Face descriptors are
    //    hundreds of numbers and are deliberately left out.
    const SKIP = new Set(["faceDescriptor", "faceDescriptors", "photo", "photoUrl", "photoURL"]);
    const profile = Object.entries(m)
        .filter(([k]) => !SKIP.has(k))
        .map(([k, v]) => ({
            Field: k,
            Value:
                v == null ? ""
                : (v as any)?.toDate ? fmtWhen(v)
                : typeof v === "object" ? JSON.stringify(v)
                : String(v),
        }));

    const attendanceRows = attendance
        .map(a => ({
            Date: a.date || fmtDay(a.checkInTime),
            "Checked in": fmtWhen(a.checkInTime),
            Method: a.checkInMethod || "",
            "Couple present": a.couplePresence || "",
            __sort: a.date || fmtDay(a.checkInTime),
        }))
        .sort(byDayDesc);

    const orderRows = orders
        .map(o => ({
            Date: o.date || fmtDay(o.createdAt),
            Time: fmtWhen(o.createdAt),
            Token: o.tokenNumber ?? "",
            Items: (o.items || [])
                .map((it: any) => `${it.productName || it.itemName || it.name || "Shake"} x${num(it.quantity ?? it.qty) || 1}`)
                .join(", "),
            Shakes: (o.items || []).reduce((s: number, it: any) => s + (num(it.quantity ?? it.qty) || 1), 0),
            Status: o.status || "",
            "Paid with": o.paymentMethod || "",
            Amount: num(o.totalAmount ?? o.totalCost),
            __sort: o.date || fmtDay(o.createdAt),
        }))
        .sort(byDayDesc);

    const paymentRows = payments
        .map(p => {
            const s = splitOf(p);
            return {
                Date: p.date || fmtDay(p.createdAt),
                Time: fmtWhen(p.createdAt),
                Type: p.type || "",
                Description: p.description || p.planName || "",
                Amount: s.amount,
                Cash: s.cash,
                UPI: s.upi,
                Method: p.paymentMethod || "",
                "UPI account": p.upiAccountName || "",
                Deleted: p.deleted ? "yes" : "",
                __sort: p.date || fmtDay(p.createdAt),
            };
        })
        .sort(byDayDesc);

    const creditRows = transactions
        .map(t => ({
            When: fmtWhen(t.createdAt),
            Type: t.type || "",
            Reason: t.reason || "",
            Description: t.description || t.note || "",
            Amount: num(t.amount),
            "Credits after": t.creditsAfter ?? "",
            Token: t.tokenNumber ?? "",
            __sort: fmtWhen(t.createdAt),
        }))
        .sort(byDayDesc);

    const weighInRows = weighIns
        .map(w => ({
            Date: w.date || fmtDay(w.createdAt),
            "Weight (kg)": num(w.weight),
            "Body fat %": w.bodyFat ?? "",
            Note: w.note || "",
            __sort: w.date || fmtDay(w.createdAt),
        }))
        .sort(byDayDesc);

    const invoiceRows = invoices
        .map(i => ({
            Date: i.date || fmtDay(i.createdAt),
            Number: i.invoiceNumber || i.number || i.id,
            Description: i.description || i.planName || "",
            Amount: num(i.amount ?? i.total),
            __sort: i.date || fmtDay(i.createdAt),
        }))
        .sort(byDayDesc);

    const walletRows = wallet
        .map(w => ({
            When: fmtWhen(w.createdAt),
            Type: w.type || "",
            Reason: w.reason || "",
            Amount: num(w.amount),
            "Balance after": w.balanceAfter ?? "",
            __sort: fmtWhen(w.createdAt),
        }))
        .sort(byDayDesc);

    // ── By day / by month ────────────────────────────────────────────────
    // The raw sheets answer "what happened"; these answer the question the
    // club actually asks — which days was this member here in June, how many
    // shakes did they take, and what did they pay. One row per day with
    // anything on it, and one row per month.
    type DayTally = { present: boolean; shakes: number; paid: number };
    const byDay: Record<string, DayTally> = {};
    const touch = (d: string): DayTally | null => {
        if (!d) return null;
        if (!byDay[d]) byDay[d] = { present: false, shakes: 0, paid: 0 };
        return byDay[d];
    };

    for (const a of attendance) {
        const t = touch(a.date || fmtDay(a.checkInTime));
        if (t) t.present = true;
    }
    for (const o of orders) {
        // Served only, so this agrees with what Reports counts.
        if (o.status !== "served") continue;
        const t = touch(o.date || fmtDay(o.createdAt));
        if (t) t.shakes += (o.items || []).reduce((s: number, it: any) => s + (num(it.quantity ?? it.qty) || 1), 0);
    }
    for (const p of payments) {
        if (p.deleted) continue;
        const t = touch(p.date || fmtDay(p.createdAt));
        if (t) t.paid += splitOf(p).amount;
    }

    const MONTHS = ["January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December"];
    const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const monthNameOf = (d: string) => {
        const mi = Number(d.slice(5, 7)) - 1;
        return `${MONTHS[mi] ?? d.slice(5, 7)} ${d.slice(0, 4)}`;
    };

    const dayKeys = Object.keys(byDay).sort().reverse();
    const dailyRows = dayKeys.map(d => {
        const t = byDay[d];
        let weekday = "";
        try { weekday = WEEKDAYS[new Date(`${d}T00:00:00`).getDay()] ?? ""; } catch { /* leave blank */ }
        return {
            Month: monthNameOf(d),
            Date: d,
            Day: weekday,
            Present: t.present ? "Yes" : "",
            Shakes: t.shakes,
            Paid: Math.round(t.paid),
        };
    });

    const monthAgg: Record<string, { days: number; shakes: number; paid: number }> = {};
    for (const d of dayKeys) {
        const key = d.slice(0, 7);
        if (!monthAgg[key]) monthAgg[key] = { days: 0, shakes: 0, paid: 0 };
        const t = byDay[d];
        if (t.present) monthAgg[key].days += 1;
        monthAgg[key].shakes += t.shakes;
        monthAgg[key].paid += t.paid;
    }
    const monthlyRows = Object.keys(monthAgg).sort().reverse().map(k => ({
        Month: monthNameOf(`${k}-01`),
        "Days present": monthAgg[k].days,
        Shakes: monthAgg[k].shakes,
        Paid: Math.round(monthAgg[k].paid),
    }));

    const strip = (rows: any[]) => rows.map(({ __sort, ...rest }) => rest);

    const sheets: Array<[string, any[]]> = [
        ["By month", monthlyRows],
        ["By day", dailyRows],
        ["Attendance", strip(attendanceRows)],
        ["Shakes", strip(orderRows)],
        ["Payments", strip(paymentRows)],
        ["Credits", strip(creditRows)],
        ["Weigh-ins", strip(weighInRows)],
        ["Invoices", strip(invoiceRows)],
        ["Wallet", strip(walletRows)],
    ];

    const paidTotal = paymentRows.filter(p => !p.Deleted).reduce((s, p) => s + p.Amount, 0);
    const counts: Record<string, number> = {};
    sheets.forEach(([name, rows]) => { counts[name] = rows.length; });

    const summary = [
        { Item: "Member", Value: m.name || "" },
        { Item: "Member ID", Value: m.memberId || "" },
        { Item: "Phone", Value: m.phone || "" },
        { Item: "Club", Value: clubName },
        { Item: "Exported", Value: fmtWhen(new Date()) },
        { Item: "", Value: "" },
        { Item: "Shake credits now", Value: m.shakeCredits ?? "" },
        { Item: "Plan", Value: m.planName || "" },
        { Item: "Plan ends", Value: fmtDay(m.membershipEndDate ?? m.membershipEnd) },
        { Item: "", Value: "" },
        ...sheets.map(([name, rows]) => ({ Item: `${name} (rows)`, Value: rows.length })),
        { Item: "Total paid (live payments)", Value: paidTotal },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(profile), "Profile");
    for (const [name, rows] of sheets) {
        // An empty sheet is a real answer — it says "we hold nothing here" —
        // so write a placeholder row rather than dropping the tab.
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(rows.length ? rows : [{ "No records": "" }]),
            name,
        );
    }

    const safe = String(m.name || m.memberId || memberId).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
    const fileName = `${safe || "member"}-${fmtDay(new Date())}.xlsx`;
    XLSX.writeFile(wb, fileName);

    return { fileName, counts };
}
