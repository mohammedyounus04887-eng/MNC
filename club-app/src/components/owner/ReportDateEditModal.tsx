/**
 * Report transaction manager (Reports → Daily / Monthly day-row / Yearly).
 *
 * Full visibility + correction for a date range:
 *   - Summary: revenue, shakes, memberships, products
 *   - Payments / Shakes / Memberships / Products tabs list EVERY contributing
 *     transaction (who, what, amount, date) with Edit (amount) + Delete
 *   - Add tab: add a real backdated shake / membership / product
 *
 * Edits/deletes use the cascade service so member credits / wallet / stock are
 * reversed correctly. Single-day ranges (start==end) drive the per-day Edit
 * button; month / year ranges drive the top "Manage transactions" button.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { summarizeMoney, splitOf } from "@/lib/paymentSplit";
import {
    addBackdatedShake, addBackdatedMembership, addBackdatedProduct,
    type PayMethod, type EditMemberLite,
} from "@/lib/reportEdits";
import {
    deletePaymentCascade, updatePaymentCascade, cancelOrderCascade,
} from "@/lib/cascadeService";

const FONT = "'Nunito', sans-serif";
const fmtRs = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const isCancelled = (o: any) => o?.status === "cancelled" || o?.status === "rejected";
const MEMBERSHIP_TYPES = new Set(["plan_purchase", "membership"]);

// "split (₹600 cash + ₹550 upi)" instead of just "split" — how the money
// arrived, in words, on the row itself, so the desk never has to guess which
// side of a split went where. Top-ups are named for what they are.
function describeTender(p: any): string {
    const s = splitOf(p);
    const m = String(p?.paymentMethod || "?").toLowerCase();
    const label = (p?.type === "wallet_topup" || p?.type === "topup") ? "top-up · " : "";
    if (m === "split") return `${label}split (₹${Math.round(s.cash)} cash + ₹${Math.round(s.upi)} upi)`;
    return label + m;
}

type Tab = "payments" | "shakes" | "memberships" | "products" | "add";

export default function ReportDateEditModal({ clubId, startStr, endStr, label, onClose, onChanged }: {
    clubId: string; startStr: string; endStr: string; label: string; onClose: () => void; onChanged: () => void;
}) {
    const singleDay = startStr === endStr;
    const [tab, setTab] = useState<Tab>("payments");

    // Reference data for the Add tab
    const [members, setMembers] = useState<any[]>([]);
    const [plans, setPlans] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);

    // Transactions for the range
    const [orders, setOrders] = useState<any[]>([]);
    const [payments, setPayments] = useState<any[]>([]);
    const [productSales, setProductSales] = useState<any[]>([]);
    const [loadingTx, setLoadingTx] = useState(true);
    const [tick, setTick] = useState(0);

    const [busyId, setBusyId] = useState<string | null>(null);
    const [editId, setEditId] = useState<string | null>(null);
    const [editAmt, setEditAmt] = useState("");
    const [replacing, setReplacing] = useState<any | null>(null);
    const [err, setErr] = useState("");

    useEffect(() => {
        if (!clubId) return;
        (async () => {
            try {
                const [m, p, pr] = await Promise.all([
                    getDocs(collection(db, `clubs/${clubId}/members`)),
                    getDocs(collection(db, `clubs/${clubId}/memberships`)).catch(() => null),
                    getDocs(collection(db, `clubs/${clubId}/simpleProducts`)).catch(() => null),
                ]);
                setMembers(m.docs.map(d => ({ id: d.id, ...d.data() })));
                setPlans((p?.docs || []).map(d => ({ id: d.id, ...(d.data() as any) })).filter((x: any) => x.isActive !== false));
                setProducts((pr?.docs || []).map(d => ({ id: d.id, ...(d.data() as any) })));
            } catch (e) { console.error("[edit ref load]", e); }
        })();
    }, [clubId]);

    const loadTx = useCallback(async () => {
        setLoadingTx(true);
        try {
            const [o, p, ps] = await Promise.all([
                getDocs(query(collection(db, `clubs/${clubId}/orders`), where("date", ">=", startStr), where("date", "<=", endStr))),
                getDocs(query(collection(db, `clubs/${clubId}/payments`), where("date", ">=", startStr), where("date", "<=", endStr))),
                getDocs(query(collection(db, `clubs/${clubId}/productSales`), where("date", ">=", startStr), where("date", "<=", endStr))),
            ]);
            setOrders(o.docs.map(d => ({ id: d.id, ...d.data() })));
            setPayments(p.docs.map(d => ({ id: d.id, ...d.data() })).filter((x: any) => !x.deleted));
            setProductSales(ps.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) { console.error("[edit tx load]", e); }
        finally { setLoadingTx(false); }
    }, [clubId, startStr, endStr]);

    useEffect(() => { loadTx(); }, [loadTx, tick]);

    const refresh = () => { setTick(t => t + 1); onChanged(); };

    const summary = useMemo(() => {
        const liveOrders = orders.filter(o => !isCancelled(o));
        // Served only — Reports counts served, and this modal opens FROM
        // Reports, so a different shake count here read as a bug.
        const shakes = liveOrders
            .filter(o => o.status === "served")
            .reduce((s, o) => s + (o.items || []).reduce((si: number, it: any) => si + (Number(it.quantity ?? it.qty) || 1), 0), 0);
        // The same summary every report uses. `totalOf(payments)` here included
        // wallet top-ups while the Reports page underneath excluded them, so
        // the modal and the page it opened from disagreed by exactly the
        // top-ups — the class of mismatch this modal exists to explain.
        const money = summarizeMoney(payments);
        const memberships = payments.filter(p => MEMBERSHIP_TYPES.has(p.type)).length;
        const productsSold = productSales.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
        return { shakes, money, memberships, productsSold };
    }, [orders, payments, productSales]);

    // ── actions ──
    const delPayment = async (p: any) => {
        setBusyId(p.id); setErr("");
        const res = await deletePaymentCascade(clubId, p);
        setBusyId(null);
        if (res.ok) refresh(); else setErr(res.errorMessage || "Delete failed");
    };
    const saveEditPayment = async (p: any) => {
        const amt = Number(editAmt);
        if (!amt || amt < 0) { setErr("Enter a valid amount"); return; }
        setBusyId(p.id); setErr("");
        const res = await updatePaymentCascade(clubId, p, { amount: amt, ...(p.paymentMethod === "cash" ? { cashAmount: amt } : p.paymentMethod === "upi" ? { upiAmount: amt } : {}) });
        setBusyId(null);
        if (res.ok) { setEditId(null); refresh(); } else setErr(res.errorMessage || "Update failed");
    };
    const delOrder = async (o: any) => {
        setBusyId(o.id); setErr("");
        const res = await cancelOrderCascade(clubId, o);
        setBusyId(null);
        if (res.ok) refresh(); else setErr(res.errorMessage || "Delete failed");
    };
    const delProductSale = async (ps: any) => {
        setBusyId(ps.id); setErr("");
        try { await deleteDoc(doc(db, `clubs/${clubId}/productSales/${ps.id}`)); refresh(); }
        catch (e: any) { setErr(e?.message || "Delete failed"); }
        finally { setBusyId(null); }
    };

    const memberships = payments.filter(p => MEMBERSHIP_TYPES.has(p.type));
    const liveOrders = orders.filter(o => !isCancelled(o));

    return (
        <div onClick={onClose} style={overlay}>
            <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, padding: 18, maxWidth: 560, width: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                        <div style={{ fontSize: 17, fontWeight: 900, color: "#0f172a" }}>🧾 Transactions · {label}</div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>See, add, edit &amp; delete the entries behind the totals.</div>
                    </div>
                    <button onClick={onClose} style={{ width: 30, height: 30, border: "none", background: "#f1f5f9", borderRadius: "50%", cursor: "pointer", fontWeight: 800, color: "#64748b" }}>×</button>
                </div>

                {/* Summary. Collected = what the listed rows add up to; revenue
                    differs only by wallet top-ups, and when it does the
                    subtraction is printed right here instead of leaving the desk
                    to discover two totals that disagree. */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, margin: "12px 0 6px" }}>
                    <Mini label="Collected" value={fmtRs(summary.money.totalCollected)} color="#0f172a" />
                    <Mini label="Revenue" value={fmtRs(summary.money.revenue)} color="#16a34a" />
                    <Mini label="Shakes served" value={String(summary.shakes)} color="#0891b2" />
                    <Mini label="Memberships" value={String(summary.memberships)} color="#2563eb" />
                </div>
                {summary.money.topupTotal > 0 && (
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: "#b45309", margin: "0 0 8px" }}>
                        Collected {fmtRs(summary.money.totalCollected)} − wallet top-ups {fmtRs(summary.money.topupTotal)} = revenue {fmtRs(summary.money.revenue)}.
                        Cash {fmtRs(summary.money.cashCollected)} · UPI {fmtRs(summary.money.upiCollected)}.
                    </div>
                )}

                {/* Tabs */}
                <div style={{ display: "flex", gap: 3, background: "#f1f5f9", borderRadius: 10, padding: 4, marginBottom: 10, flexWrap: "wrap" }}>
                    {(["payments", "shakes", "memberships", "products", "add"] as Tab[]).map(t => (
                        <button key={t} onClick={() => { setTab(t); setErr(""); setEditId(null); setReplacing(null); }} style={{ flex: 1, minWidth: 70, padding: "7px 6px", border: "none", borderRadius: 7, background: tab === t ? "#0f172a" : "transparent", color: tab === t ? "white" : "#64748b", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: FONT, textTransform: "capitalize" }}>{t === "add" ? "+ Add" : t}</button>
                    ))}
                </div>

                {err && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 8, fontWeight: 700 }}>{err}</div>}

                <div style={{ flex: 1, overflowY: "auto" }}>
                    {replacing ? (
                        <ReplaceForm clubId={clubId} payment={replacing} plans={plans} products={products}
                            onReplaced={() => { setReplacing(null); refresh(); }}
                            onCancel={() => setReplacing(null)} />
                    ) : (
                    <>
                    {tab !== "add" && loadingTx && <div style={{ color: "#9ca3af", padding: 20, textAlign: "center" }}>Loading…</div>}

                    {tab === "payments" && !loadingTx && (
                        <>
                        <TxList rows={payments} empty="No payments in this range." render={(p) => (
                            <Row key={p.id} who={p.memberName || p.guestName || "—"} sub={`${p.type || "payment"} · ${describeTender(p)}${singleDay ? "" : ` · ${p.date}`}`}
                                amount={p.amount} id={p.id} busyId={busyId} editId={editId} editAmt={editAmt} setEditAmt={setEditAmt}
                                onEdit={() => { setEditId(p.id); setEditAmt(String(p.amount ?? "")); }} onSaveEdit={() => saveEditPayment(p)} onCancelEdit={() => setEditId(null)} onReplace={() => { setReplacing(p); setErr(""); }} onDelete={() => delPayment(p)} />
                        )} />
                        {/* The sum of exactly the rows above — the number the desk
                            gets when adding them by hand. It equals Collected, and
                            saying so on screen is the whole point. */}
                        {payments.length > 0 && (
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", marginTop: 6, background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontWeight: 900, color: "#0f172a" }}>
                                <span>These {payments.length} rows add up to</span>
                                <span>{fmtRs(summary.money.totalCollected)}</span>
                            </div>
                        )}
                        </>
                    )}
                    {tab === "memberships" && !loadingTx && (
                        <TxList rows={memberships} empty="No membership payments in this range." render={(p) => (
                            <Row key={p.id} who={p.memberName || "—"} sub={`${p.planName || "Plan"} · ${p.paymentMethod || "?"}${singleDay ? "" : ` · ${p.date}`}`}
                                amount={p.amount} id={p.id} busyId={busyId} editId={editId} editAmt={editAmt} setEditAmt={setEditAmt}
                                onEdit={() => { setEditId(p.id); setEditAmt(String(p.amount ?? "")); }} onSaveEdit={() => saveEditPayment(p)} onCancelEdit={() => setEditId(null)} onReplace={() => { setReplacing(p); setErr(""); }} onDelete={() => delPayment(p)} />
                        )} />
                    )}
                    {tab === "shakes" && !loadingTx && (
                        <TxList rows={liveOrders} empty="No shake orders in this range." render={(o) => (
                            <Row key={o.id} who={o.memberName || "Walk-in"} sub={`${(o.items || []).map((i: any) => `${i.productName || i.itemName} ×${i.quantity || i.qty || 1}`).join(", ")}${singleDay ? "" : ` · ${o.date}`}`}
                                amount={o.totalAmount} id={o.id} busyId={busyId} onDelete={() => delOrder(o)} />
                        )} />
                    )}
                    {tab === "products" && !loadingTx && (
                        <TxList rows={productSales} empty="No product sales in this range." render={(ps) => (
                            <Row key={ps.id} who={ps.productName || "Product"} sub={`Qty ${ps.quantity || 0}${ps.buyerName ? ` · ${ps.buyerName}` : ""}${singleDay ? "" : ` · ${ps.date}`}`}
                                amount={ps.totalAmount} id={ps.id} busyId={busyId} onDelete={() => delProductSale(ps)} />
                        )} />
                    )}

                    {tab === "add" && (
                        <AddForms clubId={clubId} defaultDate={startStr} members={members} plans={plans} products={products} onAdded={refresh} />
                    )}
                    </>
                    )}
                </div>
            </div>
        </div>
    );
}

