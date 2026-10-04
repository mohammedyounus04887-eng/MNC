import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
    usePendingPurchaseRequests,
    useFulfillPurchaseRequest,
    useRejectPurchaseRequest,
} from "@/hooks/usePurchaseRequests";
import FaceVerification from "@/components/FaceVerification";
import { fetchClubAndPrint } from "@/utils/printReceipt";
import { buildPurchaseRequestReceipt } from "@/utils/receiptBuilder";
import type { PurchaseRequest } from "@/types/firestore";

const GREEN = "#2d9653";

interface Props {
    clubId: string;
    onBack: () => void;
}

type View = "list" | "detail" | "verify_accountant" | "done";

export default function PurchaseRequestsScreen({ clubId, onBack }: Props) {
    const { requests, loading } = usePendingPurchaseRequests(clubId);
    const fulfill = useFulfillPurchaseRequest();
    const reject = useRejectPurchaseRequest();

    const [view, setView] = useState<View>("list");
    const [selected, setSelected] = useState<PurchaseRequest | null>(null);
    const [paymentMethod, setPaymentMethod] = useState<"cash" | "upi" | "card">("cash");
    const [accountants, setAccountants] = useState<any[]>([]);
    const [error, setError] = useState("");
    const [doneSummary, setDoneSummary] = useState<{
        receiptNumber: string;
        creditsAdded: number;
        membershipExtension: { startDate: Date; endDate: Date; planName: string } | null;
        walletBalanceAfter: number;
    } | null>(null);

    useEffect(() => {
        if (!clubId) return;
        const unsub = onSnapshot(collection(db, "clubs", clubId, "accountants"), (snap) => {
            setAccountants(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, [clubId]);

    const handleAccountantVerified = async (verifier: { id: string; name: string }) => {
        if (!selected) return;
        setError("");
        try {
            const result = await fulfill.mutateAsync({
                request: selected,
                paymentMethod,
                accountantVerifiedBy: verifier.name,
                accountantVerifiedById: verifier.id,
            });

            // Print combined receipt
            try {
                fetchClubAndPrint(clubId, (freshClub) =>
                    buildPurchaseRequestReceipt({
                        club: freshClub,
                        memberName: selected.memberName,
                        memberId: (selected as any).memberId || selected.memberId,
                        items: selected.items.map((item) => {
                            if (item.type === "membership") {
                                return {
                                    label: item.planName,
                                    detail: `${item.visits} credits · ${item.durationDays} days`,
                                    amount: item.price,
                                };
                            }
                            if (item.type === "wallet_topup") {
                                return {
                                    label: "Wallet Top-up",
                                    detail: `Adds ₹${item.amount} to wallet`,
                                    amount: item.amount,
                                };
                            }
                            return {
                                label: `${item.productName} x${item.quantity}`,
                                detail: `₹${item.unitPrice} per ${item.unit}`,
                                amount: item.totalPrice,
                            };
                        }),
                        totalAmount: selected.totalAmount,
                        paymentMethod,
                        receiptNumber: result.receiptNumber,
                        timestamp: new Date(),
                        accountantName: verifier.name,
                        creditsAdded: result.creditsAdded,
                        membershipValidTill: result.membershipExtension?.endDate,
                        walletBalanceAfter: result.walletBalanceAfter,
                    }),
                );
            } catch (printErr) {
                console.error("[purchase request receipt print]", printErr);
            }

            setDoneSummary(result);
            setView("done");
        } catch (err: any) {
            setError(err.message || "Could not process payment");
            setView("detail");
        }
    };

    const handleReject = async () => {
        if (!selected) return;
        const reason = prompt("Reason for rejection?") ?? "";
        try {
            await reject.mutateAsync({ clubId, requestId: selected.id, reason });
            setSelected(null);
            setView("list");
        } catch (err: any) {
            setError(err.message);
        }
    };

    // ═══════════════════════════════════════════════
    // VIEW: face verification
    // ═══════════════════════════════════════════════
    if (view === "verify_accountant" && selected) {
        return (
            <FaceVerification
                clubId={clubId}
                verifiers={accountants.map((a) => ({
                    id: a.id,
                    name: a.name,
                    photo: a.photo,
                    faceDescriptor: a.faceDescriptor,
                    role: "Accountant",
                }))}
                title="Verify Accountant"
                subtitle={`To complete ₹${selected.totalAmount} purchase for ${selected.memberName}`}
                onVerified={handleAccountantVerified}
                onCancel={() => setView("detail")}
            />
        );
    }

    // ═══════════════════════════════════════════════
    // VIEW: success summary
    // ═══════════════════════════════════════════════
    if (view === "done" && selected && doneSummary) {
        return (
            <div style={containerDark}>
                <div style={cardWhite}>
                    <div style={{ textAlign: "center", marginBottom: 20 }}>
                        <div style={{ fontSize: 64, marginBottom: 8 }}>✅</div>
                        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#1a3a2a" }}>
                            Request Fulfilled
                        </h2>
                        <p style={{ marginTop: 4, fontSize: 13, color: "#6b7280" }}>
                            {selected.memberName}
                        </p>
                    </div>

                    <div style={{ background: "#f0fdf4", borderRadius: 12, padding: 14, marginBottom: 14 }}>
                        <div style={summaryRow}>
                            <span>Receipt</span>
                            <span style={{ fontWeight: 700, fontFamily: "monospace" }}>
                                {doneSummary.receiptNumber}
                            </span>
                        </div>
                        <div style={summaryRow}>
                            <span>Total</span>
                            <span style={{ fontWeight: 800, color: GREEN }}>
                                ₹{selected.totalAmount.toLocaleString()}
                            </span>
                        </div>
                        {doneSummary.creditsAdded > 0 && (
                            <div style={summaryRow}>
                                <span>Credits Added</span>
                                <span style={{ fontWeight: 700 }}>+{doneSummary.creditsAdded}</span>
                            </div>
                        )}
                        {doneSummary.membershipExtension && (
                            <div style={summaryRow}>
                                <span>Plan Valid Till</span>
                                <span style={{ fontWeight: 700 }}>
                                    {doneSummary.membershipExtension.endDate.toLocaleDateString("en-IN", {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                    })}
                                </span>
                            </div>
                        )}
                    </div>

                    {selected.items.some((item) => item.type === "product") && (
                        <div
                            style={{
                                background: "#fff7ed",
                                border: "1px solid #fed7aa",
                                borderRadius: 12,
                                padding: 12,
                                marginBottom: 14,
                                fontSize: 13,
                                color: "#9a3412",
                            }}
                        >
                            🛒 Hand the products to the member now.
                        </div>
                    )}

                    <button
                        onClick={() => {
                            setSelected(null);
                            setDoneSummary(null);
                            setView("list");
                        }}
                        style={primaryBtn}
                    >
                        Done
                    </button>
                </div>
            </div>
        );
    }

    // ═══════════════════════════════════════════════
    // VIEW: detail
    // ═══════════════════════════════════════════════
    if (view === "detail" && selected) {
        return (
            <div style={containerDark}>
                <div style={cardWhite}>
                    <button
                        onClick={() => {
                            setView("list");
                            setSelected(null);
                            setError("");
                        }}
                        style={backBtn}
                    >
                        ← Back to Requests
                    </button>

                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                        {selected.memberPhoto ? (
                            <img
                                src={selected.memberPhoto}
                                alt=""
                                style={{
                                    width: 64,
                                    height: 64,
                                    borderRadius: "50%",
                                    objectFit: "cover",
                                    border: "3px solid #e0f0e9",
                                    flexShrink: 0,
                                }}
                            />
                        ) : (
                            <div
                                style={{
                                    width: 64,
                                    height: 64,
                                    borderRadius: "50%",
                                    background: "#e0f0e9",
                                    color: GREEN,
                                    fontWeight: 900,
                                    fontSize: 24,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                            >
                                {selected.memberName[0]?.toUpperCase()}
                            </div>
                        )}
                        <div>
                            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#1a3a2a" }}>
                                {selected.memberName}
                            </h2>
                            <p style={{ marginTop: 2, fontSize: 12, color: "#6b7280" }}>
                                Submitted {formatRelative(selected.createdAt)}
                            </p>
                        </div>
                    </div>

                    <div
                        style={{
                            background: "#f9fafb",
                            borderRadius: 12,
                            padding: 12,
                            marginBottom: 14,
                            border: "1px solid #f3f4f6",
                        }}
                    >
                        {selected.items.map((item, idx) => (
                            <div
                                key={idx}
                                style={{
                                    padding: "8px 0",
                                    borderBottom:
                                        idx < selected.items.length - 1
                                            ? "1px solid #f3f4f6"
                                            : "none",
                                }}
                            >
                                <div style={summaryRow}>
                                    <span style={{ fontWeight: 700, color: "#1a3a2a" }}>
                                        {itemPrimary(item)}
                                    </span>
                                    <span style={{ fontWeight: 800, color: GREEN }}>
                                        ₹{itemAmount(item).toLocaleString()}
                                    </span>
                                </div>
                                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                                    {itemSecondary(item)}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div style={summaryRow}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#1a3a2a" }}>Total</span>
                        <span style={{ fontSize: 22, fontWeight: 900, color: GREEN }}>
                            ₹{selected.totalAmount.toLocaleString()}
                        </span>
                    </div>

                    {selected.notes && (
                        <div
                            style={{
                                marginTop: 12,
                                padding: 10,
                                background: "#fffbeb",
                                border: "1px solid #fde68a",
                                borderRadius: 10,
                                fontSize: 12,
                                color: "#92400e",
                            }}
                        >
                            📝 {selected.notes}
                        </div>
                    )}

                    <div style={{ marginTop: 18 }}>
                        <p style={sectionTitle}>Payment Method</p>
                        <div style={{ display: "flex", gap: 8 }}>
                            {(["cash", "upi", "card"] as const).map((method) => {
                                const active = paymentMethod === method;
                                return (
                                    <button
                                        key={method}
                                        type="button"
                                        onClick={() => setPaymentMethod(method)}
                                        style={{
                                            flex: 1,
                                            padding: "10px 0",
                                            borderRadius: 12,
                                            border: `2px solid ${active ? GREEN : "#e5e7eb"}`,
                                            background: active ? "#f0fdf4" : "white",
                                            color: active ? GREEN : "#475569",
                                            fontWeight: 700,
                                            fontSize: 13,
                                            cursor: "pointer",
                                            textTransform: "uppercase",
                                            fontFamily: "Nunito, sans-serif",
                                        }}
                                    >
                                        {method}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {error && (
                        <p
                            style={{
                                marginTop: 12,
                                padding: 10,
                                background: "#fef2f2",
                                border: "1px solid #fecaca",
                                borderRadius: 10,
                                fontSize: 12,
                                color: "#b91c1c",
                            }}
                        >
                            ⚠ {error}
                        </p>
                    )}

                    <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                        <button onClick={handleReject} style={rejectBtn} disabled={fulfill.isPending}>
                            Reject
                        </button>
                        <button
                            onClick={() => setView("verify_accountant")}
                            disabled={fulfill.isPending || accountants.length === 0}
                            style={{ ...primaryBtn, flex: 2, opacity: accountants.length === 0 ? 0.5 : 1 }}
                        >
                            {fulfill.isPending ? "Processing…" : "Process Payment"}
                        </button>
                    </div>
                    {accountants.length === 0 && (
                        <p style={{ marginTop: 8, fontSize: 11, color: "#dc2626", textAlign: "center" }}>
                            No accountant configured. Add one in Settings before processing.
                        </p>
                    )}
                </div>
            </div>
        );
    }

    // ═══════════════════════════════════════════════
    // VIEW: list
    // ═══════════════════════════════════════════════
    return (
        <div style={containerDark}>
            <div style={{ ...cardWhite, padding: 0, overflow: "hidden" }}>
                <div
                    style={{
                        padding: "16px 20px",
                        background: "linear-gradient(135deg,#1a3a2a,#2d9653)",
                        color: "white",
                    }}
                >
                    <button onClick={onBack} style={{ ...backBtn, color: "rgba(255,255,255,0.8)", margin: 0 }}>
                        ← Reception Home
                    </button>
                    <h2 style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 900 }}>
                        Member Requests
                    </h2>
                    <p style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.7 }}>
                        {loading ? "Loading…" : requests.length === 0 ? "No pending requests" : `${requests.length} pending`}
                    </p>
                </div>

                {!loading && requests.length === 0 && (
                    <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>
                        <div style={{ fontSize: 56, marginBottom: 12 }}>📭</div>
                        <p style={{ fontSize: 13, fontWeight: 600 }}>
                            No pending requests right now.
                        </p>
                    </div>
                )}

                {requests.map((req, idx) => (
                    <button
                        key={req.id}
                        onClick={() => {
                            setSelected(req);
                            setView("detail");
                            setError("");
                        }}
                        style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "14px 20px",
                            background: "white",
                            border: "none",
                            borderBottom: idx < requests.length - 1 ? "1px solid #f3f4f6" : "none",
                            cursor: "pointer",
                            textAlign: "left",
                            fontFamily: "Nunito, sans-serif",
                        }}
                    >
                        {req.memberPhoto ? (
                            <img
                                src={req.memberPhoto}
                                alt=""
                                style={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: "50%",
                                    objectFit: "cover",
                                    flexShrink: 0,
                                }}
                            />
                        ) : (
                            <div
                                style={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: "50%",
                                    background: "#e0f0e9",
                                    color: GREEN,
                                    fontWeight: 900,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                            >
                                {req.memberName[0]?.toUpperCase()}
                            </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <p
                                style={{
                                    margin: 0,
                                    fontSize: 14,
                                    fontWeight: 800,
                                    color: "#1a3a2a",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {req.memberName} has raised a request
                            </p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6b7280" }}>
                                {req.items.length} item{req.items.length !== 1 ? "s" : ""} ·{" "}
                                {formatRelative(req.createdAt)}
                            </p>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: GREEN }}>
                                ₹{req.totalAmount.toLocaleString()}
                            </p>
                            <p style={{ margin: "2px 0 0", fontSize: 10, color: "#9ca3af" }}>›</p>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function itemPrimary(item: PurchaseRequest["items"][number]): string {
    if (item.type === "membership") return item.planName;
    if (item.type === "wallet_topup") return "Wallet Top-up";
    return `${item.productName} × ${item.quantity}`;
}

function itemSecondary(item: PurchaseRequest["items"][number]): string {
    if (item.type === "membership")
        return `${item.visits} credits · ${item.durationDays} days`;
    if (item.type === "wallet_topup") return `Adds ₹${item.amount} to wallet`;
    return `₹${item.unitPrice} per ${item.unit}`;
}

function itemAmount(item: PurchaseRequest["items"][number]): number {
    if (item.type === "membership") return item.price;
    if (item.type === "wallet_topup") return item.amount;
    return item.totalPrice;
}

function formatRelative(ts: any): string {
    const date = ts?.toDate ? ts.toDate() : null;
    if (!date) return "just now";
    const diffMs = Date.now() - date.getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// ─── Styles ──────────────────────────────────────────────────────────────

const containerDark: React.CSSProperties = {
    minHeight: "100vh",
    background: "linear-gradient(160deg,#0a1f14 0%,#1a4a2e 100%)",
    fontFamily: "Nunito, sans-serif",
    padding: 20,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
};

const cardWhite: React.CSSProperties = {
    background: "white",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 520,
    boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
};

const summaryRow: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 13,
    color: "#475569",
    padding: "2px 0",
};

const sectionTitle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#6b7280",
    marginBottom: 8,
};

const primaryBtn: React.CSSProperties = {
    width: "100%",
    padding: "14px 0",
    borderRadius: 12,
    border: "none",
    background: GREEN,
    color: "white",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "Nunito, sans-serif",
};

const rejectBtn: React.CSSProperties = {
    flex: 1,
    padding: "12px 0",
    borderRadius: 12,
    border: "1.5px solid #fecaca",
    background: "white",
    color: "#dc2626",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "Nunito, sans-serif",
};

const backBtn: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: "#6b7280",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    marginBottom: 12,
    padding: 0,
    fontFamily: "Nunito, sans-serif",
};
