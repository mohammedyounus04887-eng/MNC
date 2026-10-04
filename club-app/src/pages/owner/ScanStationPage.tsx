/**
 * Scan Station — mark members present with the QR card reader.
 *
 * Point the reader at a member card and they are marked present. No camera, no
 * searching a list of two hundred names, and the record is created by a
 * physical act with a person standing there — which is exactly what the paper
 * register is, so the two can finally agree.
 *
 * Attendance goes through the shared writer (lib/attendance), so a scan here is
 * identical to a reception check-in and is visible on every screen.
 *
 * The scan also places the member's usual shake with the kitchen, so nobody has
 * to repeat at a desk what the scan already knows. The credit is NOT taken here
 * — it is taken when the Serve Station hands the shake over, so a member who
 * scans in and leaves without collecting is not charged (lib/checkinOrder).
 *
 * When the usual shake can't be worked out, nothing is ordered and the row
 * offers the day's menu as one-tap buttons rather than guessing.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useClubMembers } from "@/hooks/useOwner";
import { useCardScanner, parseCardCode } from "@/lib/qrScan";
import { markMemberAttendance } from "@/lib/attendance";
import { resolvePreferredShake, deriveClubFavourites } from "@/lib/preferredShake";
import { createCheckinOrder, type CheckinOrderItem } from "@/lib/checkinOrder";
import { todayLocal } from "@/lib/clubDay";

interface ScanRow {
    key: string;
    memberDocId: string;
    name: string;
    memberId: string;
    photo?: string;
    at: string;
    repeat: boolean;
    shake: string | null;
    shakeSource: string;
    credits: number | null;
    expiresInDays: number | null;
    /** Token if a shake was ordered by this scan. */
    token?: string | number;
    /** Already had an order today — we didn't make a second one. */
    duplicate?: boolean;
    /** No usual shake could be resolved; the row shows the menu to pick from. */
    needsPick?: boolean;
    /** They ordered on their phone — reception confirms it, we don't re-order. */
    preOrder?: string;
}

const daysUntil = (v: any): number | null => {
    if (!v) return null;
    try {
        const d = v?.toDate ? v.toDate() : new Date(v);
        if (isNaN(d.getTime())) return null;
        return Math.ceil((d.getTime() - Date.now()) / 86400000);
    } catch {
        return null;
    }
};

