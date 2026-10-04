import { useState } from "react";
import { ShoppingCart, AlertTriangle, Check, X, ChevronRight, PackageCheck, ShieldCheck } from "lucide-react";
import {
    useRecipes,
    useCreateAndApproveKitchenRequest,
    useCreateKitchenRequest,
    calculateRequiredStock,
} from "@/hooks/useKitchenInventory";
import FaceVerification from "@/components/FaceVerification";

interface TodaysItem {
    id: string;
    name: string;
    imageUrl?: string;
    emoji?: string;
}

interface Verifier {
    id: string;
    name: string;
    photo?: string;
    faceDescriptor?: any;
    role?: string;
}

interface Props {
    todaysItems: TodaysItem[];
    requestedBy: string;
    clubId: string;
    /** Accountants / inventory managers authorized to verify the handover. */
    verifiers: Verifier[];
    onClose: () => void;
    onSuccess: () => void;
}

type Step = "select" | "review" | "collect" | "verify" | "done" | "submitted_pending";

/**
 * Kitchen → Request flow
 *
 * UX:
 *   1. SELECT  — today's specials shown as cards; enter expected member count per shake
 *   2. REVIEW  — breakdown of ingredients required, in inventory units
 *   3. COLLECT — instruct kitchen team to physically collect items & call inventory manager
 *   4. VERIFY  — inventory manager face-scans (FaceVerification). On match, stock is
 *                atomically transferred from inventoryProducts → kitchenStock.
 *   5. DONE    — confirmation screen
 *
 * If no authorized verifier is set up in Settings, an emergency submit falls back
 * to the classic create-pending request which an owner can approve elsewhere.
 */
