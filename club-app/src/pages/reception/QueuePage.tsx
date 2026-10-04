/**
 * The Queue — reception's main screen, rebuilt.
 *
 * Members who ordered from their phone appear here with their photo. Two
 * buttons: Accept or Reject. Nothing else on the screen, because this is the
 * thing the receptionist does two hundred times a day and every extra tap is
 * paid for two hundred times.
 *
 * Accepting goes through lib/pendingCheckin, the same pipe the existing
 * reception uses, so credits, the kitchen order, the token and the stock all
 * move together and both screens can never disagree.
 *
 * Runs at /queue on its own so it can sit on a dedicated tablet at the desk;
 * the existing reception screen is untouched.
 */

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useClubMembers } from "@/hooks/useOwner";
import { acceptPendingCheckin, rejectPendingCheckin } from "@/lib/pendingCheckin";
import { markMemberAttendance } from "@/lib/attendance";
import { todayLocal } from "@/lib/clubDay";

type Toast = { kind: "ok" | "warn" | "err"; text: string } | null;

export default function QueuePage() {
    const { club } = useClubContext();
    const clubId = club?.id ?? null;
    const { data: members } = useClubMembers();

    const [authed, setAuthed] = useState(false);
    const [pending, setPending] = useState<any[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [toast, setToast] = useState<Toast>(null);
    const [doneCount, setDoneCount] = useState(0);

    useEffect(() => {
        return onAuthStateChanged(auth, user => setAuthed(!!user && !user.isAnonymous));
    }, []);

    const byId = useMemo(() => {
        const m = new Map<string, any>();
        (members ?? []).forEach((x: any) => m.set(x.id, x));
        return m;
    }, [members]);

    useEffect(() => {
        if (!clubId || !authed) return;
        return onSnapshot(
            query(
                collection(db, "clubs", clubId, "pendingCheckins"),
                where("date", "==", todayLocal()),
                where("status", "==", "pending"),
            ),
            snap => {
                const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
                rows.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
                setPending(rows);
            },
            err => console.error("[queue]", err),
        );
    }, [clubId, authed]);

    const say = (t: Toast) => { setToast(t); setTimeout(() => setToast(null), 3200); };

    const accept = async (p: any) => {
        if (!clubId || busy) return;
        const member = byId.get(p.memberId) ?? { id: p.memberId, name: p.memberName, photoUrl: p.memberPhoto };
        setBusy(p.id);
        try {
            const res = await acceptPendingCheckin(clubId, { id: p.memberId, ...member }, p);
            if (!res.ok && res.refused) {
                say({ kind: "warn", text: `${p.memberName || "Member"} has no shake credits left — ask them to renew.` });
                return;
            }
            // Being here counts as being present.
            void markMemberAttendance({
                clubId,
                memberId: p.memberId,
                memberName: p.memberName || member?.name || "",
                memberPhoto: p.memberPhoto || member?.photoUrl || "",
                method: "manual",
            }).catch(() => { /* the order still stands */ });

            setDoneCount(c => c + 1);
            say({ kind: "ok", text: `${p.memberName || "Member"} — sent to kitchen${res.tokenNumber ? ` · token ${res.tokenNumber}` : ""}` });
        } catch (e: any) {
            say({ kind: "err", text: e?.message || "Could not accept. Try again." });
        } finally {
            setBusy(null);
        }
    };

    const reject = async (p: any) => {
        if (!clubId || busy) return;
        setBusy(p.id);
        try {
            await rejectPendingCheckin(clubId, p.id);
            say({ kind: "warn", text: `${p.memberName || "Member"} — order rejected. No credits taken.` });
        } catch (e: any) {
            say({ kind: "err", text: e?.message || "Could not reject." });
        } finally {
            setBusy(null);
        }
    };

    const itemsOf = (p: any) =>
        (p.items || []).map((i: any) => `${i.name || i.productName || "Shake"}${(i.qty || 1) > 1 ? ` ×${i.qty}` : ""}`).join(", ");

    return (
        <div style={{ minHeight: "100vh", background: "#0d1211", fontFamily: "'Nunito', system-ui, sans-serif", color: "#ece6da" }}>
            <div style={{ background: "#0a0f0e", color: "#151d1b", padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ fontSize: 20, fontWeight: 900 }}>Queue</div>
                <div style={{ fontSize: 13, opacity: .8 }}>{club?.name}</div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                    <Pill tone="wait">{pending.length} waiting</Pill>
                    <Pill tone="done">{doneCount} sent</Pill>
                </div>
            </div>

            {toast && (
                <div style={{
                    padding: "13px 20px", fontWeight: 800, fontSize: 15,
                    background: toast.kind === "ok" ? "#0f2825" : toast.kind === "warn" ? "#241c0c" : "#2b1512",
                    color: toast.kind === "ok" ? "#54b5a8" : toast.kind === "warn" ? "#e0a94a" : "#f0776b",
                }}>
                    {toast.text}
                </div>
            )}

            <div style={{ padding: 18 }}>
                {pending.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "80px 20px", color: "#6f7e79" }}>
                        <div style={{ fontSize: 56 }}>☕</div>
                        <div style={{ fontSize: 22, fontWeight: 900, marginTop: 8, color: "#ece6da" }}>Nobody waiting</div>
                        <div style={{ fontSize: 15, marginTop: 4 }}>Orders from the member app appear here.</div>
                    </div>
                ) : (
                    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
                        {pending.map(p => {
                            const m = byId.get(p.memberId);
                            const credits = Number(m?.shakeCredits);
                            const working = busy === p.id;
                            return (
                                <div key={p.id} style={{ background: "#151d1b", border: "1px solid #25302d", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                        {(p.memberPhoto || m?.photoUrl) ? (
                                            <img src={p.memberPhoto || m?.photoUrl} alt="" style={{ width: 58, height: 58, borderRadius: "50%", objectFit: "cover" }} />
                                        ) : (
                                            <div style={{ width: 58, height: 58, borderRadius: "50%", background: "#0f2825", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 22, color: "#54b5a8" }}>
                                                {(p.memberName || "?").charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.15 }}>{p.memberName || "Member"}</div>
                                            <div style={{ fontSize: 12.5, color: "#6f7e79" }}>
                                                {p.humanMemberId || m?.memberId || ""}
                                                {Number.isFinite(credits) && ` · ${credits} credits`}
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ background: "#0d1211", borderRadius: 10, padding: "10px 12px", fontSize: 15, fontWeight: 800 }}>
                                        🥤 {itemsOf(p) || "Shake"}
                                    </div>

                                    {Number.isFinite(credits) && credits <= 0 && (
                                        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#f0776b" }}>
                                            No credits left — accepting will go into grace.
                                        </div>
                                    )}

                                    <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                                        <button
                                            onClick={() => reject(p)}
                                            disabled={working}
                                            style={{ flex: "0 0 auto", padding: "14px 18px", borderRadius: 11, border: "1.5px solid #25302d", background: "#151d1b", color: "#6f7e79", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
                                        >
                                            Reject
                                        </button>
                                        <button
                                            onClick={() => accept(p)}
                                            disabled={working}
                                            style={{ flex: 1, padding: "14px 18px", borderRadius: 11, border: "none", background: working ? "#3d7a71" : "#54b5a8", color: "#151d1b", fontSize: 16, fontWeight: 900, cursor: working ? "default" : "pointer", fontFamily: "inherit" }}
                                        >
                                            {working ? "Sending…" : "Accept"}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function Pill({ tone, children }: { tone: "wait" | "done"; children: React.ReactNode }) {
    const s = tone === "wait" ? { bg: "#c9a45c" } : { bg: "rgba(255,255,255,.18)" };
    return (
        <span style={{ background: s.bg, color: "#151d1b", borderRadius: 999, padding: "6px 14px", fontWeight: 900, fontSize: 14 }}>
            {children}
        </span>
    );
}
