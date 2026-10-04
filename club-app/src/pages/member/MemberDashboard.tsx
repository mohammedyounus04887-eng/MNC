import { useMemo, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    collection,
    doc,
    addDoc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    where,
    serverTimestamp,
} from "firebase/firestore";
import { useQuery } from "@tanstack/react-query";
import { Wallet, CalendarCheck, Megaphone, ChevronRight, ArrowUpRight, ArrowDownRight, User, CreditCard, Camera, Upload, X, ShoppingBag, Loader2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from "date-fns";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import { db } from "@/lib/firebase";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyAttendance, computeAttendanceStats } from "@/hooks/member/useMemberAttendance";
import { useMyWallet } from "@/hooks/useMemberWallet";
import { useMyAnnouncements } from "@/hooks/member/useMemberAnnouncements";
import { useEarlyBird, uploadEarlyBirdPhoto } from "@/hooks/useEarlyBird";
import { useFunFriday } from "@/hooks/useFunFriday";
import { useLeaderboard } from "@/hooks/owner/useWeighIns";
import { useAfterPaint } from "@/hooks/useAfterPaint";
import type { User as UserType, Attendance, WalletTransaction, MembershipPlan } from "@/types/firestore";
import ShakeBalanceCard from "@/components/member/ShakeBalanceCard";
import BirthdayWishBanner from "@/components/mlm/BirthdayWishBanner";
import PurchaseRequestWizard from "@/components/member/PurchaseRequestWizard";
import { useMyPendingPurchaseRequest, useCancelPurchaseRequest } from "@/hooks/usePurchaseRequests";
import { useToast } from "@/hooks/use-toast";
import { todayLocal } from "@/lib/clubDay";

const GREEN = "#2d9653";
const BG = "#f8fffe";

function getGreeting(): { text: string; emoji: string } {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return { text: "Good morning", emoji: "☀️" };
    if (hour >= 12 && hour < 17) return { text: "Good afternoon", emoji: "👋" };
    if (hour >= 17 && hour < 21) return { text: "Good evening", emoji: "🌙" };
    return { text: "Good night", emoji: "✨" };
}

function getFirstName(name: string): string {
    return name?.trim().split(/\s+/)[0] || "Member";
}

function getMembershipStatus(user: UserType): {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    className?: string;
} {
    const credits = (user as any).shakeCredits ?? 0;
    const totalCredits = (user as any).shakeCreditsPlanTotal ?? 0;
    if (totalCredits <= 0) return { label: "No Plan", variant: "outline", className: "bg-slate-100 text-slate-600 border-slate-300" };
    if (credits <= 0) return { label: "No Credits", variant: "destructive", className: "bg-red-600 text-white border-red-700" };
    if (credits <= 3) return { label: "Low Credits", variant: "secondary", className: "bg-amber-500 text-white border-amber-600" };
    return { label: "Active", variant: "default", className: "bg-green-600 text-white border-green-700" };
}

function formatTxDate(createdAt: any): string {
    if (!createdAt) return "";
    const d = createdAt?.toDate ? createdAt.toDate() : createdAt?.seconds ? new Date(createdAt.seconds * 1000) : null;
    return d ? format(d, "MMM d, h:mm a") : "";
}

function txReasonLabel(reason: string): string {
    switch (reason) {
        case "topup": return "Wallet Top-up";
        case "shake_order": return "Shake Order";
        case "membership": return "Membership";
        case "product": return "Product Purchase";
        case "referral_bonus": return "Referral Bonus";
        case "adjustment": return "Adjustment";
        case "inventory_received": return "Inventory Received";
        default: return reason || "Transaction";
    }
}

