/**
 * Data Check — find the damage the duplicate-write bugs left behind.
 *
 * READ ONLY. This page never writes anything. It reads payments and orders,
 * looks for the specific footprints those two bugs leave, and tells you what to
 * look at. Every correction stays a human decision made in Reports.
 *
 * Two bugs, two footprints:
 *
 *  1. Renewal charged twice — the accountant-approval guard released in the same
 *     tick, so two quick taps wrote two payments for one renewal. Because
 *     credits were written as an absolute total, the member's account looked
 *     correct and only the report was wrong. Footprint: same member, same
 *     amount, same day, seconds apart.
 *
 *  2. Shake charged twice — tapping a member's face twice deducted a second
 *     credit and placed a second kitchen order. Footprint: two orders for the
 *     same member and the same item, minutes apart. Here the MEMBER lost, not
 *     the club: they paid a credit for a shake they never received.
 *
 * A wide time gap usually means two genuine purchases, so results are ranked by
 * how close together they are. Anything under a minute is almost certainly the
 * bug; anything over an hour probably is not.
 */

import { useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { todayLocal } from "@/lib/clubDay";
import { splitOf, tenderIsConsistent } from "@/lib/paymentSplit";

const rs = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

const ms = (v: any): number | null => {
    try {
        if (v?.toMillis) return v.toMillis();
        if (v?.toDate) return v.toDate().getTime();
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d.getTime();
    } catch { return null; }
};

const clock = (t: number | null) =>
    t == null ? "—" : new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const gapLabel = (secs: number | null) => {
    if (secs == null) return "unknown gap";
    if (secs < 60) return `${secs}s apart`;
    if (secs < 3600) return `${Math.round(secs / 60)}m apart`;
    return `${(secs / 3600).toFixed(1)}h apart`;
};

/** Under a minute is near-certain; under ten is likely; beyond an hour, probably genuine. */
const confidence = (secs: number | null): { label: string; tone: "high" | "mid" | "low" } => {
    if (secs == null) return { label: "Unknown", tone: "mid" };
    if (secs < 60) return { label: "Almost certainly a duplicate", tone: "high" };
    if (secs < 600) return { label: "Likely a duplicate", tone: "mid" };
    return { label: "Probably two genuine entries", tone: "low" };
};

interface Group {
    key: string;
    who: string;
    memberId: string;
    label: string;
    amount: number;
    date: string;
    times: (number | null)[];
    extra: number;        // how many beyond the first
    minGapSecs: number | null;
}

function groupDuplicates(
    rows: any[],
    keyOf: (r: any) => string | null,
    amountOf: (r: any) => number,
    labelOf: (r: any) => string,
    whoOf: (r: any) => string,
): Group[] {
    const buckets = new Map<string, any[]>();
    for (const r of rows) {
        const k = keyOf(r);
        if (!k) continue;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k)!.push(r);
    }

    const out: Group[] = [];
    for (const [key, list] of buckets) {
        if (list.length < 2) continue;
        const times = list.map(r => ms(r.createdAt)).sort((a, b) => (a ?? 0) - (b ?? 0));
        let minGap: number | null = null;
        for (let i = 1; i < times.length; i++) {
            const a = times[i - 1], b = times[i];
            if (a == null || b == null) continue;
            const g = Math.round((b - a) / 1000);
            if (minGap == null || g < minGap) minGap = g;
        }
        out.push({
            key,
            who: whoOf(list[0]),
            memberId: list[0].memberId ?? "",
            label: labelOf(list[0]),
            amount: amountOf(list[0]),
            date: list[0].date ?? "",
            times,
            extra: list.length - 1,
            minGapSecs: minGap,
        });
    }
    // Closest together first — most likely to be the bug.
    return out.sort((a, b) => (a.minGapSecs ?? 1e9) - (b.minGapSecs ?? 1e9));
}

