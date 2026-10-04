/**
 * Renew — rebuilt.
 *
 * Find the member, pick the plan, say how they paid, collect. Three steps, and
 * the money, the credits and the new expiry all commit together through
 * lib/sellPlan.
 *
 * The old flow set credits and status and stopped — no plan, no expiry — so a
 * member renewed at the desk still read as Expired, while the identical plan
 * bought elsewhere worked. That is the "renewal works in one place and not
 * another" problem, and it lived in the difference between two code paths.
 */

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import MemberPicker, { type PickedMember } from "@/components/reception/MemberPicker";
import { sellPlan } from "@/lib/sellPlan";
import { planCreditsOf } from "@/utils/planCredits";
import type { PayMethod } from "@/lib/recordPayment";

const rs = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

const daysLeft = (v: any): number | null => {
    if (!v) return null;
    try {
        const d = v?.toDate ? v.toDate() : new Date(v);
        return isNaN(d.getTime()) ? null : Math.ceil((d.getTime() - Date.now()) / 86400000);
    } catch { return null; }
};

export default function ReceptionRenewPage() {
    const { club } = useClubContext();
    const clubId = club?.id ?? null;

    const [plans, setPlans] = useState<any[]>([]);
    const [member, setMember] = useState<PickedMember | null>(null);
    const [plan, setPlan] = useState<any | null>(null);
    const [method, setMethod] = useState<PayMethod>("cash");
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<{ name: string; credits: number; amount: number } | null>(null);
    const [err, setErr] = useState("");

    // StationAccess authenticates and authorizes this route before mounting.

    useEffect(() => {
        if (!clubId) return;
        getDocs(collection(db, "clubs", clubId, "memberships"))
            .then(s => setPlans(
                s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                    .filter((p: any) => p.isActive !== false)
                    .sort((a: any, b: any) => (Number(a.price) || 0) - (Number(b.price) || 0)),
            ))
            .catch(e => setErr(e.message));
    }, [clubId]);

    const expiry = useMemo(() => daysLeft(member?.membershipEndDate ?? member?.membershipEnd), [member]);

    const collect = async () => {
        if (!clubId || !member || !plan || busy) return;
        setBusy(true);
        setErr("");
        try {
            const res = await sellPlan({
                clubId,
                member: { id: member.id, name: member.name, memberId: member.memberId },
                plan,
                method,
            });
            setDone({ name: member.name, credits: res.creditsAfter, amount: res.amount });
            setMember(null);
            setPlan(null);
            setMethod("cash");
        } catch (e: any) {
            setErr(e?.message || "Could not complete the renewal. Nothing was charged — try again.");
        } finally {
            setBusy(false);
        }
    };

    if (done) {
        return (
            <Shell club={club?.name}>
                <div style={{ background: "#0f2825", border: "2px solid #54b5a8", borderRadius: 18, padding: 28, textAlign: "center" }}>
                    <div style={{ fontSize: 52 }}>✅</div>
                    <div style={{ fontSize: 24, fontWeight: 900, marginTop: 6 }}>{done.name} renewed</div>
                    <div style={{ fontSize: 16, color: "#a2b0ab", marginTop: 6 }}>
                        {rs(done.amount)} collected · now has <b>{done.credits} shakes</b>
                    </div>
                    <button onClick={() => setDone(null)} style={btnPrimary}>Renew someone else</button>
                </div>
            </Shell>
        );
    }

    return (
        <Shell club={club?.name}>
            {err && <div style={{ background: "#2b1512", border: "1px solid #5c2a24", color: "#f0776b", borderRadius: 12, padding: "12px 14px", fontWeight: 800, marginBottom: 14 }}>{err}</div>}

            {/* 1 — who */}
            <Step n={1} title="Who is renewing?" />
            {member ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#151d1b", border: "2px solid #54b5a8", borderRadius: 14, padding: "12px 14px" }}>
                    {member.photoUrl
                        ? <img src={member.photoUrl} alt="" style={{ width: 46, height: 46, borderRadius: "50%", objectFit: "cover" }} />
                        : <div style={{ width: 46, height: 46, borderRadius: "50%", background: "#0f2825", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#54b5a8" }}>{(member.name || "?").charAt(0)}</div>}
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: 17 }}>{member.name}</div>
                        <div style={{ fontSize: 12.5, color: "#6f7e79" }}>
                            {member.memberId} · {Number(member.shakeCredits) || 0} credits
                            {expiry != null && (expiry > 0 ? ` · ${expiry}d left` : " · expired")}
                        </div>
                    </div>
                    <button onClick={() => setMember(null)} style={{ ...btnGhost, marginLeft: "auto" }}>Change</button>
                </div>
            ) : (
                <MemberPicker onPick={m => { setMember(m); setErr(""); }} />
            )}

            {/* 2 — which plan */}
            {member && (
                <>
                    <Step n={2} title="Which plan?" />
                    <div style={{ display: "grid", gap: 8 }}>
                        {plans.map(p => {
                            const on = plan?.id === p.id;
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => setPlan(p)}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                                        background: on ? "#0f2825" : "#151d1b",
                                        border: `2px solid ${on ? "#54b5a8" : "#25302d"}`,
                                        borderRadius: 14, padding: "14px 16px", cursor: "pointer", fontFamily: "inherit",
                                    }}
                                >
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 900, fontSize: 16.5 }}>{p.name}</div>
                                        <div style={{ fontSize: 13, color: "#a2b0ab" }}>
                                            {planCreditsOf(p)} shakes{p.durationDays ? ` · ${p.durationDays} days` : ""}
                                        </div>
                                    </div>
                                    <div style={{ marginLeft: "auto", fontWeight: 900, fontSize: 19 }}>{rs(p.price)}</div>
                                </button>
                            );
                        })}
                        {plans.length === 0 && <div style={{ color: "#6f7e79", fontSize: 14 }}>No plans set up yet.</div>}
                    </div>
                </>
            )}

            {/* 3 — how paid */}
            {member && plan && (
                <>
                    <Step n={3} title="How did they pay?" />
                    <div style={{ display: "flex", gap: 8 }}>
                        {(["cash", "upi"] as PayMethod[]).map(m => (
                            <button
                                key={m}
                                onClick={() => setMethod(m)}
                                style={{
                                    flex: 1, padding: 16, borderRadius: 13, cursor: "pointer", fontFamily: "inherit",
                                    border: `2px solid ${method === m ? "#54b5a8" : "#25302d"}`,
                                    background: method === m ? "#0f2825" : "#151d1b",
                                    fontSize: 16, fontWeight: 900, textTransform: "uppercase",
                                }}
                            >
                                {m === "cash" ? "💵 Cash" : "📱 UPI"}
                            </button>
                        ))}
                    </div>

                    <button onClick={collect} disabled={busy} style={{ ...btnPrimary, opacity: busy ? .6 : 1 }}>
                        {busy ? "Saving…" : `Collect ${rs(plan.price)} & Renew`}
                    </button>
                    <div style={{ fontSize: 12.5, color: "#6f7e79", textAlign: "center", marginTop: 8 }}>
                        Adds {planCreditsOf(plan)} shakes and extends the plan. Money, credits and expiry are saved together.
                    </div>
                </>
            )}
        </Shell>
    );
}

