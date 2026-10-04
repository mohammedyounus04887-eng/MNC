/**
 * Serve Station — hand shakes over by scanning the member's card.
 *
 * The server picks their own name once at the start of the shift, then scans
 * each member's card as they hand the shake over. The order records who served
 * it and when.
 *
 * That record is the point. "I did serve it" against "I never got my shake"
 * currently has no answer, and the argument lands on whoever is least able to
 * defend themselves. With a scan there is either a record — server, member,
 * time — or there isn't, and if there isn't, the member is right and gets their
 * shake. It protects the servers as much as it checks them, which is also why
 * it is easy to introduce to staff.
 *
 * Serving reuses the existing order-status pipe, so kitchen stock is still
 * deducted exactly once, transactionally.
 */

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useClubMembers } from "@/hooks/useOwner";
import { useUpdateOrderStatus } from "@/hooks/useOrders";
import { useCardScanner } from "@/lib/qrScan";
import { todayLocal } from "@/lib/clubDay";

const SERVER_KEY = "mnh_serving_as";

type Flash = { kind: "serve" | "already" | "none" | "err"; title: string; detail?: string } | null;

const timeOf = (ts: any): string => {
    try {
        const d = ts?.toDate ? ts.toDate() : new Date(ts);
        return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    } catch {
        return "";
    }
};

const itemsLabel = (o: any) =>
    (o.items || [])
        .map((i: any) => `${i.productName || i.itemName || "Shake"}${(i.quantity || i.qty || 1) > 1 ? ` ×${i.quantity || i.qty}` : ""}`)
        .join(", ");

