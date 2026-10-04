/**
 * Night Shake — the evening operation, run from the reception desk.
 *
 * Three doors along the top, exactly as asked: Members, Passes (the plans on
 * sale) and Tonight's report.
 *
 * Members works like the normal check-in grid — every member's name, tap one —
 * but a tap opens a choice rather than checking anybody in, because the night
 * club is a separate thing from a day visit:
 *
 *   Order — pay now      cash / UPI / split
 *   Order — use a pass   only when the member HAS a pass; greyed out otherwise
 *   Buy passes           sell them a bundle
 *
 * Prices come from the plans the club sets up under Passes. Nothing is
 * hardcoded, so the amounts can be filled in without a code change.
 *
 * Deliberately its own component and its own collections. The day's shake
 * credits are never touched, and the night's money is tagged so it can be
 * reported separately or folded into a day on purpose — never by accident.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import PaymentMethodPicker, {
    emptyPaymentSelection, validatePayment, type PaymentSelection, type UpiAccount,
} from "@/components/PaymentMethodPicker";
import { todayLocal } from "@/lib/clubDay";
import { memberPhotoOf } from "@/lib/memberPhoto";
import {
    listNightPlans, saveNightPlan, deactivateNightPlan, serveNightShake, sellUmsPlan,
    getNightTotals, umsBalanceOf, type NightShakePlan, type NightDayTotals,
} from "@/lib/nightShake";

const FONT = "'Nunito', sans-serif";
const INK = "#0b0f2a";       // near-black blue — the night palette, distinct
const NIGHT = "#312e81";     // indigo
const ACCENT = "#a78bfa";    // soft violet
const rs = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

type Tab = "members" | "plans" | "report";
type Flow = null | { kind: "choose"; member: any }
    | { kind: "pay"; member: any }
    | { kind: "buy"; member: any };

interface Props {
    clubId: string;
    members: any[];
    upiAccounts: UpiAccount[];
    onClose: () => void;
    /** Optional: who is on the desk, stamped on what they sell. */
    servedBy?: string;
}