function Shell({ club, children }: { club?: string; children: React.ReactNode }) {
    return (
        <div style={{ minHeight: "100vh", background: "#0d1211", fontFamily: "'Nunito', system-ui, sans-serif", color: "#ece6da" }}>
            <div style={{ background: "#0a0f0e", color: "#151d1b", padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: 20, fontWeight: 900 }}>Renew Plan</div>
                <div style={{ fontSize: 13, opacity: .8 }}>{club}</div>
            </div>
            <div style={{ padding: 18, maxWidth: 620, margin: "0 auto" }}>{children}</div>
        </div>
    );
}

function Step({ n, title }: { n: number; title: string }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "22px 0 10px" }}>
            <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#54b5a8", color: "#151d1b", fontSize: 13, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
            <span style={{ fontSize: 16, fontWeight: 900 }}>{title}</span>
        </div>
    );
}

const btnPrimary: React.CSSProperties = {
    width: "100%", marginTop: 18, padding: 18, border: "none", borderRadius: 14,
    background: "#54b5a8", color: "#151d1b", fontSize: 18, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
};
const btnGhost: React.CSSProperties = {
    padding: "8px 14px", border: "1.5px solid #25302d", background: "#151d1b",
    borderRadius: 10, fontSize: 13, fontWeight: 800, color: "#a2b0ab", cursor: "pointer", fontFamily: "inherit",
};