export default function KitchenStockRequest({
    todaysItems, requestedBy, clubId, verifiers, onClose, onSuccess,
}: Props) {
    const { recipes } = useRecipes();
    const createAndApprove = useCreateAndApproveKitchenRequest();
    const createPending = useCreateKitchenRequest();

    const [step, setStep] = useState<Step>("select");
    const [estimates, setEstimates] = useState<Record<string, number>>({});
    const [isEmergency, setIsEmergency] = useState(false);
    const [error, setError] = useState("");

    const shakeEstimates = todaysItems
        .filter(item => (estimates[item.id] || 0) > 0)
        .map(item => ({ menuItemId: item.id, menuItemName: item.name, count: estimates[item.id] || 0 }));

    const requiredStock = calculateRequiredStock(recipes, shakeEstimates);
    const totalShakes = Object.values(estimates).reduce((s, v) => s + (v || 0), 0);

    function bump(id: string, delta: number) {
        setEstimates(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + delta) }));
    }

    async function handleVerified(verifier: { id: string; name: string }) {
        if (requiredStock.length === 0) return;
        setError("");
        try {
            await createAndApprove.mutateAsync({
                items: requiredStock.map(r => ({
                    productId: r.productId,
                    productName: r.productName,
                    requestedQty: r.requiredQty,
                    issuedQty: null,
                    unit: r.unit,
                })),
                estimatedShakes: totalShakes,
                requestedBy,
                resolvedBy: verifier.name,
                resolvedById: verifier.id,
                isEmergency,
            });
            setStep("done");
        } catch (err: any) {
            setError(err?.message || "Failed to commit stock transfer");
            setStep("collect"); // back to pre-verify step
        }
    }

    async function handleEmergencyFallback() {
        // No authorized verifier available — create the request in the old
        // pending state so an owner can approve it later.
        setError("");
        try {
            await createPending.mutateAsync({
                items: requiredStock.map(r => ({
                    productId: r.productId,
                    productName: r.productName,
                    requestedQty: r.requiredQty,
                    issuedQty: null,
                    unit: r.unit,
                })),
                estimatedShakes: totalShakes,
                requestedBy,
                isEmergency: true,
            });
            setStep("submitted_pending");
        } catch (err: any) {
            setError(err?.message || "Failed to submit request");
        }
    }

    // ── DONE (approved + stock transferred) ──
    if (step === "done") {
        return (
            <div className="p-6 text-center" style={{ fontFamily: "'Nunito', sans-serif" }}>
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="text-lg font-black text-slate-900 mb-1">Stock Transferred</h3>
                <p className="text-sm text-slate-500 mb-1">{totalShakes} shakes worth of ingredients moved to kitchen stock.</p>
                <p className="text-xs text-emerald-600 font-bold">{requiredStock.length} ingredients added</p>
                <button onClick={() => { onSuccess(); onClose(); }} className="mt-6 px-6 py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors">
                    Done
                </button>
            </div>
        );
    }

    // ── SUBMITTED (pending owner approval — fallback) ──
    if (step === "submitted_pending") {
        return (
            <div className="p-6 text-center" style={{ fontFamily: "'Nunito', sans-serif" }}>
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-lg font-black text-slate-900 mb-1">Request Queued</h3>
                <p className="text-sm text-slate-500 mb-1">No inventory manager was available. The request is pending owner approval.</p>
                <button onClick={() => { onSuccess(); onClose(); }} className="mt-6 px-6 py-3 rounded-2xl bg-slate-700 text-white font-bold text-sm hover:bg-slate-800 transition-colors">
                    Close
                </button>
            </div>
        );
    }

    // ── VERIFY ──
    if (step === "verify") {
        return (
            <FaceVerification
                clubId={clubId}
                verifiers={verifiers.map(v => ({ id: v.id, name: v.name, photo: v.photo, faceDescriptor: v.faceDescriptor, role: v.role || "Inventory Manager" }))}
                title="Inventory Manager Verification"
                subtitle={`Hand over ${requiredStock.length} items → scan face to commit stock transfer`}
                onVerified={handleVerified}
                onCancel={() => setStep("collect")}
            />
        );
    }

    // ── COLLECT (instruction + verify-or-fallback) ──
    if (step === "collect") {
        return (
            <div className="p-5 space-y-4" style={{ fontFamily: "'Nunito', sans-serif" }}>
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-black text-slate-900">Collect & Verify</h3>
                    <button onClick={() => setStep("review")} className="text-xs font-bold text-blue-600 hover:underline">← Back</button>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center gap-2">
                        <PackageCheck className="w-5 h-5 text-blue-600" />
                        <p className="font-black text-blue-900 text-sm">Step 1 — Collect</p>
                    </div>
                    <p className="text-xs text-blue-800">
                        Physically collect the items below from the main inventory. Stock is not
                        deducted yet; it only moves when the inventory manager verifies below.
                    </p>
                </div>

                <div className="space-y-1.5">
                    {requiredStock.map(it => (
                        <div key={it.productId} className="flex justify-between items-center bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm">
                            <span className="font-bold text-slate-800">{it.productName}</span>
                            <span className="font-black text-emerald-700">{it.requiredQty} {it.unit}</span>
                        </div>
                    ))}
                </div>

                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-emerald-600" />
                        <p className="font-black text-emerald-900 text-sm">Step 2 — Inventory manager verifies</p>
                    </div>
                    <p className="text-xs text-emerald-800">
                        The inventory manager scans their face on this device. On match, stock is
                        deducted from main inventory and added to kitchen stock in one step.
                    </p>
                </div>

                {error && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{error}</p>
                )}

                {verifiers.length === 0 ? (
                    <div className="space-y-2">
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl">
                            No inventory manager is registered. Ask the owner to add one in
                            Settings → Accountants / Inventory Managers. You can still submit
                            this as an emergency request for owner approval.
                        </p>
                        <button
                            onClick={handleEmergencyFallback}
                            disabled={createPending.isPending}
                            className="w-full py-3 rounded-2xl bg-amber-600 text-white font-bold text-sm hover:bg-amber-700 disabled:opacity-60"
                        >
                            {createPending.isPending ? "Submitting…" : "🚨 Queue as Emergency Request"}
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setStep("verify")}
                        className="w-full py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors"
                    >
                        📸 Scan Inventory Manager's Face
                    </button>
                )}
            </div>
        );
    }

    // ── REVIEW ──
    if (step === "review") {
        return (
            <div className="p-5 space-y-4" style={{ fontFamily: "'Nunito', sans-serif" }}>
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-black text-slate-900">Review Breakdown</h3>
                    <button onClick={() => setStep("select")} className="text-xs font-bold text-blue-600 hover:underline">← Back</button>
                </div>

                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
                    <p className="text-xs font-bold text-emerald-700 uppercase tracking-widest">Expected Members</p>
                    <p className="text-3xl font-black text-emerald-900 mt-1">{totalShakes}</p>
                </div>

                {/* Per-shake breakdown */}
                <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Shakes</p>
                    {shakeEstimates.map(est => (
                        <div key={est.menuItemId} className="flex justify-between items-center text-sm bg-white rounded-lg px-3 py-2 mb-1 border border-slate-100">
                            <span className="font-bold text-slate-700">{est.menuItemName}</span>
                            <span className="font-black text-slate-900">× {est.count}</span>
                        </div>
                    ))}
                </div>

                {/* Required stock */}
                <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Required from Inventory</p>
                    {requiredStock.length === 0 ? (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl">
                            No recipes defined for the selected shakes. Ask admin to set up recipes in Inventory → Shake Recipes first.
                        </p>
                    ) : (
                        requiredStock.map(item => (
                            <div key={item.productId} className="flex justify-between items-center text-sm bg-blue-50 rounded-lg px-3 py-2 mb-1 border border-blue-100">
                                <span className="font-bold text-slate-700">{item.productName}</span>
                                <span className="font-black text-blue-700">{item.requiredQty} {item.unit}</span>
                            </div>
                        ))
                    )}
                </div>

                {/* Emergency toggle */}
                <button
                    onClick={() => setIsEmergency(!isEmergency)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${isEmergency ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200 hover:border-slate-300'}`}
                >
                    <AlertTriangle className={`w-5 h-5 ${isEmergency ? 'text-amber-600' : 'text-slate-400'}`} />
                    <div className="text-left flex-1">
                        <p className={`text-sm font-bold ${isEmergency ? 'text-amber-700' : 'text-slate-700'}`}>Mark as emergency</p>
                        <p className="text-[10px] text-slate-400">Flagged on the request for reporting</p>
                    </div>
                    <div className={`w-10 h-5 rounded-full transition-colors ${isEmergency ? 'bg-amber-500' : 'bg-slate-200'}`}>
                        <div className="w-4 h-4 rounded-full bg-white mt-0.5" style={{ marginLeft: isEmergency ? 22 : 2 }} />
                    </div>
                </button>

                <button
                    onClick={() => setStep("collect")}
                    disabled={requiredStock.length === 0}
                    className="w-full py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                    Continue → Collect & Verify
                </button>
            </div>
        );
    }

    // ── SELECT ──
    return (
        <div className="p-5 space-y-4" style={{ fontFamily: "'Nunito', sans-serif" }}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5 text-emerald-600" />
                    <h3 className="text-base font-black text-slate-900">Request Stock</h3>
                </div>
                <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                    <X className="w-5 h-5" />
                </button>
            </div>

            <p className="text-xs text-slate-500">
                Tap a shake to enter how many members you expect. The system auto-calculates
                what ingredients are needed from your recipes.
            </p>

            {todaysItems.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-5 text-center">
                    <p className="text-sm font-bold text-amber-700">No items on today's menu</p>
                    <p className="text-xs text-amber-500 mt-1">Add shakes to Today's Special first</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {todaysItems.map(item => {
                        const hasRecipe = recipes.some(r => r.isActive && (r.menuItemId === item.id || r.menuItemName === item.name));
                        const count = estimates[item.id] || 0;
                        const active = count > 0;
                        return (
                            <div
                                key={item.id}
                                className={`rounded-2xl border-2 overflow-hidden transition-colors ${active ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}
                            >
                                <div
                                    className="h-20 bg-cover bg-center flex items-end"
                                    style={{
                                        backgroundImage: item.imageUrl ? `url(${item.imageUrl})` : undefined,
                                        backgroundColor: item.imageUrl ? undefined : "#e0f2fe",
                                    }}
                                >
                                    {!item.imageUrl && (
                                        <div className="w-full h-full flex items-center justify-center text-4xl">
                                            {item.emoji || "🥤"}
                                        </div>
                                    )}
                                </div>
                                <div className="p-2.5 space-y-2">
                                    <div className="min-h-[32px]">
                                        <p className="font-black text-slate-900 text-xs leading-tight">{item.name}</p>
                                        {!hasRecipe && (
                                            <p className="text-[9px] text-amber-600 font-bold mt-0.5">⚠ No recipe</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => bump(item.id, -10)}
                                            disabled={count === 0}
                                            className="w-7 h-7 rounded-lg border border-slate-200 font-black text-slate-500 text-sm hover:bg-slate-100 disabled:opacity-40"
                                        >−</button>
                                        <input
                                            type="number" min={0}
                                            value={count || ""}
                                            onChange={e => setEstimates(prev => ({ ...prev, [item.id]: Math.max(0, Number(e.target.value)) }))}
                                            placeholder="0"
                                            className="flex-1 min-w-0 text-center px-1 py-1 border border-slate-200 rounded-lg text-sm font-black focus:outline-none focus:ring-2 focus:ring-emerald-400"
                                        />
                                        <button
                                            onClick={() => bump(item.id, 10)}
                                            className="w-7 h-7 rounded-lg bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700"
                                        >+</button>
                                    </div>
                                    <p className="text-[9px] text-center text-slate-400 font-bold">members</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {totalShakes > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 flex items-center justify-between sticky bottom-0">
                    <div>
                        <p className="text-xs font-bold text-emerald-700">Total: {totalShakes} members</p>
                        <p className="text-[10px] text-emerald-500">{requiredStock.length} ingredients needed</p>
                    </div>
                    <button onClick={() => setStep("review")} className="flex items-center gap-1 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
                        Review <ChevronRight className="w-3 h-3" />
                    </button>
                </div>
            )}
        </div>
    );
}
