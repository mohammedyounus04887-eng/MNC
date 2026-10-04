import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
    LayoutDashboard,
    Users,
    HandHeart,
    Wallet,
    ShoppingCart,
    UtensilsCrossed,
    Megaphone,
    ClipboardList,
    Trophy,
    Gift,
    Dumbbell,
    BarChart3,
    Settings,
    GitBranch,
    Package,
    CreditCard,
    Hash,
    CalendarDays,
    X,
    Lock,
    Home,
    QrCode,
    ScanLine,
    ShieldAlert,
    ClipboardCheck,
    Sun,
    ToggleRight,
} from "lucide-react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { usePinAccess } from "@/hooks/usePinAccess";
import { signOutUser } from "@/lib/auth";
import { usePendingTopupRequests } from "@/hooks/owner/useWallet";
import { Button } from "@/components/ui/button";

interface OwnerSidebarProps {
    /** Base URL path the admin section is mounted at (e.g. "/admin" or "/login") */
    base: string;
    open: boolean;
    onClose: () => void;
}

const NAV_ITEMS = [
    { label: "Today",        slug: "today",        icon: Sun },
    { label: "Dashboard",    slug: "dashboard",    icon: LayoutDashboard },
    { label: "Members",      slug: "members",      icon: Users },
    { label: "Scan Station", slug: "scan",         icon: ScanLine },
    { label: "Serve Station", slug: "serve",       icon: UtensilsCrossed },
    { label: "Member Cards", slug: "member-cards", icon: QrCode },
    { label: "Attendance",   slug: "attendance",   icon: CalendarDays },
    { label: "Volunteers",   slug: "volunteers",   icon: HandHeart },
    { label: "Wallet",       slug: "wallet",       icon: Wallet },
    { label: "Orders",       slug: "orders",       icon: ShoppingCart },
    { label: "Menu",         slug: "menu",         icon: UtensilsCrossed },
    { label: "Announcements",slug: "announcements",icon: Megaphone },
    { label: "Enquiries",    slug: "enquiries",    icon: ClipboardList },
    { label: "Memberships",  slug: "membership-plans",  icon: CreditCard },
    { label: "Virtual Numbers", slug: "virtual-numbers", icon: Hash },
    { label: "Inventory",    slug: "inventory",    icon: Package },
    { label: "Reports",      slug: "reports",      icon: BarChart3 },
    { label: "Data Check",   slug: "data-check",   icon: ShieldAlert },
    { label: "Feature Testing", slug: "testing",  icon: ClipboardCheck },
    { label: "BTC",          slug: "btc",          icon: Dumbbell },
    { label: "Awards",       slug: "awards",       icon: Trophy },
    { label: "Loyalty",      slug: "loyalty",      icon: Gift },
    { label: "Settings",     slug: "settings",     icon: Settings },
    { label: "App Version",  slug: "app-version",  icon: ToggleRight },
    { label: "Club Network", slug: "downline",      icon: GitBranch },
    { label: "Reviews",      slug: "reviews",      icon: BarChart3 },
] as const;

// Read from the theme variables so the sidebar follows whichever palette is
// active — the club theme when Admin is switched to new, the original
// otherwise — instead of holding its own copy of the colours.
const ACCENT = "hsl(var(--primary))";
const ACCENT_HOVER = "hsl(var(--secondary))";
const BORDER_COLOR = "hsl(var(--border))";

