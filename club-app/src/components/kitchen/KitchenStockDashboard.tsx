/**
 * Kitchen Stock dashboard (rewritten 2026-04 for the unified, unit-first
 * model). Two sections — Available (current kitchen packets, formatted
 * as "N pkt + leftover" for clarity) and Used Today (gram/ml-level
 * consumption derived live from served orders × recipes). Two action
 * buttons up top: Add Stock and Return Stock; both face-verified.
 *
 * "Close Day" sits at the bottom — face-verified, snapshots the day's
 * given/used totals and atomically returns all remaining kitchen stock
 * back to admin.
 */

import { useMemo, useState } from "react";
import { Package, AlertTriangle, Plus, RotateCcw, Moon } from "lucide-react";
import {
    useKitchenStockItems,
    useRecipesUnified,
    useTodayServedOrders,
    commitEndOfDay,
} from "@/hooks/useUnifiedInventory";
import { formatStock, formatUnitAmount } from "@/utils/inventoryUnits";
import FaceVerification from "@/components/FaceVerification";
import AddStockToKitchen from "./AddStockToKitchen";
import ReturnStockToInventory from "./ReturnStockToInventory";
import { useToast } from "@/hooks/use-toast";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useEffect } from "react";
import type { KitchenStockEventItem } from "@/types/firestore";

interface Props {
    clubId: string;
}

interface UsedRow {
    inventoryItemId: string;
    name: string;
    unit: string;
    size: number;
    /** Total amount consumed today in `unit`, e.g. grams of protein. */
    amountUsed: number;
}

