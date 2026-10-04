import { useState } from "react";
import { Users, Check, X, ShieldCheck } from "lucide-react";
import { useKitchenStock, useRecordShiftHandover } from "@/hooks/useKitchenInventory";
import { useTodayOrdersSummary } from "@/hooks/useOrders";
import FaceVerification from "@/components/FaceVerification";

interface Props {
    clubId: string;
    /** Optional list of accountants/verifiers. If provided, the incoming person can face-verify. */
    verifiers?: { id: string; name: string; photo?: string; faceDescriptor?: any; role?: string }[];
    onClose: () => void;
}

type Step = "form" | "verify" | "done";

/**
 * Shift Handover — logs a kitchen-staff change with:
 *   - outgoing person's name (free text)
 *   - incoming person's name (free text, or face-verified if they're an accountant)
 *   - current stock snapshot (so discrepancies at the next handover are attributable)
 *   - today's served count at the moment of handover
 *
 * Everything is persisted to `clubs/{id}/kitchenShiftHandovers`.
 */
export default function KitchenShiftHandover({ clubId, verifiers = [], onClose }: Props) {
    const { stock } = useKitchenStock();
    const record = useRecordShiftHandover();
    const { orders: allTodayOrders } = useTodayOrdersSummary();
    const servedCountToday = allTodayOrders.filter(o => o.status === "served").length;

    const [step, setStep] = useState<Step>("form");
    const [outgoingName, setOutgoingName] = useState("");
    const [incomingName, setIncomingName] = useState("");
    const [notes, setNotes] = useState("");
    const [error, setError] = useState("");
    const [verifiedIncomingId, setVerifiedIncomingId] = useState<string | null>(null);

    const stockSnapshot = stock.map(s => ({
        productId: s.productId,
        productName: s.productName,
        quantity: s.quantity,
        unit: s.unit,
    }));

    async function commit(incomingId: string | null) {
        if (!outgoingName.trim() || !incomingName.trim()) {
            setError("Both outgoing and incoming names are required.");
            setStep("form");
            return;
        }
        setError("");
        try {
            await record.mutateAsync({
                outgoingName: outgoingName.trim(),
                incomingName: incomingName.trim(),
                incomingId: incomingId ?? undefined,
                servedCountToday,
                stockSnapshot,
                notes: notes.trim() || undefined,
            });
            setStep("done");
        } catch (err: any) {
            setError(err?.message || "Failed to record handover");
            setStep("form");
        }
    }

    // ── Done ──
    if (step === "done") {
        return (
            <div className="p-6 text-center" style={{ fontFamily: "'Nunito', sans-serif" }}>
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="text-lg font-black text-slate-900 mb-1">Handover Recorded</h3>
                <p className="text-sm text-slate-500 mb-1">
                    {outgoingName} → {incomingName}
                </p>
                <p className="text-xs text-emerald-600 font-bold">
                    {stockSnapshot.length} stock items snapshot · {servedCountToday} served so far today
                </p>
                <button onClick={onClose} className="mt-6 px-6 py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700">
                    Close
                </button>
            </div>
        );
    }

    // ── Verify ──
    if (step === "verify") {
        return (
            <FaceVerification
                clubId={clubId}
                verifiers={verifiers.map(v => ({ id: v.id, name: v.name, photo: v.photo, faceDescriptor: v.faceDescriptor, role: v.role || "Kitchen" }))}
                title="Incoming Staff Verification"
                subtitle={`${outgoingName || "Outgoing staff"} → handover`}
                onVerified={(verifier) => {
                    setIncomingName(verifier.name);
                    setVerifiedIncomingId(verifier.id);
                    commit(verifier.id);
                }}
                onCancel={() => setStep("form")}
            />
        );
    }

    // ── Form ──
    return (
        <div className="p-5 space-y-4" style={{ fontFamily: "'Nunito', sans-serif" }}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    <h3 className="text-base font-black text-slate-900">Shift Handover</h3>
                </div>
                <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                    <X className="w-5 h-5" />
                </button>
            </div>

            <p className="text-xs text-slate-500">
                Snapshot the kitchen stock before handing over to the next person. The next
                shift's discrepancies will be measured against this baseline.
            </p>

            {/* Current stock snapshot preview */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Snapshot ({stockSnapshot.length} items · {servedCountToday} served today)
                </p>
                {stockSnapshot.length === 0 ? (
                    <p className="text-xs text-slate-400">Kitchen stock is empty.</p>
                ) : (
                    <div className="max-h-32 overflow-y-auto space-y-0.5 pt-1">
                        {stockSnapshot.map(s => (
                            <div key={s.productId} className="flex justify-between items-center text-xs">
                                <span className="font-semibold text-slate-700">{s.productName}</span>
                                <span className="font-bold text-slate-900">
                                    {s.quantity % 1 === 0 ? s.quantity : s.quantity.toFixed(2)} {s.unit}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Outgoing */}
            <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Outgoing person *</label>
                <input
                    value={outgoingName}
                    onChange={e => setOutgoingName(e.target.value)}
                    placeholder="Your name"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
            </div>

            {/* Incoming */}
            <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Incoming person *</label>
                <input
                    value={incomingName}
                    onChange={e => { setIncomingName(e.target.value); setVerifiedIncomingId(null); }}
                    placeholder="Next person's name"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                {verifiedIncomingId && (
                    <p className="text-[10px] text-emerald-600 font-bold mt-1 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> Face-verified
                    </p>
                )}
            </div>

            {/* Notes */}
            <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Notes (optional)</label>
                <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. low on chocolate powder, freezer fixed, etc."
                    rows={2}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                />
            </div>

            {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{error}</p>
            )}

            {verifiers.length > 0 ? (
                <>
                    <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2">
                        The incoming person <strong>must face-verify</strong> to accept responsibility for
                        the current stock. No free-text handover when verified staff are set up.
                    </p>
                    <button
                        onClick={() => {
                            if (!outgoingName.trim()) {
                                setError("Enter outgoing person's name first");
                                return;
                            }
                            setError("");
                            setStep("verify");
                        }}
                        disabled={record.isPending}
                        className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                    >
                        📸 Scan Incoming Person's Face
                    </button>
                </>
            ) : (
                <>
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        No verified staff are set up. Handover will be recorded by name only — ask the owner
                        to add verifiers in Settings → Accountants so future handovers are face-verified.
                    </p>
                    <button
                        onClick={() => commit(null)}
                        disabled={record.isPending || !outgoingName.trim() || !incomingName.trim()}
                        className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                    >
                        {record.isPending ? "Recording…" : "Record Handover"}
                    </button>
                </>
            )}
        </div>
    );
}