export default function ScanStationPage() {
    const { club } = useClubContext();
    const clubId = club?.id ?? null;
    const { data: members } = useClubMembers();

    const [rows, setRows] = useState<ScanRow[]>([]);
    const [flash, setFlash] = useState<{ kind: "ok" | "repeat" | "err"; text: string } | null>(null);
    const [manual, setManual] = useState("");
    const [busy, setBusy] = useState(false);
    const clubFav = useRef<Record<number, string> | null>(null);
    const [specials, setSpecials] = useState<any[]>([]);
    const [orders, setOrders] = useState<any[]>([]);
    const [pending, setPending] = useState<any[]>([]);
    const [menuPrices, setMenuPrices] = useState<Record<string, number>>({});

    // Today's menu — used to price the usual shake and to offer one-tap picks.
    useEffect(() => {
        if (!clubId) return;
        return onSnapshot(
            query(
                collection(db, "clubs", clubId, "todaysSpecial"),
                where("date", "==", todayLocal()),
            ),
            snap => setSpecials(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
            err => console.error("[scan station] specials", err),
        );
    }, [clubId]);

    // Today's orders, live — so a re-scan doesn't order a second shake.
    useEffect(() => {
        if (!clubId) return;
        return onSnapshot(
            query(
                collection(db, "clubs", clubId, "orders"),
                where("date", "==", todayLocal()),
            ),
            snap => setOrders(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
            err => console.error("[scan station] orders", err),
        );
    }, [clubId]);

    // Outstanding pre-orders from the member app. A member who chose their own
    // shake on their phone must NOT also be auto-ordered here: reception still
    // has their queue card to confirm, and confirming it writes a second order
    // and takes a second credit. Their explicit choice wins over our guess.
    useEffect(() => {
        if (!clubId) return;
        return onSnapshot(
            query(
                collection(db, "clubs", clubId, "pendingCheckins"),
                where("date", "==", todayLocal()),
                where("status", "==", "pending"),
            ),
            snap => setPending(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
            err => console.error("[scan station] pending", err),
        );
    }, [clubId]);

    // Prices live on the menu item, not on the special.
    useEffect(() => {
        if (!clubId) return;
        return onSnapshot(
            collection(db, "clubs", clubId, "menu"),
            snap => {
                const p: Record<string, number> = {};
                snap.docs.forEach(d => { p[d.id] = Number((d.data() as any).price) || 0; });
                setMenuPrices(p);
            },
            err => console.error("[scan station] menu", err),
        );
    }, [clubId]);

    // What can actually be ordered right now, with a usable name and price.
    const orderable = useMemo(
        () => specials
            .filter(s =>
                s.isActive !== false &&
                (s.stockType !== "limited" || (s.remainingStock || 0) > 0))
            .map(s => ({
                ...s,
                displayName: s.name || s.itemName || "Shake",
                price: menuPrices[s.itemId || s.id] ?? 0,
            })),
        [specials, menuPrices],
    );

    const ordersFor = (memberDocId: string) =>
        orders.filter(o => o.memberId === memberDocId);

    /** Place the order and reflect the outcome on that member's row. */
    const placeFor = async (
        rowKey: string,
        member: any,
        item: CheckinOrderItem,
    ) => {
        if (!clubId) return;
        try {
            const res = await createCheckinOrder(clubId, member, [item], ordersFor(member.id));
            setRows(prev => prev.map(r => r.key === rowKey
                ? { ...r, needsPick: false, shake: item.name, token: res.tokenNumber, duplicate: res.duplicate }
                : r));
            if (res.duplicate) show("repeat", `${member.name} already has an order today`);
            else show("ok", `${member.name} — ${item.name} sent to kitchen (#${res.tokenNumber})`);
        } catch (e: any) {
            console.error("[scan station] order failed", e);
            show("err", e?.message || "Marked present, but the order failed.");
        }
    };

    const byId = useMemo(() => {
        const m = new Map<string, any>();
        (members ?? []).forEach((x: any) => m.set(x.id, x));
        return m;
    }, [members]);

    // Club-wide weekday favourites, loaded once — the fallback for anyone
    // without enough history of their own.
    useEffect(() => {
        if (!clubId) return;
        let alive = true;
        deriveClubFavourites(clubId)
            .then(f => { if (alive) clubFav.current = f; })
            .catch(() => { clubFav.current = {}; });
        return () => { alive = false; };
    }, [clubId]);

    const show = (kind: "ok" | "repeat" | "err", text: string) => {
        setFlash({ kind, text });
        setTimeout(() => setFlash(null), 2600);
    };

    const handleMember = async (memberId: string) => {
        if (!clubId || busy) return;
        const member = byId.get(memberId);
        if (!member) {
            show("err", "Card not recognised — is this member in this club?");
            return;
        }
        setBusy(true);
        try {
            const res = await markMemberAttendance({
                clubId,
                memberId,
                memberName: member.name || "",
                memberPhoto: member.photoUrl || member.photo || "",
                method: "card",
            });

            let shake: string | null = null;
            let shakeSource = "none";
            try {
                const pref = await resolvePreferredShake(clubId, memberId, new Date(), clubFav.current ?? undefined);
                shake = pref.name;
                shakeSource = pref.source;
            } catch { /* preference is a nicety, never block the check-in */ }

            const credits = Number(member.shakeCredits);
            const rowKey = `${memberId}-${Date.now()}`;

            // Already chose on their phone — reception confirms that queue card
            // and it writes the order. Auto-ordering here too would give them
            // two shakes and take two credits.
            const preOrder = pending.find(p => p.memberId === memberId);

            // Match the usual shake against today's menu so the order carries a
            // real price and stock link. No match means it isn't on today's
            // menu — treat that as "pick one" rather than ordering a phantom.
            const match = !preOrder && shake
                ? orderable.find(s =>
                    s.displayName.trim().toLowerCase() === shake!.trim().toLowerCase())
                : null;

            setRows(prev => [
                {
                    key: rowKey,
                    memberDocId: memberId,
                    name: member.name || "Member",
                    memberId: member.memberId || "",
                    photo: member.photoUrl || member.photo,
                    at: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
                    repeat: res.alreadyPresent,
                    shake,
                    shakeSource,
                    credits: Number.isFinite(credits) ? credits : null,
                    expiresInDays: daysUntil(member.membershipEndDate ?? member.membershipEnd),
                    needsPick: !match && !preOrder,
                    preOrder: preOrder
                        ? (preOrder.items || [])
                            .map((i: any) => `${i.name}${(i.qty || 1) > 1 ? ` ×${i.qty}` : ""}`)
                            .join(", ")
                        : undefined,
                },
                ...prev,
            ].slice(0, 40));

            show(res.alreadyPresent ? "repeat" : "ok",
                res.alreadyPresent ? `${member.name} — already marked present` : `${member.name} marked present`);

            // Attendance is already saved above; ordering is a bonus on top and
            // must never be able to undo it.
            if (match) {
                await placeFor(rowKey, member, {
                    name: match.displayName,
                    itemId: match.itemId || match.id,
                    price: Number(match.price) || 0,
                    stockType: match.stockType,
                    qty: 1,
                });
            }
        } catch (e: any) {
            show("err", e?.message || "Could not mark present. Try again.");
        } finally {
            setBusy(false);
        }
    };

    useCardScanner({
        onCard: handleMember,
        onUnknown: () => show("err", "That is not a Magic Nutrition Club card."),
    });

    const todayCount = rows.filter(r => !r.repeat).length;

    return (
        <div className="p-4 sm:p-6">
            <div className="mb-1 flex flex-wrap items-baseline gap-3">
                <h1 className="text-xl font-black tracking-tight">Scan Station</h1>
                <span className="text-sm text-slate-500">{todayLocal()}</span>
                <span className="ml-auto rounded-full bg-emerald-100 px-3 py-1 text-sm font-black text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    {todayCount} marked present
                </span>
            </div>
            <p className="mb-5 max-w-2xl text-sm text-slate-500">
                Point the card reader at a member's card. There is nothing to click — leave this screen open
                at the desk. A card read twice within a few seconds is ignored.
            </p>

            {/* status */}
            <div
                className={`mb-5 rounded-2xl border-2 p-6 text-center transition ${
                    flash?.kind === "ok"
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                        : flash?.kind === "repeat"
                        ? "border-amber-500 bg-amber-50 dark:bg-amber-950"
                        : flash?.kind === "err"
                        ? "border-red-500 bg-red-50 dark:bg-red-950"
                        : "border-dashed border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                }`}
            >
                <div className="text-3xl">{flash ? (flash.kind === "ok" ? "✅" : flash.kind === "repeat" ? "↺" : "⚠️") : "🎴"}</div>
                <div className="mt-2 text-lg font-black">
                    {flash ? flash.text : busy ? "Working…" : "Ready — scan a card"}
                </div>
            </div>

            {/* manual fallback: forgotten card */}
            <div className="mb-6 flex flex-wrap items-center gap-2">
                <input
                    value={manual}
                    onChange={e => setManual(e.target.value)}
                    placeholder="No card? Type a name or member ID…"
                    className="min-w-[240px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300 dark:border-slate-700 dark:bg-slate-900"
                />
                {manual.trim() && (
                    <div className="flex w-full flex-wrap gap-2">
                        {(members ?? [])
                            .filter((m: any) =>
                                [m.name, m.memberId, m.phone].filter(Boolean).join(" ").toLowerCase()
                                    .includes(manual.trim().toLowerCase()))
                            .slice(0, 6)
                            .map((m: any) => (
                                <button
                                    key={m.id}
                                    onClick={() => { handleMember(m.id); setManual(""); }}
                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-900"
                                >
                                    {m.name} <span className="text-slate-400">{m.memberId}</span>
                                </button>
                            ))}
                    </div>
                )}
            </div>

            {/* today's scans */}
            <div className="grid gap-2">
                {rows.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400 dark:border-slate-700">
                        Scans will appear here.
                    </div>
                )}
                {rows.map(r => (
                    <div
                        key={r.key}
                        className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                            r.repeat
                                ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30"
                                : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                        }`}
                    >
                        {r.photo ? (
                            <img src={r.photo} alt="" className="h-11 w-11 rounded-full object-cover" />
                        ) : (
                            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 font-black text-slate-600 dark:bg-slate-700">
                                {r.name.charAt(0).toUpperCase()}
                            </div>
                        )}
                        <div className="min-w-0">
                            <div className="font-black">{r.name}</div>
                            <div className="text-xs text-slate-500">
                                {r.memberId} · {r.at}
                                {r.repeat && " · already present"}
                            </div>
                        </div>

                        <div className="ml-auto flex flex-wrap items-center gap-2">
                            {r.token != null && (
                                <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                                    🥤 {r.shake} · sent to kitchen #{r.token}
                                </span>
                            )}
                            {r.preOrder && (
                                <span className="rounded-lg bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-800 dark:bg-violet-950 dark:text-violet-200">
                                    📲 ordered on their phone: {r.preOrder} · confirm in the queue
                                </span>
                            )}
                            {r.duplicate && r.token == null && (
                                <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                                    already ordered today
                                </span>
                            )}
                            {r.shake && r.token == null && !r.duplicate && !r.needsPick && (
                                <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                                    🥤 {r.shake}
                                    <span className="ml-1 font-medium opacity-70">
                                        {r.shakeSource === "member" ? "their choice" : r.shakeSource === "history" ? "usual" : "popular"}
                                    </span>
                                </span>
                            )}
                            {r.credits != null && (
                                <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                                    r.credits <= 0
                                        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                }`}>
                                    {r.credits} credits
                                </span>
                            )}
                            {r.expiresInDays != null && r.expiresInDays <= 7 && (
                                <span className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
                                    {r.expiresInDays <= 0 ? "Plan expired" : `Plan ends in ${r.expiresInDays}d`}
                                </span>
                            )}
                        </div>

                        {/* No usual shake — offer today's menu rather than guess. */}
                        {r.needsPick && !r.duplicate && (
                            <div className="w-full border-t border-slate-100 pt-2 dark:border-slate-800">
                                <div className="mb-1.5 text-xs font-bold text-slate-500">
                                    No usual shake — pick one
                                </div>
                                {orderable.length === 0 ? (
                                    <div className="text-xs text-slate-400">Nothing on today's menu.</div>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {orderable.map((s: any) => (
                                            <button
                                                key={s.id}
                                                onClick={() => {
                                                    const member = byId.get(r.memberDocId);
                                                    if (!member) return;
                                                    placeFor(r.key, member, {
                                                        name: s.displayName,
                                                        itemId: s.itemId || s.id,
                                                        price: Number(s.price) || 0,
                                                        stockType: s.stockType,
                                                        qty: 1,
                                                    });
                                                }}
                                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                                            >
                                                {s.itemEmoji ? `${s.itemEmoji} ` : ""}{s.displayName}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export { parseCardCode };
