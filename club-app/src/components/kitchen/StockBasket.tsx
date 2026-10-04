/**
 * Shared checkout-style basket UI used for "Add Stock" (admin → kitchen)
 * and "Return Stock" (kitchen → admin). Keeps the two flows visually
 * identical — the only thing that changes is the source list and the
 * commit function passed in by the parent.
 */

import { useEffect, useMemo, useState } from "react";
import { Search, X, ShoppingBasket, Check } from "lucide-react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import FaceVerification from "@/components/FaceVerification";
import { useToast } from "@/hooks/use-toast";
import { formatStock } from "@/utils/inventoryUnits";
import type { KitchenStockEventItem } from "@/types/firestore";

export interface BasketSourceItem {
    id: string;
    name: string;
    size: number;
    unit: string;
    quantity: number;       // current packets in source (admin or kitchen)
    category?: string;
    imageUrl?: string;
}

interface Props {
    clubId: string;
    title: string;
    subtitle: string;
    /** Items the operator can pick from (admin items for Add, kitchen items for Return). */
    sourceItems: BasketSourceItem[];
    sourceLabel: string;       // "Admin" or "Kitchen" — shown in availability text
    actionLabel: string;       // "Give to Kitchen" / "Return to Inventory"
    /** Atomic commit. Receives event-shaped items + verifier; throws on failure. */
    onCommit: (items: KitchenStockEventItem[], verifier: { id: string; name: string }) => Promise<void>;
    /** Verify subtitle template — receives total packets. */
    verifySubtitle: (total: number) => string;
    onClose: () => void;
}

export default function StockBasket({
    clubId, title, subtitle, sourceItems, sourceLabel, actionLabel,
    onCommit, verifySubtitle, onClose,
}: Props) {
    const { toast } = useToast();
    const [search, setSearch] = useState("");
    const [basket, setBasket] = useState<Record<string, number>>({});
    const [verifyOpen, setVerifyOpen] = useState(false);
    const [committing, setCommitting] = useState(false);

    // Inventory managers — verifiers for face-scan
    const [verifiers, setVerifiers] = useState<any[]>([]);
    useEffect(() => {
        if (!clubId) return;
        const unsub = onSnapshot(collection(db, `clubs/${clubId}/inventoryManagers`), (snap) => {
            setVerifiers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, [clubId]);

    const filtered = useMemo(() => sourceItems.filter((it) =>
        !search || it.name.toLowerCase().includes(search.toLowerCase()),
    ), [sourceItems, search]);

    function bump(itemId: string, delta: number, max?: number) {
        setBasket((prev) => {
            const current = prev[itemId] || 0;
            let next = Math.max(0, current + delta);
            if (max != null) next = Math.min(max, next);
            const out = { ...prev };
            if (next === 0) delete out[itemId];
            else out[itemId] = next;
            return out;
        });
    }

    const basketEntries = Object.entries(basket)
        .map(([id, count]) => ({ item: sourceItems.find((s) => s.id === id), count }))
        .filter((b): b is { item: BasketSourceItem; count: number } => !!b.item);
    const totalPackets = basketEntries.reduce((s, b) => s + b.count, 0);

    async function handleVerified(verifier: { id: string; name: string }) {
        setCommitting(true);
        try {
            const items: KitchenStockEventItem[] = basketEntries.map((b) => ({
                inventoryItemId: b.item.id,
                name: b.item.name,
                size: b.item.size,
                unit: b.item.unit,
                quantity: b.count,
            }));
            await onCommit(items, verifier);
            toast({ title: `${actionLabel} — done`, description: `${totalPackets} packet${totalPackets === 1 ? '' : 's'} moved.` });
            setBasket({});
            setVerifyOpen(false);
            onClose();
        } catch (err: any) {
            toast({ title: "Failed", description: err.message, variant: "destructive" });
            setVerifyOpen(false);
        } finally {
            setCommitting(false);
        }
    }

    if (verifyOpen) {
        return (
            <FaceVerification
                clubId={clubId}
                verifiers={verifiers.map((m) => ({ id: m.id, name: m.name, photo: m.photoUrl || m.photo, faceDescriptor: m.faceDescriptor, role: 'Inventory Manager' }))}
                title={`Verify ${actionLabel}`}
                subtitle={verifySubtitle(totalPackets)}
                onVerified={handleVerified}
                onCancel={() => { if (!committing) setVerifyOpen(false); }}
            />
        );
    }

    return (
        <div className="p-4 space-y-3" style={{ fontFamily: "'Nunito', sans-serif" }}>
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                        <ShoppingBasket className="w-5 h-5 text-emerald-600" /> {title}
                    </h3>
                    <p className="text-xs text-slate-500">{subtitle}</p>
                </div>
                <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…"
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
            </div>

            {/* Item cards */}
            {filtered.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
                    {sourceItems.length === 0 ? `Nothing in ${sourceLabel.toLowerCase()} yet.` : "No items match your search."}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[55vh] overflow-y-auto pr-1">
                    {filtered.map((item) => {
                        const count = basket[item.id] || 0;
                        const max = Math.floor(item.quantity);
                        const empty = max <= 0;
                        return (
                            <div key={item.id} className={`rounded-2xl border p-3 ${count > 0 ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="min-w-0">
                                        <p className="text-sm font-black text-slate-900 truncate">{item.name}</p>
                                        <p className="text-[10px] text-slate-400 mt-0.5">
                                            {sourceLabel}: {formatStock(item.quantity, item.size, item.unit)}
                                        </p>
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                                        {item.size}{item.unit}/pkt
                                    </span>
                                </div>
                                <div className="flex items-center justify-end gap-1.5">
                                    <button onClick={() => bump(item.id, -1)} disabled={count === 0}
                                        className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 font-black text-base hover:bg-slate-100 disabled:opacity-40">−</button>
                                    <span className="min-w-[32px] text-center text-sm font-black">{count}</span>
                                    <button onClick={() => bump(item.id, +1, max)} disabled={empty || count >= max}
                                        className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-black text-base hover:bg-emerald-700 disabled:opacity-40">+</button>
                                </div>
                                {empty && (
                                    <p className="text-[10px] text-amber-600 font-bold text-right mt-1">None available</p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Sticky basket footer */}
            {totalPackets > 0 && (
                <div className="sticky bottom-0 bg-white border-t border-emerald-200 -mx-4 px-4 pt-3 pb-2 flex items-center gap-3">
                    <div className="flex-1 text-xs">
                        <p className="font-black text-emerald-700">{totalPackets} packet{totalPackets === 1 ? '' : 's'} · {basketEntries.length} item{basketEntries.length === 1 ? '' : 's'}</p>
                        <p className="text-slate-400 text-[10px] mt-0.5">Face-verify on next step</p>
                    </div>
                    <button onClick={() => setBasket({})} className="px-3 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100">Clear</button>
                    <button onClick={() => setVerifyOpen(true)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700">
                        <Check className="w-4 h-4" /> {actionLabel}
                    </button>
                </div>
            )}
        </div>
    );
}