function TxList({ rows, render, empty }: { rows: any[]; render: (r: any) => any; empty: string }) {
    if (rows.length === 0) return <div style={{ color: "#9ca3af", padding: 20, textAlign: "center", fontSize: 13 }}>{empty}</div>;
    return <div style={{ display: "grid", gap: 6 }}>{rows.map(render)}</div>;
}

function Row({ who, sub, amount, id, busyId, onDelete, onEdit, onReplace, onSaveEdit, onCancelEdit, editId, editAmt, setEditAmt }: any) {
    const editing = editId === id;
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{who}</div>
                <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
            </div>
            {editing ? (
                <>
                    <input value={editAmt} onChange={(e: any) => setEditAmt(e.target.value)} type="number" style={{ width: 80, padding: 6, border: "1.5px solid #cbd5e1", borderRadius: 6, fontSize: 13, fontFamily: FONT }} />
                    <button onClick={onSaveEdit} disabled={busyId === id} style={{ padding: "6px 10px", border: "none", background: "#16a34a", color: "white", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: "pointer" }}>Save</button>
                    <button onClick={onCancelEdit} style={{ padding: "6px 8px", border: "1px solid #e2e8f0", background: "white", color: "#475569", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✕</button>
                </>
            ) : (
                <>
                    <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", minWidth: 60, textAlign: "right" }}>{fmtRs(amount)}</div>
                    {onEdit && <button onClick={onEdit} title="Edit amount" style={{ width: 26, height: 26, border: "1px solid #cbd5e1", background: "white", color: "#0f172a", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: "pointer" }}>✎</button>}
                    {onReplace && <button onClick={onReplace} title="Convert / replace this transaction" style={{ width: 26, height: 26, border: "1px solid #bfdbfe", background: "white", color: "#2563eb", borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>⇄</button>}
                    <button onClick={onDelete} disabled={busyId === id} title="Delete" style={{ width: 26, height: 26, border: "1px solid #fecaca", background: "white", color: "#dc2626", borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: "pointer" }}>{busyId === id ? "…" : "✕"}</button>
                </>
            )}
        </div>
    );
}

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color }}>{value}</div>
        </div>
    );
}

