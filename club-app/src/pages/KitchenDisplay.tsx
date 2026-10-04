import { useState, useEffect, useRef, useCallback } from "react";
import { useClubContext } from "@/lib/clubDetection";
import { useAppVersion } from "@/lib/appVersion";
import KitchenOrdersNew from "@/components/kitchen/KitchenOrdersNew";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import StationAccess from "@/components/StationAccess";
import { signOut } from "firebase/auth";
import {
    useKitchenOrders,
    useUpdateOrderStatus,
    useTodayOrdersSummary,
    useRejectOrder,
    useTodayRejectedOrders,
} from "@/hooks/useOrders";
import {
    collection,
    query,
    where,
    getDocs,
    getDoc,
    onSnapshot,
    doc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    serverTimestamp,
    Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
    Lock,
    ChefHat,
    CookingPot,
    Plus,
    Minus,
    Pencil,
    Trash2,
    AlertTriangle,
    ChevronRight,
    TrendingUp,
    Star,
    Printer,
} from "lucide-react";
import type { Order, Product } from "@/types/firestore";
import { useToggleGlobalItem, useGlobalMenuItems } from "@/hooks/useGlobalMenu";
import { useClubProducts, useAddProduct, useUpdateProduct } from "@/hooks/useInventory";
import ProductForm from "@/components/inventory/ProductForm";
import KitchenStockDashboard from "@/components/kitchen/KitchenStockDashboard";
import KitchenStockRequest from "@/components/kitchen/KitchenStockRequest";
import { useToast } from "@/hooks/use-toast";
import { fetchClubAndPrint, generateTxnId, printShakeAndAfresh } from "@/utils/printReceipt";
import { buildKitchenDailyReceipt, buildOrderRefundSlip, buildShakeTokenReceipt, buildAfreshToken } from "@/utils/receiptBuilder";
import KitchenMagicianButton from "@/features/magician/kitchen/KitchenMagicianButton";
import OrderElapsedTimer from "@/components/kitchen/OrderElapsedTimer";
import {
    useTodaysSpecials,
    useToggleTodaysSpecial,
    useSetSpecialStockType,
    useSetSpecialQuantity,
    getTodayStr,
    getStockBadgeInfo,
    type TodaysSpecialItem,
} from "@/hooks/useTodaysSpecial";

const GREEN = "#2d9653";
const FONT = "'Nunito', sans-serif";

// ─── Sound helpers ───────────────────────────────────────────────────────

function playTone(freq: number, duration = 0.4) {
    try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    } catch {
        /* AudioContext not available */
    }
}
const playNewOrder = () => playTone(600, 0.35);
const playOrderReady = () => playTone(900, 0.5);

// ─── Time helpers ────────────────────────────────────────────────────────

function minutesAgo(ts: any): number {
    if (!ts?.toDate) return 0;
    return Math.floor((Date.now() - ts.toDate().getTime()) / 60000);
}

function elapsedBadge(mins: number) {
    if (mins < 5) return { text: `${mins}m`, cls: "bg-green-100 text-green-700" };
    if (mins < 10) return { text: `${mins}m`, cls: "bg-amber-100 text-amber-700" };
    return { text: `${mins}m`, cls: "bg-red-100 text-red-700" };
}

// ─── Inventory type ──────────────────────────────────────────────────────