export default function KitchenStockDashboard({ clubId }: Props) {
    const { toast } = useToast();
    const { stock, loading } = useKitchenStockItems();
    const { recipes } = useRecipesUnified();
    const servedOrders = useTodayServedOrders();

    const [sheet, setSheet] = useState<null | "add" | "return" | "close">(null);
    const [verifiers, setVerifiers] = useState<any[]>([]);

    useEffect(() => {
        if (!clubId) return;
        const unsub = onSnapshot(collection(db, `clubs/${clubId}/inventoryManagers`), (snap) => {
            setVerifiers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, [clubId]);

    // ── Derive Used Today from served orders × recipes ────────────────
    const usedToday: UsedRow[] = useMemo(() => {
        if (!servedOrders.length || !recipes.length) return [];
        const recipeByMenuId = new Map(recipes.filter((r) => r.isActive !== false).map((r) => [r.menuItemId, r]));
        const totals = new Map<string, UsedRow>();

        for (const order of servedOrders) {
            for (const oItem of order.items || []) {
                const recipe = recipeByMenuId.get(oItem.productId);
                if (!recipe?.ingredients?.length) continue;
                const qty = Number(oItem.quantity ?? 1);
                for (const ing of recipe.ingredients) {
                    if (!ing.inventoryItemId || !ing.amountPerServing) continue;
                    const used = ing.amountPerServing * qty;
                    const existing = totals.get(ing.inventoryItemId);
                    if (existing) {
                        existing.amountUsed += used;
                    } else {
                        // Find the matching kitchen-stock row to read size for display.
                        const ks = stock.find((s) => s.inventoryItemId === ing.inventoryItemId);
                        totals.set(ing.inventoryItemId, {
                            inventoryItemId: ing.inventoryItemId,
                            name: ing.inventoryItemName,
                            unit: ing.unit,
                            size: ks?.size ?? 1,
                            amountUsed: used,
                        });
                    }
                }
            }
        }
        return Array.from(totals.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [servedOrders, recipes, stock]);

    const critical = stock.filter((s) => s.quantity <= 0);
    const low = stock.filter((s) => s.quantity > 0 && s.quantity <= 1);

    // ── Close Day (face-verified) ─────────────────────────────────────
    const [closing, setClosing] = useState(false);
    async function handleCloseVerified(verifier: { id: string; name: string }) {
        setClosing(true);
        try {
            const remaining: KitchenStockEventItem[] = stock
                .filter((s) => s.quantity > 0)
                .map((s) => ({
                    inventoryItemId: s.inventoryItemId,
                    name: s.name, size: s.size, unit: s.unit,
                    quantity: s.quantity,
                }));
            const used: KitchenStockEventItem[] = usedToday.map((u) => ({
                inventoryItemId: u.inventoryItemId,
                name: u.name, size: u.size, unit: u.unit,
                quantity: u.amountUsed,        // stored as raw unit amount, not packets
            }));
            await commitEndOfDay(clubId, {
                remainingItems: remaining,
                usedToday: used,
                verifiedBy: verifier.name,
                verifiedById: verifier.id,
            });
            toast({ title: "Day closed", description: "Snapshot saved · remaining stock returned to inventory." });
            setSheet(null);
        } catch (err: any) {
            toast({ title: "Close failed", description: err.message, variant: "destructive" });
        } finally {
            setClosing(false);
        }
    }

    // ── Sheet rendering (Add / Return / Close take over the panel) ────
    if (sheet === "add")     return <AddStockToKitchen clubId={clubId} onClose={() => setSheet(null)} />;
    if (sheet === "return")  return <ReturnStockToInventory clubId={clubId} onClose={() => setSheet(null)} />;
    if (sheet === "close") {
        return (
            <div className="p-4">
                <FaceVerification
                    clubId={clubId}
                    verifiers={verifiers.map((m) => ({ id: m.id, name: m.name, photo: m.photoUrl || m.photo, faceDescriptor: m.faceDescriptor, role: 'Inventory Manager' }))}
                    title="Close Day"
                    subtitle={`Snapshot used + return ${stock.filter(s => s.quantity > 0).length} item(s) to admin`}
                    onVerified={handleCloseVerified}
                    onCancel={() => { if (!closing) setSheet(null); }}
                />
            </div>
        );
    }

    return (
        <div className="p-4 space-y-4" style={{ fontFamily: "'Nunito', sans-serif" }}>
            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setSheet("add")}
                    className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700">
                    <Plus className="w-4 h-4" /> Add Stock
                </button>
                <button onClick={() => setSheet("return")}
                    className="flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-blue-200 bg-blue-50 text-blue-700 font-bold text-sm hover:bg-blue-100">
                    <RotateCcw className="w-4 h-4" /> Return Stock
                </button>
            </div>

            {/* Low-stock banner */}
            {(critical.length > 0 || low.length > 0) && (
                <div className="rounded-2xl border p-3 flex items-start gap-3"
                    style={{
                        background: critical.length > 0 ? "#fef2f2" : "#fffbeb",
                        borderColor: critical.length > 0 ? "#fecaca" : "#fde68a",
                    }}>
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5"
                        style={{ color: critical.length > 0 ? "#b91c1c" : "#b45309" }} />
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-black uppercase tracking-wider"
                            style={{ color: critical.length > 0 ? "#b91c1c" : "#b45309" }}>
                            {critical.length > 0 ? "Out of stock" : "Running low"}
                        </p>
                        <p className="text-xs font-bold text-slate-700 mt-0.5 truncate">
                            {[...critical, ...low].map((s) => s.name).slice(0, 4).join(", ")}
                            {critical.length + low.length > 4 ? ` +${critical.length + low.length - 4} more` : ""}
                        </p>
                    </div>
                </div>
            )}

            {/* Available section */}
            <Section icon={<Package className="w-5 h-5 text-emerald-600" />} title="Available Stock" subtitle="Live · what's in the kitchen now">
                {loading ? (
                    <p className="text-xs text-slate-400 py-4 text-center">Loading…</p>
                ) : stock.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">No items in kitchen yet. Tap "Add Stock" to start.</p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {stock.map((it) => {
                            const isCritical = it.quantity <= 0;
                            const isLow = !isCritical && it.quantity <= 1;
                            const color = isCritical ? "text-red-700" : isLow ? "text-amber-700" : "text-emerald-700";
                            const bg = isCritical ? "bg-red-50 border-red-200" : isLow ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200";
                            return (
                                <div key={it.inventoryItemId} className={`rounded-2xl border p-3 ${bg}`}>
                                    <div className="flex items-center justify-between mb-1">
                                        <p className="font-bold text-slate-900 text-sm truncate">{it.name}</p>
                                        <span className="text-[10px] font-bold text-slate-500 bg-white/70 rounded-full px-2 py-0.5">
                                            {it.size}{it.unit}/pkt
                                        </span>
                                    </div>
                                    <p className={`text-xl font-black ${color}`}>{formatStock(it.quantity, it.size, it.unit)}</p>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Section>

            {/* Used Today section */}
            <Section icon={<span className="text-base">🥤</span>} title="Used Today" subtitle="Auto-calculated from served orders × recipes">
                {usedToday.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">Nothing served yet today.</p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {usedToday.map((u) => (
                            <div key={u.inventoryItemId} className="rounded-2xl border border-slate-200 bg-white p-3">
                                <p className="font-bold text-slate-900 text-sm truncate">{u.name}</p>
                                <p className="text-lg font-black text-blue-700 mt-1">{formatUnitAmount(u.amountUsed, u.unit)}</p>
                            </div>
                        ))}
                    </div>
                )}
            </Section>

            {/* Close Day */}
            <button onClick={() => setSheet("close")}
                className="w-full mt-2 flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-slate-200 bg-slate-900 text-white font-bold text-sm hover:bg-slate-800">
                <Moon className="w-4 h-4" /> Close Day · Verify & Return Remaining
            </button>
        </div>
    );
}

function Section({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="flex items-baseline gap-2">
                {icon}
                <h3 className="text-base font-black text-slate-900">{title}</h3>
                {subtitle && <span className="text-[10px] text-slate-400">· {subtitle}</span>}
            </div>
            {children}
        </div>
    );
}
