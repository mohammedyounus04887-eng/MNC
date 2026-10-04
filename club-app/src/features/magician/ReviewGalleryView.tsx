import { useMemo, useState } from "react";
import type { User as Member, Product } from "@/types/firestore";
import type { ConfirmedAction, ParsedAction } from "./types";
import MemberCard from "./MemberCard";
import FirstDayCard from "./FirstDayCard";
import PaymentIntentCard from "./payment/PaymentIntentCard";
import type { PaymentIntent, UpiAccount } from "./payment/types";

interface Props {
    transcript: string;
    actions: ParsedAction[];
    setActions: React.Dispatch<React.SetStateAction<ParsedAction[]>>;
    members: Member[];
    products: Product[];
    upiAccounts: UpiAccount[];
    submitting: boolean;
    onCancel: () => void;
    onSubmit: (confirmed: ConfirmedAction[]) => void;
    // First-day callback — overlay owns the camera + duplicate-check flow.
    onCaptureFirstDayFace: (id: string) => void;
}

// ─── ReviewGalleryView ──────────────────────────────────────────────────
// Per-row state machine in one place. Each card can be edited (change
// member, change shake), have its couple-side picked, or be removed.
// Submit is only enabled when every remaining row has status "ready".

export default function ReviewGalleryView({
    transcript, actions, setActions, members, products, upiAccounts,
    submitting, onCancel, onSubmit, onCaptureFirstDayFace,
}: Props) {

    const partnerLookup = useMemo(() => {
        const map = new Map<string, Member>();
        for (const m of members) map.set(m.id, m);
        return map;
    }, [members]);

    const updateAction = (id: string, patch: Partial<ParsedAction>) => {
        setActions((prev) => prev.map((a) => a.id === id ? { ...a, ...patch } : a));
    };

    const handleChangeMember = (id: string, newMemberId: string) => {
        const newMember = members.find((m) => m.id === newMemberId);
        if (!newMember) return;
        updateAction(id, {
            memberMatch: newMember,
            status: newMember.couplePartnerId ? "needs_couple" : "ready",
            coupleChoice: undefined,
        });
    };

    const handleChangeItem = (id: string, newProductId: string) => {
        const p = products.find((x) => x.id === newProductId);
        if (!p) return;
        const a = actions.find((x) => x.id === id);
        if (!a) return;
        updateAction(id, {
            itemMatch: p,
            itemName: p.name,
            // changing the shake doesn't fix couple/member, but does fix needs_item
            status: a.status === "needs_item" ? "ready" : a.status,
        });
    };

    const handleChangeCouple = (id: string, choice: "both" | "self" | "partner") => {
        updateAction(id, { coupleChoice: choice, status: "ready" });
    };

    const handleRemove = (id: string) => {
        setActions((prev) => prev.filter((a) => a.id !== id));
    };

    // First-day "ready" logic:
    //   • name + phone present
    //   • if a duplicate was detected, receptionist must pick mark_again /
    //     new_photo / ignore
    //   • if already at the 2-shake limit, only "ignore" (different person)
    //     can submit — mark_again / new_photo are blocked at the limit
    //   • photo required unless mark_again (reuses prior photo)
    const firstDayReady = (a: ParsedAction): boolean => {
        const fd = a.firstDay;
        if (!fd) return false;
        if (!fd.name || fd.phoneDigits.length < 5) return false;
        if (fd.existingMatch && !fd.duplicateChoice) return false;
        if (fd.existingMatch && fd.existingMatch.count >= 2 && fd.duplicateChoice !== "ignore") return false;
        if (fd.duplicateChoice !== "mark_again" && !fd.capturedFile) return false;
        return true;
    };

    // Paid rows are "ready" when their payment intent has no error and
    // (for split method) the cash + UPI amounts sum to the total.
    const paymentReady = (a: ParsedAction): boolean => {
        if (!a.payment) return false;
        if (a.payment.error) return false;
        const sel = a.payment.selection;
        const isFree = a.payment.payload.kind === "day_redeem";
        if (isFree) return true;
        if (sel.method === "split") {
            const sum = (sel.cashAmount ?? 0) + (sel.upiAmount ?? 0);
            if (sum !== a.payment.totalAmount) return false;
        }
        if ((sel.method === "upi" || sel.method === "split") && !sel.upiAccountId) return false;
        return true;
    };

    const ready = actions.filter((a) => {
        if (a.payment) return paymentReady(a);
        if (a.action === "first_day") return firstDayReady(a);
        return a.status === "ready";
    });
    const blocking = actions.filter((a) => {
        if (a.payment) return !paymentReady(a);
        if (a.action === "first_day") return !firstDayReady(a) && a.status !== "duplicate";
        return a.status !== "ready" && a.status !== "duplicate";
    });
    const duplicates = actions.filter((a) => a.status === "duplicate");

    const handleSubmit = () => {
        const confirmed: ConfirmedAction[] = ready.map((a) => {
            if (a.payment) {
                return {
                    memberMatch: ("member" in a.payment.payload ? a.payment.payload.member : null) as any,
                    action: a.action,
                    itemMatch: null,
                    payment: a.payment,
                };
            }
            if (a.action === "first_day") {
                return {
                    memberMatch: null as any,
                    action: a.action,
                    itemMatch: null,
                    firstDay: a.firstDay,
                };
            }
            return {
                memberMatch: a.memberMatch!,
                action: a.action,
                itemMatch: a.itemMatch,
                coupleChoice: a.coupleChoice,
                asVolunteer: a.asVolunteer,
            };
        });
        onSubmit(confirmed);
    };

    const canSubmit = !submitting && ready.length > 0 && blocking.length === 0;

    return (
        <div style={{
            background: "white",
            borderRadius: 20,
            padding: 18,
            maxWidth: 1100,
            width: "min(1100px, 92vw)",
            maxHeight: "88vh",
            overflowY: "auto",
            display: "flex", flexDirection: "column", gap: 14,
            fontFamily: "Nunito, sans-serif",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}>
            {/* header */}
            <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#1f2937" }}>
                    Magician — Review {actions.length} action{actions.length === 1 ? "" : "s"}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    <span style={{ color: "#2d9653", fontWeight: 700 }}>{ready.length} ready</span>
                    {blocking.length > 0 && <> · <span style={{ color: "#dc2626", fontWeight: 700 }}>{blocking.length} needs your attention</span></>}
                    {duplicates.length > 0 && <> · <span style={{ color: "#6b7280", fontWeight: 700 }}>{duplicates.length} duplicate</span></>}
                </div>
            </div>

            {/* transcript — always visible so receptionist can compare
                 what Magician heard against what they meant to say */}
            <div style={{
                background: "#1f2937", color: "#e5e7eb",
                padding: "10px 14px", borderRadius: 10,
                fontSize: 13, lineHeight: 1.5,
                borderLeft: "4px solid #7c3aed",
            }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#a78bfa", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
                    Heard
                </div>
                <div style={{ fontStyle: "italic" }}>
                    "{transcript || "(nothing recorded)"}"
                </div>
            </div>

            {/* gallery */}
            {actions.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#9ca3af", fontSize: 14 }}>
                    Nothing parsed yet — Cancel and try again.
                </div>
            ) : (
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: 18,
                    paddingTop: 6,
                }}>
                    {actions.map((a) => {
                        if (a.payment) {
                            return (
                                <PaymentIntentCard
                                    key={a.id}
                                    action={a}
                                    upiAccounts={upiAccounts}
                                    onChange={(id, patch) => {
                                        setActions((prev) => prev.map((x) => x.id === id
                                            ? { ...x, payment: { ...(x.payment as PaymentIntent), ...patch } }
                                            : x));
                                    }}
                                    onRemove={handleRemove}
                                />
                            );
                        }
                        if (a.action === "first_day" && a.firstDay) {
                            return (
                                <FirstDayCard
                                    key={a.id}
                                    action={a}
                                    allMembers={members}
                                    onChange={(id, patch) => {
                                        setActions((prev) => prev.map((x) => x.id === id
                                            ? { ...x, firstDay: { ...(x.firstDay as any), ...patch } }
                                            : x));
                                    }}
                                    onCaptureFace={onCaptureFirstDayFace}
                                    onResolveDuplicate={(id, choice) => {
                                        setActions((prev) => prev.map((x) => x.id === id
                                            ? { ...x, firstDay: { ...(x.firstDay as any), duplicateChoice: choice } }
                                            : x));
                                    }}
                                    onRemove={handleRemove}
                                />
                            );
                        }
                        const partner = a.memberMatch?.couplePartnerId
                            ? partnerLookup.get(a.memberMatch.couplePartnerId) ?? null
                            : null;
                        return (
                            <MemberCard
                                key={a.id}
                                action={a}
                                allMembers={members}
                                products={products}
                                partner={partner}
                                onChangeMember={handleChangeMember}
                                onChangeItem={handleChangeItem}
                                onChangeCouple={handleChangeCouple}
                                onRemove={handleRemove}
                                onToggleVolunteer={(id) => {
                                    setActions((prev) => prev.map((x) => x.id === id
                                        ? { ...x, asVolunteer: !x.asVolunteer }
                                        : x));
                                }}
                            />
                        );
                    })}
                </div>
            )}

            {/* footer */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 8, borderTop: "1px solid #f3f4f6" }}>
                <button
                    onClick={onCancel}
                    disabled={submitting}
                    style={{ padding: "10px 18px", border: "1.5px solid #d1d5db", background: "white", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: submitting ? "default" : "pointer", fontFamily: "inherit", color: "#374151", opacity: submitting ? 0.5 : 1 }}
                >
                    Cancel
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    style={{
                        padding: "10px 22px", border: "none",
                        background: canSubmit ? "linear-gradient(135deg,#7c3aed,#06b6d4)" : "#d1d5db",
                        color: "white", borderRadius: 10, fontSize: 14, fontWeight: 800,
                        cursor: canSubmit ? "pointer" : "default", fontFamily: "inherit",
                        boxShadow: canSubmit ? "0 4px 12px rgba(124,58,237,0.4)" : "none",
                    }}
                >
                    {submitting ? "Submitting..." : `✓ Submit ${ready.length} action${ready.length === 1 ? "" : "s"}`}
                </button>
            </div>
        </div>
    );
}