export default function NightShakeScreen({ clubId, members, upiAccounts, onClose, servedBy }: Props) {
    const [tab, setTab] = useState<Tab>("members");
    const [search, setSearch] = useState("");
    const [plans, setPlans] = useState<NightShakePlan[]>([]);
    const [flow, setFlow] = useState<Flow>(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [msg, setMsg] = useState("");

    // Local view of pass balances, so a sale or a spend shows immediately
    // without waiting for the members listener to come round again.
    const [umsDelta, setUmsDelta] = useState<Record<string, number>>({});
    const balanceOf = (m: any) => umsBalanceOf(m) + (umsDelta[m.id] || 0);

    const loadPlans = useCallback(async () => {
        try { setPlans(await listNightPlans(clubId)); }
        catch (e: any) { setErr(e?.message || "Could not load the passes."); }
    }, [clubId]);
    useEffect(() => { loadPlans(); }, [loadPlans]);

    const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3500); };

    const q = search.trim().toLowerCase();
    const shown = useMemo(() => members.filter((m) => {
        if (!q) return true;
        return `${m.name || ""} ${m.phone || ""} ${m.memberId || ""}`.toLowerCase().includes(q);
    }), [members, q]);

    return (
        <div style={{ minHeight: "100vh", background: `linear-gradient(165deg, ${INK} 0%, #1e1b4b 100%)`, fontFamily: FONT, paddingBottom: 40 }}>
            {/* Header */}
            <div style={{ padding: "18px 22px", display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "1.5px solid rgba(255,255,255,0.2)", color: "white", borderRadius: 12, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>← Back</button>
                <div style={{ flex: 1 }}>
                    <div style={{ color: "white", fontSize: 21, fontWeight: 900, display: "flex", alignItems: "center", gap: 10 }}>🌙 Night Shake</div>
                    <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 600 }}>{todayLocal()}</div>
                </div>
            </div>

            {/* The three doors */}
            <div style={{ display: "flex", gap: 8, padding: "14px 22px 0" }}>
                {([["members", "👥 Members"], ["plans", "🎟️ Passes"], ["report", "📊 Tonight"]] as const).map(([k, label]) => (
                    <button
                        key={k}
                        onClick={() => setTab(k)}
                        style={{
                            flex: 1, padding: "14px 10px", borderRadius: 14, border: "none", cursor: "pointer",
                            fontFamily: FONT, fontSize: 15, fontWeight: 900,
                            background: tab === k ? ACCENT : "rgba(255,255,255,0.08)",
                            color: tab === k ? INK : "rgba(255,255,255,0.75)",
                        }}
                    >{label}</button>
                ))}
            </div>

            {msg && <div style={{ margin: "14px 22px 0", background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", borderRadius: 12, padding: "10px 14px", color: "#6ee7b7", fontSize: 13, fontWeight: 800 }}>{msg}</div>}
            {err && <div style={{ margin: "14px 22px 0", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 12, padding: "10px 14px", color: "#fca5a5", fontSize: 13, fontWeight: 800 }}>{err}</div>}

            {tab === "members" && (
                <MembersTab
                    shown={shown} search={search} setSearch={setSearch}
                    balanceOf={balanceOf} onPick={(m) => { setErr(""); setFlow({ kind: "choose", member: m }); }}
                />
            )}

            {tab === "plans" && (
                <PlansTab clubId={clubId} plans={plans} reload={loadPlans} onError={setErr} onSaved={flash} />
            )}

            {tab === "report" && <ReportTab clubId={clubId} />}

            {/* ── What to do with this member ── */}
            {flow?.kind === "choose" && (() => {
                const m = flow.member;
                const bal = balanceOf(m);
                const hasPass = bal > 0;
                return (
                    <Sheet onClose={() => setFlow(null)}>
                        <div style={{ textAlign: "center", marginBottom: 16 }}>
                            <Avatar m={m} />
                            <div style={{ fontSize: 19, fontWeight: 900, color: INK, marginTop: 8 }}>{m.name}</div>
                            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{m.memberId || ""}</div>
                            <div style={{
                                display: "inline-block", marginTop: 8, padding: "4px 12px", borderRadius: 999,
                                background: hasPass ? "#ede9fe" : "#f1f5f9", color: hasPass ? "#5b21b6" : "#64748b",
                                fontSize: 12, fontWeight: 900,
                            }}>
                                {hasPass ? `${bal} pass${bal === 1 ? "" : "es"} left` : "No passes"}
                            </div>
                        </div>

                        <button
                            onClick={() => setFlow({ kind: "pay", member: m })}
                            style={btnPrimary}
                        >💵 Order — pay now</button>

                        {/* Greyed out when they have no pass, exactly as asked —
                            still visible so the desk can see the option exists. */}
                        <button
                            disabled={!hasPass || busy}
                            onClick={async () => {
                                setBusy(true); setErr("");
                                try {
                                    await serveNightShake({
                                        clubId, member: { id: m.id, name: m.name, memberId: m.memberId, photo: memberPhotoOf(m) },
                                        itemName: "Night Shake", useUms: true, servedBy, sendToKitchen: true,
                                    });
                                    setUmsDelta((d) => ({ ...d, [m.id]: (d[m.id] || 0) - 1 }));
                                    setFlow(null);
                                    flash(`${(m.name || "").split(" ")[0]} served — one pass used, ${bal - 1} left.`);
                                } catch (e: any) { setErr(e?.message || "Could not serve that."); }
                                finally { setBusy(false); }
                            }}
                            style={{
                                ...btnBase,
                                background: hasPass ? "linear-gradient(135deg,#7c3aed,#5b21b6)" : "#e2e8f0",
                                color: hasPass ? "white" : "#94a3b8",
                                filter: hasPass ? "none" : "grayscale(1)",
                                cursor: hasPass ? "pointer" : "not-allowed",
                            }}
                        >
                            🎟️ Order — use a pass
                            {!hasPass && <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.9, marginTop: 2 }}>No passes — buy some first</div>}
                        </button>

                        <button onClick={() => setFlow({ kind: "buy", member: m })} style={{ ...btnBase, background: "white", color: INK, border: `2px solid ${NIGHT}` }}>
                            ➕ Buy passes
                        </button>

                        <button onClick={() => setFlow(null)} style={{ ...btnBase, background: "transparent", color: "#64748b", fontWeight: 700 }}>Cancel</button>
                    </Sheet>
                );
            })()}

            {/* ── Pay now ── */}
            {flow?.kind === "pay" && (
                <PayNowSheet
                    clubId={clubId} member={flow.member} upiAccounts={upiAccounts} servedBy={servedBy}
                    plans={plans}
                    onDone={(what) => { setFlow(null); flash(what); }}
                    onCancel={() => setFlow(null)}
                    onError={setErr}
                />
            )}

            {/* ── Buy passes ── */}
            {flow?.kind === "buy" && (
                <BuyPassSheet
                    clubId={clubId} member={flow.member} plans={plans} upiAccounts={upiAccounts} servedBy={servedBy}
                    onDone={(passes, what) => {
                        setUmsDelta((d) => ({ ...d, [flow.member.id]: (d[flow.member.id] || 0) + passes }));
                        setFlow(null); flash(what);
                    }}
                    onCancel={() => setFlow(null)}
                    onError={setErr}
                    goToPlans={() => { setFlow(null); setTab("plans"); }}
                />
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────
const btnBase: React.CSSProperties = {
    width: "100%", padding: "16px", borderRadius: 14, border: "none", marginBottom: 10,
    fontSize: 16, fontWeight: 900, cursor: "pointer", fontFamily: FONT,
};
const btnPrimary: React.CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#16a34a,#15803d)", color: "white" };

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, zIndex: 300 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 22, padding: 22, width: "100%", maxWidth: 420, maxHeight: "88vh", overflowY: "auto", fontFamily: FONT }}>
                {children}
            </div>
        </div>
    );
}