// ── Convert / replace an existing payment with a different transaction ──
// Robust by construction: it reuses the tested cascade primitives — reverse
// the original payment (credits / wallet / stock all roll back via
// deletePaymentCascade), then create the chosen replacement with the same
// addBackdated* helpers the Add tab uses. Covers: change plan, change product,
// convert a One-Day Shake into a plan, or rewrite the whole transaction.
function ReplaceForm({ clubId, payment, plans, products, onReplaced, onCancel }: {
    clubId: string; payment: any; plans: any[]; products: any[]; onReplaced: () => void; onCancel: () => void;
}) {
    const member: EditMemberLite | null = payment.memberId && payment.memberId !== "guest"
        ? { id: payment.memberId, name: payment.memberName || "—" } : null;
    const [kind, setKind] = useState<"membership" | "shake" | "product">(MEMBERSHIP_TYPES.has(payment.type) ? "membership" : member ? "shake" : "product");
    const [planId, setPlanId] = useState("");
    const [flavor, setFlavor] = useState("");
    const [qty, setQty] = useState("1");
    const [amount, setAmount] = useState(String(payment.amount ?? ""));
    const [method, setMethod] = useState<PayMethod>(payment.paymentMethod === "upi" ? "upi" : "cash");
    const [grantCredits, setGrantCredits] = useState(true);
    const [productName, setProductName] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const selectedPlan = plans.find((p: any) => p.id === planId);

    const doReplace = async () => {
        setBusy(true); setErr("");
        try {
            const amt = Number(amount) || 0; const q = parseInt(qty, 10) || 1;
            if (kind === "membership" && !member) throw new Error("This transaction has no member to assign a plan to.");
            if (kind === "membership" && !selectedPlan) throw new Error("Choose the new plan.");
            if (kind === "shake" && !member) throw new Error("This transaction has no member.");
            if (kind === "shake" && !flavor.trim()) throw new Error("Enter a shake flavour.");
            if (kind === "product" && !productName.trim()) throw new Error("Enter a product name.");
            // 1) create the replacement FIRST. If this fails, the original is left
            // untouched — no silent revenue loss on the unhappy path.
            if (kind === "membership") {
                await addBackdatedMembership(clubId, payment.date, member!, { id: selectedPlan.id, name: selectedPlan.name, price: Number(selectedPlan.price) || 0, visits: Number(selectedPlan.visits ?? selectedPlan.totalVisits) || 0, durationDays: Number(selectedPlan.durationDays) || 30 }, method, grantCredits);
            } else if (kind === "shake") {
                await addBackdatedShake(clubId, payment.date, member!, flavor.trim(), q, amt, method);
            } else {
                await addBackdatedProduct(clubId, payment.date, productName.trim(), q, amt, method, member || undefined);
            }
            // 2) reverse the original. If THIS fails we have a recoverable duplicate
            // (both entries exist) rather than data loss — warn loudly so it's fixed.
            const del = await deletePaymentCascade(clubId, payment);
            if (!del.ok) {
                alert(`⚠ The replacement was saved, but reversing the ORIGINAL transaction failed:\n${del.errorMessage || "unknown error"}\n\nYou now have BOTH entries. Delete the original from the Payments tab to avoid double-counting.`);
            }
            onReplaced();
        } catch (e: any) { setErr(e?.message || "Replace failed"); }
        finally { setBusy(false); }
    };

    return (
        <div>
            <button onClick={onCancel} style={{ ...miniGhost, marginBottom: 10 }}>← Back to list</button>
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#92400e" }}>Replacing: {payment.memberName || payment.guestName || "—"} · {payment.type || "payment"} · {fmtRs(payment.amount)}</div>
                <div style={{ fontSize: 10.5, color: "#b45309", marginTop: 2 }}>The original is reversed (credits / wallet / stock roll back) and the new entry below is created on {payment.date}.</div>
            </div>

            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                {(["membership", "shake", "product"] as const).map(k => (
                    <button key={k} onClick={() => { setKind(k); setErr(""); }} style={{ flex: 1, padding: "6px", border: `1.5px solid ${kind === k ? "#2563eb" : "#e2e8f0"}`, borderRadius: 8, background: kind === k ? "#eff6ff" : "white", color: "#0f172a", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT, textTransform: "capitalize" }}>{k === "membership" ? "Plan" : k}</button>
                ))}
            </div>

            {member ? (
                <div style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>Member: <b style={{ color: "#0f172a" }}>{member.name}</b></div>
            ) : (
                <div style={{ fontSize: 12, color: "#b45309", marginBottom: 8 }}>No linked member — only a product replacement is possible.</div>
            )}

            {kind === "membership" && (<>
                <div style={lbl}>New plan</div>
                <select value={planId} onChange={e => setPlanId(e.target.value)} style={inp}>
                    <option value="">Select a plan…</option>
                    {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name} — ₹{Number(p.price) || 0}</option>)}
                </select>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, fontWeight: 700, color: "#0f172a", cursor: "pointer" }}>
                    <input type="checkbox" checked={grantCredits} onChange={e => setGrantCredits(e.target.checked)} /> Grant credits &amp; extend membership
                </label>
            </>)}
            {kind === "shake" && (<>
                <div style={{ ...lbl, marginTop: 4 }}>Shake flavour</div>
                <input value={flavor} onChange={e => setFlavor(e.target.value)} placeholder="e.g. Formula 1 Orange" list="rflavors" style={inp} />
                <datalist id="rflavors">{[...new Set(products.map((p: any) => p.name))].map((n: any) => <option key={n} value={n} />)}</datalist>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <div style={{ flex: 1 }}><div style={lbl}>Qty</div><input value={qty} onChange={e => setQty(e.target.value)} type="number" min={1} style={inp} /></div>
                    <div style={{ flex: 1 }}><div style={lbl}>Amount ₹ (0=free)</div><input value={amount} onChange={e => setAmount(e.target.value)} type="number" style={inp} /></div>
                </div>
            </>)}
            {kind === "product" && (<>
                <div style={{ ...lbl, marginTop: 4 }}>Product</div>
                <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Afresh" list="rprods" style={inp} />
                <datalist id="rprods">{products.map((p: any) => <option key={p.id} value={p.name} />)}</datalist>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <div style={{ flex: 1 }}><div style={lbl}>Qty</div><input value={qty} onChange={e => setQty(e.target.value)} type="number" min={1} style={inp} /></div>
                    <div style={{ flex: 1 }}><div style={lbl}>Amount ₹</div><input value={amount} onChange={e => setAmount(e.target.value)} type="number" style={inp} /></div>
                </div>
            </>)}

            <div style={{ ...lbl, marginTop: 8 }}>Payment method</div>
            <div style={{ display: "flex", gap: 6 }}>
                {(["cash", "upi"] as PayMethod[]).map(m => <button key={m} onClick={() => setMethod(m)} style={{ flex: 1, padding: 9, borderRadius: 8, border: `1.5px solid ${method === m ? "#16a34a" : "#e2e8f0"}`, background: method === m ? "#f0fdf4" : "white", color: "#0f172a", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT, textTransform: "uppercase" }}>{m}</button>)}
            </div>

            {err && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 8, fontWeight: 700 }}>{err}</div>}
            <button onClick={doReplace} disabled={busy} style={{ width: "100%", marginTop: 12, padding: 12, background: busy ? "#93c5fd" : "#2563eb", color: "white", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>{busy ? "Replacing…" : "⇄ Reverse original & save replacement"}</button>
        </div>
    );
}