export default function ServeStationPage() {
    const { club } = useClubContext();
    const clubId = club?.id ?? null;
    const { data: members } = useClubMembers();
    const updateStatus = useUpdateOrderStatus();

    const [server, setServer] = useState<{ id: string; name: string } | null>(() => {
        try {
            const raw = localStorage.getItem(SERVER_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    });
    const [pickOpen, setPickOpen] = useState(false);
    const [pickSearch, setPickSearch] = useState("");
    const [orders, setOrders] = useState<any[]>([]);
    const [flash, setFlash] = useState<Flash>(null);
    const [served, setServed] = useState<{ name: string; item: string; at: string }[]>([]);

    const byId = useMemo(() => {
        const m = new Map<string, any>();
        (members ?? []).forEach((x: any) => m.set(x.id, x));
        return m;
    }, [members]);

    // Today's orders, live.
    useEffect(() => {
        if (!clubId) return;
        return onSnapshot(
            query(collection(db, "clubs", clubId, "orders"), where("date", "==", todayLocal())),
            snap => setOrders(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
            err => console.error("[serve station]", err),
        );
    }, [clubId]);

    const say = (f: Flash) => {
        setFlash(f);
        setTimeout(() => setFlash(null), 4000);
    };

    const handleCard = async (memberId: string) => {
        if (!clubId) return;
        const member = byId.get(memberId);
        const name = member?.name || "Member";

        const theirs = orders.filter(o => o.memberId === memberId);
        const pending = theirs.filter(o => o.status === "pending" || o.status === "preparing");
        const done = theirs.filter(o => o.status === "served");

        if (pending.length === 0) {
            if (done.length > 0) {
                const last = done[done.length - 1];
                say({
                    kind: "already",
                    title: `${name} — already served`,
                    detail: `${itemsLabel(last)} at ${timeOf(last.servedAt)}${last.servedByName ? ` by ${last.servedByName}` : ""}`,
                });
            } else {
                say({ kind: "none", title: `${name} has no shake ordered today`, detail: "Send them to reception to order." });
            }
            return;
        }

        // Serve the oldest outstanding order — if they ordered two, the next
        // scan takes the next one.
        const target = pending[0];
        try {
            await updateStatus.mutateAsync({
                clubId,
                orderId: target.id,
                newStatus: "served",
                servedBy: server?.id,
                servedByName: server?.name,
            });
            const at = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
            setServed(prev => [{ name, item: itemsLabel(target), at }, ...prev].slice(0, 30));
            say({
                kind: "serve",
                title: `Serve ${name}`,
                detail: `${itemsLabel(target)}${pending.length > 1 ? ` · ${pending.length - 1} more waiting` : ""}`,
            });
        } catch (e: any) {
            say({ kind: "err", title: "Could not mark served", detail: e?.message });
        }
    };

    useCardScanner({
        onCard: handleCard,
        onUnknown: () => say({ kind: "err", title: "Not a club card" }),
        enabled: !!server && !pickOpen,
    });

    const pending = orders.filter(o => o.status === "pending" || o.status === "preparing");

    // ── Who is serving? ──
    if (!server || pickOpen) {
        const q = pickSearch.trim().toLowerCase();
        const list = (members ?? [])
            .filter((m: any) => !q || [m.name, m.memberId].filter(Boolean).join(" ").toLowerCase().includes(q))
            .slice(0, 24);
        return (
            <div className="p-4 sm:p-6">
                <h1 className="mb-1 text-xl font-black tracking-tight">Who is serving?</h1>
                <p className="mb-5 max-w-xl text-sm text-slate-500">
                    Pick your name once. Every shake you hand over is recorded against it for the rest of the
                    shift.
                </p>
                <input
                    autoFocus
                    value={pickSearch}
                    onChange={e => setPickSearch(e.target.value)}
                    placeholder="Search your name…"
                    className="mb-4 w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300 dark:border-slate-700 dark:bg-slate-900"
                />
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((m: any) => (
                        <button
                            key={m.id}
                            onClick={() => {
                                const s = { id: m.id, name: m.name || "Server" };
                                setServer(s);
                                try { localStorage.setItem(SERVER_KEY, JSON.stringify(s)); } catch { /* private mode */ }
                                setPickOpen(false);
                                setPickSearch("");
                            }}
                            className="rounded-xl border border-slate-200 bg-white p-3 text-left font-bold hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-900"
                        >
                            {m.name}
                            <span className="ml-2 text-xs font-medium text-slate-400">{m.memberId}</span>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6">
            <div className="mb-1 flex flex-wrap items-baseline gap-3">
                <h1 className="text-xl font-black tracking-tight">Serve Station</h1>
                <button
                    onClick={() => setPickOpen(true)}
                    className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white dark:bg-slate-200 dark:text-slate-900"
                >
                    Serving as {server.name} · change
                </button>
                <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-sm font-black text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    {pending.length} waiting
                </span>
            </div>
            <p className="mb-5 max-w-2xl text-sm text-slate-500">
                Scan the member's card as you hand the shake over. If they ordered two, scan again for the
                second.
            </p>

            <div
                className={`mb-6 rounded-2xl border-2 p-7 text-center ${
                    flash?.kind === "serve"
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                        : flash?.kind === "already"
                        ? "border-red-500 bg-red-50 dark:bg-red-950"
                        : flash?.kind === "none"
                        ? "border-amber-500 bg-amber-50 dark:bg-amber-950"
                        : flash?.kind === "err"
                        ? "border-red-500 bg-red-50 dark:bg-red-950"
                        : "border-dashed border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                }`}
            >
                <div className="text-4xl">
                    {flash ? (flash.kind === "serve" ? "✅" : flash.kind === "already" ? "🛑" : flash.kind === "none" ? "🤷" : "⚠️") : "🎴"}
                </div>
                <div className="mt-2 text-2xl font-black">{flash ? flash.title : "Ready — scan a card"}</div>
                {flash?.detail && <div className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">{flash.detail}</div>}
            </div>

            {served.length > 0 && (
                <>
                    <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">
                        Served by you this shift · {served.length}
                    </div>
                    <div className="grid gap-2">
                        {served.map((s, i) => (
                            <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-900">
                                <span className="font-bold">{s.name}</span>
                                <span className="text-slate-500">{s.item}</span>
                                <span className="ml-auto text-xs text-slate-400">{s.at}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
