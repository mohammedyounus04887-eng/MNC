import { useState } from "react";
import type { ParsedAction } from "../types";
import type { PaymentIntent, PaymentMethod, UpiAccount } from "./types";

interface Props {
    action: ParsedAction;            // action.payment guaranteed set
    upiAccounts: UpiAccount[];
    onChange: (id: string, patch: Partial<PaymentIntent>) => void;
    onRemove: (id: string) => void;
}

// ─── PaymentIntentCard ────────────────────────────────────────────────
// Unified card for all four paid intents (oneday_shake, day_redeem,
// topup, plan_renewal). Renders different summary fields per kind but
// shares the payment-method picker + amount display + remove button.

export default function PaymentIntentCard({ action, upiAccounts, onChange, onRemove }: Props) {
    const intent = action.payment!;
    const p = intent.payload;
    const member = "member" in p ? p.member : "buyer" in p ? p.buyer : null;
    const memberPhoto = member ? ((member as any).photoUrl || member.photo || "") : "";
    const memberInitial = (member?.name?.[0] ?? "?").toUpperCase();

    const isFree = p.kind === "day_redeem";
    const valid = !intent.error;
    const themeColor = valid ? (isFree ? "#0891b2" : "#7c3aed") : "#dc2626";
    const themeChip = valid ? (isFree ? "#cffafe" : "#ede9fe") : "#fee2e2";
    const themeLabel = INTENT_LABELS[p.kind];

    const onMethodChange = (method: PaymentMethod) => {
        onChange(action.id, { selection: { ...intent.selection, method, cashAmount: 0, upiAmount: 0 } });
    };
    const onUpiAccountChange = (id: string) => {
        onChange(action.id, { selection: { ...intent.selection, upiAccountId: id } });
    };
    const onSplitChange = (kind: "cash" | "upi", value: number) => {
        onChange(action.id, {
            selection: {
                ...intent.selection,
                [kind === "cash" ? "cashAmount" : "upiAmount"]: value,
            },
        });
    };

    return (
        <div style={{
            width: 240,
            background: "white",
            borderRadius: 14,
            border: `2px solid ${themeColor}`,
            boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
            padding: 12,
            display: "flex", flexDirection: "column", gap: 8,
            position: "relative",
            fontFamily: "Nunito, sans-serif",
        }}>
            {/* status chip */}
            <div style={{
                position: "absolute", top: -10, left: 12,
                background: themeChip, color: themeColor,
                fontSize: 11, fontWeight: 800, padding: "3px 10px",
                borderRadius: 10, border: `1.5px solid ${themeColor}`,
            }}>{themeLabel}</div>

            {/* remove × */}
            <button
                onClick={() => onRemove(action.id)}
                title="Remove this row"
                style={{
                    position: "absolute", top: 8, right: 8,
                    width: 22, height: 22, borderRadius: 11,
                    border: "none", background: "#f3f4f6", color: "#6b7280",
                    fontWeight: 700, cursor: "pointer", fontSize: 13, lineHeight: 1,
                }}
            >×</button>

            {/* photo */}
            <div style={{
                width: 72, height: 72, borderRadius: 36,
                background: memberPhoto ? `center/cover url(${memberPhoto})` : "#ede9fe",
                color: "#7c3aed",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 26, fontWeight: 800, margin: "8px auto 0",
                border: "3px solid #faf5ff",
            }}>
                {!memberPhoto && memberInitial}
            </div>

            {/* member name + id */}
            <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#1f2937", lineHeight: 1.1 }}>
                    {member?.name || "—"}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                    {(member as any)?.memberId || ""}
                </div>
            </div>

            {/* intent-specific summary */}
            <IntentSummary intent={intent} />

            {/* amount */}
            <div style={{ textAlign: "center", padding: "4px 0" }}>
                {isFree ? (
                    <div style={{ fontSize: 20, fontWeight: 900, color: "#0891b2" }}>FREE</div>
                ) : (
                    <div style={{ fontSize: 22, fontWeight: 900, color: "#1f2937" }}>
                        ₹{intent.totalAmount.toLocaleString()}
                    </div>
                )}
            </div>

            {/* payment method (hidden for free) */}
            {!isFree && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", gap: 4 }}>
                        {(["cash", "upi", "split"] as PaymentMethod[]).map((m) => (
                            <button
                                key={m}
                                onClick={() => onMethodChange(m)}
                                style={{
                                    flex: 1, padding: "6px 0",
                                    border: intent.selection.method === m ? "2px solid #7c3aed" : "1px solid #d1d5db",
                                    background: intent.selection.method === m ? "#ede9fe" : "white",
                                    color: intent.selection.method === m ? "#5b21b6" : "#6b7280",
                                    borderRadius: 6, fontSize: 11, fontWeight: 800,
                                    cursor: "pointer", fontFamily: "inherit",
                                    textTransform: "uppercase",
                                }}
                            >{m}</button>
                        ))}
                    </div>

                    {/* UPI account picker */}
                    {(intent.selection.method === "upi" || intent.selection.method === "split") && upiAccounts.length > 0 && (
                        <select
                            value={intent.selection.upiAccountId ?? ""}
                            onChange={(e) => onUpiAccountChange(e.target.value)}
                            style={{ padding: "5px 6px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 11, fontFamily: "inherit" }}
                        >
                            <option value="">Select UPI account…</option>
                            {upiAccounts.map((a) => (
                                <option key={a.id} value={a.id}>{a.app} · {a.number}</option>
                            ))}
                        </select>
                    )}

                    {/* split amounts */}
                    {intent.selection.method === "split" && (
                        <div style={{ display: "flex", gap: 4 }}>
                            <input
                                type="number" min={0} placeholder="Cash"
                                value={intent.selection.cashAmount ?? ""}
                                onChange={(e) => onSplitChange("cash", Number(e.target.value) || 0)}
                                style={splitInput}
                            />
                            <input
                                type="number" min={0} placeholder="UPI"
                                value={intent.selection.upiAmount ?? ""}
                                onChange={(e) => onSplitChange("upi", Number(e.target.value) || 0)}
                                style={splitInput}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* error banner */}
            {intent.error && (
                <div style={{
                    background: "#fef2f2", border: "1px solid #fecaca",
                    color: "#991b1b", padding: 6, borderRadius: 6,
                    fontSize: 11, fontWeight: 700,
                }}>
                    {intent.error}
                </div>
            )}
        </div>
    );
}

const INTENT_LABELS: Record<string, string> = {
    oneday_shake: "🥤 One-Day Shake",
    day_redeem: "🎟️ Day Redeem (free)",
    topup: "💰 Wallet Top-up",
    plan_renewal: "🔄 Plan Renewal",
    product_sale: "🛍️ Product Sale",
};

function IntentSummary({ intent }: { intent: PaymentIntent }) {
    const p = intent.payload;
    const row = (label: string, value: React.ReactNode) => (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: "#6b7280", fontWeight: 600 }}>{label}</span>
            <span style={{ color: "#1f2937", fontWeight: 800, textAlign: "right" }}>{value}</span>
        </div>
    );
    switch (p.kind) {
        case "oneday_shake":
            return (
                <div style={{ background: "#faf5ff", padding: 8, borderRadius: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {row("Shake", (p.item as any).name || (p.item as any).itemName)}
                    {row("Days", `${p.days} × ₹${p.unitPrice}`)}
                </div>
            );
        case "day_redeem":
            return (
                <div style={{ background: "#ecfeff", padding: 8, borderRadius: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {row("Shake", (p.item as any).name || (p.item as any).itemName)}
                    {row("Credits left", `${p.creditsAvailable} banked`)}
                </div>
            );
        case "topup":
            return (
                <div style={{ background: "#faf5ff", padding: 8, borderRadius: 8 }}>
                    {row("Top-up", `+₹${p.amount.toLocaleString()} → wallet`)}
                </div>
            );
        case "plan_renewal":
            return (
                <div style={{ background: "#faf5ff", padding: 8, borderRadius: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {row("Plan", p.plan.name || "")}
                    {row("Credits", `${(p.plan as any).visits ?? (p.plan as any).totalVisits ?? 0}`)}
                    {row("Duration", `${(p.plan as any).durationDays ?? 30} days`)}
                </div>
            );
        case "product_sale":
            return (
                <div style={{ background: p.isGift ? "#ecfdf5" : "#faf5ff", padding: 8, borderRadius: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {row("Product", p.product.name)}
                    {row("Quantity", `${p.quantity} ${p.product.unit || ""}`.trim())}
                    {row(p.isGift ? "Type" : "Unit price", p.isGift ? "🎁 Gift" : `₹${p.unitPrice}`)}
                </div>
            );
    }
}

const splitInput: React.CSSProperties = {
    flex: 1, padding: "5px 6px", border: "1px solid #d1d5db",
    borderRadius: 6, fontSize: 11, fontFamily: "inherit",
    boxSizing: "border-box", minWidth: 0,
};