function Avatar({ m, size = 76 }: { m: any; size?: number }) {
    const src = memberPhotoOf(m);
    return src
        ? <img src={src} alt={m.name} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: `3px solid ${ACCENT}` }} />
        : <div style={{ width: size, height: size, borderRadius: "50%", background: `linear-gradient(135deg,${NIGHT},${INK})`, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size / 2.6, fontWeight: 900, margin: "0 auto" }}>{(m.name || "?")[0].toUpperCase()}</div>;
}

// ─── Members ─────────────────────────────────────────────────────────────
function MembersTab({ shown, search, setSearch, balanceOf, onPick }: {
    shown: any[]; search: string; setSearch: (v: string) => void;
    balanceOf: (m: any) => number; onPick: (m: any) => void;
}) {
    return (
        <>
            <div style={{ padding: "14px 22px 0" }}>
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, phone or member ID…"
                    style={{ width: "100%", padding: "14px 18px", borderRadius: 14, border: "2px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.07)", color: "white", fontSize: 15, fontWeight: 600, fontFamily: FONT, outline: "none", boxSizing: "border-box" }}
                />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 14, padding: 22 }}>
                {shown.map((m) => {
                    const bal = balanceOf(m);
                    return (
                        <button key={m.id} onClick={() => onPick(m)} style={{
                            background: "rgba(255,255,255,0.06)", border: `2px solid ${bal > 0 ? ACCENT : "rgba(255,255,255,0.12)"}`,
                            borderRadius: 18, padding: "18px 12px", cursor: "pointer", fontFamily: FONT,
                            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                        }}>
                            <Avatar m={m} size={64} />
                            <div style={{ fontSize: 13, fontWeight: 800, color: "white", textAlign: "center", lineHeight: 1.2 }}>{m.name}</div>
                            <div style={{
                                fontSize: 11, fontWeight: 900, padding: "2px 10px", borderRadius: 999,
                                background: bal > 0 ? ACCENT : "rgba(255,255,255,0.1)",
                                color: bal > 0 ? INK : "rgba(255,255,255,0.5)",
                            }}>{bal > 0 ? `${bal} pass${bal === 1 ? "" : "es"}` : "no pass"}</div>
                        </button>
                    );
                })}
                {shown.length === 0 && (
                    <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 50, color: "rgba(255,255,255,0.5)", fontWeight: 700 }}>No members match that.</div>
                )}
            </div>
        </>
    );
}

