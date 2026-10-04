/**
 * Member home — rebuilt.
 *
 * One screen, one action. The QR card sits at the top because it is now how the
 * club recognises them: scanned on arrival to be marked present, and again at
 * the counter to be served. Credits and plan expiry are visible without tapping
 * anything, which is most of what members came to check.
 *
 * Deliberately absent: the wallet (credits are the only currency now) and the
 * self check-in button, which wrote attendance in a shape the club's own
 * screens could not see.
 *
 * Runs only when the club's Member surface is switched to "new".
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
    addDoc, collection, doc, onSnapshot, query, serverTimestamp, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import { todayLocal } from "@/lib/clubDay";
import { cardQrValue } from "@/pages/owner/MemberCardsPage";
import { T, card, label, title } from "@/styles/theme";

const daysLeft = (v: any): number | null => {
    if (!v) return null;
    try {
        const d = v?.toDate ? v.toDate() : new Date(v);
        if (isNaN(d.getTime())) return null;
        return Math.ceil((d.getTime() - Date.now()) / 86400000);
    } catch {
        return null;
    }
};

const fmtDate = (v: any): string => {
    if (!v) return "—";
    try {
        const d = v?.toDate ? v.toDate() : new Date(v);
        return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "numeric", month: "long" });
    } catch {
        return "—";
    }
};

export default function MemberHomeNew() {
    const navigate = useNavigate();
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();
    const [live, setLive] = useState<any>(null);

    // ── Pre-order state — same flow as the classic member dashboard ──────
    // Ordering writes a `pendingCheckins` doc and stops there. Reception
    // confirms it, and only then are credits deducted and the kitchen order
    // written (lib/pendingCheckin.ts). Ordering straight into `orders` would
    // bypass the desk entirely and double-count credits.
    const [todaysSpecials, setTodaysSpecials] = useState<any[]>([]);
    const [menuPrices, setMenuPrices] = useState<Record<string, number>>({});
    const [showPreOrderModal, setShowPreOrderModal] = useState(false);
    const [preOrderCart, setPreOrderCart] = useState<any[]>([]);
    const [preOrderSubmitting, setPreOrderSubmitting] = useState(false);
    const [preOrderMsg, setPreOrderMsg] = useState("");
    const [pendingEntry, setPendingEntry] = useState<any | null>(null);

    // Live member doc so credits update the moment a shake is served.
    useEffect(() => {
        const uid = firebaseUser?.uid;
        if (!club?.id || !uid) return;
        return onSnapshot(doc(db, "clubs", club.id, "members", uid), s => setLive(s.data() ?? null));
    }, [club?.id, firebaseUser?.uid]);

    // Today's specials — ONLY the items the club switched on for today. This is
    // the `todaysSpecial` collection, not `menu`/isAvailableToday, which is a
    // different and much longer list.
    useEffect(() => {
        if (!club?.id) return;
        return onSnapshot(
            query(
                collection(db, "clubs", club.id, "todaysSpecial"),
                where("isActive", "==", true),
                where("date", "==", todayLocal()),
            ),
            snap => setTodaysSpecials(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        );
    }, [club?.id]);

    // Prices live on the menu item, not on the special — the special doc only
    // records that it is on today and how much stock is left. Join on the id
    // (the special's doc id IS the menu item id) so the sheet doesn't show ₹0.
    useEffect(() => {
        if (!club?.id) return;
        return onSnapshot(
            collection(db, "clubs", club.id, "menu"),
            snap => {
                const p: Record<string, number> = {};
                snap.docs.forEach(d => { p[d.id] = Number((d.data() as any).price) || 0; });
                setMenuPrices(p);
            },
        );
    }, [club?.id]);

    // This member's outstanding pre-order for today, if any.
    useEffect(() => {
        const uid = firebaseUser?.uid;
        if (!club?.id || !uid) return;
        return onSnapshot(
            query(
                collection(db, "clubs", club.id, "pendingCheckins"),
                where("memberId", "==", uid),
                where("date", "==", todayLocal()),
                where("status", "==", "pending"),
            ),
            snap => setPendingEntry(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }),
        );
    }, [club?.id, firebaseUser?.uid]);

    const m: any = live ?? userProfile ?? {};
    const uid = firebaseUser?.uid ?? "";
    const credits = Number(m.shakeCredits);
    const hasCredits = Number.isFinite(credits);
    const expiry = m.membershipEndDate ?? m.membershipEnd;
    const left = daysLeft(expiry);

    const orderable = todaysSpecials
        .filter(i => i.stockType !== "limited" || (i.remainingStock || 0) > 0)
        .map(i => ({
            ...i,
            // `itemName` is what the special stores; `name` is only there on
            // older docs. Price always comes from the joined menu item.
            displayName: i.name || i.itemName || "Shake",
            price: menuPrices[i.itemId || i.id] ?? 0,
        }));
    const cartTotal = preOrderCart.reduce((s, c) => s + c.price * c.qty, 0);
    const cartCount = preOrderCart.reduce((s, c) => s + c.qty, 0);

    const closePreOrder = () => {
        setShowPreOrderModal(false);
        setPreOrderCart([]);
        setPreOrderMsg("");
    };

    const addToCart = (item: any) => {
        setPreOrderCart(prev => {
            const ex = prev.find(c => c.id === item.id);
            if (ex) return prev.map(c => (c.id === item.id ? { ...c, qty: c.qty + 1 } : c));
            return [...prev, {
                id: item.id,
                name: item.displayName || item.name || item.itemName || "Shake",
                qty: 1,
                price: Number(item.price) || 0,
                stockType: item.stockType,
                itemId: item.itemId || item.id,
            }];
        });
    };

    const submitPreOrder = async () => {
        if (!club?.id || !uid || preOrderCart.length === 0) return;
        setPreOrderSubmitting(true);
        setPreOrderMsg("");
        try {
            await addDoc(collection(db, "clubs", club.id, "pendingCheckins"), {
                memberId: uid,
                memberName: m.name || "",
                memberPhoto: m.photoUrl || m.photo || "",
                humanMemberId: m.memberId || "",
                items: preOrderCart.map(c => ({
                    name: c.name, qty: c.qty, price: c.price,
                    stockType: c.stockType, itemId: c.itemId,
                })),
                totalAmount: cartTotal,
                status: "pending",
                date: todayLocal(),
                createdAt: serverTimestamp(),
                clubId: club.id,
            });
            setPreOrderMsg("✅ Order placed! Show your card at reception.");
            setPreOrderCart([]);
            setTimeout(closePreOrder, 2500);
        } catch {
            setPreOrderMsg("❌ Could not place the order. Please try again.");
        } finally {
            setPreOrderSubmitting(false);
        }
    };

    return (
        <div style={{ padding: "18px 16px 28px", maxWidth: 460, margin: "0 auto", fontFamily: T.sans, background: T.bone, minHeight: "100vh" }}>
            {/* greeting */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                {m.photoUrl ? (
                    <img src={m.photoUrl} alt="" style={{ width: 46, height: 46, borderRadius: "50%", objectFit: "cover" }} />
                ) : (
                    <div style={{ width: 46, height: 46, borderRadius: "50%", background: T.tealSoft, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: T.teal, fontSize: 20 }}>
                        {(m.name || "?").charAt(0).toUpperCase()}
                    </div>
                )}
                <div style={{ minWidth: 0 }}>
                    <div style={{ ...title(21), color: T.ink, lineHeight: 1.15 }}>
                        Hi, {(m.name || "there").split(" ")[0]}
                    </div>
                    <div style={{ fontSize: 13, color: T.ink3, fontWeight: 600 }}>{m.memberId || ""}</div>
                </div>
            </div>

            {/* the card */}
            <div style={{ ...card, borderRadius: 18, padding: 18, textAlign: "center" }}>
                {uid ? (
                    <QRCodeSVG value={cardQrValue(uid)} size={150} level="M" marginSize={0} />
                ) : (
                    <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", color: T.ink3 }}>Loading…</div>
                )}
                <div style={{ ...label, marginTop: 12 }}>
                    Show this to check in &amp; be served
                </div>
            </div>

            {/* credits */}
            <div style={{ background: T.tealSoft, color: T.ink, border: `1px solid ${T.rule}`, borderRadius: 18, padding: "24px 18px", textAlign: "center", marginTop: 14 }}>
                <div style={{ fontFamily: T.serif, fontSize: 58, fontWeight: 400, lineHeight: 1, letterSpacing: "-0.03em", color: T.tealDeep }}>
                    {hasCredits ? credits : "—"}
                </div>
                <div style={{ ...label, color: T.ink3, marginTop: 8 }}>
                    Shakes left
                </div>
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.rule}`, fontSize: 13.5, color: T.ink2 }}>
                    {expiry ? <>Plan ends <b>{fmtDate(expiry)}</b></> : "No active plan"}
                </div>
            </div>

            {/* nudges */}
            {hasCredits && credits <= 3 && credits > 0 && (
                <Nudge tone="warn">Only {credits} shake{credits === 1 ? "" : "s"} left — renew at reception.</Nudge>
            )}
            {hasCredits && credits <= 0 && (
                <Nudge tone="bad">No shakes left. Please renew at reception.</Nudge>
            )}
            {left != null && left <= 7 && left > 0 && (
                <Nudge tone="warn">Your plan ends in {left} day{left === 1 ? "" : "s"}.</Nudge>
            )}
            {left != null && left <= 0 && <Nudge tone="bad">Your plan has expired.</Nudge>}

            {/* the one action — or the standing order, if there is one */}
            {pendingEntry ? (
                <div style={{ ...card, borderRadius: 14, marginTop: 16, padding: 0, overflow: "hidden" }}>
                    <div style={{ background: T.brassSoft, borderBottom: `1px solid ${T.rule}`, padding: "14px 16px" }}>
                        <div style={{ color: T.brass, fontSize: 15, fontWeight: 800 }}>You're in the queue</div>
                        <div style={{ color: T.ink2, fontSize: 13, marginTop: 2 }}>
                            Show your card at reception to confirm.
                        </div>
                    </div>
                    <div style={{ padding: "12px 16px 14px" }}>
                        <div style={{ ...label, color: T.ink3, marginBottom: 8 }}>Your pre-order</div>
                        {(pendingEntry.items || []).map((item: any, i: number) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: T.ink, fontWeight: 600, marginTop: 4 }}>
                                <span>{item.name} × {item.qty}</span>
                                <span>₹{(item.price || 0) * item.qty}</span>
                            </div>
                        ))}
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800, color: T.ink, marginTop: 10, borderTop: `1px solid ${T.rule}`, paddingTop: 10 }}>
                            <span>Total</span><span>₹{pendingEntry.totalAmount || 0}</span>
                        </div>
                    </div>
                </div>
            ) : (
                <button
                    onClick={() => { setPreOrderCart([]); setPreOrderMsg(""); setShowPreOrderModal(true); }}
                    style={{
                        width: "100%", marginTop: 16, padding: 18, border: "none", borderRadius: 14,
                        background: T.teal, color: T.onTeal, fontSize: 18, fontWeight: 800,
                        fontFamily: T.sans, cursor: "pointer", letterSpacing: "0.01em",
                    }}
                >
                    Order a Shake
                </button>
            )}

            {/* the rest */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                <Tile label="My Attendance" sub="When you came" onClick={() => navigate("/member/attendance")} />
                <Tile label="My Shakes" sub="What you took" onClick={() => navigate("/member/orders")} />
                <Tile label="My Progress" sub="Weight over time" onClick={() => navigate("/member/progress")} />
                <Tile label="Profile" sub="Your details" onClick={() => navigate("/member/profile")} />
            </div>

            <div style={{ textAlign: "center", fontSize: 12, color: T.ink3, marginTop: 18 }}>
                {club?.name}
            </div>

            {/* ── Pre-order sheet ─────────────────────────────────────────── */}
            {showPreOrderModal && (
                <div
                    onClick={closePreOrder}
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center", fontFamily: T.sans }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ background: T.card, borderTop: `1px solid ${T.rule}`, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 460, maxHeight: "85vh", display: "flex", flexDirection: "column" }}
                    >
                        <div style={{ padding: "18px 18px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexShrink: 0 }}>
                            <div>
                                <div style={{ ...title(19), color: T.ink }}>Order a Shake</div>
                                <div style={{ fontSize: 13, color: T.ink3, marginTop: 3 }}>
                                    Reception confirms it when you arrive.
                                </div>
                            </div>
                            <button
                                onClick={closePreOrder}
                                style={{ width: 34, height: 34, background: T.sunk, border: `1px solid ${T.rule}`, borderRadius: 9, color: T.ink2, cursor: "pointer", fontSize: 16, flexShrink: 0 }}
                            >✕</button>
                        </div>

                        <div style={{ overflowY: "auto", padding: "14px 18px", flex: 1 }}>
                            {orderable.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "34px 0", color: T.ink3, fontSize: 14 }}>
                                    Nothing on the menu today.
                                </div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                                    {orderable.map(item => {
                                        const inCart = preOrderCart.find(c => c.id === item.id);
                                        return (
                                            <div
                                                key={item.id}
                                                style={{ background: inCart ? T.tealSoft : T.sunk, border: `1px solid ${inCart ? T.teal : T.rule}`, borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}
                                            >
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>
                                                        {item.itemEmoji ? `${item.itemEmoji} ` : ""}{item.displayName}
                                                    </div>
                                                    <div style={{ fontSize: 13, color: T.ink3, marginTop: 2 }}>
                                                        {item.price > 0 ? `₹${item.price}` : "1 shake credit"}
                                                        {item.stockType === "limited" ? ` · ${item.remainingStock} left` : ""}
                                                    </div>
                                                </div>
                                                {inCart ? (
                                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                                        <button
                                                            onClick={() => setPreOrderCart(p => inCart.qty > 1
                                                                ? p.map(c => (c.id === item.id ? { ...c, qty: c.qty - 1 } : c))
                                                                : p.filter(c => c.id !== item.id))}
                                                            style={{ width: 32, height: 32, background: T.badSoft, border: `1px solid ${T.rule}`, borderRadius: 8, color: T.bad, fontSize: 18, fontWeight: 700, cursor: "pointer" }}
                                                        >−</button>
                                                        <span style={{ fontSize: 16, fontWeight: 800, color: T.ink, minWidth: 18, textAlign: "center" }}>{inCart.qty}</span>
                                                        <button
                                                            onClick={() => setPreOrderCart(p => p.map(c => (c.id === item.id ? { ...c, qty: c.qty + 1 } : c)))}
                                                            style={{ width: 32, height: 32, background: T.tealSoft, border: `1px solid ${T.teal}`, borderRadius: 8, color: T.tealDeep, fontSize: 18, fontWeight: 700, cursor: "pointer" }}
                                                        >+</button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => addToCart(item)}
                                                        style={{ background: T.teal, color: T.onTeal, border: "none", borderRadius: 9, padding: "9px 15px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: T.sans, flexShrink: 0 }}
                                                    >Add</button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {preOrderMsg && (
                            <div style={{ margin: "0 18px 12px", padding: "12px 14px", borderRadius: 10, background: preOrderMsg.startsWith("✅") ? T.tealSoft : T.badSoft, color: preOrderMsg.startsWith("✅") ? T.tealDeep : T.bad, fontSize: 13.5, fontWeight: 700, textAlign: "center" }}>
                                {preOrderMsg}
                            </div>
                        )}

                        {preOrderCart.length > 0 && !preOrderMsg && (
                            <div style={{ padding: "12px 18px 22px", borderTop: `1px solid ${T.rule}`, flexShrink: 0 }}>
                                <button
                                    onClick={submitPreOrder}
                                    disabled={preOrderSubmitting}
                                    style={{ width: "100%", padding: 16, background: preOrderSubmitting ? T.sunk : T.teal, color: preOrderSubmitting ? T.ink3 : T.onTeal, border: "none", borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: preOrderSubmitting ? "not-allowed" : "pointer", fontFamily: T.sans, display: "flex", justifyContent: "space-between", alignItems: "center" }}
                                >
                                    <span>{preOrderSubmitting ? "Placing…" : "Confirm pre-order"}</span>
                                    <span>₹{cartTotal} · {cartCount} item{cartCount === 1 ? "" : "s"}</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function Nudge({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
    const s = tone === "bad"
        ? { bg: T.badSoft, ink: T.bad }
        : { bg: T.warnSoft, ink: T.warn };
    return (
        <div style={{ marginTop: 12, background: s.bg, border: `1px solid ${T.rule}`, borderLeft: `2px solid ${s.ink}`, color: s.ink, borderRadius: 10, padding: "11px 14px", fontSize: 13.5, fontWeight: 700 }}>
            {children}
        </div>
    );
}

function Tile({ label: text, sub, onClick }: { label: string; sub: string; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            style={{ ...card, padding: "14px 13px", textAlign: "left", cursor: "pointer", fontFamily: T.sans }}
        >
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{text}</div>
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>{sub}</div>
        </button>
    );
}