// ── Add forms (shake / membership / product) ──
function AddForms({ clubId, defaultDate, members, plans, products, onAdded }: {
    clubId: string; defaultDate: string; members: any[]; plans: any[]; products: any[]; onAdded: () => void;
}) {
    const [sub, setSub] = useState<"shake" | "membership" | "product">("shake");
    const [addDate, setAddDate] = useState(defaultDate);
    const [memberQuery, setMemberQuery] = useState("");
    const [member, setMember] = useState<EditMemberLite | null>(null);
    const [flavor, setFlavor] = useState("");
    const [qty, setQty] = useState("1");
    const [amount, setAmount] = useState("");
    const [method, setMethod] = useState<PayMethod>("cash");
    const [planId, setPlanId] = useState("");
    const [grantCredits, setGrantCredits] = useState(true);
    const [productName, setProductName] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [ok, setOk] = useState("");

    const matches = useMemo(() => {
        const t = memberQuery.trim().toLowerCase();
        if (!t) return [];
        return members.filter((m: any) => (m.name || "").toLowerCase().includes(t) || (m.phone || "").includes(t) || (m.memberId || "").toLowerCase().includes(t)).slice(0, 8);
    }, [members, memberQuery]);
    const selectedPlan = plans.find((p: any) => p.id === planId);

    const save = async () => {
        setBusy(true); setErr(""); setOk("");
        try {
            const amt = Number(amount) || 0; const q = parseInt(qty, 10) || 0;
            if (sub === "shake") { if (!member) throw new Error("Choose a member."); await addBackdatedShake(clubId, addDate, member, flavor, q, amt, method); setOk(`Added ${q} × ${flavor}`); }
            else if (sub === "membership") { if (!member) throw new Error("Choose a member."); if (!selectedPlan) throw new Error("Choose a plan."); await addBackdatedMembership(clubId, addDate, member, { id: selectedPlan.id, name: selectedPlan.name, price: Number(selectedPlan.price) || 0, visits: Number(selectedPlan.visits ?? selectedPlan.totalVisits) || 0, durationDays: Number(selectedPlan.durationDays) || 30 }, method, grantCredits); setOk(`Added ${selectedPlan.name}`); }
            else { await addBackdatedProduct(clubId, addDate, productName, q, amt, method, member || undefined); setOk(`Added ${q} × ${productName}`); }
            onAdded();
            setFlavor(""); setQty("1"); setAmount(""); setProductName("");
        } catch (e: any) { setErr(e?.message || "Could not save"); }
        finally { setBusy(false); }
    };

    return (
        <div>
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                {(["shake", "membership", "product"] as const).map(s => (
                    <button key={s} onClick={() => { setSub(s); setErr(""); setOk(""); }} style={{ flex: 1, padding: "6px", border: `1.5px solid ${sub === s ? "#16a34a" : "#e2e8f0"}`, borderRadius: 8, background: sub === s ? "#f0fdf4" : "white", color: "#0f172a", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT, textTransform: "capitalize" }}>{s}</button>
                ))}
            </div>

            <div style={lbl}>Date</div>
            <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} style={inp} />

            {sub !== "product" && (
                <div style={{ marginTop: 8 }}>
                    <div style={lbl}>Member</div>
                    {member ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8 }}>
                            <span style={{ flex: 1, fontWeight: 800, color: "#0f172a", fontSize: 13 }}>{member.name}</span>
                            <button onClick={() => { setMember(null); setMemberQuery(""); }} style={miniGhost}>Change</button>
                        </div>
                    ) : (
                        <>
                            <input value={memberQuery} onChange={e => setMemberQuery(e.target.value)} placeholder="Search member…" style={inp} />
                            {matches.length > 0 && <div style={{ display: "grid", gap: 3, marginTop: 4, maxHeight: 140, overflowY: "auto" }}>
                                {matches.map((m: any) => <button key={m.id} onClick={() => setMember({ id: m.id, name: m.name || "—" })} style={{ ...miniGhost, textAlign: "left" }}><b>{m.name}</b> <span style={{ color: "#94a3b8" }}>· {m.memberId || m.phone || ""}</span></button>)}
                            </div>}
                        </>
                    )}
                </div>
            )}

            {sub === "shake" && (<>
                <div style={{ ...lbl, marginTop: 8 }}>Shake flavour</div>
                <input value={flavor} onChange={e => setFlavor(e.target.value)} placeholder="e.g. Formula 1 Orange" list="flavors" style={inp} />
                <datalist id="flavors">{[...new Set(products.map((p: any) => p.name))].map((n: any) => <option key={n} value={n} />)}</datalist>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <div style={{ flex: 1 }}><div style={lbl}>Qty</div><input value={qty} onChange={e => setQty(e.target.value)} type="number" min={1} style={inp} /></div>
                    <div style={{ flex: 1 }}><div style={lbl}>Amount ₹ (0=free)</div><input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="0" style={inp} /></div>
                </div>
            </>)}
            {sub === "membership" && (<>
                <div style={{ ...lbl, marginTop: 8 }}>Plan</div>
                <select value={planId} onChange={e => setPlanId(e.target.value)} style={inp}>
                    <option value="">Select a plan…</option>
                    {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name} — ₹{Number(p.price) || 0}</option>)}
                </select>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, fontWeight: 700, color: "#0f172a", cursor: "pointer" }}>
                    <input type="checkbox" checked={grantCredits} onChange={e => setGrantCredits(e.target.checked)} /> Also grant credits &amp; extend membership
                </label>
            </>)}
            {sub === "product" && (<>
                <div style={{ ...lbl, marginTop: 8 }}>Product</div>
                <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Afresh" list="prods" style={inp} />
                <datalist id="prods">{products.map((p: any) => <option key={p.id} value={p.name} />)}</datalist>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <div style={{ flex: 1 }}><div style={lbl}>Qty</div><input value={qty} onChange={e => setQty(e.target.value)} type="number" min={1} style={inp} /></div>
                    <div style={{ flex: 1 }}><div style={lbl}>Amount ₹</div><input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="0" style={inp} /></div>
                </div>
            </>)}

            <div style={{ ...lbl, marginTop: 8 }}>Payment method</div>
            <div style={{ display: "flex", gap: 6 }}>
                {(["cash", "upi"] as PayMethod[]).map(m => <button key={m} onClick={() => setMethod(m)} style={{ flex: 1, padding: 9, borderRadius: 8, border: `1.5px solid ${method === m ? "#16a34a" : "#e2e8f0"}`, background: method === m ? "#f0fdf4" : "white", color: "#0f172a", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT, textTransform: "uppercase" }}>{m}</button>)}
            </div>

            {err && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 8, fontWeight: 700 }}>{err}</div>}
            {ok && <div style={{ fontSize: 12, color: "#16a34a", marginTop: 8, fontWeight: 800 }}>✓ {ok}</div>}
            <button onClick={save} disabled={busy} style={{ width: "100%", marginTop: 12, padding: 12, background: busy ? "#86efac" : "#16a34a", color: "white", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>{busy ? "Saving…" : "Add entry"}</button>
        </div>
    );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16, fontFamily: FONT };
const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: 10, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14, fontFamily: FONT, boxSizing: "border-box" };
const miniGhost: React.CSSProperties = { padding: "6px 10px", borderRadius: 7, border: "1px solid #e2e8f0", background: "white", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT };
