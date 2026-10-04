import { planCreditsLabel } from "@/utils/planCredits";
import { useState, useEffect } from "react";
import { X, Search, Package, ShoppingBag, ArrowLeft, Coffee } from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubMembers, useMembershipPlans, useManualPaymentEntry } from "@/hooks/useOwner";
import { useSaveProductSale } from "@/hooks/useInventoryManagement";
import { useClubContext } from "@/lib/clubDetection";
import { useAuth } from "@/lib/auth";
import FaceVerification from "@/components/FaceVerification";
import type { User as AppUser, MembershipPlan, InventoryProduct } from "@/types/firestore";
import PaymentMethodPicker, { emptyPaymentSelection, validatePayment, type PaymentSelection } from "@/components/PaymentMethodPicker";
import { fetchClubAndPrint, generateTxnId, fetchShakeTokenToggles } from "@/utils/printReceipt";
import { buildMembershipReceipt, buildShakeTokenReceipt, buildAfreshToken, buildProductSaleReceipt, buildGuestPaymentReceipt } from "@/utils/receiptBuilder";

interface ManualEntryModalProps {
    onClose: () => void;
}

type EntryType = "plan" | "product" | "shake";
type Step = "members" | "action" | "form" | "verify" | "saving" | "success";
type UpiAccount = { id: string; app: string; number: string; holderName: string };