export default function DataCheckPage() {
    const { club } = useClubContext();
    const clubId = club?.id ?? null;

    const [from, setFrom] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 120);
        return todayLocal(d);
    });
    const [to, setTo] = useState(todayLocal());
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [ran, setRan] = useState(false);
    const [payDupes, setPayDupes] = useState<Group[]>([]);
    const [orderDupes, setOrderDupes] = useState<Group[]>([]);
    const [scanned, setScanned] = useState({ payments: 0, orders: 0 });
    // Payments whose cash + UPI does not equal their own amount. These are the
    // records behind "the columns do not add up to the total": every report has
    // to guess at the difference, and they guess differently.
    const [badTender, setBadTender] = useState<any[]>([]);

    const run = async () => {
        if (!clubId || busy) return;
        setBusy(true); setErr(""); setRan(false);
        try {
            const [paySnap, orderSnap] = await Promise.all([
                getDocs(query(collection(db, "clubs", clubId, "payments"),
                    where("date", ">=", from), where("date", "<=", to))),
                getDocs(query(collection(db, "clubs", clubId, "orders"),
                    where("date", ">=", from), where("date", "<=", to))),
            ]);

            const payments = paySnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                .filter(p => !p.deleted);
            const orders = orderSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                .filter(o => o.status !== "cancelled" && o.status !== "rejected");

            setScanned({ payments: payments.length, orders: orders.length });

            setPayDupes(groupDuplicates(
                payments,
                p => (p.memberId && Number(p.amount) > 0)
                    ? `${p.memberId}|${p.type}|${Number(p.amount)}|${p.date}` : null,
                p => Number(p.amount) || 0,
                p => `${p.type ?? "payment"}${p.planName ? ` · ${p.planName}` : ""}`,
                p => p.memberName || p.memberId || "—",
            ));

            setOrderDupes(groupDuplicates(
                orders.filter(o => o.paymentMethod === "shake_credits"),
                o => {
                    const item = (o.items || []).map((i: any) => i.productName || i.itemName).join("+");
                    return o.memberId ? `${o.memberId}|${item}|${o.date}` : null;
                },
                o => Number(o.creditsUsed) || (o.items || []).length || 1,
                o => (o.items || []).map((i: any) => i.productName || i.itemName || "Shake").join(", ") || "Shake",
                o => o.memberName || o.memberId || "—",
            ));

            setBadTender(payments.filter(p => !tenderIsConsistent(p)));

            setRan(true);
        } catch (e: any) {
            setErr(e?.message || "Could not read the records. Check the date range and try again.");
        } finally {
            setBusy(false);
        }
    };

    const moneyAtRisk = payDupes
        .filter(g => (g.minGapSecs ?? 1e9) < 600)
        .reduce((s, g) => s + g.amount * g.extra, 0);
    const creditsAtRisk = orderDupes
        .filter(g => (g.minGapSecs ?? 1e9) < 600)
        .reduce((s, g) => s + g.amount * g.extra, 0);

    return (
        <div className="p-4 sm:p-6">
            <div className="mb-1 text-xl font-black tracking-tight">Data Check</div>
            <p className="mb-5 max-w-3xl text-sm text-slate-500">
                Looks for the marks left by the two duplicate-write bugs that were fixed on 28 July.
                This page <strong>only reads</strong> — nothing here changes any record. Corrections stay
                yours to make in Reports.
            </p>

            <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <label className="text-sm font-bold">
                    <div className="mb-1 text-xs uppercase tracking-wider text-slate-400">From</div>
                    <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="text-sm font-bold">
                    <div className="mb-1 text-xs uppercase tracking-wider text-slate-400">To</div>
                    <input type="date" value={to} onChange={e => setTo(e.target.value)}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <button onClick={run} disabled={busy}
                    className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">
                    {busy ? "Checking…" : "Run check"}
                </button>
                {ran && (
                    <span className="text-xs text-slate-400">
                        read {scanned.payments} payments · {scanned.orders} orders
                    </span>
                )}
            </div>

            {err && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                    {err}
                </div>
            )}

            {ran && (
                <>
                    <div className="mb-6 grid gap-3 sm:grid-cols-2">
                        <Summary
                            title="Money counted twice"
                            value={rs(moneyAtRisk)}
                            note={payDupes.length === 0
                                ? "No duplicate payments found."
                                : `${payDupes.length} group${payDupes.length === 1 ? "" : "s"} to review · figure covers those under 10 minutes apart`}
                            tone={moneyAtRisk > 0 ? "bad" : "ok"}
                        />
                        <Summary
                            title="Credits taken twice"
                            value={String(creditsAtRisk)}
                            note={orderDupes.length === 0
                                ? "No duplicate shake orders found."
                                : "Shakes members paid a credit for and did not receive — worth giving back"}
                            tone={creditsAtRisk > 0 ? "warn" : "ok"}
                        />
                    </div>

                    {/* The records behind "cash + UPI doesn't equal the total". */}
                    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
                        <div className="mb-1 text-base font-black text-slate-900">Payments that don't add up</div>
                        <p className="mb-3 text-sm text-slate-600">
                            The cash and UPI parts should always add up to the payment's own total. Where they
                            don't, every report has to guess at the difference — and they guess differently, which
                            is why the columns and the total disagree. New payments can no longer be saved this
                            way; these are older records.
                        </p>
                        {badTender.length === 0 ? (
                            <p className="text-sm font-bold text-emerald-700">
                                ✓ All {scanned.payments} payments in this range add up correctly.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-sm font-black text-red-700">
                                    {badTender.length} payment{badTender.length === 1 ? "" : "s"} to correct —
                                    open Reports → Transactions for that day and re-enter the amount.
                                </p>
                                {badTender.map((p) => {
                                    const cash = Number(p.cashAmount) || 0;
                                    const upi = Number(p.upiAmount) || 0;
                                    const amt = Number(p.amount) || 0;
                                    return (
                                        <div key={p.id} className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm">
                                            <div className="font-bold text-slate-900">
                                                {p.memberName || p.guestName || "—"} · {p.type || "payment"} · {p.date}
                                            </div>
                                            <div className="text-red-800 tabular-nums">
                                                cash ₹{cash.toLocaleString("en-IN")} + UPI ₹{upi.toLocaleString("en-IN")} = ₹
                                                {(cash + upi).toLocaleString("en-IN")}, but the payment says ₹{amt.toLocaleString("en-IN")}
                                                {" "}— off by ₹{Math.abs(amt - cash - upi).toLocaleString("en-IN")}.
                                                Reports currently show this as ₹{Math.round(splitOf(p).cash).toLocaleString("en-IN")} cash
                                                and ₹{Math.round(splitOf(p).upi).toLocaleString("en-IN")} UPI.
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <Section
                        title="Possible duplicate payments"
                        blurb="Same member, same type, same amount, same day. Closest together first — the club was over-credited here, so these inflate your revenue figures."
                        groups={payDupes}
                        unit="money"
                    />

                    <Section
                        title="Possible duplicate shake charges"
                        blurb="Same member, same item, same day, paid with credits. Here the member lost — they were charged a credit for a shake that was ordered twice."
                        groups={orderDupes}
                        unit="credits"
                    />

                    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                        <div className="mb-1 font-black text-slate-900">Reading this</div>
                        A gap of a few seconds is the bug — nobody takes two payments from one person in
                        four seconds. A gap of hours is usually two genuine visits. Anything in between is
                        worth checking against the day's paper record before you change anything.
                    </div>
                </>
            )}
        </div>
    );
}

function Summary({ title, value, note, tone }: { title: string; value: string; note: string; tone: "ok" | "warn" | "bad" }) {
    const c = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-emerald-600";
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</div>
            <div className={`mt-1 text-3xl font-black ${c}`} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
            <div className="mt-1 text-xs text-slate-500">{note}</div>
        </div>
    );
}

function Section({ title, blurb, groups, unit }: { title: string; blurb: string; groups: Group[]; unit: "money" | "credits" }) {
    return (
        <div className="mb-6">
            <div className="mb-1 text-base font-black">{title}</div>
            <p className="mb-3 max-w-3xl text-xs text-slate-500">{blurb}</p>
            {groups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400">
                    Nothing found in this range.
                </div>
            ) : (
                <div className="grid gap-2">
                    {groups.map(g => {
                        const conf = confidence(g.minGapSecs);
                        const tone = conf.tone === "high" ? "border-red-300 bg-red-50"
                            : conf.tone === "mid" ? "border-amber-300 bg-amber-50"
                            : "border-slate-200 bg-white";
                        return (
                            <div key={g.key} className={`rounded-xl border p-3 ${tone}`}>
                                <div className="flex flex-wrap items-baseline gap-2">
                                    <span className="font-black">{g.who}</span>
                                    <span className="text-xs text-slate-500">{g.label}</span>
                                    <span className="ml-auto font-black">
                                        {unit === "money" ? rs(g.amount) : `${g.amount} credit${g.amount === 1 ? "" : "s"}`}
                                        <span className="ml-1 text-xs font-bold text-slate-500">× {g.extra + 1}</span>
                                    </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                                    <span className="font-bold">{g.date}</span>
                                    <span>{g.times.map(clock).join("  ·  ")}</span>
                                    <span className="font-bold">{gapLabel(g.minGapSecs)}</span>
                                    <span className={conf.tone === "high" ? "font-black text-red-700"
                                        : conf.tone === "mid" ? "font-bold text-amber-700" : "text-slate-500"}>
                                        {conf.label}
                                    </span>
                                </div>
                                <div className="mt-1 text-xs text-slate-400">
                                    {unit === "money"
                                        ? `Extra counted: ${rs(g.amount * g.extra)}`
                                        : `Credits to return: ${g.amount * g.extra}`}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