interface InventoryItem {
    id: string;
    clubId: string;
    name: string;
    unit: string;
    currentStock: number;
    minThreshold: number;
    notes: string;
    lastUpdated: Timestamp;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY POINT — PIN gate wrapper
// ═══════════════════════════════════════════════════════════════════════════

// Rotate prompt — shown via CSS when device is in portrait mode
function RotatePrompt() {
    return (
        <div className="landscape-rotate-prompt">
            <div style={{ fontSize: 72, marginBottom: 24, transform: "rotate(90deg)", display: "inline-block" }}>↻</div>
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Please Rotate Your Device</div>
            <div style={{ fontSize: 15, opacity: 0.7 }}>Kitchen display works in landscape mode</div>
        </div>
    );
}

export default function KitchenDisplay() {
    return <StationAccess role="kitchen">
        <div className="kitchen-landscape-root">
            <RotatePrompt />
            <KitchenApp onLock={() => { void signOut(auth); }} />
        </div>
    </StationAccess>;
}
// ═══════════════════════════════════════════════════════════════════════════
// MAIN KITCHEN APP
// ═══════════════════════════════════════════════════════════════════════════

type Tab = "orders" | "specials" | "stock" | "request";

function KitchenApp({ onLock }: { onLock: () => void }) {
    const { club } = useClubContext();
    const [tab, setTab] = useState<Tab>("orders");
    const [clock, setClock] = useState(new Date());
    const [accountants, setAccountants] = useState<any[]>([]);
    const [todaysItemsForRequest, setTodaysItemsForRequest] = useState<{ id: string; name: string; imageUrl?: string; emoji?: string }[]>([]);

    // Fetch accountants for verification flows
    useEffect(() => {
        if (!club?.id) return;
        const unsub = onSnapshot(collection(db, 'clubs', club.id, 'accountants'), snap => {
            setAccountants(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, [club?.id]);

    // Fetch today's specials for request tab
    useEffect(() => {
        if (!club?.id) return;
        const todayStr = new Date().toISOString().slice(0, 10);
        const q = query(
            collection(db, 'clubs', club.id, 'todaysSpecial'),
            where('isActive', '==', true),
            where('date', '==', todayStr)
        );
        const unsub = onSnapshot(q, snap => {
            setTodaysItemsForRequest(snap.docs.map(d => {
                const data = d.data();
                return {
                    id: data.itemId || d.id,
                    name: data.itemName || data.name || '',
                    imageUrl: data.imageUrl || undefined,
                    emoji: data.itemEmoji || undefined,
                };
            }));
        });
        return () => unsub();
    }, [club?.id]);

    useEffect(() => {
        const t = setInterval(() => setClock(new Date()), 1000);
        return () => clearInterval(t);
    }, []);

    // Midnight auto-reset: DELETE old todaysSpecial docs (not from today)
    useEffect(() => {
        if (!club?.id) return;
        const scheduleReset = () => {
            const now = new Date();
            const midnight = new Date();
            midnight.setHours(24, 0, 5, 0); // 5s after midnight
            const msUntilMidnight = midnight.getTime() - now.getTime();

            const timer = setTimeout(async () => {
                try {
                    const todayStr = new Date().toISOString().slice(0, 10);
                    // 1. Clear yesterday's specials
                    const q = query(
                        collection(db, 'clubs', club.id, 'todaysSpecial'),
                        where('isActive', '==', true),
                    );
                    const snap = await getDocs(q);
                    const batch = writeBatch(db);
                    snap.docs.forEach((d) => {
                        if (d.data().date !== todayStr) {
                            batch.delete(d.ref);
                        }
                    });
                    await batch.commit();

                    // 2. Apply weekly schedule for the new day
                    const schedSnap = await getDoc(doc(db, 'clubs', club.id, 'settings', 'weeklySchedule'));
                    if (schedSnap.exists()) {
                        const schedule = schedSnap.data() as WeeklySchedule;
                        await applyWeeklyScheduleForDay(club.id, todayDayKey(), schedule);
                    }
                } catch (err) {
                    console.error('[Kitchen] midnight reset error:', err);
                }
                scheduleReset(); // reschedule for next midnight
            }, msUntilMidnight);
            return timer;
        };

        const timer = scheduleReset();
        return () => clearTimeout(timer);
    }, [club?.id]);

    const { orders, loading } = useKitchenOrders();
    // Only the orders view is swapped. Specials, stock and the schedule are
    // unchanged and still reachable on either version, and the club can put
    // this back from Admin → App Version without a deploy.
    const { version: kitchenVersion } = useAppVersion("kitchen");
    const pendingCount = orders.filter((o) => o.status === "pending" || o.status === "preparing").length;

    const dateStr = clock.toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
    const timeStr = clock.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

    const tabs: { key: Tab; label: string }[] = [
        { key: "orders", label: "ORDERS" },
        { key: "stock", label: "STOCK" },
        { key: "request", label: "REQUEST" },
        { key: "specials", label: "TODAY'S SPECIAL" },
    ];

    return (
        <div className="min-h-screen flex flex-col font-sans" style={{ minHeight: '100svh' }}>
            <div className="kitchen-header">
                <div className="flex items-center gap-3">
                    <span className="text-3xl">🍳</span>
                    <div className="kitchen-header-title">{club?.name || "Kitchen"}</div>
                </div>
                <div className="kitchen-clock">{timeStr}</div>
            </div>
            <div className="kitchen-stats-bar">
                <div>{dateStr}</div>
                <div>{pendingCount} pending orders</div>
            </div>

            <div className="kitchen-body flex-1">
                <div className="kitchen-tabs">
                    {tabs.map((t) => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`kitchen-tab ${tab === t.key ? "active" : ""}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {tab === "orders" && (
                    kitchenVersion === "new"
                        ? <KitchenOrdersNew orders={orders} loading={loading} clubId={club?.id ?? ""} />
                        : <OrdersTab orders={orders} loading={loading} clubId={club?.id ?? ""} />
                )}
                {tab === "stock" && club?.id && <KitchenStockDashboard clubId={club.id} />}
                {tab === "request" && club?.id && (
                    <KitchenStockRequest
                        todaysItems={todaysItemsForRequest}
                        requestedBy="Kitchen"
                        clubId={club.id}
                        verifiers={accountants}
                        onClose={() => setTab("stock")}
                        onSuccess={() => setTab("stock")}
                    />
                )}
                {tab === "specials" && <SpecialsTab clubId={club?.id ?? ""} />}
            </div>

            <button
                onClick={onLock}
                className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/90 backdrop-blur border text-xs font-bold text-gray-500 hover:text-red-600 hover:border-red-200 transition-colors shadow-sm"
                style={{ borderColor: "#e0f0e9" }}
            >
                <Lock className="w-3.5 h-3.5" /> Lock
            </button>

            {/* Kitchen Magician — voice commands for marking served / rejecting / queries */}
            {club?.id && <KitchenMagicianButton clubId={club.id} orders={orders.filter((o) => o.status === "pending" || o.status === "preparing")} />}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1: ORDERS + DAILY INSIGHTS DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

function OrdersTab({ orders, loading, clubId }: { orders: Order[]; loading: boolean; clubId: string }) {
    const updateStatus = useUpdateOrderStatus();
    const rejectOrder = useRejectOrder();
    const { orders: rejectedOrders } = useTodayRejectedOrders();
    const [showRejected, setShowRejected] = useState(false);
    const [rejectingOrder, setRejectingOrder] = useState<Order | null>(null);
    const [rejectReason, setRejectReason] = useState("");
    const [orderSearch, setOrderSearch] = useState("");
    const prevCountRef = useRef(orders.length);
    const { summary, orders: allTodayOrders } = useTodayOrdersSummary();
    const { specials } = useTodaysSpecials(clubId || null);
    const { club } = useClubContext();
    const { toast } = useToast();

    // Sound on new order arriving
    useEffect(() => {
        if (!loading && orders.length > prevCountRef.current) {
            playNewOrder();
        }
        prevCountRef.current = orders.length;
    }, [orders.length, loading]);

    const activeOrders = orders.filter((o) => o.status === "pending" || o.status === "preparing");
    const orderQuery = orderSearch.trim().toLowerCase();
    // One matcher for both lists, so a name finds the person whether their
    // shake is still waiting or was served an hour ago.
    const matchesQuery = (o: any) => {
        if (!orderQuery) return true;
        const hay = [
            o.memberName,
            o.memberPhone, o.phone, o.humanMemberId,
            o.memberId, o.tokenNumber, o.id,
            ...(((o.items as any[]) || []).map((i: any) => i.productName || i.itemName)),
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(orderQuery);
    };
    const filteredOrders = activeOrders.filter(matchesQuery);
    // Pin guest / first-day orders to the top (stable sort preserves the
    // createdAt order — oldest first — within each group).
    const visibleOrders = [...filteredOrders].sort((a, b) => pinRank(a) - pinRank(b));

    const handleStatus = useCallback((orderId: string, currentStatus: string) => {
        updateStatus.mutate({ clubId, orderId, newStatus: "served" });
        playOrderReady();
    }, [updateStatus, clubId]);

    const openRejectModal = useCallback((order: Order) => {
        if (rejectOrder.isPending) return;
        setRejectReason("");
        setRejectingOrder(order);
    }, [rejectOrder.isPending]);

    const confirmReject = useCallback(async () => {
        if (!rejectingOrder) return;
        const order = rejectingOrder;
        try {
            const result = await rejectOrder.mutateAsync({
                clubId,
                orderId: order.id,
                rejectedBy: "Kitchen",
                reason: rejectReason,
            });
            toast({
                title: "Order rejected",
                description: result.shakeCreditsRefunded > 0
                    ? `${result.shakeCreditsRefunded} shake credit${result.shakeCreditsRefunded > 1 ? "s" : ""} refunded to ${order.memberName}.`
                    : `Stock restored. No credits to refund (${(order as any).paymentMethod || "non-credit order"}).`,
            });

            // Auto-print refund slip — gives the member proof their credit
            // was returned, so kitchen-side cancellations leave a paper trail.
            try {
                fetchClubAndPrint(clubId, (freshClub) => buildOrderRefundSlip({
                    club: freshClub,
                    memberName: order.memberName || 'Unknown',
                    memberId: (order as any).memberId,
                    items: (order.items as any[]).map(i => ({
                        name: i.productName || i.itemName || 'Item',
                        qty: i.quantity || i.qty || 1,
                    })),
                    rejectedBy: 'Kitchen',
                    rejectReason: rejectReason || undefined,
                    refund: { shakeCredits: result.shakeCreditsRefunded ?? 0 },
                    refNumber: generateTxnId(),
                    timestamp: new Date(),
                }));
            } catch (printErr) {
                console.error('[refund slip print]', printErr);
            }

            setRejectingOrder(null);
            setRejectReason("");
        } catch (err: any) {
            toast({
                title: "Failed to reject",
                description: err?.message ?? "Unknown error",
                variant: "destructive",
            });
        }
    }, [rejectingOrder, rejectOrder, clubId, rejectReason, toast]);

    // Per-product counts split by pending vs served
    // Key by productId if available, fall back to productName (reception orders may lack productId)
    const activeSpecialsList = Object.values(specials).filter(s => s.isActive);

    const perProductCounts: Record<string, { name: string; pending: number; served: number }> = {};
    allTodayOrders.filter(o => o.status !== "cancelled").forEach((o) => {
        const isServed = o.status === "served";
        (o.items as any[]).forEach((item) => {
            const key = (item.productId && item.productId !== '') ? item.productId : (item.productName || item.itemName || 'unknown');
            const name = item.productName || item.itemName || 'Shake';
            const qty = item.quantity || item.qty || 1;
            if (!perProductCounts[key]) {
                perProductCounts[key] = { name, pending: 0, served: 0 };
            }
            if (isServed) perProductCounts[key].served += qty;
            else perProductCounts[key].pending += qty;
        });
    });

    // Build bucket list: specials first (matched by id or name), then any remaining from orders
    const bucketList: { key: string; name: string }[] = [];
    const usedKeys = new Set<string>();
    activeSpecialsList.forEach(s => {
        // match by id, or by name fallback
        const nameKey = Object.keys(perProductCounts).find(k => perProductCounts[k].name === s.itemName);
        const key = perProductCounts[s.itemId] ? s.itemId : (nameKey ?? s.itemId);
        bucketList.push({ key, name: s.itemName });
        usedKeys.add(key);
    });
    // Add any ordered products not in today's special (e.g. ordered before special was set)
    Object.entries(perProductCounts).forEach(([key, val]) => {
        if (!usedKeys.has(key)) bucketList.push({ key, name: val.name });
    });

    // Both totals sum shake QUANTITIES (not order counts) so that the big
    // header tiles always match the per-shake-type buckets above them.
    // Cancelled orders are excluded from served (filter applied below).
    const sumQty = (list: any[]) =>
        list.reduce((s, o) => s + ((o.items as any[])?.reduce((si, i) => si + (i.quantity || i.qty || 1), 0) || 0), 0);
    const totalPending = sumQty(activeOrders);
    const totalServed = sumQty(allTodayOrders.filter(o => o.status === "served"));

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

            {/* ─── STICKY STATS BUCKETS ─── */}
            <div style={{
                position: "sticky", top: 0, zIndex: 10,
                background: "linear-gradient(135deg,#1a3a2a,#2d9653)",
                padding: "10px 14px",
                display: "flex", gap: 8, alignItems: "stretch", flexWrap: "nowrap", overflowX: "auto",
            }}>
                {/* Total Pending */}
                <div style={{ background: "#fef3c7", borderRadius: 12, padding: "10px 14px", textAlign: "center", minWidth: 80, flexShrink: 0 }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: "#92400e" }}>{totalPending}</div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#92400e", textTransform: "uppercase", marginTop: 2 }}>⏳ Pending</div>
                </div>

                {/* Per-shake buckets */}
                {bucketList.map(bucket => {
                    const counts = perProductCounts[bucket.key] ?? { pending: 0, served: 0 };
                    const flavor = getFlavorStyle(bucket.name);
                    // Short display name: first 2 words max
                    const shortName = bucket.name.split(" ").slice(0, 2).join(" ");
                    return (
                        <div key={bucket.key} style={{ borderRadius: 12, overflow: "hidden", minWidth: 110, flexShrink: 0 }}>
                            <div style={{ background: flavor.gradient, padding: "5px 10px", textAlign: "center" }}>
                                <span style={{ fontSize: 13, color: "white", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                                    <span>{flavor.emoji}</span>
                                    <span>{shortName}</span>
                                </span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "rgba(255,255,255,0.15)" }}>
                                <div style={{ padding: "6px 4px", textAlign: "center", borderRight: "1px solid rgba(255,255,255,0.2)" }}>
                                    <div style={{ fontSize: 20, fontWeight: 900, color: "#fef3c7" }}>{counts.pending}</div>
                                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.7)", textTransform: "uppercase" }}>Pending</div>
                                </div>
                                <div style={{ padding: "6px 4px", textAlign: "center" }}>
                                    <div style={{ fontSize: 20, fontWeight: 900, color: "#d1fae5" }}>{counts.served}</div>
                                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.7)", textTransform: "uppercase" }}>Served</div>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* Print + Total Served */}
                <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexShrink: 0 }}>
                    <div style={{ background: "#d1fae5", borderRadius: 12, padding: "10px 14px", textAlign: "center", minWidth: 80 }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#065f46" }}>{totalServed}</div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: "#065f46", textTransform: "uppercase", marginTop: 2 }}>✅ Served</div>
                    </div>
                    <button
                        onClick={() => {
                            if (!club?.id) return;
                            const productRows = activeSpecialsList.map(s => ({
                                name: s.itemName,
                                qty: (perProductCounts[s.itemId]?.pending ?? 0) + (perProductCounts[s.itemId]?.served ?? 0),
                            }));
                            fetchClubAndPrint(club.id, (freshClub) =>
                                buildKitchenDailyReceipt({
                                    club: freshClub,
                                    date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
                                    totalShakes: summary.totalOrders,
                                    completedOrders: summary.statusCounts.served ?? 0,
                                    pendingOrders: summary.statusCounts.pending ?? 0,
                                    totalRevenue: summary.totalRevenue,
                                    productBreakdown: productRows,
                                })
                            );
                        }}
                        style={{ background: "rgba(255,255,255,0.2)", color: "white", border: "none", borderRadius: 12, padding: "10px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
                    >
                        <Printer style={{ width: 16, height: 16 }} />
                        <span style={{ fontSize: 9 }}>PRINT</span>
                    </button>
                    {/* Batch token reprint — re-issues a token slip for every
                         pending order, useful after a printer jam or paper-out. */}
                    <button
                        title="Reprint tokens for all pending orders"
                        onClick={() => {
                            if (!club?.id) return;
                            if (activeOrders.length === 0) {
                                toast({ title: "Nothing to reprint", description: "No pending orders." });
                                return;
                            }
                            for (const o of activeOrders) {
                                const printedName = o.memberName || 'Unknown';
                                const tokenNumber = (o as any).tokenNumber || generateTxnId().slice(-3);
                                const timestamp = o.createdAt?.toDate?.() ?? new Date();
                                const items = (o.items as any[]).map(i => ({
                                    name: i.productName || i.itemName || 'Shake',
                                    qty: i.quantity || i.qty || 1,
                                    ice: i.notes || undefined,
                                }));
                                printShakeAndAfresh(club.id, {
                                    shake: buildShakeTokenReceipt({
                                        memberName: printedName,
                                        items,
                                        tokenNumber,
                                        timestamp,
                                    }),
                                    afresh: buildAfreshToken({
                                        memberName: printedName,
                                        tokenNumber,
                                        timestamp,
                                    }),
                                });
                            }
                            toast({ title: `Reprinted ${activeOrders.length} token${activeOrders.length === 1 ? '' : 's'}` });
                        }}
                        style={{ background: "rgba(255,255,255,0.2)", color: "white", border: "none", borderRadius: 12, padding: "10px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
                    >
                        <Printer style={{ width: 16, height: 16 }} />
                        <span style={{ fontSize: 9 }}>REPRINT TOKENS</span>
                    </button>
                </div>
            </div>

            {/* ─── SCROLLABLE ORDERS AREA ─── */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
                {/* Search — sticky.
                    It used to scroll away with the orders, so on a busy screen
                    it was off the top exactly when the kitchen needed it and
                    looked as though there was no search at all. It now stays
                    pinned, and it filters today's served list further down as
                    well as the live cards. */}
                {!loading && (
                    <div style={{
                        position: "sticky", top: -14, zIndex: 30,
                        margin: "-14px -14px 12px", padding: "14px 14px 10px",
                        background: "#f9fafb", borderBottom: "1px solid #eef2f7",
                    }}>
                        <input
                            value={orderSearch}
                            onChange={(e) => setOrderSearch(e.target.value)}
                            placeholder="🔍 Search by name, phone, member ID, token or flavour…"
                            style={{ width: "100%", padding: "14px 18px", borderRadius: 12, border: "2px solid #d1d5db", fontSize: 16, fontFamily: FONT, boxSizing: "border-box", outline: "none", fontWeight: 600 }}
                        />
                        {orderQuery && (
                            <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#6b7280", display: "flex", alignItems: "center", gap: 10 }}>
                                <span>{visibleOrders.length} of {activeOrders.length} waiting</span>
                                <button
                                    onClick={() => setOrderSearch("")}
                                    style={{ background: "none", border: "none", color: "#2d9653", fontWeight: 800, cursor: "pointer", fontFamily: FONT, fontSize: 12 }}
                                >Clear ✕</button>
                            </div>
                        )}
                    </div>
                )}
                {/* Active Orders Grid */}
                {loading ? (
                    <div className="orders-grid">
                        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
                    </div>
                ) : activeOrders.length === 0 ? (
                    <div className="kitchen-empty">
                        <div className="kitchen-empty-icon">✅</div>
                        <h3>All Caught Up</h3>
                        <p>No pending orders right now</p>
                        <p>Kitchen is ready for next order</p>
                    </div>
                ) : visibleOrders.length === 0 ? (
                    <div className="kitchen-empty">
                        <div className="kitchen-empty-icon">🔍</div>
                        <h3>No matches</h3>
                        <p>No pending orders match "{orderSearch}"</p>
                    </div>
                ) : (
                    <div className="orders-grid">
                        {visibleOrders.map((o) => (
                            <OrderCard
                                key={o.id}
                                order={o}
                                onAction={() => handleStatus(o.id, o.status)}
                                onReject={() => openRejectModal(o)}
                                isUpdating={updateStatus.isPending}
                                isRejecting={rejectOrder.isPending}
                                specials={specials}
                            />
                        ))}
                    </div>
                )}

                {/* ─── Rejected Today (collapsible) ─── */}
                {rejectedOrders.length > 0 && (
                    <div style={{
                        marginTop: 16,
                        background: "white",
                        borderRadius: 18,
                        border: "1.5px solid #fecaca",
                        overflow: "hidden",
                    }}>
                        <button
                            onClick={() => setShowRejected(v => !v)}
                            style={{
                                width: "100%",
                                display: "flex", alignItems: "center", gap: 8,
                                padding: "12px 16px",
                                background: "#fef2f2",
                                border: "none",
                                fontFamily: FONT,
                                cursor: "pointer",
                            }}
                        >
                            <span style={{ fontSize: 18 }}>🚫</span>
                            <span style={{ fontWeight: 800, fontSize: 14, color: "#991b1b" }}>
                                Rejected today
                            </span>
                            <span style={{ marginLeft: "auto", fontSize: 12, color: "#991b1b", fontWeight: 700 }}>
                                {rejectedOrders.length} {showRejected ? "▼" : "▶"}
                            </span>
                        </button>
                        {showRejected && (
                            <div style={{ display: "flex", flexDirection: "column" }}>
                                {rejectedOrders.map((o, idx) => {
                                    const timeStr = (o.rejectedAt as any)?.toDate?.()?.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                                        ?? (o.createdAt as any)?.toDate?.()?.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                                        ?? "";
                                    const itemsLabel = (o.items as any[])
                                        .map(i => `${i.productName || i.itemName || "item"}×${i.quantity || i.qty || 1}`)
                                        .join(", ");
                                    const refund = (o as any).refund;
                                    return (
                                        <div key={o.id} style={{
                                            display: "flex", alignItems: "flex-start", gap: 12,
                                            padding: "10px 16px",
                                            borderBottom: idx < rejectedOrders.length - 1 ? "1px solid #fee2e2" : "none",
                                        }}>
                                            <div style={{ width: 58, height: 58, borderRadius: 10, overflow: "hidden", flexShrink: 0, border: "2px solid #fecaca", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                {o.memberPhoto
                                                    ? <img src={o.memberPhoto} alt={o.memberName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                    : <span style={{ fontSize: 26 }}>👤</span>}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 13, fontWeight: 800, color: "#991b1b", display: "flex", alignItems: "center", gap: 6 }}>
                                                    {o.memberName}
                                                    <span style={{ fontSize: 10, fontWeight: 700, color: "#7f1d1d", background: "#fecaca", padding: "1px 6px", borderRadius: 99 }}>
                                                        {timeStr}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{itemsLabel}</div>
                                                {o.rejectReason && (
                                                    <div style={{ fontSize: 11, color: "#7f1d1d", fontStyle: "italic", marginTop: 2 }}>
                                                        "{o.rejectReason}"
                                                    </div>
                                                )}
                                                {refund && (
                                                    <div style={{ fontSize: 10, color: "#059669", fontWeight: 700, marginTop: 2 }}>
                                                        ✓ Refunded: {refund.shakeCredits} credits
                                                        {refund.kitchenStockRestored ? " · kitchen restored" : ""}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

            {/* ─── Today's Order Log ─── */}
            {allTodayOrders.length > 0 && (
                <div style={{
                    background: "white",
                    borderRadius: 18,
                    border: "1.5px solid #e8f5ee",
                    overflow: "hidden",
                    marginTop: 4,
                }}>
                    <div style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "12px 16px",
                        borderBottom: "1.5px solid #e8f5ee",
                        background: "#f8fffe",
                    }}>
                        <ChefHat style={{ width: 16, height: 16, color: GREEN }} />
                        <span style={{ fontWeight: 800, fontSize: 14, color: GREEN }}>Today's Order Log</span>
                        <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280", fontWeight: 600 }}>
                            {orderQuery ? allTodayOrders.filter(matchesQuery).length + " of " + allTodayOrders.length : allTodayOrders.length} orders
                        </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                        {[...allTodayOrders].filter(matchesQuery)
                            .sort((a, b) => {
                                const at = (a.createdAt as any)?.toDate?.()?.getTime() ?? 0;
                                const bt = (b.createdAt as any)?.toDate?.()?.getTime() ?? 0;
                                return bt - at;
                            })
                            .map((o, idx) => {
                                const timeStr = (o.createdAt as any)?.toDate?.()?.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) ?? "";
                                const isServed = o.status === "served";
                                return (
                                    <div key={o.id} style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 12,
                                        padding: "10px 16px",
                                        borderBottom: idx < allTodayOrders.length - 1 ? "1px solid #f0fdf4" : "none",
                                        background: isServed ? "white" : "#fffbeb",
                                    }}>
                                        {/* Member photo */}
                                        <div style={{ width: 76, height: 76, borderRadius: 12, overflow: "hidden", flexShrink: 0, border: "2px solid #d8f3dc", background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            {o.memberPhoto ? (
                                                <img src={o.memberPhoto} alt={o.memberName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                            ) : (
                                                <span style={{ fontSize: 32, color: "#2d9653" }}>👤</span>
                                            )}
                                        </div>
                                        {/* Member + items */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                <span style={{ fontWeight: 800, fontSize: 13, color: "#1a3a2a" }}>
                                                    {o.memberName || "—"}
                                                </span>
                                                <span style={{
                                                    fontSize: 11, fontWeight: 700,
                                                    padding: "1px 7px", borderRadius: 99,
                                                    background: isServed ? "#d8f3dc" : "#fef3c7",
                                                    color: isServed ? GREEN : "#92400e",
                                                }}>
                                                    {isServed ? "✓ Served" : "⏳ Pending"}
                                                </span>
                                                <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: "auto" }}>{timeStr}</span>
                                            </div>
                                            <div style={{ fontSize: 12, color: "#4b5563", marginTop: 2, lineHeight: 1.5 }}>
                                                {o.items.map((item, i) => (
                                                    <span key={i}>
                                                        {i > 0 && <span style={{ color: "#d1d5db" }}> · </span>}
                                                        {item.productName} ×{item.quantity}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        {/* Total + Serve button */}
                                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                                            <div style={{ fontWeight: 800, fontSize: 13, color: GREEN }}>
                                                ₹{o.totalCost}
                                            </div>
                                            {!isServed && (
                                                <button
                                                    onClick={() => handleStatus(o.id, o.status)}
                                                    disabled={updateStatus.isPending}
                                                    style={{
                                                        background: GREEN,
                                                        color: "white",
                                                        border: "none",
                                                        borderRadius: 8,
                                                        padding: "5px 14px",
                                                        fontSize: 12,
                                                        fontWeight: 800,
                                                        cursor: "pointer",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    ✓ Serve
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}
            </div>

            {/* ─── Reject confirmation modal (replaces window.confirm/prompt) ─── */}
            {rejectingOrder && (
                <div
                    style={{
                        position: "fixed", inset: 0, zIndex: 80,
                        background: "rgba(0,0,0,0.55)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: 16,
                        fontFamily: FONT,
                    }}
                    onClick={() => !rejectOrder.isPending && setRejectingOrder(null)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: "white",
                            borderRadius: 20,
                            width: "100%",
                            maxWidth: 420,
                            padding: 22,
                            boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                            <div style={{ fontSize: 28 }}>🚫</div>
                            <div>
                                <div style={{ fontWeight: 900, fontSize: 18, color: "#991b1b" }}>Reject order?</div>
                                <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700, marginTop: 2 }}>
                                    {rejectingOrder.memberName}
                                </div>
                            </div>
                        </div>

                        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "10px 12px", marginTop: 4, fontSize: 12, color: "#7f1d1d", lineHeight: 1.55 }}>
                            {(rejectingOrder.items as any[])
                                .map((i) => `${i.productName || i.itemName || "item"} ×${i.quantity || i.qty || 1}`)
                                .join(" · ")}
                        </div>

                        <div style={{ marginTop: 14, fontSize: 12, color: "#4b5563", fontWeight: 600, lineHeight: 1.55 }}>
                            This will refund shake credits and restore today's-special + menu stock. Kitchen stock is only restored if this order was already served (it isn't, for pending orders).
                        </div>

                        <label style={{ display: "block", marginTop: 14 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                                Reason (optional)
                            </div>
                            <textarea
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="e.g. duplicate order, wrong flavour"
                                rows={2}
                                autoFocus
                                style={{
                                    width: "100%",
                                    padding: "10px 12px",
                                    borderRadius: 10,
                                    border: "1.5px solid #e5e7eb",
                                    fontFamily: FONT,
                                    fontSize: 13,
                                    outline: "none",
                                    resize: "none",
                                    boxSizing: "border-box",
                                }}
                            />
                        </label>

                        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                            <button
                                onClick={() => setRejectingOrder(null)}
                                disabled={rejectOrder.isPending}
                                style={{
                                    flex: 1, padding: "12px",
                                    background: "#f1f5f9", color: "#475569",
                                    border: "none", borderRadius: 12,
                                    fontSize: 14, fontWeight: 800,
                                    cursor: rejectOrder.isPending ? "not-allowed" : "pointer",
                                    fontFamily: FONT,
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmReject}
                                disabled={rejectOrder.isPending}
                                style={{
                                    flex: 2, padding: "12px",
                                    background: "#dc2626", color: "white",
                                    border: "none", borderRadius: 12,
                                    fontSize: 14, fontWeight: 900,
                                    cursor: rejectOrder.isPending ? "not-allowed" : "pointer",
                                    fontFamily: FONT,
                                }}
                            >
                                {rejectOrder.isPending ? "Rejecting…" : "Reject & Refund"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Priority-order helper ──────────────────────────────────────────────────
// Guest and First-Day shakes get pinned to the top of the kitchen queue so
// walk-ins / new prospects are never left waiting behind regular members.
type PinKind = "firstday" | "guest" | null;
function orderPinKind(o: Order): PinKind {
    const items = (o.items as any[]) || [];
    const isFirstDay = items.some((i) =>
        i.productId === "first_day_shake" ||
        String(i.productName || i.itemName || "").toLowerCase().includes("first day"));
    if (isFirstDay) return "firstday";
    const isGuest = (o as any).source === "guest" || (o as any).orderedFrom === "guest" || o.memberId === "guest";
    if (isGuest) return "guest";
    return null;
}
const pinRank = (o: Order) => { const k = orderPinKind(o); return k === "firstday" ? 0 : k === "guest" ? 1 : 2; };

// ─── Flavor style helper ────────────────────────────────────────────────────
function getFlavorStyle(name: string): { gradient: string; emoji: string; accent: string } {
    const n = (name || "").toLowerCase();
    if (n.includes("mango")) return { gradient: "linear-gradient(135deg,#f59e0b,#d97706)", emoji: "🥭", accent: "#92400e" };
    if (n.includes("strawberry")) return { gradient: "linear-gradient(135deg,#f43f5e,#e11d48)", emoji: "🍓", accent: "#9f1239" };
    if (n.includes("chocolate") || n.includes("choco")) return { gradient: "linear-gradient(135deg,#92400e,#78350f)", emoji: "🍫", accent: "#451a03" };
    if (n.includes("vanilla")) return { gradient: "linear-gradient(135deg,#d97706,#b45309)", emoji: "🍦", accent: "#451a03" };
    if (n.includes("rose") || n.includes("rosy") || n.includes("roski")) return { gradient: "linear-gradient(135deg,#ec4899,#db2777)", emoji: "🌹", accent: "#831843" };
    if (n.includes("orange")) return { gradient: "linear-gradient(135deg,#ea580c,#c2410c)", emoji: "🍊", accent: "#7c2d12" };
    if (n.includes("banana")) return { gradient: "linear-gradient(135deg,#eab308,#ca8a04)", emoji: "🍌", accent: "#713f12" };
    if (n.includes("kulfi")) return { gradient: "linear-gradient(135deg,#f97316,#ea580c)", emoji: "🍡", accent: "#7c2d12" };
    if (n.includes("paan") || n.includes("pan")) return { gradient: "linear-gradient(135deg,#16a34a,#15803d)", emoji: "🌿", accent: "#14532d" };
    if (n.includes("blueberry")) return { gradient: "linear-gradient(135deg,#7c3aed,#6d28d9)", emoji: "🫐", accent: "#2e1065" };
    if (n.includes("kesar") || n.includes("saffron")) return { gradient: "linear-gradient(135deg,#f59e0b,#d97706)", emoji: "🌼", accent: "#451a03" };
    if (n.includes("pineapple")) return { gradient: "linear-gradient(135deg,#eab308,#d97706)", emoji: "🍍", accent: "#713f12" };
    if (n.includes("coffee") || n.includes("mocha")) return { gradient: "linear-gradient(135deg,#78350f,#451a03)", emoji: "☕", accent: "#292524" };
    return { gradient: "linear-gradient(135deg,#2d9653,#15803d)", emoji: "🥤", accent: "#14532d" };
}

function OrderCard({ order, onAction, onReject, isUpdating, isRejecting, specials }: {
    order: Order;
    onAction: () => void;
    onReject: () => void;
    isUpdating: boolean;
    isRejecting: boolean;
    specials: Record<string, TodaysSpecialItem>;
}) {
    const timeStr = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";
    const isPending = order.status === "pending";
    const hasWithoutIce = order.items.some((item: any) => item.notes?.toLowerCase().includes("without ice"));

    // Use first item for card theming
    const mainItem = order.items[0];
    const flavor = getFlavorStyle(mainItem?.productName || "");
    // Use image from special if available
    const mainSpecial = specials[mainItem?.productId ?? ""];
    const bgImage = mainSpecial?.imageUrl;

    // Guest / first-day orders are pinned to the top and flagged with a ribbon + ring.
    const pinKind = orderPinKind(order);
    const pin = pinKind === "firstday"
        ? { label: "☀️ FIRST DAY", bg: "linear-gradient(135deg,#f59e0b,#d97706)", ring: "#f59e0b" }
        : pinKind === "guest"
            ? { label: "🧑‍🤝‍🧑 GUEST", bg: "linear-gradient(135deg,#7c3aed,#6d28d9)", ring: "#a78bfa" }
            : null;

    return (
        <div style={{
            borderRadius: 20, overflow: "hidden", position: "relative", fontFamily: FONT,
            boxShadow: pin
                ? `0 0 0 3px #fff, 0 0 0 6px ${pin.ring}, 0 8px 28px rgba(0,0,0,0.28)`
                : "0 4px 20px rgba(0,0,0,0.18)",
        }}>
            {/* Background gradient */}
            <div style={{ position: "absolute", inset: 0, background: flavor.gradient }} />
            {/* Pinned ribbon — guest / first-day */}
            {pin && (
                <div style={{
                    position: "relative", zIndex: 2, background: pin.bg, color: "white",
                    fontSize: 13, fontWeight: 900, letterSpacing: 0.5, textTransform: "uppercase",
                    padding: "6px 14px", display: "flex", alignItems: "center", gap: 6,
                }}>
                    <span style={{ fontSize: 12 }}>📌</span>
                    <span>{pin.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, opacity: 0.85 }}>PRIORITY</span>
                </div>
            )}
            {/* Optional background image with overlay */}
            {bgImage && (
                <>
                    <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
                </>
            )}

            {/* Content */}
            <div style={{ position: "relative", zIndex: 1, padding: "16px" }}>
                {/* Member section */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                    {/* Big member photo */}
                    <div style={{ width: 124, height: 124, borderRadius: 18, overflow: "hidden", flexShrink: 0, border: "3px solid rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(0,0,0,0.25)" }}>
                        {order.memberPhoto ? (
                            <img src={order.memberPhoto} alt={order.memberName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                            <span style={{ fontSize: 60 }}>👤</span>
                        )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "white", lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {order.memberName}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{timeStr}</div>
                            <OrderElapsedTimer createdAt={order.createdAt} />
                        </div>
                    </div>
                    {order.tokenNumber ? (
                        <div style={{
                            background: "rgba(255,255,255,0.95)",
                            color: flavor.accent,
                            borderRadius: 12,
                            padding: "6px 12px",
                            fontWeight: 900,
                            fontSize: 24,
                            lineHeight: 1,
                            minWidth: 56,
                            textAlign: "center",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                        }}>
                            #{order.tokenNumber}
                        </div>
                    ) : (
                        <div style={{ fontSize: 30 }}>{isPending ? "🟡" : "🔵"}</div>
                    )}
                </div>

                {/* Order items */}
                <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
                    {(order.items as any[]).map((item, i) => {
                        const itemFlavor = getFlavorStyle(item.productName || item.itemName || "");
                        const iceNote = (item.notes || "").toLowerCase();
                        const withoutIce = iceNote.includes("without ice") || iceNote.includes("no ice");
                        const withIce = iceNote.includes("with ice");
                        return (
                            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                                <span style={{ fontSize: 30, flexShrink: 0, marginTop: 2 }}>{itemFlavor.emoji}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 17, fontWeight: 900, color: "white", lineHeight: 1.25, wordBreak: "break-word" }}>
                                        {item.productName || item.itemName}
                                    </div>
                                    {(withoutIce || withIce) && (
                                        <div style={{ marginTop: 3, display: "inline-block", background: withoutIce ? "rgba(239,68,68,0.85)" : "rgba(59,130,246,0.85)", color: "white", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 99 }}>
                                            {withoutIce ? "🚫❄️ WITHOUT ICE" : "❄️ WITH ICE"}
                                        </div>
                                    )}
                                </div>
                                <span style={{ fontSize: 20, fontWeight: 900, color: "rgba(255,255,255,0.85)", flexShrink: 0 }}>×{item.quantity || item.qty || 1}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Action buttons — primary serve + secondary reject */}
                <div style={{ display: "flex", gap: 8 }}>
                    <button
                        onClick={onAction}
                        disabled={isUpdating || isRejecting}
                        style={{ flex: 1, padding: "14px", background: "rgba(255,255,255,0.92)", color: flavor.accent, border: "none", borderRadius: 12, fontSize: 15, fontWeight: 900, cursor: (isUpdating || isRejecting) ? "not-allowed" : "pointer", fontFamily: FONT }}
                    >
                        {isUpdating ? "Updating…" : "✅ Mark as Served"}
                    </button>
                    <button
                        onClick={onReject}
                        disabled={isUpdating || isRejecting}
                        title="Reject this order and refund credits"
                        style={{ width: 56, padding: "14px 0", background: "rgba(239,68,68,0.92)", color: "white", border: "none", borderRadius: 12, fontSize: 20, fontWeight: 900, cursor: (isUpdating || isRejecting) ? "not-allowed" : "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                        {isRejecting ? "…" : "✕"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// WEEKLY SCHEDULE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type DayKey = typeof DAYS[number];

function todayDayKey(): DayKey {
    return DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
}

interface WeeklyScheduleItem { id: string; name: string; category: string; imageUrl: string | null; emoji: string; }
type WeeklySchedule = Record<DayKey, WeeklyScheduleItem[]>;

async function applyWeeklyScheduleForDay(clubId: string, dayKey: DayKey, schedule: WeeklySchedule) {
    const items = schedule[dayKey] ?? [];
    if (items.length === 0) return;
    const todayStr = new Date().toISOString().split("T")[0];
    for (const item of items) {
        const docRef = doc(db, "clubs", clubId, "todaysSpecial", item.id);
        const existing = await getDoc(docRef);
        if (existing.exists() && existing.data().date === todayStr) {
            // Doc exists for today — re-activate if inactive (schedule overrides manual off)
            if (!existing.data().isActive) {
                await updateDoc(docRef, { isActive: true, updatedAt: serverTimestamp() });
            }
            continue;
        }
        // New day or first time — create fresh
        await setDoc(docRef, {
            itemId: item.id,
            itemName: item.name,
            itemEmoji: item.emoji,
            category: item.category,
            imageUrl: item.imageUrl,
            isActive: true,
            stockType: "unlimited",
            totalStock: null,
            remainingStock: null,
            date: todayStr,
            addedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2: TODAY'S SPECIAL — direct Firestore fetch using clubId prop
// ═══════════════════════════════════════════════════════════════════════════

interface SimpleProduct { id: string; name: string; category: string; imageUrl?: string | null; photo?: string | null; price?: number; }

const catEmoji = (cat: string) =>
    cat === "tea" ? "🍵" : cat === "shake" || cat === "drink" ? "🥤" : cat === "supplement" ? "💊" : cat === "snack" ? "🍿" : "🍽️";

function SpecialsTab({ clubId }: { clubId: string }) {
    const [products, setProducts] = useState<SimpleProduct[]>([]);
    const [productsLoading, setProductsLoading] = useState(true);
    const { specials, loading: specialsLoading } = useTodaysSpecials(clubId || null);
    const toggleSpecial = useToggleTodaysSpecial();
    const setStockType = useSetSpecialStockType();
    const setQuantity = useSetSpecialQuantity();

    // Weekly schedule state
    const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule>(() =>
        Object.fromEntries(DAYS.map(d => [d, []])) as WeeklySchedule
    );
    const [weeklyScheduleLoading, setWeeklyScheduleLoading] = useState(true);
    const [scheduleTab, setScheduleTab] = useState<DayKey>(todayDayKey());
    const [showSchedule, setShowSchedule] = useState(false);
    const [savingSchedule, setSavingSchedule] = useState(false);
    const autoAppliedRef = useRef(false);

    // Load weekly schedule from Firestore
    useEffect(() => {
        if (!clubId) return;
        (async () => {
            try {
                const snap = await getDoc(doc(db, "clubs", clubId, "settings", "weeklySchedule"));
                if (snap.exists()) {
                    const data = snap.data() as WeeklySchedule;
                    setWeeklySchedule(prev => ({ ...prev, ...data }));
                }
            } catch (err) {
                console.error("[SpecialsTab] load weekly schedule:", err);
            } finally {
                setWeeklyScheduleLoading(false);
            }
        })();
    }, [clubId]);

    // Auto-apply weekly schedule if today has no active specials
    useEffect(() => {
        if (!clubId || specialsLoading || weeklyScheduleLoading) return;
        if (autoAppliedRef.current) return;
        const activeToday = Object.values(specials).filter(s => s.isActive);
        if (activeToday.length === 0) {
            autoAppliedRef.current = true;
            applyWeeklyScheduleForDay(clubId, todayDayKey(), weeklySchedule).catch(console.error);
        }
    }, [clubId, specials, specialsLoading, weeklyScheduleLoading, weeklySchedule]);

    const saveWeeklySchedule = async () => {
        if (!clubId) return;
        setSavingSchedule(true);
        try {
            await setDoc(doc(db, "clubs", clubId, "settings", "weeklySchedule"), weeklySchedule);
            // Immediately apply today's schedule so it reflects right away
            await applyWeeklyScheduleForDay(clubId, todayDayKey(), weeklySchedule);
            autoAppliedRef.current = true;
        } catch (err) {
            console.error("[SpecialsTab] save weekly schedule:", err);
        } finally {
            setSavingSchedule(false);
        }
    };

    const toggleProductInDay = (day: DayKey, product: SimpleProduct) => {
        setWeeklySchedule(prev => {
            const current = prev[day] ?? [];
            const exists = current.some(p => p.id === product.id);
            return {
                ...prev,
                [day]: exists
                    ? current.filter(p => p.id !== product.id)
                    : [...current, { id: product.id, name: product.name, category: product.category, imageUrl: product.imageUrl ?? null, emoji: catEmoji(product.category) }],
            };
        });
    };

    // Direct Firestore fetch — no hooks, no orderBy, no where filters
    useEffect(() => {
        if (!clubId) return;
        let cancelled = false;
        (async () => {
            try {
                // 1. Club's own menu
                const clubSnap = await getDocs(collection(db, `clubs/${clubId}/menu`));
                const clubItems: SimpleProduct[] = clubSnap.docs.map(d => {
                    const data = d.data();
                    return { id: d.id, name: data.name ?? "Unnamed", category: data.category ?? "other", imageUrl: data.imageUrl ?? data.photo ?? null, price: data.price ?? 0 };
                });

                // 2. Global menu (active items shared across all clubs)
                const globalSnap = await getDocs(query(collection(db, "globalMenu"), where("isActive", "==", true)));
                const clubIds = new Set(clubItems.map(p => p.name.toLowerCase()));
                const globalItems: SimpleProduct[] = globalSnap.docs
                    .filter(d => !clubIds.has((d.data().name ?? "").toLowerCase()))
                    .map(d => {
                        const data = d.data();
                        return { id: d.id, name: data.name ?? "Unnamed", category: data.category ?? "other", imageUrl: data.imageUrl ?? null, price: data.price ?? 0 };
                    });

                if (!cancelled) {
                    const all = [...clubItems, ...globalItems].sort((a, b) => a.name.localeCompare(b.name));
                    setProducts(all);
                    setProductsLoading(false);
                }
            } catch (err) {
                console.error("[SpecialsTab] fetch products:", err);
                if (!cancelled) setProductsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [clubId]);

    const activeCount = Object.values(specials).filter(s => s.isActive).length;
    const dateDisplay = new Date().toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

    if (productsLoading || specialsLoading) {
        return (
            <div className="p-4 space-y-3">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
            </div>
        );
    }

    const handleToggle = async (p: SimpleProduct) => {
        if (!clubId) return;
        const currentData = specials[p.id] ?? null;
        await toggleSpecial.mutateAsync({
            clubId,
            item: { id: p.id, name: p.name, category: p.category, imageUrl: p.imageUrl ?? null, emoji: catEmoji(p.category) },
            currentData,
        });
    };

    const handleStockType = async (productId: string, type: "unlimited" | "limited") => {
        if (!clubId) return;
        await setStockType.mutateAsync({ clubId, itemId: productId, stockType: type, quantity: 10 });
    };

    const handleSetQuantity = async (productId: string, qty: number) => {
        if (!clubId) return;
        await setQuantity.mutateAsync({ clubId, itemId: productId, quantity: Math.max(1, qty) });
    };

    return (
        <div className="p-4 space-y-4" style={{ maxHeight: "calc(100vh - 160px)", overflowY: "auto" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                    <div style={{ fontWeight: 900, fontSize: 17, color: GREEN }}>TODAY'S SPECIAL</div>
                    <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{dateDisplay} · {activeCount} items active</div>
                </div>
                <Badge style={{ background: "#e6f7ed", color: GREEN }} className="text-xs font-bold">
                    {activeCount} / {products.length} active
                </Badge>
            </div>

            <p style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>
                Toggle items on/off and set stock for today. Resets automatically tomorrow.
            </p>

            {/* Item list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {products.map((product) => {
                    const specialData = specials[product.id] ?? null;
                    const isOn = specialData?.isActive ?? false;
                    const stockType = specialData?.stockType ?? "unlimited";
                    const remaining = specialData?.remainingStock ?? null;
                    const total = specialData?.totalStock ?? null;

                    return (
                        <div
                            key={product.id}
                            style={{
                                background: isOn ? "#f8fffe" : "white",
                                borderRadius: 14,
                                padding: "14px 16px",
                                border: `2px solid ${isOn ? GREEN : "#f0f0f0"}`,
                                transition: "border-color 0.2s, background 0.2s",
                            }}
                        >
                            {/* Item header */}
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                    <div style={{
                                        width: 36, height: 36, borderRadius: 10,
                                        background: "#e8f5ee",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        fontSize: 18, flexShrink: 0,
                                        overflow: "hidden",
                                    }}>
                                        {product.imageUrl
                                            ? <img src={product.imageUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                            : catEmoji(product.category)}
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 800, fontSize: 14, color: "#1a3a2a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {product.name}
                                        </div>
                                        <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>
                                            {product.category}
                                            {product.price ? ` · ₹${product.price}` : ""}
                                        </div>
                                    </div>
                                </div>

                                {/* Toggle */}
                                <button
                                    onClick={() => handleToggle(product)}
                                    style={{
                                        width: 52, height: 28, borderRadius: 99,
                                        background: isOn ? GREEN : "#e5e7eb",
                                        position: "relative", border: "none", cursor: "pointer",
                                        flexShrink: 0, transition: "background 0.2s", padding: 0,
                                    }}
                                >
                                    <div style={{
                                        position: "absolute", top: 3, left: isOn ? 26 : 3,
                                        width: 22, height: 22, borderRadius: "50%", background: "white",
                                        transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                                    }} />
                                    <span style={{
                                        position: "absolute", top: "50%",
                                        left: isOn ? 6 : "unset", right: isOn ? "unset" : 6,
                                        transform: "translateY(-50%)", fontSize: 9, fontWeight: 900,
                                        color: isOn ? "rgba(255,255,255,0.9)" : "#9ca3af",
                                    }}>
                                        {isOn ? "ON" : "OFF"}
                                    </span>
                                </button>
                            </div>

                            {/* Stock settings (visible when ON) */}
                            {isOn && (
                                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e8f5ee" }}>
                                    {/* Stock type radio */}
                                    <div style={{ display: "flex", gap: 20, marginBottom: 10 }}>
                                        {(["unlimited", "limited"] as const).map((type) => (
                                            <label key={type} style={{
                                                display: "flex", alignItems: "center", gap: 6,
                                                cursor: "pointer", fontSize: 13, fontWeight: 700,
                                                color: stockType === type ? GREEN : "#6b7280",
                                            }}>
                                                <input
                                                    type="radio"
                                                    name={`stock-${product.id}`}
                                                    value={type}
                                                    checked={stockType === type}
                                                    onChange={() => handleStockType(product.id, type)}
                                                    style={{ accentColor: GREEN }}
                                                />
                                                {type === "unlimited" ? "∞ Unlimited" : "🔢 Limited"}
                                            </label>
                                        ))}
                                    </div>

                                    {/* Quantity input + remaining (only for limited) */}
                                    {stockType === "limited" && (
                                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: "#3d405b" }}>Qty today:</span>
                                            <input
                                                type="number"
                                                min={1}
                                                defaultValue={total ?? 10}
                                                key={`qty-${product.id}-${total}`}
                                                onBlur={(e) => handleSetQuantity(product.id, Number(e.target.value))}
                                                style={{
                                                    width: 72, padding: "6px 10px",
                                                    border: "1.5px solid #d8f3dc", borderRadius: 8,
                                                    fontSize: 15, fontWeight: 700, textAlign: "center",
                                                    color: "#1a3a2a", fontFamily: FONT,
                                                }}
                                            />
                                            {remaining !== null && total !== null && (
                                                <div style={{
                                                    fontSize: 12, fontWeight: 700,
                                                    color: (remaining <= 3 && remaining > 0) ? "#c0392b" : remaining === 0 ? "#9ca3af" : GREEN,
                                                    background: (remaining <= 3 && remaining > 0) ? "#fde8e8" : remaining === 0 ? "#f0f0f0" : "#d8f3dc",
                                                    padding: "4px 10px", borderRadius: 99,
                                                    display: "inline-flex", alignItems: "center", gap: 4,
                                                    animation: remaining > 0 && remaining <= 3 ? "pulse 1.5s infinite" : "none",
                                                }}>
                                                    {remaining} / {total} remaining
                                                    {remaining === 0 && " · SOLD OUT"}
                                                    {remaining > 0 && remaining <= 3 && ` · Only ${remaining} left!`}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Stock badge for unlimited */}
                                    {stockType === "unlimited" && (
                                        <span style={{
                                            fontSize: 12, fontWeight: 700, color: GREEN,
                                            background: "#d8f3dc", padding: "3px 10px", borderRadius: 99,
                                        }}>
                                            ∞ Unlimited stock today
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                {products.length === 0 && (
                    <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
                        <CookingPot style={{ width: 40, height: 40, margin: "0 auto 12px", opacity: 0.4 }} />
                        <p style={{ fontWeight: 700, fontSize: 14 }}>No products found</p>
                        <p style={{ fontSize: 12, marginTop: 4 }}>Add products from the owner dashboard first</p>
                    </div>
                )}
            </div>

            {/* ─── Weekly Schedule Section ─── */}
            <div style={{ borderRadius: 16, border: "2px solid #e8f5ee", overflow: "hidden", marginTop: 8 }}>
                {/* Collapsible header */}
                <button
                    onClick={() => setShowSchedule(v => !v)}
                    style={{
                        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "14px 16px", background: showSchedule ? "#f0fdf4" : "white",
                        border: "none", cursor: "pointer", fontFamily: FONT,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 20 }}>📅</span>
                        <div style={{ textAlign: "left" }}>
                            <div style={{ fontWeight: 900, fontSize: 14, color: GREEN }}>Weekly Schedule</div>
                            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>
                                Auto-applied daily at midnight · tap to edit
                            </div>
                        </div>
                    </div>
                    <span style={{ fontSize: 18, color: GREEN, transform: showSchedule ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</span>
                </button>

                {showSchedule && (
                    <div style={{ padding: "16px", background: "#fafffe", borderTop: "1.5px solid #e8f5ee" }}>
                        {/* Day tabs */}
                        <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto" }}>
                            {DAYS.map(day => {
                                const count = weeklySchedule[day]?.length ?? 0;
                                const isToday = day === todayDayKey();
                                return (
                                    <button
                                        key={day}
                                        onClick={() => setScheduleTab(day)}
                                        style={{
                                            flexShrink: 0, padding: "6px 12px", borderRadius: 99, border: "none",
                                            background: scheduleTab === day ? GREEN : isToday ? "#e6f7ed" : "#f3f4f6",
                                            color: scheduleTab === day ? "white" : isToday ? GREEN : "#6b7280",
                                            fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: FONT,
                                        }}
                                    >
                                        {day.slice(0, 3).toUpperCase()} {count > 0 && `(${count})`}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Product checkboxes for selected day */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 280, overflowY: "auto" }}>
                            {products.map(product => {
                                const isChecked = (weeklySchedule[scheduleTab] ?? []).some(p => p.id === product.id);
                                return (
                                    <label
                                        key={product.id}
                                        style={{
                                            display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                                            borderRadius: 10, cursor: "pointer",
                                            background: isChecked ? "#f0fdf4" : "white",
                                            border: `1.5px solid ${isChecked ? GREEN : "#e5e7eb"}`,
                                            transition: "all 0.15s",
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => toggleProductInDay(scheduleTab, product)}
                                            style={{ accentColor: GREEN, width: 18, height: 18, flexShrink: 0 }}
                                        />
                                        <div style={{ width: 32, height: 32, borderRadius: 8, overflow: "hidden", background: "#e8f5ee", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>
                                            {product.imageUrl
                                                ? <img src={product.imageUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                : catEmoji(product.category)}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 800, fontSize: 13, color: "#1a3a2a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {product.name}
                                            </div>
                                            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{product.category}</div>
                                        </div>
                                        {isChecked && <span style={{ fontSize: 14, color: GREEN }}>✓</span>}
                                    </label>
                                );
                            })}
                            {products.length === 0 && (
                                <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "20px 0" }}>No products yet</p>
                            )}
                        </div>

                        {/* Save button */}
                        <button
                            onClick={saveWeeklySchedule}
                            disabled={savingSchedule}
                            style={{
                                marginTop: 14, width: "100%", padding: "12px",
                                background: savingSchedule ? "#9ca3af" : GREEN,
                                color: "white", border: "none", borderRadius: 12,
                                fontSize: 14, fontWeight: 900, cursor: savingSchedule ? "not-allowed" : "pointer",
                                fontFamily: FONT,
                            }}
                        >
                            {savingSchedule ? "Saving…" : "💾 Save Weekly Schedule"}
                        </button>
                        <p style={{ textAlign: "center", fontSize: 11, color: "#9ca3af", marginTop: 8, fontWeight: 600 }}>
                            Schedule auto-applies every day at midnight when today's menu is empty
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Global animation ────────────────────────────────────────────────────

const styleSheet = document.createElement("style");
styleSheet.textContent = `
@keyframes slideIn {
  from { opacity: 0; transform: translateY(-12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}`;
if (!document.querySelector("[data-kitchen-animations]")) {
    styleSheet.setAttribute("data-kitchen-animations", "");
    document.head.appendChild(styleSheet);
}