// ─── Pay now ─────────────────────────────────────────────────────────────
function PayNowSheet({ clubId, member, upiAccounts, servedBy, plans, onDone, onCancel, onError }: {
    clubId: string; member: any; upiAccounts: UpiAccount[]; servedBy?: string; plans: NightShakePlan[];
    onDone: (msg: string) => void; onCancel: () => void; onError: (e: string) => void;
}) {
    // The single-shake price is whatever the club set on a 1-pass plan. If
    // none exists yet the desk types the amount, so the screen is usable
    // before the prices are decided.
    const single = plans.find((p) => Number(p.umsCount) === 1);
    const [amount, setAmount] = useState(single ? String(single.price) : "");
    const [pay, setPay] = useState<PaymentSelection>(emptyPaymentSelection);
    const [busy, setBusy] = useState(false);
    const total = Number(amount) || 0;
    const v = validatePayment(pay, total, { requireUpiAccount: upiAccounts.length > 0 });

    return (
        <Sheet onClose={onCancel}>
            <div style={{ fontSize: 18, fontWeight: 900, color: INK, marginBottom: 4 }}>💵 Night shake — pay now</div>
            <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 14 }}>{member.name}</div>

            <label style={{ fontSize: 11, fontWeight: 900, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Amount</label>
            <input
                type="number" inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setPay(emptyPaymentSelection); }}
                placeholder="What are they paying?"
                style={{ width: "100%", padding: "13px 15px", borderRadius: 12, border: "2px solid #e2e8f0", fontSize: 16, fontWeight: 800, fontFamily: FONT, margin: "6px 0 14px", boxSizing: "border-box" }}
            />
            {!single && (
                <div style={{ fontSize: 11, color: "#b45309", fontWeight: 700, marginTop: -8, marginBottom: 12 }}>
                    No single-shake price set yet — add a 1-pass plan under Passes and it will fill in automatically.
                </div>
            )}

            {total > 0 && (
                <PaymentMethodPicker total={total} upiAccounts={upiAccounts} value={pay} onChange={setPay} />
            )}
            {total > 0 && !v.ok && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, color: "#b91c1c" }}>{v.reason}</div>}

            <button
                disabled={busy || total <= 0 || !v.ok}
                onClick={async () => {
                    setBusy(true); onError("");
                    try {
                        await serveNightShake({
                            clubId,
                            member: { id: member.id, name: member.name, memberId: member.memberId, photo: memberPhotoOf(member) },
                            itemName: "Night Shake",
                            payment: {
                                amount: total, method: pay.method,
                                cashAmount: pay.cashAmount, upiAmount: pay.upiAmount,
                                upiAccount: pay.upiAccountId ? upiAccounts.find((u) => u.id === pay.upiAccountId) : undefined,
                            },
                            servedBy, sendToKitchen: true,
                        });
                        onDone(`${(member.name || "").split(" ")[0]} served — ${rs(total)} taken.`);
                    } catch (e: any) { onError(e?.message || "Could not save that."); }
                    finally { setBusy(false); }
                }}
                style={{ ...btnPrimary, marginTop: 16, background: (busy || total <= 0 || !v.ok) ? "#cbd5e1" : "linear-gradient(135deg,#16a34a,#15803d)", cursor: (busy || total <= 0 || !v.ok) ? "not-allowed" : "pointer" }}
            >{busy ? "Saving…" : `Take ${rs(total)} & serve`}</button>
            <button onClick={onCancel} style={{ ...btnBase, background: "transparent", color: "#64748b", fontWeight: 700, marginBottom: 0 }}>Cancel</button>
        </Sheet>
    );
}

