/**
 * Today — the admin home, rebuilt.
 *
 * Written for someone who is not technical and is not looking for a dashboard.
 * Five numbers, in plain words, then the short list of things that actually
 * need doing today. Detail lives one tap away in Reports; it is deliberately
 * not the first thing on screen.
 *
 * Every figure comes from the same places Reports reads, so the two can't
 * disagree — soft-deleted payments are excluded here exactly as they are there,
 * which is what used to make the day's cash count differ from the month's book.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useClubMembers } from "@/hooks/useOwner";
import { todayLocal } from "@/lib/clubDay";
import { splitOf } from "@/lib/paymentSplit";

const rs = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

const daysLeft = (v: any): number | null => {
    if (!v) return null;
    try {
        const d = v?.toDate ? v.toDate() : new Date(v);
        return isNaN(d.getTime()) ? null : Math.ceil((d.getTime() - Date.now()) / 86400000);
    } catch { return null; }
};

export default function TodayPage() {
    const navigate = useNavigate();
    const { club } = useClubContext();
    const clubId = club?.id ?? null;
    const { data: members } = useClubMembers();

    const [payments, setPayments] = useState<any[]>([]);
    const [orders, setOrders] = useState<any[]>([]);
    const [stock, setStock] = useState<any[]>([]);
    const today = todayLocal();

    useEffect(() => {
        if (!clubId) return;
        const unsubs = [
            onSnapshot(
                query(collection(db, "clubs", clubId, "payments"), where("date", "==", today)),
                s => setPayments(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(p => !p.deleted)),
                () => {},
            ),
            onSnapshot(
                query(collection(db, "clubs", clubId, "orders"), where("date", "==", today)),
                s => setOrders(s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
                () => {},
            ),
            onSnapshot(
                collection(db, "clubs", clubId, "inventory"),
                s => setStock(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(p => !p.deleted)),
                () => {},
            ),
        ];
        return () => unsubs.forEach(u => u());
    }, [clubId, today]);

    const money = useMemo(() => {
        let cash = 0, upi = 0, other = 0;
        for (const p of payments) {
            const amt = Number(p.amount) || 0;
            const { cash: c, upi: u } = splitOf(p);
            cash += c; upi += u;
            const residual = amt - c - u;
            if (residual > 0.5) other += residual;
        }
        return { cash, upi, total: cash + upi + other };
    }, [payments]);

    const shakesServed = useMemo(
        () => orders.filter(o => o.status === "served")
            .reduce((s, o) => s + (o.items || []).reduce((n: number, i: any) => n + (Number(i.quantity ?? i.qty) || 1), 0), 0),
        [orders],
    );

    const waiting = orders.filter(o => o.status === "pending" || o.status === "preparing").length;
    const presentToday = (members ?? []).filter((m: any) => m.lastVisit === today).length;

    const expiring = useMemo(
        () => (members ?? [])
            .map((m: any) => ({ m, d: daysLeft(m.membershipEndDate ?? m.membershipEnd) }))
            .filter(x => x.d != null && x.d >= 0 && x.d <= 7)
            .sort((a, b) => (a.d ?? 0) - (b.d ?? 0))
            .slice(0, 8),
        [members],
    );

    const lowStock = useMemo(
        () => stock
            .map(p => ({ p, q: Number(p.quantity) }))
            .filter(x => Number.isFinite(x.q) && x.q <= 5)
            .sort((a, b) => a.q - b.q)
            .slice(0, 8),
        [stock],
    );

    const noCredits = useMemo(
        () => (members ?? []).filter((m: any) => Number(m.shakeCredits) <= 0 && m.status === "active").length,
        [members],
    );

    return (
        <div className="p-4 sm:p-6">
            <div className="mb-1 text-2xl font-black tracking-tight">Today at the club</div>
            <p className="mb-5 text-sm text-muted-foreground">
                {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </p>

            {/* the five numbers */}
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Big label="Money today" value={rs(money.total)} tone="green" />
                <Big label="Cash" value={rs(money.cash)} />
                <Big label="UPI" value={rs(money.upi)} />
                <Big label="Shakes served" value={String(shakesServed)} tone="amber" sub={waiting ? `${waiting} waiting` : undefined} />
                <Big label="Members came" value={String(presentToday)} />
            </div>

            {/* what needs doing */}
            <div className="mb-3 text-sm font-black uppercase tracking-wider text-slate-400">
                Needs your attention
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
                <Card
                    title={`${expiring.length} plan${expiring.length === 1 ? "" : "s"} ending this week`}
                    empty={expiring.length === 0 ? "No plans ending in the next 7 days." : undefined}
                    action={{ label: "Open Members", onClick: () => navigate("../members") }}
                >
                    {expiring.map(({ m, d }) => (
                        <Row
                            key={m.id}
                            left={m.name || "Member"}
                            sub={m.memberId}
                            right={d === 0 ? "ends today" : `${d} day${d === 1 ? "" : "s"}`}
                            tone={d != null && d <= 2 ? "bad" : "warn"}
                        />
                    ))}
                </Card>

                <Card
                    title={`${lowStock.length} item${lowStock.length === 1 ? "" : "s"} running low`}
                    empty={lowStock.length === 0 ? "Nothing is running low." : undefined}
                    action={{ label: "Open Stock", onClick: () => navigate("../inventory") }}
                >
                    {lowStock.map(({ p, q }) => (
                        <Row key={p.id} left={p.name} sub={p.unit} right={q <= 0 ? "out of stock" : `${q} left`} tone={q <= 0 ? "bad" : "warn"} />
                    ))}
                </Card>

                {noCredits > 0 && (
                    <Card
                        title={`${noCredits} active member${noCredits === 1 ? "" : "s"} with no shakes left`}
                        action={{ label: "Open Members", onClick: () => navigate("../members") }}
                    >
                        <div className="px-1 py-2 text-sm text-muted-foreground">
                            They will need to renew before their next shake.
                        </div>
                    </Card>
                )}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
                <Quick label="Reports" onClick={() => navigate("../reports")} />
                <Quick label="Attendance" onClick={() => navigate("../attendance")} />
                <Quick label="Members" onClick={() => navigate("../members")} />
                <Quick label="Member Cards" onClick={() => navigate("../member-cards")} />
            </div>
        </div>
    );
}