export default function ManualEntryModal({ onClose }: ManualEntryModalProps) {
    const { userProfile } = useAuth();
    const { club } = useClubContext();
    const { data: members = [] } = useClubMembers();
    const { data: plans = [] } = useMembershipPlans();
    const manualEntry = useManualPaymentEntry();
    const saveProductSale = useSaveProductSale();

    // Inventory products + accountants + today's shakes — all real-time
    const [products, setProducts] = useState<InventoryProduct[]>([]);
    const [accountants, setAccountants] = useState<any[]>([]);
    const [todaysShakes, setTodaysShakes] = useState<any[]>([]);

    useEffect(() => {
        if (!club) return;
        const u1 = onSnapshot(collection(db, `clubs/${club.id}/inventory`), (snap) => {
            setProducts(snap.docs
                .map((d) => ({ id: d.id, ...d.data() }) as InventoryProduct)
                .filter((p) => p.isForSale && p.quantity > 0));
        });
        const u2 = onSnapshot(collection(db, `clubs/${club.id}/accountants`), (snap) => {
            setAccountants(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        const today = new Date().toISOString().split('T')[0];
        const u3 = onSnapshot(
            query(collection(db, `clubs/${club.id}/todaysSpecial`), where('isActive', '==', true), where('date', '==', today)),
            (snap) => setTodaysShakes(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        );
        return () => { u1(); u2(); u3(); };
    }, [club]);

    const upiAccounts: UpiAccount[] = ((club as any)?.upiAccounts ?? []) as UpiAccount[];

    // Form state
    const [entryType, setEntryType] = useState<EntryType>("plan");
    const [memberSearch, setMemberSearch] = useState("");
    const [selectedMember, setSelectedMember] = useState<AppUser | null>(null);
    const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null);
    const [selectedProduct, setSelectedProduct] = useState<InventoryProduct | null>(null);
    const [selectedShake, setSelectedShake] = useState<any>(null);
    const [productQty, setProductQty] = useState(1);
    const [payment, setPayment] = useState<PaymentSelection>(emptyPaymentSelection);
    const [error, setError] = useState("");
    const [step, setStep] = useState<Step>("members");
    const [successData, setSuccessData] = useState<{ amount: number; label: string; verifier: string } | null>(null);

    // Derived
    const filteredMembers = memberSearch.trim()
        ? members.filter(
            (m) =>
                m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
                (m.phone || "").includes(memberSearch) ||
                (m.memberId || "").toLowerCase().includes(memberSearch.toLowerCase())
        )
        : members;

    const activePlans = plans.filter((p) => p.isActive);
    const availableShakes = todaysShakes.filter(i => i.stockType !== 'limited' || (i.remainingStock || 0) > 0);

    const totalAmount = (() => {
        if (entryType === "plan") return selectedPlan?.price || 0;
        if (entryType === "product") return (selectedProduct?.price || 0) * productQty;
        if (entryType === "shake") return 240;
        return 0;
    })();

    function resetForm() {
        setEntryType("plan");
        setMemberSearch("");
        setSelectedMember(null);
        setSelectedPlan(null);
        setSelectedProduct(null);
        setSelectedShake(null);
        setProductQty(1);
        setPayment(emptyPaymentSelection);
        setError("");
        setStep("members");
        setSuccessData(null);
    }

    function validate(): string | null {
        if (!selectedMember) return "Please select a member.";
        if (entryType === "plan" && !selectedPlan) return "Please select a plan.";
        if (entryType === "product" && !selectedProduct) return "Please select a product.";
        if (entryType === "product" && productQty < 1) return "Quantity must be at least 1.";
        if (entryType === "shake" && !selectedShake) return "Please select a shake.";
        const v = validatePayment(payment, totalAmount, { requireUpiAccount: upiAccounts.length > 0 });
        if (!v.ok) return v.reason ?? "Complete the payment details.";
        return null;
    }

    function handleProceedToVerify() {
        const err = validate();
        if (err) { setError(err); return; }
        setError("");
        setStep("verify");
    }

    async function handleVerified(verifier: { id: string; name: string }) {
        setStep("saving");
        try {
            const splitFields = {
                cashAmount: payment.method === "cash" ? totalAmount
                          : payment.method === "split" ? payment.cashAmount : 0,
                upiAmount: payment.method === "upi" ? totalAmount
                         : payment.method === "split" ? payment.upiAmount : 0,
                ...(payment.method !== "cash" && payment.upiAccountId ? {
                    upiAccountId: payment.upiAccountId,
                    upiAccountName: payment.upiAccountName,
                    upiNumber: payment.upiNumber,
                } : {}),
            };

            const clubIdEff = club?.id;
            if (entryType === "product") {
                if (!selectedProduct || !selectedMember) throw new Error("Missing data");
                await saveProductSale.mutateAsync({
                    productId: selectedProduct.id,
                    productName: selectedProduct.name,
                    quantity: productQty,
                    unit: selectedProduct.unit,
                    price: selectedProduct.price,
                    totalAmount,
                    buyerId: selectedMember.id,
                    buyerName: selectedMember.name,
                    isGift: false,
                    paymentMethod: payment.method as any,
                    ...splitFields,
                    accountantVerifiedBy: verifier.name,
                    accountantVerifiedById: verifier.id,
                    inventoryVerifiedBy: verifier.name,
                    inventoryVerifiedById: verifier.id,
                });
                setSuccessData({ amount: totalAmount, label: `${selectedProduct.name} x${productQty}`, verifier: verifier.name });
                // Auto-print product sale receipt (audit entry)
                if (clubIdEff) {
                    try {
                        fetchClubAndPrint(clubIdEff, (freshClub) => buildProductSaleReceipt({
                            club: freshClub,
                            buyerName: selectedMember.name,
                            buyerId: (selectedMember as any).memberId || selectedMember.id,
                            productName: selectedProduct.name,
                            quantity: productQty,
                            unit: selectedProduct.unit,
                            unitPrice: selectedProduct.price,
                            totalAmount,
                            isGift: false,
                            paymentMethod: payment.method,
                            cashAmount: splitFields.cashAmount,
                            upiAmount: splitFields.upiAmount,
                            upiAccountName: payment.upiAccountName,
                            accountantVerifiedBy: verifier.name,
                            inventoryVerifiedBy: verifier.name,
                            receiptNumber: generateTxnId(),
                            timestamp: new Date(),
                        }));
                    } catch (printErr) { console.error('[audit product print]', printErr); }
                }
            } else {
                const result = await manualEntry.mutateAsync({
                    memberId: selectedMember!.id,
                    memberName: selectedMember!.name,
                    memberPhoto: (selectedMember as any)?.photoUrl || selectedMember!.photo || "",
                    amount: totalAmount,
                    paymentMethod: payment.method,
                    ...splitFields,
                    recordedBy: verifier.name || userProfile?.name || userProfile?.email || "owner",
                    planId: entryType === "plan" ? selectedPlan?.id : undefined,
                    shakeName: entryType === "shake" ? (selectedShake?.itemName || selectedShake?.name) : undefined,
                    shakeItemId: entryType === "shake" ? selectedShake?.id : undefined,
                });

                if (entryType === "plan") {
                    setSuccessData({ amount: totalAmount, label: selectedPlan!.name, verifier: verifier.name });
                    // Auto-print plan renewal receipt (audit)
                    if (clubIdEff && selectedPlan) {
                        try {
                            const now = new Date();
                            const endDate = new Date(now);
                            endDate.setDate(endDate.getDate() + (selectedPlan.durationDays || 30));
                            fetchClubAndPrint(clubIdEff, (freshClub) => buildMembershipReceipt({
                                club: freshClub,
                                memberName: selectedMember!.name,
                                memberId: (selectedMember as any).memberId || selectedMember!.id,
                                planName: selectedPlan.name,
                                amount: totalAmount,
                                totalVisits: (selectedPlan.visits ?? selectedPlan.totalVisits ?? 0) as number,
                                paymentMethod: payment.method,
                                startDate: now,
                                endDate,
                                timestamp: now,
                                receiptNumber: generateTxnId(),
                                walletBalanceAfter: 0,
                            }));
                        } catch (printErr) { console.error('[audit plan print]', printErr); }
                    }
                } else {
                    setSuccessData({ amount: 240, label: `One-Day Shake: ${selectedShake?.itemName || selectedShake?.name}`, verifier: verifier.name });
                    // Auto-print kitchen token + customer payment receipt in a single
                    // RawBT job — same as Reception's completeOneDayShake so audit
                    // entries match the regular one-day-shake flow.
                    if (clubIdEff && result.tokenNumber) {
                        try {
                            const now = new Date();
                            const shakeName = selectedShake?.itemName || selectedShake?.name || 'Shake';
                            const memberPhone = (selectedMember as any).phone || (selectedMember as any).mobile || '';
                            const tokenToggles = await fetchShakeTokenToggles(clubIdEff);
                            fetchClubAndPrint(clubIdEff, (freshClub) => {
                                const lines: string[] = [];
                                // 1. Kitchen shake token (suppressed if owner turned it off)
                                if (tokenToggles.printShakeToken) {
                                    lines.push(...buildShakeTokenReceipt({
                                        memberName: selectedMember!.name,
                                        items: [{ name: shakeName, qty: 1 }],
                                        tokenNumber: result.tokenNumber,
                                        timestamp: now,
                                    }));
                                }
                                // 2. Afresh token (suppressed if owner turned it off)
                                if (tokenToggles.printRefreshmentToken) {
                                    lines.push(...buildAfreshToken({
                                        memberName: selectedMember!.name,
                                        tokenNumber: result.tokenNumber,
                                        timestamp: now,
                                    }));
                                }
                                // 3. Customer payment receipt
                                lines.push(...buildGuestPaymentReceipt({
                                    club: freshClub,
                                    guestName: selectedMember!.name,
                                    guestPhone: memberPhone,
                                    items: [{ name: shakeName, qty: 1, unitPrice: totalAmount, total: totalAmount }],
                                    totalAmount,
                                    amountPaid: totalAmount,
                                    paymentMethod: payment.method,
                                    cashAmount: splitFields.cashAmount,
                                    upiAmount: splitFields.upiAmount,
                                    upiAccountName: payment.upiAccountName,
                                    upiNumber: payment.upiNumber,
                                    receiptNumber: generateTxnId(),
                                    tokenNumbers: [String(result.tokenNumber)],
                                    timestamp: now,
                                }));
                                return lines;
                            });
                        } catch (printErr) { console.error('[audit shake print]', printErr); }
                    }
                }
            }
            setStep("success");
        } catch (e: any) {
            setError(e.message || "Failed to save entry.");
            setStep("form");
        }
    }

    // ───── Members grid step ─────
    if (step === "members") {
        return (
            <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
                <div
                    className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                    style={{ fontFamily: "'Nunito', sans-serif" }}
                >
                    <div className="flex items-center justify-between px-5 py-4 border-b">
                        <div>
                            <h2 className="text-base font-black text-slate-900">Audit Entry</h2>
                            <p className="text-xs text-slate-500 mt-0.5">Select a member</p>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="px-5 pt-4 pb-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                value={memberSearch}
                                onChange={(e) => setMemberSearch(e.target.value)}
                                placeholder="Search by name, phone, or MNC ID..."
                                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-400"
                            />
                        </div>
                    </div>
                    <div className="overflow-y-auto flex-1 p-4">
                        {filteredMembers.length === 0 ? (
                            <p className="text-sm text-slate-400 text-center py-8">No members found.</p>
                        ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                {filteredMembers.map((m) => (
                                    <button
                                        key={m.id}
                                        onClick={() => { setSelectedMember(m); setStep("action"); }}
                                        className="flex flex-col items-center gap-2 p-3 rounded-2xl border-2 border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50 transition-all"
                                    >
                                        {(m.photoUrl || m.photo) ? (
                                            <img src={m.photoUrl || m.photo} className="w-16 h-16 rounded-full object-cover" />
                                        ) : (
                                            <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center">
                                                <span className="text-xl font-bold text-violet-700">{m.name[0]}</span>
                                            </div>
                                        )}
                                        <div className="text-center w-full">
                                            <p className="text-xs font-bold text-slate-900 truncate">{m.name}</p>
                                            {m.memberId && <p className="text-[10px] text-slate-400 font-mono">{m.memberId}</p>}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ───── Action selection step ─────
    if (step === "action") {
        return (
            <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
                <div
                    className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                    style={{ fontFamily: "'Nunito', sans-serif" }}
                >
                    <div className="flex items-center justify-between px-5 py-4 border-b">
                        <button onClick={() => { setSelectedMember(null); setStep("members"); }}
                            className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div className="text-center flex-1">
                            <h2 className="text-base font-black text-slate-900">What did they pay for?</h2>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="p-6 space-y-6">
                        <div className="flex flex-col items-center gap-3">
                            {(selectedMember?.photoUrl || selectedMember?.photo) ? (
                                <img src={selectedMember.photoUrl || selectedMember.photo} className="w-20 h-20 rounded-full object-cover border-4 border-emerald-200" />
                            ) : (
                                <div className="w-20 h-20 rounded-full bg-violet-100 flex items-center justify-center border-4 border-violet-200">
                                    <span className="text-2xl font-bold text-violet-700">{selectedMember?.name[0]}</span>
                                </div>
                            )}
                            <div className="text-center">
                                <p className="text-lg font-black text-slate-900">{selectedMember?.name}</p>
                                {(selectedMember as any)?.memberId && (
                                    <p className="text-xs text-slate-400 font-mono">{(selectedMember as any).memberId}</p>
                                )}
                                <div className="flex items-center justify-center gap-3 mt-2">
                                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                                        {(selectedMember as any)?.shakeCredits ?? 0} credits
                                    </span>
                                    {(selectedMember as any)?.phone && (
                                        <span className="text-xs text-slate-400">{(selectedMember as any).phone}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <button
                                onClick={() => { setEntryType("plan"); setSelectedProduct(null); setSelectedShake(null); setStep("form"); }}
                                className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-400 transition-all"
                            >
                                <Package className="w-7 h-7 text-emerald-600" />
                                <div className="text-center">
                                    <p className="text-xs font-black text-emerald-800">Add Plan</p>
                                </div>
                            </button>
                            <button
                                onClick={() => { setEntryType("shake"); setSelectedPlan(null); setSelectedProduct(null); setStep("form"); }}
                                className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-orange-200 bg-orange-50 hover:bg-orange-100 hover:border-orange-400 transition-all"
                            >
                                <Coffee className="w-7 h-7 text-orange-600" />
                                <div className="text-center">
                                    <p className="text-xs font-black text-orange-800">One-Day Shake</p>
                                </div>
                            </button>
                            <button
                                onClick={() => { setEntryType("product"); setSelectedPlan(null); setSelectedShake(null); setStep("form"); }}
                                className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 hover:border-amber-400 transition-all"
                            >
                                <ShoppingBag className="w-7 h-7 text-amber-600" />
                                <div className="text-center">
                                    <p className="text-xs font-black text-amber-800">Add Product</p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ───── Verification step ─────
    if (step === "verify") {
        return (
            <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
                <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    <FaceVerification
                        clubId={club?.id || ""}
                        verifiers={accountants.map((m) => ({
                            id: m.id, name: m.name, photo: m.photoUrl || m.photo,
                            faceDescriptor: m.faceDescriptor, role: "Accountant",
                        }))}
                        title="Accountant Verification"
                        subtitle={
                            entryType === "plan" ? `${selectedPlan?.name} — ₹${totalAmount} for ${selectedMember?.name}`
                                : entryType === "shake" ? `One-Day Shake — ₹240 for ${selectedMember?.name}`
                                : `${selectedProduct?.name} x${productQty} — ₹${totalAmount} for ${selectedMember?.name}`
                        }
                        onVerified={handleVerified}
                        onCancel={() => setStep("form")}
                    />
                </div>
            </div>
        );
    }

    // ───── Success step ─────
    if (step === "success" && successData) {
        return (
            <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
                <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                    style={{ fontFamily: "'Nunito', sans-serif" }}>
                    <div className="py-10 text-center px-6">
                        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-9 h-9 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <p className="text-3xl font-black text-emerald-700 mb-2">₹{successData.amount}</p>
                        <p className="font-black text-slate-900 text-lg mb-1">Entry Saved!</p>
                        <p className="text-sm text-slate-600 mb-1">{successData.label}</p>
                        <p className="text-sm text-emerald-600 font-bold">Verified by: {successData.verifier}</p>
                        <button
                            onClick={onClose}
                            className="w-full mt-6 py-3 rounded-2xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 transition-colors"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ───── Saving step ─────
    if (step === "saving") {
        return (
            <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
                <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                    style={{ fontFamily: "'Nunito', sans-serif" }}>
                    <div className="py-12 text-center px-5">
                        <div className="w-10 h-10 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4"></div>
                        <p className="font-bold text-slate-700">Saving entry...</p>
                    </div>
                </div>
            </div>
        );
    }

    // ───── Form step (plan/product/shake selection + payment) ─────
    return (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
            <div
                className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                style={{ fontFamily: "'Nunito', sans-serif" }}
            >
                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b">
                    <button onClick={() => { setSelectedPlan(null); setSelectedProduct(null); setSelectedShake(null); setStep("action"); }}
                        className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-3 flex-1">
                        {(selectedMember?.photoUrl || selectedMember?.photo) ? (
                            <img src={selectedMember.photoUrl || selectedMember.photo} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center">
                                <span className="text-sm font-bold text-violet-700">{selectedMember?.name[0]}</span>
                            </div>
                        )}
                        <div>
                            <p className="text-sm font-black text-slate-900">{selectedMember?.name}</p>
                            <p className="text-xs text-slate-500">
                                {entryType === "plan" ? "Adding Shake Credits Plan" : entryType === "shake" ? "One-Day Shake · ₹240" : "Adding Product"}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="overflow-y-auto flex-1 p-5 space-y-4">
                    {/* Plan list */}
                    {entryType === "plan" && (
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Select Plan</p>
                            <div className="space-y-2 max-h-56 overflow-y-auto">
                                {activePlans.map((plan) => (
                                    <button
                                        key={plan.id}
                                        onClick={() => setSelectedPlan(plan)}
                                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-colors ${selectedPlan?.id === plan.id
                                            ? "bg-emerald-50 border-emerald-300"
                                            : "border-slate-200 hover:bg-slate-50"
                                            }`}
                                    >
                                        <div className="text-left">
                                            <p className="font-bold text-slate-900">{plan.name}</p>
                                            <p className="text-xs text-slate-400">
                                                {planCreditsLabel(plan)}
                                            </p>
                                        </div>
                                        <span className="font-black text-slate-900">₹{plan.price}</span>
                                    </button>
                                ))}
                                {activePlans.length === 0 && (
                                    <p className="text-sm text-slate-400 text-center py-4">No active plans found.</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Shake list */}
                    {entryType === "shake" && (
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Select Shake</p>
                            <div className="space-y-2 max-h-56 overflow-y-auto">
                                {availableShakes.map((shake) => (
                                    <button
                                        key={shake.id}
                                        onClick={() => setSelectedShake(shake)}
                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm transition-colors ${selectedShake?.id === shake.id
                                            ? "bg-orange-50 border-orange-300"
                                            : "border-slate-200 hover:bg-slate-50"
                                            }`}
                                    >
                                        {shake.imageUrl ? (
                                            <img src={shake.imageUrl} className="w-10 h-10 rounded-lg object-cover" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center text-base">🥤</div>
                                        )}
                                        <div className="flex-1 text-left">
                                            <p className="font-bold text-slate-900">{shake.itemName || shake.name}</p>
                                            {shake.stockType === 'limited' && (
                                                <p className="text-xs text-amber-600 font-bold">{shake.remainingStock} left</p>
                                            )}
                                        </div>
                                        <span className="font-black text-emerald-700">₹240</span>
                                    </button>
                                ))}
                                {availableShakes.length === 0 && (
                                    <p className="text-sm text-slate-400 text-center py-4">No shakes available today.</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Product list */}
                    {entryType === "product" && (
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Select Product</p>
                            <div className="space-y-2 max-h-56 overflow-y-auto">
                                {products.map((p) => (
                                    <button
                                        key={p.id}
                                        onClick={() => setSelectedProduct(p)}
                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm transition-colors ${selectedProduct?.id === p.id
                                            ? "bg-amber-50 border-amber-300"
                                            : "border-slate-200 hover:bg-slate-50"
                                            }`}
                                    >
                                        {p.imageUrl ? (
                                            <img src={p.imageUrl} className="w-10 h-10 rounded-lg object-cover" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-base">📦</div>
                                        )}
                                        <div className="flex-1 text-left">
                                            <p className="font-bold text-slate-900">{p.name}</p>
                                            <p className="text-xs text-slate-400">Stock: {p.quantity} {p.unit}</p>
                                        </div>
                                        <span className="font-black text-slate-900">₹{p.price}</span>
                                    </button>
                                ))}
                                {products.length === 0 && (
                                    <p className="text-sm text-slate-400 text-center py-4">No products available for sale.</p>
                                )}
                            </div>

                            {selectedProduct && (
                                <div className="mt-3">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Quantity</p>
                                    <div className="flex items-center gap-3">
                                        <button onClick={() => setProductQty(Math.max(1, productQty - 1))}
                                            className="w-10 h-10 rounded-xl border border-slate-200 font-bold">−</button>
                                        <input
                                            type="number"
                                            min="1"
                                            max={selectedProduct.quantity}
                                            value={productQty}
                                            onChange={(e) => setProductQty(Math.max(1, Math.min(selectedProduct.quantity, Number(e.target.value))))}
                                            className="w-20 text-center px-3 py-2 border border-slate-200 rounded-xl text-sm font-bold"
                                        />
                                        <button onClick={() => setProductQty(Math.min(selectedProduct.quantity, productQty + 1))}
                                            className="w-10 h-10 rounded-xl bg-emerald-600 text-white font-bold">+</button>
                                        <span className="text-xs text-slate-500">{selectedProduct.unit}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Total + payment method */}
                    {totalAmount > 0 && (
                        <>
                            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center justify-between">
                                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Total</span>
                                <span className="text-2xl font-black text-emerald-700">₹{totalAmount}</span>
                            </div>

                            <div>
                                <PaymentMethodPicker
                                    total={totalAmount}
                                    upiAccounts={upiAccounts}
                                    value={payment}
                                    onChange={setPayment}
                                />
                            </div>
                        </>
                    )}

                    {error && (
                        <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">
                            {error}
                        </p>
                    )}
                </div>

                <div className="px-5 py-4 border-t bg-white">
                    <button
                        onClick={handleProceedToVerify}
                        disabled={(step as Step) === "saving" || totalAmount <= 0}
                        className="w-full py-3 rounded-2xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 transition-colors disabled:opacity-60"
                    >
                        Proceed to Verify →
                    </button>
                </div>
            </div>
        </div>
    );
}