// ─── Buy passes ──────────────────────────────────────────────────────────
function BuyPassSheet({ clubId, member, plans, upiAccounts, servedBy, onDone, onCancel, onError, goToPlans }: {
    clubId: string; member: any; plans: NightShakePlan[]; upiAccounts: UpiAccount[]; servedBy?: string;
    onDone: (passes: number, msg: string) => void; onCancel: () => void; onError: (e: string) => void; goToPlans: () => void;
}) {
    const [planId, setPlanId] = useState("");
    const [pay, setPay] = useState<PaymentSelection>(emptyPaymentSelection);
    const [busy, setBusy] = useState(false);
    const plan = plans.find((p) => p.id === planId) || null;
    const total = Number(plan?.price) || 0;
    const v = validatePayment(pay, total, { requireUpiAccount: upiAccounts.length > 0 });

    return (
        <Sheet onClose={onCancel}>
            <div style={{ fontSize: 18, fontWeight: 900, color: INK, marginBottom: 4 }}>🎟️ Buy night passes</div>
            <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginBottom: 14 }}>{member.name}</div>

            {plans.length === 0 ? (
                <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: 14, fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                    No passes have been set up yet.
                    <button onClick={goToPlans} style={{ display: "block", marginTop: 10, background: NIGHT, color: "white", border: "none", borderRadius: 10, padding: "10px 14px", fontWeight: 900, cursor: "pointer", fontFamily: FONT }}>Set up passes →</button>
                </div>
            ) : (
                <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                        {plans.map((p) => {
                            const on = planId === p.id;
                            return (
                                <button key={p.id} onClick={() => { setPlanId(p.id); setPay(emptyPaymentSelection); }} style={{
                                    width: "100%", padding: 15, textAlign: "left", cursor: "pointer", fontFamily: FONT,
                                    background: on ? "#f5f3ff" : "white", border: `2.5px solid ${on ? NIGHT : "#e2e8f0"}`, borderRadius: 14,
                                }}>
                                    <div style={{ fontSize: 15, fontWeight: 900, color: INK }}>{p.name}</div>
                                    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginTop: 2 }}>
                                        {Number(p.umsCount) > 0 ? `${p.umsCount} night shake${Number(p.umsCount) === 1 ? "" : "s"}` : "Unlimited"}
                                        {Number(p.durationDays) > 0 ? ` · valid ${p.durationDays} days` : ""}
                                    </div>
                                    <div style={{ fontSize: 19, fontWeight: 900, color: NIGHT, marginTop: 4 }}>{rs(p.price)}</div>
                                </button>
                            );
                        })}
                    </div>

                    {plan && <PaymentMethodPicker total={total} upiAccounts={upiAccounts} value={pay} onChange={setPay} />}
                    {plan && !v.ok && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, color: "#b91c1c" }}>{v.reason}</div>}

                    <button
                        disabled={busy || !plan || !v.ok}
                        onClick={async () => {
                            if (!plan) return;
                            setBusy(true); onError("");
                            try {
                                await sellUmsPlan({
                                    clubId,
                                    member: { id: member.id, name: member.name, memberId: member.memberId },
                                    plan, method: pay.method,
                                    cashAmount: pay.cashAmount, upiAmount: pay.upiAmount,
                                    upiAccount: pay.upiAccountId ? upiAccounts.find((u) => u.id === pay.upiAccountId) : undefined,
                                    soldBy: servedBy,
                                });
                                onDone(Number(plan.umsCount) || 0, `${(member.name || "").split(" ")[0]} bought ${plan.name} — ${rs(total)}.`);
                            } catch (e: any) { onError(e?.message || "Could not save that."); }
                            finally { setBusy(false); }
                        }}
                        style={{ ...btnBase, marginTop: 16, background: (busy || !plan || !v.ok) ? "#cbd5e1" : `linear-gradient(135deg,#7c3aed,${NIGHT})`, color: "white", cursor: (busy || !plan || !v.ok) ? "not-allowed" : "pointer" }}
                    >{busy ? "Saving…" : plan ? `Take ${rs(total)}` : "Pick a pass"}</button>
                </>
            )}
            <button onClick={onCancel} style={{ ...btnBase, background: "transparent", color: "#64748b", fontWeight: 700, marginBottom: 0 }}>Cancel</button>
        </Sheet>
    );
}