export default function MemberDashboard() {
    const { userProfile, refreshProfile } = useAuth();
    const { club } = useClubContext();

    // Refresh profile on mount so subscription changes (e.g. from Reception) are reflected
    useEffect(() => { refreshProfile(); }, []);

    // Silent push-token sync + foreground toast for incoming notifications
    // Push notifications set themselves up AFTER the screen has drawn.
    //
    // This pulls in the Firebase messaging SDK as its own chunk and then makes
    // network calls to register a token — none of which the member needs in
    // order to see their credits, and all of which used to compete for the
    // connection with the data that draws this page.
    const { toast: pushToast } = useToast();
    // One signal for the whole screen: true once this page has drawn. Everything
    // the member cannot see yet hangs off it — push registration, the
    // transaction history, the volunteer log, the leaderboard.
    const afterPaint = useAfterPaint();
    useEffect(() => {
        if (!afterPaint || !club?.id || !userProfile?.id) return;
        (async () => {
            const { syncPushTokenSilently, subscribeToForegroundMessages } = await import("@/lib/messaging");
            await syncPushTokenSilently({
                clubId: club.id,
                memberId: userProfile.id,
                notificationsEnabled: !!(userProfile as any).notificationsEnabled,
            });
            const unsub = subscribeToForegroundMessages((p) => {
                pushToast({ title: p.title, description: p.body });
            });
            return () => unsub();
        })();
    }, [afterPaint, club?.id, userProfile?.id]);
    const { text: greetingText, emoji } = getGreeting();
    const firstName = userProfile ? getFirstName(userProfile.name) : "";
    const memberIdDisplay = (userProfile as any)?.memberId
        ? String((userProfile as any).memberId)
        : userProfile ? `MNC-${userProfile.id.substring(0, 6).toUpperCase()}` : "";

    // ── Early Bird & Fun Friday ──────────────────────────────────────────
    const { photo: earlyBirdPhoto, loading: earlyBirdLoading } = useEarlyBird(club?.id);
    const { photo: funFridayPhoto, loading: funFridayLoading } = useFunFriday(club?.id);
    const [earlyBirdUploading, setEarlyBirdUploading] = useState(false);
    const [earlyBirdError, setEarlyBirdError] = useState("");

    const handleEarlyBirdUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !club?.id) return;
        setEarlyBirdUploading(true);
        setEarlyBirdError("");
        const result = await uploadEarlyBirdPhoto(club.id, file);
        if (!result.success) setEarlyBirdError(result.error || "Upload failed");
        setEarlyBirdUploading(false);
        e.target.value = "";
    };

    // ── Pre-order state ──────────────────────────────────────────────────
    const [todaysSpecials, setTodaysSpecials] = useState<any[]>([]);
    const [showPreOrderModal, setShowPreOrderModal] = useState(false);
    const [preOrderCart, setPreOrderCart] = useState<any[]>([]);
    const [preOrderSubmitting, setPreOrderSubmitting] = useState(false);
    const [preOrderMsg, setPreOrderMsg] = useState('');
    const [pendingEntry, setPendingEntry] = useState<any | null>(null);

    // Load today's specials
    useEffect(() => {
        if (!club?.id) return;
        const today = todayLocal();
        return onSnapshot(
            query(
                collection(db, 'clubs', club.id, 'todaysSpecial'),
                where('isActive', '==', true),
                where('date', '==', today)
            ),
            snap => setTodaysSpecials(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        );
    }, [club?.id]);

    // Watch for this member's pending checkin today
    useEffect(() => {
        if (!club?.id || !userProfile?.id) return;
        const today = todayLocal();
        return onSnapshot(
            query(
                collection(db, 'clubs', club.id, 'pendingCheckins'),
                where('memberId', '==', userProfile.id),
                where('date', '==', today),
                where('status', '==', 'pending')
            ),
            snap => setPendingEntry(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() })
        );
    }, [club?.id, userProfile?.id]);

    const preOrderCartTotal = preOrderCart.reduce((s, c) => s + c.price * c.qty, 0);

    const addToPreOrderCart = (item: any) => {
        setPreOrderCart(prev => {
            const ex = prev.find(c => c.id === item.id);
            if (ex) return prev.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
            return [...prev, { id: item.id, name: item.name || item.itemName || 'Shake', qty: 1, price: item.price || 0, stockType: item.stockType, itemId: item.id }];
        });
    };

    const submitPreOrder = async () => {
        if (!club?.id || !userProfile?.id || preOrderCart.length === 0) return;
        setPreOrderSubmitting(true);
        setPreOrderMsg('');
        try {
            const today = todayLocal();
            await addDoc(collection(db, 'clubs', club.id, 'pendingCheckins'), {
                memberId: userProfile.id,
                memberName: userProfile.name || '',
                memberPhoto: (userProfile as any).photoUrl || (userProfile as any).photo || '',
                humanMemberId: (userProfile as any).memberId || '',
                items: preOrderCart.map(c => ({ name: c.name, qty: c.qty, price: c.price, stockType: c.stockType, itemId: c.itemId })),
                totalAmount: preOrderCartTotal,
                status: 'pending',
                date: today,
                createdAt: serverTimestamp(),
                clubId: club.id,
            });
            setPreOrderMsg('✅ Order placed! Head to reception for face scan.');
            setPreOrderCart([]);
            setTimeout(() => { setShowPreOrderModal(false); setPreOrderMsg(''); }, 3000);
        } catch {
            setPreOrderMsg('❌ Failed to place order. Please try again.');
        } finally {
            setPreOrderSubmitting(false);
        }
    };

    // Reception OTP overlay (keep - it's a passive display).
    //
    // The receptionist generates a 6-digit code on the `members/{id}` doc:
    //   receptionOtp, receptionOtpAt, receptionOtpUsed
    // We listen for it here and show a banner so the member can read it out.
    //
    // Two rules to keep the banner from being a nuisance:
    //   1. If the user dismisses an OTP, remember the dismissal in
    //      localStorage so closing/reopening the app doesn't bring it back.
    //   2. If `receptionOtpAt` is more than OTP_TTL_MIN minutes old, treat
    //      the OTP as stale and never show it — protects against the
    //      receptionist starting a flow but switching to face-scan instead,
    //      which would otherwise leave the field set forever.
    const OTP_TTL_MIN = 10;
    const DISMISSED_OTP_KEY = `mnc_dismissed_otp_${userProfile?.id || "anon"}`;
    const [receptionOtp, setReceptionOtp] = useState<string | null>(null);
    const [dismissedOtp, setDismissedOtp] = useState<string | null>(() => {
        try { return localStorage.getItem(DISMISSED_OTP_KEY); } catch { return null; }
    });
    const persistDismissed = (v: string | null) => {
        setDismissedOtp(v);
        try {
            if (v) localStorage.setItem(DISMISSED_OTP_KEY, v);
            else localStorage.removeItem(DISMISSED_OTP_KEY);
        } catch { /* ignore quota */ }
    };
    useEffect(() => {
        if (!club?.id || !userProfile?.id) return;
        return onSnapshot(
            doc(db, 'clubs', club.id, 'members', userProfile.id),
            snap => {
                const data = snap.data();
                const otp = data?.receptionOtp;
                const otpAtRaw = data?.receptionOtpAt;
                const otpAt = otpAtRaw?.toDate ? otpAtRaw.toDate() : (otpAtRaw ? new Date(otpAtRaw) : null);
                const ageMin = otpAt ? (Date.now() - otpAt.getTime()) / 60000 : Infinity;
                if (otp && !data?.receptionOtpUsed && ageMin <= OTP_TTL_MIN) {
                    setReceptionOtp(otp);
                } else {
                    setReceptionOtp(null);
                    // When the OTP truly clears (used/expired/gone), forget any
                    // prior dismissal so the next NEW OTP isn't suppressed.
                    persistDismissed(null);
                }
            }
        );
        // DISMISSED_OTP_KEY changes only when userProfile.id changes, which is
        // already in the dep array.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [club?.id, userProfile?.id]);
    const showReceptionOtp = !!receptionOtp && receptionOtp !== dismissedOtp;

    // Purchase request flow
    const [showPurchaseWizard, setShowPurchaseWizard] = useState(false);
    // The wizard reads the club's whole memberships collection when it mounts,
    // with no check on whether it is open — so arriving on this screen paid a
    // round trip for a dialog nobody had opened, competing with the wallet and
    // the plan lookup the credits card actually needs. It is mounted on first
    // open instead, and stays mounted after that so its close-reset effect and
    // exit animation still work.
    const [wizardMounted, setWizardMounted] = useState(false);
    const { pendingRequest: pendingPurchaseRequest } = useMyPendingPurchaseRequest();
    const cancelPurchaseRequest = useCancelPurchaseRequest();
    const { toast: dashToast } = useToast();

    // Everything the member cannot see yet waits until the screen has drawn.
    //
    // This page starts about a dozen Firestore reads at once. They share one
    // connection, so the transaction history and the volunteer log were being
    // fetched alongside — and slowing down — the credits card the member is
    // actually looking at. The wallet and credits stay eager; the rest of the
    // page fills in a moment later, by which time it has already been scrolled
    // to or not looked at at all.

    // Wallet - real-time via onSnapshot
    const { wallet: walletData, loading: walletLoading } = useMyWallet();

    // Transactions - full list
    const { data: transactions = [], isLoading: txLoading } = useQuery({
        queryKey: ["member-transactions", userProfile?.id, club?.id],
        // Below the fold. Held until the page has drawn, so the member's entire
        // transaction history is not being read over the same connection they
        // are waiting on to see their credits.
        enabled: afterPaint && !!userProfile?.id && !!club?.id,
        queryFn: async () => {
            const q = query(
                collection(db, `clubs/${club!.id}/members/${userProfile!.id}/transactions`),
                orderBy("createdAt", "desc")
            );
            const snap = await getDocs(q);
            return snap.docs.map((d) => ({ id: d.id, ...d.data() } as WalletTransaction));
        },
    });

    type TxFilter = "all" | "shake_orders" | "payments" | "products";
    const TX_FILTERS: { id: TxFilter; label: string; reasons: string[] }[] = [
        { id: "all", label: "All", reasons: [] },
        { id: "shake_orders", label: "Shake Orders", reasons: ["shake_order"] },
        { id: "payments", label: "Payments", reasons: ["topup", "membership", "refund", "adjustment", "referral_bonus"] },
        { id: "products", label: "Products", reasons: ["product"] },
    ];
    const [txFilter, setTxFilter] = useState<TxFilter>("all");
    const filteredTransactions = useMemo(() => {
        if (txFilter === "all") return transactions;
        const reasons = TX_FILTERS.find((f) => f.id === txFilter)?.reasons ?? [];
        return transactions.filter((tx) => reasons.includes((tx as any).reason));
    }, [transactions, txFilter]);
    const txFilterCounts = useMemo(() => {
        const counts: Record<TxFilter, number> = { all: transactions.length, shake_orders: 0, payments: 0, products: 0 };
        for (const tx of transactions) {
            const reason = (tx as any).reason as string;
            for (const f of TX_FILTERS) {
                if (f.id !== "all" && f.reasons.includes(reason)) counts[f.id]++;
            }
        }
        return counts;
    }, [transactions]);

    // Attendance
    const { data: attendanceList = [], isLoading: attendanceLoading } = useMyAttendance(
        userProfile?.id ?? null,
        club?.id ?? null
    );
    const attendanceStats = useMemo(
        () => (attendanceList.length > 0 ? computeAttendanceStats(attendanceList) : { thisMonthCount: 0, streak: 0, allTimeCount: 0 }),
        [attendanceList]
    );

    // Membership plan info
    const { data: membershipPlan, isLoading: planLoading } = useQuery({
        queryKey: ["member-plan", userProfile?.membershipPlanId, club?.id],
        enabled: afterPaint && !!userProfile?.membershipPlanId && !!club?.id,
        queryFn: async () => {
            const snap = await getDoc(doc(db, `clubs/${club!.id}/memberships`, userProfile!.membershipPlanId!));
            if (!snap.exists()) return null;
            return { id: snap.id, ...snap.data() } as MembershipPlan;
        },
    });

    // Volunteer history
    const { data: volunteerHistory = [], isLoading: volHistLoading } = useQuery({
        queryKey: ["volunteer-history", userProfile?.id, club?.id],
        enabled: afterPaint && !!userProfile?.id && !!club?.id,
        queryFn: async () => {
            const q = query(
                collection(db, `clubs/${club!.id}/volunteerAttendance`),
                where("memberId", "==", userProfile!.id),
                orderBy("loginTime", "desc")
            );
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        },
    });

    // Announcements
    const { announcements: allAnnouncements, loading: announcementsLoading } = useMyAnnouncements(
        club?.id ?? null,
        userProfile?.id ?? null,
        userProfile?.memberType,
        undefined
    );
    const announcements = useMemo(
        () => (allAnnouncements ?? []).filter((a) => (a as any).isActive !== false).slice(0, 3),
        [allAnnouncements],
    );

    // Leaderboard — top performer this week
    // Only `[0]` is used, to name the week's top performer — and getting it
    // costs a read of every member plus a weigh-in query each. Held back until
    // the page has painted so the member sees their own credits first.
    const { data: weekLeaderboard = [] } = useLeaderboard(
        club?.id ?? null,
        "week",
        { defer: !afterPaint },
    );
    const topPerformer = weekLeaderboard[0] ?? null;

    const membershipStatus = userProfile ? getMembershipStatus(userProfile) : null;
    const planTotalVisits = membershipPlan?.visits ?? (membershipPlan as any)?.totalVisits ?? membershipPlan?.durationDays ?? 0;

    if (!userProfile) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center" style={{ background: BG }}>
                <Skeleton className="h-12 w-48" />
            </div>
        );
    }

    return (
        <>
            {/* ── Pre-Order Modal ── */}
            {showPreOrderModal && (
                <div
                    onClick={() => { setShowPreOrderModal(false); setPreOrderCart([]); setPreOrderMsg(''); }}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 99999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: 'Nunito, sans-serif' }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ background: 'white', borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -8px 40px rgba(0,0,0,0.2)' }}
                    >
                        {/* Header */}
                        <div style={{ padding: '20px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                            <div>
                                <div style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a' }}>🥤 Order & Check-in</div>
                                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Pre-order your shake — confirm with face scan at reception</div>
                            </div>
                            <button onClick={() => { setShowPreOrderModal(false); setPreOrderCart([]); setPreOrderMsg(''); }} style={{ width: 36, height: 36, background: '#f3f4f6', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        </div>

                        {/* Items */}
                        <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
                            {todaysSpecials.filter(i => i.stockType !== 'limited' || (i.remainingStock || 0) > 0).length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
                                    <div style={{ fontSize: 40, marginBottom: 8 }}>☕</div>
                                    <p style={{ fontSize: 14 }}>No specials available today</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {todaysSpecials.filter(i => i.stockType !== 'limited' || (i.remainingStock || 0) > 0).map(item => {
                                        const inCart = preOrderCart.find(c => c.id === item.id);
                                        return (
                                            <div key={item.id} style={{ background: inCart ? '#f0fdf4' : '#f8fafc', border: `2px solid ${inCart ? '#86efac' : '#e2e8f0'}`, borderRadius: 16, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                                {/* Item row */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                    {item.imageUrl ? (
                                                        <img src={item.imageUrl} style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
                                                    ) : (
                                                        <div style={{ width: 48, height: 48, borderRadius: 10, background: 'linear-gradient(135deg,#f59e0b,#d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🥤</div>
                                                    )}
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontSize: 15, fontWeight: 800, color: '#1a3a2a' }}>{item.name || item.itemName}</div>
                                                        <div style={{ fontSize: 13, color: '#6b7280' }}>₹{item.price || 0}{item.stockType === 'limited' ? ` · ${item.remainingStock} left` : ''}</div>
                                                    </div>
                                                    {inCart ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <button onClick={() => setPreOrderCart(p => inCart.qty > 1 ? p.map(c => c.id === item.id ? { ...c, qty: c.qty - 1 } : c) : p.filter(c => c.id !== item.id))} style={{ width: 32, height: 32, background: '#fee2e2', border: 'none', borderRadius: 8, color: '#ef4444', fontSize: 18, fontWeight: 700, cursor: 'pointer' }}>−</button>
                                                            <span style={{ fontSize: 16, fontWeight: 900, minWidth: 20, textAlign: 'center' }}>{inCart.qty}</span>
                                                            <button onClick={() => setPreOrderCart(p => p.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c))} style={{ width: 32, height: 32, background: '#dcfce7', border: 'none', borderRadius: 8, color: '#2d9653', fontSize: 18, fontWeight: 700, cursor: 'pointer' }}>+</button>
                                                        </div>
                                                    ) : (
                                                        <button onClick={() => addToPreOrderCart(item)} style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: 'white', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', whiteSpace: 'nowrap' }}>+ Add</button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        {preOrderMsg && (
                            <div style={{ margin: '0 20px 12px', padding: '12px 16px', borderRadius: 12, background: preOrderMsg.startsWith('✅') ? '#dcfce7' : '#fde8e8', color: preOrderMsg.startsWith('✅') ? '#166534' : '#ef4444', fontSize: 14, fontWeight: 700, textAlign: 'center' }}>
                                {preOrderMsg}
                            </div>
                        )}
                        {preOrderCart.length > 0 && !preOrderMsg && (
                            <div style={{ padding: '12px 20px 24px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
                                <button
                                    onClick={submitPreOrder}
                                    disabled={preOrderSubmitting}
                                    style={{ width: '100%', padding: '16px', background: preOrderSubmitting ? '#e5e7eb' : 'linear-gradient(135deg,#2d9653,#16a34a)', color: preOrderSubmitting ? '#9ca3af' : 'white', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 800, cursor: preOrderSubmitting ? 'not-allowed' : 'pointer', fontFamily: 'Nunito,sans-serif', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                >
                                    <span>{preOrderSubmitting ? 'Placing...' : `📲 Confirm Pre-order`}</span>
                                    <span>₹{preOrderCartTotal} · {preOrderCart.reduce((s, c) => s + c.qty, 0)} item(s)</span>
                                </button>
                                <p style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 8 }}>Your order will be confirmed when you scan your face at reception</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Purchase request wizard — mounted on first open, see wizardMounted */}
            {wizardMounted && (
                <PurchaseRequestWizard
                    open={showPurchaseWizard}
                    onOpenChange={setShowPurchaseWizard}
                    clubId={club?.id ?? null}
                />
            )}

            {/* Reception OTP overlay */}
            {showReceptionOtp && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0,
                    background: 'linear-gradient(135deg,#1a3a2a,#2d9653)',
                    zIndex: 99999, padding: '20px 24px', textAlign: 'center',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.3)', fontFamily: 'Nunito, sans-serif',
                }}>
                    <button
                        type="button"
                        aria-label="Dismiss"
                        onClick={() => persistDismissed(receptionOtp)}
                        style={{
                            position: 'absolute', top: 8, right: 8,
                            width: 32, height: 32, borderRadius: 16,
                            background: 'rgba(255,255,255,0.15)', border: 'none',
                            color: 'white', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                    >
                        <X size={18} />
                    </button>
                    <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                        Reception is verifying your identity
                    </div>
                    <div style={{ color: 'white', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                        Tell this code to the receptionist:
                    </div>
                    <div style={{ fontSize: 52, fontWeight: 900, color: 'white', letterSpacing: 14, fontFamily: 'monospace', lineHeight: 1 }}>
                        {receptionOtp}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 8 }}>
                        Disappears once verified
                    </div>
                </div>
            )}

            <div
                className="min-h-screen pb-24 px-4 font-[Nunito,sans-serif]"
                style={{ background: BG, paddingTop: showReceptionOtp ? 196 : 24, transition: 'padding-top 0.3s ease' }}
            >
                <div className="max-w-lg mx-auto space-y-5">

                    {/* ── Announcements ──
                        No skeleton while this loads. It is the first element on the
                        page, so two grey boxes here pushed the member's name, their
                        credits and the Order a Shake button below the fold until a
                        Firestore listener connected — and on most days it then
                        resolved to nothing at all. The member was watching a network
                        round trip render an empty space. Now the page draws what it
                        already knows, and an announcement drops in if there is one. */}
                    {!announcementsLoading && announcements.length > 0 && (
                        <section className="space-y-3">
                            {announcements.map((ann) => (
                                <div
                                    key={ann.id}
                                    className="rounded-2xl p-4 flex gap-3 items-start"
                                    style={{ background: 'linear-gradient(135deg, #1a3a2a, #2d9653)' }}
                                >
                                    <Megaphone className="w-5 h-5 text-white/80 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-white font-bold text-sm">{ann.title}</p>
                                        <p className="text-white/80 text-xs mt-1 leading-relaxed">{ann.message}</p>
                                        <p className="text-white/50 text-[11px] mt-1.5">
                                            {ann.createdAt?.toDate?.()?.toLocaleDateString("en-IN")}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </section>
                    )}

                    {/* ── This Week's Top Performer ── */}
                    {topPerformer && (
                        <section>
                            <div style={{
                                background: 'linear-gradient(135deg,#1a3a2a,#2d9653)',
                                borderRadius: 20,
                                padding: '18px 20px',
                                boxShadow: '0 6px 24px rgba(45,150,83,0.3)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontSize: 18 }}>🏆</span>
                                        <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' }}>This Week's Top Performer</span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                    {topPerformer.memberPhoto ? (
                                        <img src={topPerformer.memberPhoto} alt={topPerformer.memberName} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)', flexShrink: 0 }} />
                                    ) : (
                                        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, color: 'white', flexShrink: 0 }}>
                                            {topPerformer.memberName.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{ color: 'white', fontWeight: 900, fontSize: 17, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {topPerformer.memberName.split(' ')[0]}
                                        </p>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                                            {topPerformer.fatLost != null && (
                                                <span style={{ background: 'rgba(255,255,255,0.15)', color: 'white', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
                                                    ↓ {topPerformer.fatLost}% body fat
                                                </span>
                                            )}
                                            {topPerformer.weightLost > 0 && (
                                                <span style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
                                                    ↓ {topPerformer.weightLost} kg
                                                </span>
                                            )}
                                            {topPerformer.muscleGained != null && topPerformer.muscleGained > 0 && (
                                                <span style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
                                                    ↑ {topPerformer.muscleGained} kg muscle
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <Link to="/member/leaderboard" style={{
                                    display: 'block', marginTop: 14,
                                    background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
                                    borderRadius: 10, padding: '10px 0', textAlign: 'center',
                                    color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: 13, textDecoration: 'none',
                                }}>
                                    View Full Leaderboard →
                                </Link>
                            </div>
                        </section>
                    )}

                    {/* ── Club Photos (Early Bird + Fun Friday) ── */}
                    {(!earlyBirdLoading && !funFridayLoading) && (earlyBirdPhoto || funFridayPhoto) && (
                        <section className="rounded-2xl overflow-hidden" style={{ boxShadow: '0 6px 28px rgba(0,0,0,0.15)' }}>
                            {/* Early Bird */}
                            {earlyBirdPhoto && (
                                <div style={{ position: 'relative' }}>
                                    <img
                                        src={earlyBirdPhoto.photoUrl}
                                        alt="Early Bird"
                                        className="w-full object-cover"
                                        style={{ maxHeight: funFridayPhoto ? '40vw' : '55vw', minHeight: 140, display: 'block' }}
                                    />
                                    <div style={{
                                        position: 'absolute', bottom: 0, left: 0, right: 0,
                                        background: 'linear-gradient(to top, rgba(120,53,15,0.92) 0%, transparent 100%)',
                                        padding: '18px 14px 10px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontSize: 16 }}>🐦</span>
                                            <span style={{ color: 'white', fontWeight: 800, fontSize: 13 }}>Early Birds Today</span>
                                        </div>
                                        <span style={{ color: 'rgba(255,220,150,0.9)', fontSize: 12, fontWeight: 700 }}>
                                            {(() => {
                                                try {
                                                    const d = earlyBirdPhoto.uploadedAt?.toDate
                                                        ? earlyBirdPhoto.uploadedAt.toDate()
                                                        : new Date(earlyBirdPhoto.uploadedAt);
                                                    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                                                } catch { return ""; }
                                            })()}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Fun Friday Winners */}
                            {funFridayPhoto && (
                                <div style={{ position: 'relative', borderTop: earlyBirdPhoto ? '2px solid rgba(255,255,255,0.1)' : 'none' }}>
                                    <img
                                        src={funFridayPhoto.photoUrl}
                                        alt="Fun Friday Winners"
                                        className="w-full object-cover"
                                        style={{ maxHeight: earlyBirdPhoto ? '40vw' : '55vw', minHeight: 140, display: 'block' }}
                                    />
                                    <div style={{
                                        position: 'absolute', bottom: 0, left: 0, right: 0,
                                        background: 'linear-gradient(to top, rgba(88,28,135,0.92) 0%, transparent 100%)',
                                        padding: '18px 14px 10px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontSize: 16 }}>🏆</span>
                                            <span style={{ color: 'white', fontWeight: 800, fontSize: 13 }}>Fun Friday Winners</span>
                                        </div>
                                        <span style={{ color: 'rgba(216,180,254,0.9)', fontSize: 11, fontWeight: 700 }}>
                                            {(() => {
                                                try {
                                                    const d = funFridayPhoto.uploadedAt?.toDate
                                                        ? funFridayPhoto.uploadedAt.toDate()
                                                        : new Date(funFridayPhoto.uploadedAt);
                                                    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
                                                } catch { return ""; }
                                            })()}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    {/* ── Early Bird Upload (when no photo yet today) ── */}
                    {!earlyBirdLoading && !earlyBirdPhoto && (
                        <section
                            className="rounded-2xl overflow-hidden"
                            style={{ boxShadow: '0 4px 20px rgba(251,191,36,0.15)' }}
                        >
                            <div
                                className="flex flex-col items-center justify-center gap-3 py-5 px-4"
                                style={{ background: 'linear-gradient(135deg,#1c1207,#3b1f05)' }}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">🐦</span>
                                    <span className="text-amber-300 font-bold text-sm">Early Bird Photo</span>
                                </div>
                                <p className="text-amber-100/60 text-xs text-center">First crew here today? Capture the moment!</p>
                                {earlyBirdError && (
                                    <p className="text-red-400 text-xs text-center">{earlyBirdError}</p>
                                )}
                                <label className="cursor-pointer">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleEarlyBirdUpload}
                                        disabled={earlyBirdUploading}
                                    />
                                    <div
                                        className="flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-sm"
                                        style={{ background: earlyBirdUploading ? '#92400e' : '#d97706', color: 'white' }}
                                    >
                                        {earlyBirdUploading
                                            ? <><Upload className="w-4 h-4 animate-bounce" /> Uploading…</>
                                            : <><Camera className="w-4 h-4" /> Upload Photo</>
                                        }
                                    </div>
                                </label>
                            </div>
                        </section>
                    )}

                    {/* ── Pre-order / Queue Banner ── */}
                    {pendingEntry ? (
                        <section style={{ borderRadius: 20, overflow: 'hidden', boxShadow: '0 4px 20px rgba(245,158,11,0.25)' }}>
                            <div style={{ background: 'linear-gradient(135deg,#d97706,#f59e0b)', padding: '16px 20px' }}>
                                <div style={{ color: 'white', fontSize: 14, fontWeight: 900, marginBottom: 2 }}>🎯 You're in the queue!</div>
                                <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>Head to reception — they'll scan your face to confirm your order</div>
                            </div>
                            <div style={{ background: '#fffbeb', padding: '14px 20px' }}>
                                <div style={{ fontSize: 12, color: '#78350f', fontWeight: 700, marginBottom: 8 }}>Your pre-order:</div>
                                {(pendingEntry.items || []).map((item: any, i: number) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#92400e', fontWeight: 600 }}>
                                        <span>🥤 {item.name} × {item.qty}</span>
                                        <span>₹{(item.price || 0) * item.qty}</span>
                                    </div>
                                ))}
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 900, color: '#92400e', marginTop: 8, borderTop: '1px dashed #fde68a', paddingTop: 8 }}>
                                    <span>Total</span><span>₹{pendingEntry.totalAmount || 0}</span>
                                </div>
                            </div>
                        </section>
                    ) : (
                        <section>
                            <button
                                onClick={() => { setPreOrderCart([]); setPreOrderMsg(''); setShowPreOrderModal(true); }}
                                style={{ width: '100%', background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none', borderRadius: 20, padding: '20px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 6px 24px rgba(245,158,11,0.35)', fontFamily: 'Nunito, sans-serif' }}
                            >
                                <div style={{ fontSize: 44 }}>🥤</div>
                                <div style={{ flex: 1, textAlign: 'left' }}>
                                    <div style={{ color: 'white', fontSize: 17, fontWeight: 900 }}>Order a Shake</div>
                                    <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 2 }}>Pre-order now · confirm at reception</div>
                                </div>
                                <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 22 }}>›</div>
                            </button>
                        </section>
                    )}

                    {/* ── Profile / Greeting ── */}
                    <section className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full overflow-hidden bg-green-100 flex items-center justify-center flex-shrink-0 border-2 border-green-200">
                            {((userProfile as any).photoUrl || userProfile.photo || (userProfile as any).photoURL) ? (
                                <img src={(userProfile as any).photoUrl || userProfile.photo || (userProfile as any).photoURL} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <User className="w-7 h-7 text-green-600" />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h1 className="text-xl font-bold text-slate-800 truncate">
                                {greetingText}, {firstName} {emoji}
                            </h1>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                                    {memberIdDisplay}
                                </Badge>
                                {membershipStatus && (
                                    <Badge
                                        variant={membershipStatus.variant}
                                        className={`text-[10px] px-1.5 py-0 ${membershipStatus.className}`}
                                    >
                                        {membershipStatus.label}
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* ── Birthday / Anniversary wishes ── */}
                    {/* Mounted after paint. Finding out whose birthday it is means
                        reading EVERY member document in the club — the largest
                        payload this screen asks for, and nothing on it needs the
                        answer in order to draw.

                        This is also what was quietly defeating the leaderboard's
                        deferral: both reach the club roster through the same
                        query key, so whichever caller enables it first starts the
                        fetch. The leaderboard waited; this banner did not, so the
                        whole-club read landed on the critical path anyway, ahead
                        of the member's own credits. */}
                    {afterPaint && <BirthdayWishBanner clubId={club?.id} theme="light" />}

                    {/* ── Shake Balance Card ── */}
                    {(() => {
                        const credits = (userProfile as any).shakeCredits ?? 0;
                        const planTotal = (userProfile as any).shakeCreditsPlanTotal ?? 0;
                        const planVisits = membershipPlan?.visits || (membershipPlan as any)?.totalVisits || 0;
                        const perPrice = membershipPlan && planVisits > 0
                            ? Math.round((membershipPlan.price || 0) / planVisits)
                            : (membershipPlan as any)?.perShakePrice ?? 0;
                        if (planTotal <= 0) return null;
                        return (
                            <ShakeBalanceCard
                                shakeCredits={credits}
                                shakeCreditsPlanTotal={planTotal}
                                perShakePrice={perPrice}
                            />
                        );
                    })()}

                    {/* ── Purchase Request: button or pending banner ── */}
                    {pendingPurchaseRequest ? (
                        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                                    <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-amber-900">Request pending</p>
                                    <p className="text-xs text-amber-700 truncate">
                                        Pay ₹{pendingPurchaseRequest.totalAmount.toLocaleString()} at reception ·
                                        {" "}{pendingPurchaseRequest.items.length} item{pendingPurchaseRequest.items.length !== 1 ? "s" : ""}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (!confirm("Cancel this request?")) return;
                                        try {
                                            await cancelPurchaseRequest.mutateAsync(pendingPurchaseRequest.id);
                                            dashToast({ title: "Request cancelled" });
                                        } catch (err: any) {
                                            dashToast({ title: "Could not cancel", description: err.message, variant: "destructive" });
                                        }
                                    }}
                                    disabled={cancelPurchaseRequest.isPending}
                                    className="text-xs font-bold px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                                >
                                    {cancelPurchaseRequest.isPending ? "…" : "Cancel"}
                                </button>
                            </div>
                        </section>
                    ) : (
                        <button
                            type="button"
                            onClick={() => { setWizardMounted(true); setShowPurchaseWizard(true); }}
                            className="w-full flex items-center gap-3 p-4 rounded-2xl border border-green-100 bg-white shadow-sm hover:bg-green-50 transition-colors"
                        >
                            <div
                                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                                style={{ backgroundColor: `${GREEN}15`, color: GREEN }}
                            >
                                <ShoppingBag className="w-5 h-5" />
                            </div>
                            <div className="flex-1 text-left min-w-0">
                                <p className="text-sm font-bold text-slate-800">Buy Membership · Top-up · Products</p>
                                <p className="text-xs text-slate-500">Send a request — pay at reception</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        </button>
                    )}

                    {/* ── Wallet Balance ── */}
                    <section className="rounded-2xl overflow-hidden shadow-sm" style={{ background: `linear-gradient(135deg, ${GREEN}, #1e6b3a)` }}>
                        <div className="p-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <Wallet className="w-4 h-4 text-white/80" />
                                        <span className="text-white/80 text-sm font-medium">Wallet Balance</span>
                                    </div>
                                    {walletLoading ? (
                                        <Skeleton className="h-8 w-24 bg-white/20" />
                                    ) : (
                                        <p className="text-3xl font-black text-white">
                                            {walletData?.balance?.toLocaleString() ?? 0}
                                            <span className="text-sm font-medium text-white/70 ml-1.5">
                                                {club?.currencyName ?? "Coins"}
                                            </span>
                                        </p>
                                    )}
                                </div>
                                <Link
                                    to="/member/wallet"
                                    className="bg-white/20 hover:bg-white/30 transition-colors rounded-xl px-4 py-2 text-white text-xs font-bold"
                                >
                                    Details
                                </Link>
                            </div>
                        </div>
                    </section>

                    {/* ── Attendance Grid ── */}
                    <section className="rounded-2xl border border-green-100 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <CalendarCheck className="w-4 h-4" style={{ color: GREEN }} />
                                Attendance · {format(new Date(), "MMMM yyyy")}
                            </h2>
                            <Link to="/member/attendance" className="text-xs font-medium flex items-center gap-0.5" style={{ color: GREEN }}>
                                History <ChevronRight className="w-3 h-3" />
                            </Link>
                        </div>

                        {attendanceLoading ? (
                            <Skeleton className="h-40 w-full rounded-lg" />
                        ) : (
                            <>
                                {/* Progress summary */}
                                <div className="flex items-center gap-4 mb-3">
                                    <div>
                                        <p className="text-2xl font-black" style={{ color: GREEN }}>
                                            {attendanceStats.allTimeCount ?? attendanceList.length}
                                        </p>
                                        <p className="text-[11px] text-slate-500">Total Visits</p>
                                    </div>
                                    {planTotalVisits > 0 && (
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                                                <span>Plan Progress</span>
                                                <span className="font-bold" style={{ color: GREEN }}>
                                                    {attendanceList.length}/{planTotalVisits}
                                                </span>
                                            </div>
                                            <div className="w-full bg-green-100 rounded-full h-2">
                                                <div
                                                    className="h-2 rounded-full transition-all duration-500"
                                                    style={{
                                                        backgroundColor: GREEN,
                                                        width: `${Math.min(100, (attendanceList.length / planTotalVisits) * 100)}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                    <div className="text-center">
                                        <p className="text-2xl font-black" style={{ color: GREEN }}>
                                            {attendanceStats.streak}
                                        </p>
                                        <p className="text-[11px] text-slate-500">Streak</p>
                                    </div>
                                </div>

                                {/* Calendar grid for current month */}
                                {(() => {
                                    const today = new Date();
                                    const monthStart = startOfMonth(today);
                                    const monthEnd = endOfMonth(today);
                                    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
                                    const firstDayOfWeek = monthStart.getDay();
                                    const padding = Array(firstDayOfWeek).fill(null);
                                    const attendanceDates = new Set(attendanceList.map((a: any) => a.date));
                                    return (
                                        <>
                                            <div className="grid grid-cols-7 gap-1 mb-1">
                                                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                                                    <div
                                                        key={i}
                                                        className={`text-center text-[10px] font-medium py-0.5 ${i === 0 ? "text-red-400" : "text-slate-400"}`}
                                                    >
                                                        {d}
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="grid grid-cols-7 gap-1">
                                                {padding.map((_, i) => (
                                                    <div key={`pad-${i}`} className="aspect-square" />
                                                ))}
                                                {days.map((day) => {
                                                    const dateStr = format(day, "yyyy-MM-dd");
                                                    const isSun = day.getDay() === 0;
                                                    const isToday = isSameDay(day, today);
                                                    const isFuture = day > today && !isToday;
                                                    const present = attendanceDates.has(dateStr);
                                                    const bg = isSun
                                                        ? "#fef2f2"
                                                        : present
                                                            ? `${GREEN}25`
                                                            : isFuture
                                                                ? "#f1f5f9"
                                                                : "#fee2e2";
                                                    const numColor = isSun
                                                        ? "text-red-300"
                                                        : isFuture
                                                            ? "text-slate-400"
                                                            : present
                                                                ? "text-emerald-700"
                                                                : "text-red-500";
                                                    return (
                                                        <div
                                                            key={dateStr}
                                                            className="aspect-square rounded-md flex flex-col items-center justify-center"
                                                            style={{
                                                                backgroundColor: bg,
                                                                ...(isToday && { boxShadow: `inset 0 0 0 2px ${GREEN}` }),
                                                            }}
                                                        >
                                                            <span className={`text-[11px] font-semibold leading-none ${numColor}`}>
                                                                {format(day, "d")}
                                                            </span>
                                                            {!isFuture && !isSun && present && (
                                                                <span className="text-[8px] font-black leading-none mt-0.5" style={{ color: GREEN }}>✓</span>
                                                            )}
                                                            {isSun && (
                                                                <span className="text-[7px] text-red-300 font-bold leading-none mt-0.5">Off</span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="flex items-center gap-3 mt-3 text-[10px] text-slate-500">
                                                <div className="flex items-center gap-1">
                                                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: `${GREEN}25` }} />
                                                    Present
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className="w-2.5 h-2.5 rounded-sm bg-red-100" />
                                                    Absent
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className="w-2.5 h-2.5 rounded-sm bg-slate-100" />
                                                    Pending
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className="w-2.5 h-2.5 rounded-sm bg-red-50" />
                                                    Sunday
                                                </div>
                                            </div>
                                        </>
                                    );
                                })()}
                            </>
                        )}
                    </section>

                    {/* ── Volunteer History ── */}
                    {(volHistLoading || volunteerHistory.length > 0) && (
                        <section className="rounded-2xl border border-green-100 bg-white shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between p-4 pb-2">
                                <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                    🙌 Volunteer Sessions
                                </h2>
                                <span className="text-[11px] text-slate-400 font-medium">
                                    {volunteerHistory.length} session{volunteerHistory.length !== 1 ? "s" : ""}
                                </span>
                            </div>
                            {volHistLoading ? (
                                <div className="p-4 pt-2 space-y-2">
                                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}
                                </div>
                            ) : (
                                <div className="max-h-[320px] overflow-y-auto">
                                    {volunteerHistory.map((session: any, idx: number) => {
                                        const loginDate = session.loginTime?.toDate ? session.loginTime.toDate() : null;
                                        const logoutDate = session.logoutTime?.toDate ? session.logoutTime.toDate() : null;
                                        const mins: number | null = session.totalMinutes ?? null;
                                        const hrs = mins != null ? (mins / 60).toFixed(1) : null;
                                        const isActive = session.status === "active";
                                        return (
                                            <div key={session.id} className={`flex items-center justify-between px-4 py-3 ${idx < volunteerHistory.length - 1 ? "border-b border-slate-50" : ""}`}>
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${isActive ? "bg-green-100" : "bg-slate-100"}`}>
                                                        {isActive ? "🟢" : "✅"}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-semibold text-slate-800">
                                                            {loginDate ? format(loginDate, "EEE, MMM d yyyy") : session.date || "—"}
                                                        </p>
                                                        <p className="text-[11px] text-slate-400">
                                                            {loginDate ? format(loginDate, "h:mm a") : ""}
                                                            {logoutDate ? ` – ${format(logoutDate, "h:mm a")}` : isActive ? " · In progress" : ""}
                                                        </p>
                                                    </div>
                                                </div>
                                                <p className="text-sm font-bold text-slate-700 flex-shrink-0 ml-2">
                                                    {hrs != null ? `${hrs}h` : isActive ? "🔴 Active" : "—"}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    )}

                    {/* ── Transaction History ── */}
                    <section className="rounded-2xl border border-green-100 bg-white shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between p-4 pb-2">
                            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <ArrowUpRight className="w-4 h-4" style={{ color: GREEN }} />
                                Transaction History
                            </h2>
                            <span className="text-[11px] text-slate-400 font-medium">
                                {filteredTransactions.length} {txFilter === "all" ? "total" : "shown"}
                            </span>
                        </div>

                        {/* Filter tabs */}
                        <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto scrollbar-hide">
                            {TX_FILTERS.map((f) => {
                                const active = txFilter === f.id;
                                const count = txFilterCounts[f.id];
                                return (
                                    <button
                                        key={f.id}
                                        type="button"
                                        onClick={() => setTxFilter(f.id)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all shrink-0"
                                        style={active
                                            ? { backgroundColor: GREEN, color: "#fff" }
                                            : { backgroundColor: "#f3f4f6", color: "#6b7280" }}
                                    >
                                        {f.label}
                                        {count > 0 && (
                                            <span
                                                className="px-1.5 py-0.5 rounded-full text-[10px]"
                                                style={active
                                                    ? { backgroundColor: "rgba(255,255,255,0.25)" }
                                                    : { backgroundColor: "#e5e7eb" }}
                                            >
                                                {count}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {txLoading ? (
                            <div className="p-4 pt-2 space-y-2">
                                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
                            </div>
                        ) : filteredTransactions.length === 0 ? (
                            <div className="p-6 text-center text-slate-400 text-sm">
                                {txFilter === "all"
                                    ? "No transactions yet"
                                    : `No ${TX_FILTERS.find((f) => f.id === txFilter)?.label.toLowerCase()} yet`}
                            </div>
                        ) : (
                            <div className="max-h-[400px] overflow-y-auto">
                                {filteredTransactions.map((tx, idx) => (
                                    <div
                                        key={tx.id}
                                        className={`flex items-center justify-between px-4 py-3 ${
                                            idx < filteredTransactions.length - 1 ? "border-b border-slate-50" : ""
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                                tx.type === "credit"
                                                    ? "bg-green-100"
                                                    : "bg-red-50"
                                            }`}>
                                                {tx.type === "credit" ? (
                                                    <ArrowDownRight className="w-4 h-4 text-green-600" />
                                                ) : (
                                                    <ArrowUpRight className="w-4 h-4 text-red-500" />
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-slate-800 truncate">
                                                    {tx.note || tx.description || txReasonLabel(tx.reason)}
                                                </p>
                                                <p className="text-[11px] text-slate-400">
                                                    {formatTxDate(tx.createdAt)}
                                                </p>
                                            </div>
                                        </div>
                                        {(tx as any).reason === "inventory_received" ? (
                                            <span className="text-[11px] font-bold flex-shrink-0 ml-3 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                {(tx as any).itemsCount ? `${(tx as any).itemsCount} box${(tx as any).itemsCount === 1 ? "" : "es"}` : "Inventory"}
                                            </span>
                                        ) : (
                                            <p className={`text-sm font-bold flex-shrink-0 ml-3 ${
                                                tx.type === "credit" ? "text-green-600" : "text-red-500"
                                            }`}>
                                                {tx.type === "credit" ? "+" : "-"}{tx.amount?.toLocaleString()}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                </div>
            </div>
        </>
    );
}
