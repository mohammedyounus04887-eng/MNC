import { useState, useEffect } from "react";
import { collection, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, increment, getDocs, writeBatch, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import FaceVerification from "@/components/FaceVerification";
import { logInvoice } from "@/utils/invoice";
import PaymentMethodPicker, { emptyPaymentSelection, validatePayment, type PaymentSelection } from "@/components/PaymentMethodPicker";
import { fetchClubAndPrint, generateTxnId } from "@/utils/printReceipt";
import { buildMembershipReceipt } from "@/utils/receiptBuilder";
import { planCreditsOf, planCreditsLabel } from "@/utils/planCredits";
import { todayLocal } from "@/lib/clubDay";

const GREEN = "#2d9653";

interface Props {
    clubId: string;
    upiAccounts?: { id: string; app: string; number: string; holderName: string }[];
    onClose: () => void;
}

type Step = "select_member" | "select_plan" | "payment" | "verify" | "done";

export default function AddShakeCredits({ clubId, upiAccounts = [], onClose }: Props) {
    const { toast } = useToast();
    const [step, setStep] = useState<Step>("select_member");
    const [members, setMembers] = useState<any[]>([]);
    const [accountants, setAccountants] = useState<any[]>([]);
    const [plans, setPlans] = useState<any[]>([]);
    const [selectedMember, setSelectedMember] = useState<any>(null);
    const [selectedPlan, setSelectedPlan] = useState<any>(null);
    const [payment, setPayment] = useState<PaymentSelection>(emptyPaymentSelection);
    const [search, setSearch] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!clubId) return;
        const u1 = onSnapshot(collection(db, "clubs", clubId, "members"), (snap) => {
            setMembers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        const u3 = onSnapshot(collection(db, "clubs", clubId, "accountants"), (snap) => {
            setAccountants(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        const u2 = onSnapshot(collection(db, "clubs", clubId, "memberships"), (snap) => {
            setPlans(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((p: any) => p.isActive));
        });
        return () => { u1(); u2(); u3(); };
    }, [clubId]);

    const handleVerified = async (verifier: { id: string; name: string }) => {
        if (!selectedMember || !selectedPlan) return;
        setSaving(true);
        try {
            const plan = selectedPlan;
            const planVisits = planCreditsOf(plan);
            const now = new Date();
            const endDate = new Date(now);
            endDate.setDate(endDate.getDate() + (plan.durationDays || 30));

            const batch = writeBatch(db);
            const memberRef = doc(db, "clubs", clubId, "members", selectedMember.id);

            // Renewal: capped denominator. New plan visits are added to the
            // existing balance (so leftover credits carry forward), AND the
            // plan-total denominator is reset to match — it no longer grows
            // forever across renewals (5 left + 25 new = 30/30, not 30/50).
            // Grace negatives still absorb naturally: -3 + 25 = 22.
            const currentCredits = Number((selectedMember as any).shakeCredits) || 0;
            const newPlanTotal = currentCredits + planVisits;
            // Lucky-Dip: hold ≥1 credit AND the plan must opt in.
            const wasLuckyDipEligible = currentCredits >= 1 && (plan as any).luckyDipEligible === true;
            batch.update(memberRef, {
                status: "active",
                isActiveMember: true,
                isPermanent: true,
                shakeCredits: newPlanTotal,
                shakeCreditsPlanTotal: newPlanTotal,
                membershipPlanId: plan.id,
                membershipStartDate: Timestamp.fromDate(now),
                membershipEndDate: Timestamp.fromDate(endDate),
                // Same value under the other name the app uses for expiry, so
                // the admin member list and referral cards see this renewal too.
                membershipEnd: Timestamp.fromDate(endDate),
                updatedAt: serverTimestamp(),
            });

            // Transaction record
            const txnRef = doc(collection(db, "clubs", clubId, "members", selectedMember.id, "transactions"));
            const pMethod = payment.method;
            const amt = plan.price || 0;
            const splitFields = {
                paymentMethod: pMethod,
                cashAmount: pMethod === "cash" ? amt : pMethod === "split" ? payment.cashAmount : 0,
                upiAmount: pMethod === "upi" ? amt : pMethod === "split" ? payment.upiAmount : 0,
                ...(pMethod !== "cash" && payment.upiAccountId ? {
                    upiAccountId: payment.upiAccountId,
                    upiAccountName: payment.upiAccountName ?? null,
                    upiNumber: payment.upiNumber ?? null,
                } : {}),
            };
            const payDesc = pMethod === "split"
                ? `${plan.name} plan (Split: Cash ₹${payment.cashAmount} + UPI ₹${payment.upiAmount}) — verified by ${verifier.name}`
                : pMethod === "upi"
                    ? `${plan.name} plan (UPI${payment.upiAccountName ? `: ${payment.upiAccountName}` : ""}) — verified by ${verifier.name}`
                    : `${plan.name} plan (Cash) — verified by ${verifier.name}`;

            batch.set(txnRef, {
                type: "credit",
                amount: amt,
                reason: "plan_purchase",
                description: payDesc,
                approvedBy: verifier.name,
                planId: plan.id,
                planName: plan.name,
                ...splitFields,
                creditsAdded: planVisits,
                creditsBeforeRenewal: currentCredits,
                wasLuckyDipEligible,
                createdAt: serverTimestamp(),
            });

            // Payment record
            const payRef = doc(collection(db, "clubs", clubId, "payments"));
            batch.set(payRef, {
                type: "plan_purchase",
                memberId: selectedMember.id,
                memberName: selectedMember.name,
                amount: amt,
                ...splitFields,
                description: `Renewal: ${plan.name} for ${selectedMember.name}`,
                planName: plan.name,
                verifiedBy: verifier.name,
                date: todayLocal(),
                creditsBeforeRenewal: currentCredits,
                wasLuckyDipEligible,
                createdAt: serverTimestamp(),
            });

            await batch.commit();

            // Write GST invoice
            try {
                await logInvoice(clubId, selectedMember.id, {
                    type: "plan_purchase",
                    title: `${plan.name} Plan Renewal`,
                    items: [{
                        description: `${plan.name} — ${plan.durationDays || 30} days${planVisits ? ` · ${planVisits} shake credits` : ""}`,
                        qty: 1,
                        rate: plan.price || 0,
                        amount: plan.price || 0,
                    }],
                    paymentMethod: pMethod,
                    paymentReference: pMethod === "split"
                        ? `Split · Cash ₹${payment.cashAmount} + UPI ₹${payment.upiAmount}${payment.upiAccountName ? ` (${payment.upiAccountName})` : ""}`
                        : pMethod === "upi" && payment.upiAccountName
                            ? `UPI · ${payment.upiAccountName} · ${payment.upiNumber ?? ""}`
                            : undefined,
                    notes: `Verified by ${verifier.name}`,
                });
            } catch (e) {
                console.warn("Invoice write failed", e);
            }

            // Auto-print plan renewal receipt
            try {
                fetchClubAndPrint(clubId, (freshClub) => buildMembershipReceipt({
                    club: freshClub,
                    memberName: selectedMember.name,
                    memberId: selectedMember.memberId || selectedMember.id,
                    planName: plan.name,
                    amount: amt,
                    totalVisits: planVisits,
                    paymentMethod: pMethod,
                    startDate: now,
                    endDate,
                    timestamp: now,
                    receiptNumber: generateTxnId(),
                    walletBalanceAfter: 0,
                }));
            } catch (printErr) {
                console.error("[plan renewal print]", printErr);
            }

            setStep("done");
        } catch (err: any) {
            toast({ title: "Renewal failed", description: err.message, variant: "destructive" });
        }
        setSaving(false);
    };

    // ── DONE step ──
    if (step === "done") {
        return (
            <div style={{ padding: 24, textAlign: "center", fontFamily: "Nunito, sans-serif" }}>
                <div style={{ fontSize: 60, marginBottom: 16 }}>✅</div>
                <h3 style={{ fontSize: 22, fontWeight: 900, color: "#1a3a2a", marginBottom: 8 }}>Renewal Complete!</h3>
                <p style={{ fontSize: 14, color: "#6b7280" }}>
                    {selectedPlan?.name} activated for {selectedMember?.name}
                </p>
                <p style={{ fontSize: 13, color: GREEN, fontWeight: 700, marginTop: 4 }}>
                    {planCreditsOf(selectedPlan) > 0 ? `+${planCreditsOf(selectedPlan)} shake credits added` : 'No shake credits for this plan'}
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
                    <button onClick={() => { setStep("select_member"); setSelectedMember(null); setSelectedPlan(null); }} style={{
                        padding: "12px 28px", borderRadius: 12, border: "none", background: GREEN,
                        color: "white", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Add More</button>
                    <button onClick={onClose} style={{
                        padding: "12px 28px", borderRadius: 12, border: "1.5px solid #e0f0e9",
                        background: "white", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Close</button>
                </div>
            </div>
        );
    }

    // ── VERIFY step ──
    if (step === "verify") {
        return (
            <FaceVerification
                clubId={clubId}
                verifiers={accountants.map((m) => ({
                    id: m.id, name: m.name, photo: m.photoUrl || m.photo,
                    faceDescriptor: m.faceDescriptor, role: "Accountant",
                }))}
                title="Accountant Verification"
                subtitle={`${selectedPlan?.name} → ${selectedMember?.name} · ₹${selectedPlan?.price || 0}`}
                onVerified={handleVerified}
                onCancel={() => setStep("payment")}
            />
        );
    }

    // ── PAYMENT step ──
    if (step === "payment") {
        const planAmount = selectedPlan?.price || 0;
        const v = validatePayment(payment, planAmount, { requireUpiAccount: upiAccounts.length > 0 });
        return (
            <div style={{ padding: 24, fontFamily: "Nunito, sans-serif" }}>
                <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", marginBottom: 4, textAlign: "center" }}>Payment Method</h3>
                <p style={{ fontSize: 14, color: "#6b7280", textAlign: "center", marginBottom: 8 }}>
                    {selectedPlan?.name} for {selectedMember?.name}
                </p>
                <div style={{ textAlign: "center", fontSize: 28, fontWeight: 900, color: GREEN, marginBottom: 20 }}>
                    ₹{planAmount}
                </div>

                <div style={{ marginBottom: 20 }}>
                    <PaymentMethodPicker
                        total={planAmount}
                        upiAccounts={upiAccounts}
                        value={payment}
                        onChange={setPayment}
                    />
                    {!v.ok && v.reason && (
                        <p style={{ fontSize: 12, color: "#dc2626", fontWeight: 700, marginTop: 8 }}>{v.reason}</p>
                    )}
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <button onClick={() => setStep("select_plan")} style={{ padding: "12px 28px", borderRadius: 12, border: "1.5px solid #e0f0e9", background: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif" }}>Back</button>
                    <button onClick={() => setStep("verify")} disabled={!v.ok} style={{ padding: "12px 28px", borderRadius: 12, border: "none", background: v.ok ? GREEN : "#cbd5e1", color: "white", fontSize: 14, fontWeight: 700, cursor: v.ok ? "pointer" : "not-allowed", fontFamily: "Nunito, sans-serif" }}>
                        Proceed to Verify →
                    </button>
                </div>
            </div>
        );
    }

    // ── SELECT PLAN step ──
    if (step === "select_plan") {
        return (
            <div style={{ padding: 24, fontFamily: "Nunito, sans-serif" }}>
                <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", marginBottom: 4, textAlign: "center" }}>Select Plan</h3>
                <p style={{ fontSize: 14, color: "#6b7280", textAlign: "center", marginBottom: 16 }}>
                    For: {selectedMember?.name} · Credits: {selectedMember?.shakeCredits ?? 0}
                </p>
                <div style={{ maxHeight: 350, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                    {plans.length === 0 && <p style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>No active plans found</p>}
                    {plans.map(plan => (
                        <button key={plan.id} onClick={() => { setSelectedPlan(plan); setStep("payment"); }}
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: selectedPlan?.id === plan.id ? "#f0fdf4" : "white", border: selectedPlan?.id === plan.id ? `2px solid ${GREEN}` : "1.5px solid #e5e7eb", borderRadius: 14, cursor: "pointer", fontFamily: "Nunito, sans-serif", textAlign: "left" }}>
                            <div>
                                <div style={{ fontSize: 15, fontWeight: 800, color: "#1a3a2a" }}>{plan.name}</div>
                                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                                    {plan.durationDays || 30} days · {planCreditsLabel(plan)}
                                </div>
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 900, color: GREEN }}>₹{plan.price || 0}</div>
                        </button>
                    ))}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
                    <button onClick={() => { setStep("select_member"); setSelectedMember(null); }} style={{ padding: "12px 28px", borderRadius: 12, border: "1.5px solid #e0f0e9", background: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif" }}>Back</button>
                </div>
            </div>
        );
    }

    // ── SELECT MEMBER step ──
    const filtered = members.filter((m) =>
        !search || m.name?.toLowerCase().includes(search.toLowerCase()) || m.phone?.includes(search)
    );

    return (
        <div style={{ padding: 24, fontFamily: "Nunito, sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", margin: 0 }}>🔄 Renewal</h3>
                <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>Select a member to renew their plan</p>
            <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or phone..."
                style={{
                    width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9",
                    fontSize: 14, outline: "none", fontFamily: "Nunito, sans-serif", marginBottom: 12,
                    boxSizing: "border-box",
                }}
            />
            <div style={{ maxHeight: 350, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.map((m) => (
                    <button
                        key={m.id}
                        onClick={() => { setSelectedMember(m); setStep("select_plan"); }}
                        style={{
                            display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                            background: "white", border: "1.5px solid #e0f0e9", borderRadius: 10,
                            cursor: "pointer", fontFamily: "Nunito, sans-serif", textAlign: "left",
                        }}
                    >
                        <div style={{
                            width: 40, height: 40, borderRadius: "50%", background: "#f0fdf4",
                            overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                            {(m.photoUrl || m.photo) ? <img src={m.photoUrl || m.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                                : <span style={{ fontSize: 16, fontWeight: 700, color: GREEN }}>{(m.name || "?")[0]}</span>}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a2a" }}>{m.name}</div>
                            <div style={{ fontSize: 12, color: "#6b7280" }}>
                                Credits: {m.shakeCredits ?? 0} · {m.phone || ""}
                            </div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}