export default function OwnerSidebar({ base, open, onClose }: OwnerSidebarProps) {
    const location = useLocation();
    const navigate = useNavigate();
    const { club } = useClubContext();
    const { logout } = usePinAccess("admin");
    const { count: pendingWalletCount } = usePendingTopupRequests(club?.id ?? null);
    const [pendingReviews, setPendingReviews] = useState(0);

    useEffect(() => {
        const clubId = club?.id;
        if (!clubId) return;
        return onSnapshot(
            query(collection(db, 'clubs', clubId, 'reviews'), where('status', '==', 'pending')),
            snap => setPendingReviews(snap.size)
        );
    }, [club?.id]);

    async function handleLock() {
        logout(); // Clear admin PIN from localStorage
        try {
            await signOutUser(); // Sign out of Firebase Auth
        } catch {
            // Ignore sign-out errors — still navigate away
        }
        navigate("/login", { replace: true });
    }

    return (
        <>
            {/* Mobile overlay backdrop */}
            {open && (
                <div
                    className="fixed inset-0 z-20 bg-black/40 md:hidden"
                    onClick={onClose}
                    aria-hidden
                />
            )}

            {/* Sidebar panel */}
            <aside
                style={{
                    fontFamily: "var(--font-sans)",
                    borderRight: `1px solid ${BORDER_COLOR}`,
                    width: 240,
                    minWidth: 240,
                    flexShrink: 0,
                }}
                className={[
                    "fixed md:relative inset-y-0 left-0 z-30 h-full flex flex-col bg-card",
                    "transition-transform duration-300 ease-out",
                    open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
                ].join(" ")}
            >
                {/* Header */}
                <div
                    style={{ backgroundColor: ACCENT }}
                    className="px-5 py-4 flex items-center justify-between flex-shrink-0"
                >
                    <div className="flex items-center gap-3 min-w-0">
                        {club?.logo ? (
                            <img
                                src={club.logo}
                                alt={club.name}
                                className="h-9 w-9 rounded-xl object-cover border-2 border-white/30 flex-shrink-0"
                            />
                        ) : (
                            <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0 border-2 border-white/30">
                                <span className="text-white font-black text-base leading-none">
                                    {(club?.name ?? "C")[0].toUpperCase()}
                                </span>
                            </div>
                        )}
                        <div className="min-w-0">
                            <p className="text-white font-black text-sm leading-tight truncate">
                                {club?.name ?? "Club"}
                            </p>
                            <p className="text-white/70 text-[10px] font-semibold uppercase tracking-wider">
                                Owner Dashboard
                            </p>
                        </div>
                    </div>
                    {/* Mobile close button */}
                    <button
                        className="md:hidden p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0 ml-2"
                        onClick={onClose}
                        aria-label="Close sidebar"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
                    {NAV_ITEMS.map(({ label, slug, icon: Icon }) => {
                        const href = `${base}/${slug}`;
                        const active = location.pathname === href
                            || location.pathname.startsWith(`${href}/`);
                        return (
                            <Link
                                key={slug}
                                to={href}
                                onClick={onClose}
                                style={active
                                    ? { backgroundColor: ACCENT, color: "hsl(var(--card))" }
                                    : { color: "hsl(var(--foreground))" }
                                }
                                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors"
                                onMouseEnter={(e) => {
                                    if (!active) (e.currentTarget as HTMLAnchorElement).style.backgroundColor = ACCENT_HOVER;
                                }}
                                onMouseLeave={(e) => {
                                    if (!active) (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "";
                                }}
                            >
                                <Icon
                                    className="w-4 h-4 flex-shrink-0"
                                    style={{ color: active ? "hsl(var(--card))" : ACCENT }}
                                />
                                <span className="truncate flex-1">{label}</span>
                                {slug === "wallet" && pendingWalletCount > 0 && (
                                    <span
                                        className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-black leading-none pointer-events-none"
                                        style={{
                                            backgroundColor: active ? "rgba(255,255,255,0.3)" : "hsl(var(--destructive))",
                                            color: "hsl(var(--card))",
                                        }}
                                    >
                                        {pendingWalletCount}
                                    </span>
                                )}
                                {slug === "reviews" && pendingReviews > 0 && (
                                    <span
                                        className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-black leading-none pointer-events-none"
                                        style={{
                                            backgroundColor: active ? "rgba(255,255,255,0.3)" : "hsl(var(--destructive))",
                                            color: "hsl(var(--card))",
                                        }}
                                    >
                                        {pendingReviews}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                {/* Footer — lock */}
                <div
                    style={{ borderTop: `1px solid ${BORDER_COLOR}` }}
                    className="p-3 flex-shrink-0 space-y-2"
                >
                    {club && (
                        <p className="text-[10px] text-gray-400 font-medium px-2 truncate">
                            {club.domain || club.name}
                        </p>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start gap-2 text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 font-bold"
                        onClick={() => { onClose(); navigate("/"); }}
                    >
                        <Home className="w-4 h-4" />
                        Go to Home Screen
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start gap-2 text-gray-500 hover:text-red-600 hover:bg-red-50 font-bold"
                        onClick={handleLock}
                    >
                        <Lock className="w-4 h-4" />
                        Lock / Sign Out
                    </Button>
                </div>
            </aside>
        </>
    );
}