// ─── Passes (plans) ──────────────────────────────────────────────────────
function PlansTab({ clubId, plans, reload, onError, onSaved }: {
    clubId: string; plans: NightShakePlan[]; reload: () => void; onError: (e: string) => void; onSaved: (m: string) => void;
}) {
    const [editing, setEditing] = useState<Partial<NightShakePlan> | null>(null);
    const [busy, setBusy] = useState(false);

    const blank = { name: "", price: 0, umsCount: 1, durationDays: 0 };

    return (
        <div style={{ padding: 22 }}>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600, marginBottom: 14, maxWidth: 560 }}>
                What a member can buy for the night club. A pass is one night shake.
                Add a 1-pass plan to set the single-shake price — the pay-now screen picks it up automatically.
            </div>

            <button onClick={() => setEditing({ ...blank })} style={{ background: ACCENT, color: INK, border: "none", borderRadius: 12, padding: "12px 18px", fontSize: 14, fontWeight: 900, cursor: "pointer", fontFamily: FONT, marginBottom: 16 }}>
                + Add a pass
            </button>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
                {plans.map((p) => (
                    <div key={p.id} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 16 }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: "white" }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontWeight: 700, marginTop: 2 }}>
                            {Number(p.umsCount) > 0 ? `${p.umsCount} shake${Number(p.umsCount) === 1 ? "" : "s"}` : "Unlimited"}
                            {Number(p.durationDays) > 0 ? ` · ${p.durationDays} days` : " · no expiry"}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: ACCENT, marginTop: 6 }}>{rs(p.price)}</div>
                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                            <button onClick={() => setEditing(p)} style={{ flex: 1, background: "rgba(255,255,255,0.1)", color: "white", border: "none", borderRadius: 10, padding: "8px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}>Edit</button>
                            <button
                                onClick={async () => {
                                    if (!window.confirm(`Remove "${p.name}"? Passes already sold stay valid.`)) return;
                                    try { await deactivateNightPlan(clubId, p.id); reload(); onSaved("Pass removed."); }
                                    catch (e: any) { onError(e?.message || "Could not remove it."); }
                                }}
                                style={{ background: "rgba(239,68,68,0.18)", color: "#fca5a5", border: "none", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT }}
                            >Remove</button>
                        </div>
                    </div>
                ))}
                {plans.length === 0 && (
                    <div style={{ gridColumn: "1/-1", color: "rgba(255,255,255,0.5)", fontWeight: 700, padding: 30, textAlign: "center" }}>
                        No passes yet. Add the first one above.
                    </div>
                )}
            </div>

            {editing && (
                <Sheet onClose={() => setEditing(null)}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: INK, marginBottom: 14 }}>
                        {editing.id ? "Edit pass" : "New pass"}
                    </div>
                    {([
                        ["name", "Name", "text", "e.g. Night 10-pack"],
                        ["price", "Price (₹)", "number", "What the member pays"],
                        ["umsCount", "Night shakes included", "number", "0 = unlimited"],
                        ["durationDays", "Valid for (days)", "number", "0 = never expires"],
                    ] as const).map(([key, label, type, ph]) => (
                        <div key={key} style={{ marginBottom: 12 }}>
                            <label style={{ fontSize: 11, fontWeight: 900, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
                            <input
                                type={type} inputMode={type === "number" ? "numeric" : undefined}
                                value={(editing as any)[key] ?? ""}
                                onChange={(e) => setEditing({ ...editing, [key]: type === "number" ? Number(e.target.value) : e.target.value })}
                                placeholder={ph}
                                style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "2px solid #e2e8f0", fontSize: 15, fontWeight: 700, fontFamily: FONT, marginTop: 5, boxSizing: "border-box" }}
                            />
                        </div>
                    ))}
                    <button
                        disabled={busy || !String(editing.name || "").trim()}
                        onClick={async () => {
                            setBusy(true); onError("");
                            try { await saveNightPlan(clubId, editing); setEditing(null); reload(); onSaved("Pass saved."); }
                            catch (e: any) { onError(e?.message || "Could not save it."); }
                            finally { setBusy(false); }
                        }}
                        style={{ ...btnBase, background: String(editing.name || "").trim() ? `linear-gradient(135deg,#7c3aed,${NIGHT})` : "#cbd5e1", color: "white" }}
                    >{busy ? "Saving…" : "Save"}</button>
                    <button onClick={() => setEditing(null)} style={{ ...btnBase, background: "transparent", color: "#64748b", fontWeight: 700, marginBottom: 0 }}>Cancel</button>
                </Sheet>
            )}
        </div>
    );
}

