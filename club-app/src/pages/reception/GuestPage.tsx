/**
 * Guest & First Day — rebuilt.
 *
 * Mobile number first, because it is what decides everything: whether this
 * person has had their complimentary shakes already. The answer appears as the
 * number is typed, before anyone promises anything.
 *
 * Uses the existing guest-entry pipe (useAddGuestEntry), which already writes
 * the order, the token, the stock and — for a paid guest — the payment with its
 * cash/UPI split. Rebuilding that here would have been a second copy.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, query, where, updateDoc, doc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useAddGuestEntry } from "@/hooks/useGuestEntries";
import { useTodaysSpecials } from "@/hooks/useTodaysSpecial";

const FREE_LIMIT = 2;
const rs = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

export default function GuestPage() {
    const { club } = useClubContext();
    const clubId = club?.id ?? null;
    const addGuest = useAddGuestEntry();
    const { specials } = useTodaysSpecials(clubId);

    const [phone, setPhone] = useState("");
    const [name, setName] = useState("");
    const [used, setUsed] = useState<number | null>(null);
    const [checking, setChecking] = useState(false);
    const [shake, setShake] = useState<any | null>(null);
    const [paid, setPaid] = useState(false);
    const [method, setMethod] = useState<"cash" | "upi">("cash");
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<{ name: string; token?: string | number; free: boolean } | null>(null);
    const [err, setErr] = useState("");
    const reqRef = useRef(0);

    // StationAccess authenticates and authorizes this route before mounting.

    const digits = useMemo(() => phone.replace(/\D/g, ""), [phone]);

    // The hook hands back a map keyed by item id, not a list, and includes
    // items switched off for today.
    const shakeList = useMemo(
        () => Object.values(specials ?? {}).filter((s: any) => s?.isActive !== false),
        [specials],
    );

    // Eligibility as they type. Each lookup carries a sequence number so a slow
    // response for an old number can never overwrite a newer answer — the old
    // screen had exactly that race and could show the wrong person's count.
    useEffect(() => {
        if (!clubId || digits.length < 5) { setUsed(null); return; }
        const seq = ++reqRef.current;
        setChecking(true);
        const t = setTimeout(async () => {
            try {
                const snap = await getDocs(query(
                    collection(db, "clubs", clubId, "guestEntries"),
                    where("guestPhone", "==", digits),
                ));
                if (seq !== reqRef.current) return;
                setUsed(snap.docs.filter(d => (d.data() as any).firstDay === true).length);
            } catch {
                if (seq === reqRef.current) setUsed(null);
            } finally {
                if (seq === reqRef.current) setChecking(false);
            }
        }, 250);
        return () => clearTimeout(t);
    }, [clubId, digits]);

    const freeLeft = used == null ? null : Math.max(0, FREE_LIMIT - used);
    const eligibleFree = freeLeft != null && freeLeft > 0;
    const price = Number(shake?.price ?? 0) || 0;

    const submit = async () => {
        if (!clubId || !shake || busy) return;
        if (!name.trim() || digits.length < 5) { setErr("Name and mobile number are needed."); return; }
        const isFree = eligibleFree && !paid;
        setBusy(true); setErr("");
        try {
            const res = await addGuest.mutateAsync({
                guestName: name.trim(),
                guestPhone: digits,
                type: isFree ? "unpaid" : "paid",
                items: [{
                    type: "shake",
                    productId: isFree ? "first_day_shake" : shake.itemId,
                    productName: isFree ? "First Day Shake" : (shake.itemName || "Shake"),
                    qty: 1,
                    unitPrice: isFree ? 0 : price,
                    stockType: shake.stockType,
                }],
                totalAmount: isFree ? 0 : price,
                ...(isFree ? {} : { amountPaid: price, paymentMethod: method }),
                recordedBy: "reception_guest",
            } as any);

            // Tag a complimentary shake so it counts toward the limit next time.
            if (isFree && (res as any)?.entryId) {
                await updateDoc(doc(db, "clubs", clubId, "guestEntries", (res as any).entryId), {
                    firstDay: true,
                    firstDayCountAtEntry: (used ?? 0) + 1,
                }).catch(() => {});
            }

            setDone({ name: name.trim(), token: (res as any)?.tokenNumbers?.[0], free: isFree });
            setPhone(""); setName(""); setShake(null); setUsed(null); setPaid(false);
        } catch (e: any) {
            setErr(e?.message || "Could not save. Try again.");
        } finally {
            setBusy(false);
        }
    };

    if (done) {
        return (
            <Shell club={club?.name}>
                <div style={{ background: "#0f2825", border: "2px solid #54b5a8", borderRadius: 18, padding: 28, textAlign: "center" }}>
                    <div style={{ fontSize: 52 }}>{done.free ? "☀️" : "✅"}</div>
                    <div style={{ fontSize: 23, fontWeight: 900, marginTop: 6 }}>Welcome, {done.name}!</div>
                    <div style={{ fontSize: 15, color: "#a2b0ab", marginTop: 6 }}>
                        {done.free ? "Complimentary shake sent to the kitchen" : "Shake sent to the kitchen"}
                    </div>
                    {done.token != null && (
                        <div style={{ marginTop: 14, padding: "12px 0", background: "#151d1b", border: "2px dashed #3d7a71", borderRadius: 12, fontSize: 30, fontWeight: 900 }}>
                            Token #{done.token}
                        </div>
                    )}
                    <button onClick={() => setDone(null)} style={btnPrimary}>Next guest</button>
                </div>
            </Shell>
        );
    }

    return (
        <Shell club={club?.name}>
            {err && <Err>{err}</Err>}

            <Label>Mobile number</Label>
            <input
                autoFocus value={phone} onChange={e => setPhone(e.target.value)}
                inputMode="tel" placeholder="10-digit mobile" style={inputStyle}
            />
            {digits.length >= 5 && (
                <div style={{ marginTop: 9, fontSize: 14.5, fontWeight: 800,
                    color: checking ? "#6f7e79" : freeLeft === 0 ? "#f0776b" : freeLeft === 1 ? "#e0a94a" : "#54b5a8" }}>
                    {checking ? "Checking…"
                        : freeLeft == null ? ""
                        : freeLeft === 0 ? "✗ This number is not eligible for complimentary shakes"
                        : freeLeft === 1 ? "⚠ 1 complimentary shake available"
                        : "✓ 2 complimentary shakes available"}
                </div>
            )}

            <Label>Name</Label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" style={inputStyle} />

            <Label>Which shake?</Label>
            <div style={{ display: "grid", gap: 8 }}>
                {shakeList.map((s: any) => {
                    const on = shake?.itemId === s.itemId;
                    return (
                        <button key={s.itemId} onClick={() => setShake(s)} style={{
                            display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                            background: on ? "#0f2825" : "#151d1b",
                            border: `2px solid ${on ? "#54b5a8" : "#25302d"}`,
                            borderRadius: 13, padding: "13px 15px", cursor: "pointer", fontFamily: "inherit",
                        }}>
                            <div style={{ fontWeight: 900, fontSize: 16 }}>{s.itemName || s.name}</div>
                            <div style={{ marginLeft: "auto", fontWeight: 900 }}>{rs(Number(s.price) || 0)}</div>
                        </button>
                    );
                })}
                {shakeList.length === 0 && <div style={{ color: "#6f7e79", fontSize: 14 }}>No shakes on today's menu yet.</div>}
            </div>

            {shake && (
                <>
                    {eligibleFree && (
                        <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, background: "#151d1b", border: "1px solid #25302d", borderRadius: 12, padding: "12px 14px", cursor: "pointer" }}>
                            <input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} style={{ width: 18, height: 18 }} />
                            <span style={{ fontWeight: 800, fontSize: 14.5 }}>They are paying for this one ({rs(price)})</span>
                        </label>
                    )}

                    {(!eligibleFree || paid) && (
                        <>
                            <Label>How did they pay?</Label>
                            <div style={{ display: "flex", gap: 8 }}>
                                {(["cash", "upi"] as const).map(m => (
                                    <button key={m} onClick={() => setMethod(m)} style={{
                                        flex: 1, padding: 16, borderRadius: 13, cursor: "pointer", fontFamily: "inherit",
                                        border: `2px solid ${method === m ? "#54b5a8" : "#25302d"}`,
                                        background: method === m ? "#0f2825" : "#151d1b",
                                        fontSize: 16, fontWeight: 900, textTransform: "uppercase",
                                    }}>{m === "cash" ? "💵 Cash" : "📱 UPI"}</button>
                                ))}
                            </div>
                        </>
                    )}

                    <button onClick={submit} disabled={busy} style={{ ...btnPrimary, opacity: busy ? .6 : 1 }}>
                        {busy ? "Saving…"
                            : (eligibleFree && !paid) ? "☀️ Send complimentary shake"
                            : `Collect ${rs(price)} & send to kitchen`}
                    </button>
                </>
            )}
        </Shell>
    );
}

function Shell({ club, children }: { club?: string; children: React.ReactNode }) {
    return (
        <div style={{ minHeight: "100vh", background: "#0d1211", fontFamily: "'Nunito', system-ui, sans-serif", color: "#ece6da" }}>
            <div style={{ background: "#0a0f0e", color: "#151d1b", padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: 20, fontWeight: 900 }}>Guest &amp; First Day</div>
                <div style={{ fontSize: 13, opacity: .8 }}>{club}</div>
            </div>
            <div style={{ padding: 18, maxWidth: 560, margin: "0 auto" }}>{children}</div>
        </div>
    );
}
const Label = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: "#6f7e79", margin: "20px 0 9px" }}>{children}</div>
);
const Err = ({ children }: { children: React.ReactNode }) => (
    <div style={{ background: "#2b1512", border: "1px solid #5c2a24", color: "#f0776b", borderRadius: 12, padding: "12px 14px", fontWeight: 800, marginBottom: 14 }}>{children}</div>
);
const inputStyle: React.CSSProperties = { width: "100%", padding: "15px 18px", borderRadius: 13, border: "2px solid #25302d", fontSize: 17, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
const btnPrimary: React.CSSProperties = { width: "100%", marginTop: 18, padding: 18, border: "none", borderRadius: 14, background: "#54b5a8", color: "#151d1b", fontSize: 17, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" };