function Big({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "green" | "amber" }) {
    const ink = tone === "green" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-foreground dark:text-slate-100";
    return (
        <div className="rounded-2xl border border-slate-200 bg-card p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className={`text-3xl font-black leading-none tracking-tight ${ink}`} style={{ fontVariantNumeric: "tabular-nums" }}>
                {value}
            </div>
            <div className="mt-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">{label}</div>
            {sub && <div className="mt-0.5 text-xs font-semibold text-amber-600">{sub}</div>}
        </div>
    );
}

function Card({ title, children, empty, action }: {
    title: string; children?: React.ReactNode; empty?: string;
    action?: { label: string; onClick: () => void };
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-card p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 flex items-center gap-3">
                <div className="text-sm font-black">{title}</div>
                {action && (
                    <button onClick={action.onClick} className="ml-auto text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-400">
                        {action.label} →
                    </button>
                )}
            </div>
            {empty ? <div className="py-2 text-sm text-slate-400">{empty}</div> : <div className="grid gap-1">{children}</div>}
        </div>
    );
}

function Row({ left, sub, right, tone }: { left: string; sub?: string; right: string; tone: "warn" | "bad" }) {
    const c = tone === "bad" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400";
    return (
        <div className="flex items-center gap-3 border-b border-slate-100 py-1.5 last:border-0 dark:border-slate-800">
            <div className="min-w-0">
                <div className="truncate text-sm font-bold">{left}</div>
                {sub && <div className="truncate text-xs text-slate-400">{sub}</div>}
            </div>
            <div className={`ml-auto whitespace-nowrap text-sm font-black ${c}`}>{right}</div>
        </div>
    );
}

function Quick({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button onClick={onClick} className="rounded-xl border border-slate-200 bg-card px-4 py-2 text-sm font-bold hover:bg-muted dark:border-slate-700 dark:bg-slate-900">
            {label}
        </button>
    );
}