// ─── Tonight's report ────────────────────────────────────────────────────
function ReportTab({ clubId }: { clubId: string }) {
    const [date, setDate] = useState(todayLocal());
    const [t, setT] = useState<NightDayTotals | null>(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");

    const load = useCallback(async (d: string) => {
        setBusy(true); setErr("");
        try { setT(await getNightTotals(clubId, d)); }
        catch (e: any) { setErr(e?.message || "Could not load the night's figures."); }
        finally { setBusy(false); }
    }, [clubId]);

    useEffect(() => { load(date); }, [load, date]);

    return (
        <div style={{ padding: 22 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
                <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 900, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Night of</label>
                    <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)}
                        style={{ padding: "11px 14px", borderRadius: 12, border: "2px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.07)", color: "white", fontSize: 14, fontWeight: 700, fontFamily: FONT, outline: "none" }} />
                </div>
                <button onClick={() => load(date)} style={{ background: ACCENT, color: INK, border: "none", borderRadius: 12, padding: "12px 18px", fontSize: 14, fontWeight: 900, cursor: "pointer", fontFamily: FONT }}>
                    {busy ? "Loading…" : "Refresh"}
                </button>
            </div>

            {err && <div style={{ color: "#fca5a5", fontWeight: 800, fontSize: 13, marginBottom: 12 }}>{err}</div>}

            {t && (
                <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12, marginBottom: 18 }}>
                        <Kpi label="Shakes served" value={String(t.shakes)} sub={`${t.paidShakes} paid · ${t.passShakes} on a pass`} />
                        <Kpi label="Cash" value={rs(t.cash)} />
                        <Kpi label="UPI" value={rs(t.upi)} />
                        <Kpi label="Total taken" value={rs(t.total)} big />
                        <Kpi label="Passes sold" value={String(t.umsSold)} sub={rs(t.umsRevenue)} />
                    </div>

                    <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14, fontSize: 12, color: "rgba(255,255,255,0.65)", fontWeight: 600, lineHeight: 1.6, marginBottom: 18 }}>
                        The night's money is recorded separately and tagged <b style={{ color: ACCENT }}>night_shake</b>, so it can be
                        reported on its own or folded into a day on purpose. Cash plus UPI always equals the total,
                        the same rule the day's reports use.
                    </div>

                    <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, overflow: "hidden" }}>
                        {t.orders.length === 0 ? (
                            <div style={{ padding: 30, textAlign: "center", color: "rgba(255,255,255,0.45)", fontWeight: 700 }}>Nothing served that night.</div>
                        ) : t.orders.map((o: any, i: number) => (
                            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 15px", borderTop: i ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 800, color: "white" }}>{o.memberName || "—"}</div>
                                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
                                        {o.itemName}{o.tokenNumber ? ` · token ${o.tokenNumber}` : ""}
                                    </div>
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 900, color: o.paidWith === "ums" ? ACCENT : "#6ee7b7", whiteSpace: "nowrap" }}>
                                    {o.paidWith === "ums" ? "1 pass" : rs(o.amount)}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function Kpi({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
    return (
        <div style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${big ? ACCENT : "rgba(255,255,255,0.12)"}`, borderRadius: 14, padding: "13px 15px" }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
            <div style={{ fontSize: big ? 26 : 21, fontWeight: 900, color: big ? ACCENT : "white", marginTop: 3, lineHeight: 1 }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 700, marginTop: 3 }}>{sub}</div>}
        </div>
    );
}
