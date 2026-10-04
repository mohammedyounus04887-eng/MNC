import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, Wallet, CalendarCheck, Scale, UserCircle, Bell, GitBranch } from "lucide-react";
import { useClubContext } from "@/lib/clubDetection";
import { useMyPendingRequest } from "@/hooks/useMemberWallet";
import { useAuth } from "@/lib/auth";
import InstallPrompt from "../InstallPrompt";
import { useAppVersion } from "@/lib/appVersion";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchClubMenu } from "@/hooks/useOrders";
import { useAfterPaint } from "@/hooks/useAfterPaint";

// Follows the theme variables so the member shell matches whichever palette
// is active, instead of holding its own copy of the club green.
const GREEN = "hsl(var(--primary))";

const NAV_ITEMS = [
    { label: "Home",      path: "/member/dashboard", icon: Home },
    { label: "Wallet",    path: "/member/wallet",    icon: Wallet },
    { label: "Attendance",path: "/member/attendance",icon: CalendarCheck },
    { label: "Weigh-In",  path: "/member/progress",  icon: Scale },
    { label: "Profile",   path: "/member/profile",   icon: UserCircle },
] as const;

interface MemberLayoutProps { children: ReactNode; }

export default function MemberLayout({ children }: MemberLayoutProps) {
    const { pathname } = useLocation();
    const { club } = useClubContext();
    const { userProfile } = useAuth();
    const { hasPending } = useMyPendingRequest();

    // Fetch the menu quietly, once the current screen has drawn itself.
    //
    // Ordering a shake is what most members open the app to do, and the menu is
    // small. Reading it in the background here means the order screen has its
    // items in hand before the member has finished tapping — the request is
    // already done rather than starting when they arrive. It also seeds the
    // stored copy, so the very first visit on a new phone is the only one that
    // ever waits.
    const qc = useQueryClient();
    const idle = useAfterPaint();
    useEffect(() => {
        if (!idle || !club?.id) return;
        void prefetchClubMenu(qc, club.id);
    }, [idle, club?.id, qc]);
    // Switched to "new", the whole member app moves onto the club theme —
    // including the pages not yet rebuilt, because the palette lives in CSS
    // variables. Switching back is instant.
    const { version } = useAppVersion("member");
    const dark = version === "new";

    return (
        <div
            className={dark ? "dark" : undefined}
            style={{ fontFamily: "var(--font-sans)", minHeight: "100dvh", display: "flex", flexDirection: "column", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
        >
            {/* Top header — shown on mobile, hidden on desktop (sidebar has branding) */}
            <header className="member-header flex items-center justify-between px-4 py-3 bg-card border-b flex-shrink-0" style={{ borderColor: "hsl(var(--border))" }}>
                <div className="flex items-center gap-2 min-w-0">
                    {club?.logo ? (
                        <img src={club.logo} alt="" className="h-8 w-8 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                        <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ background: GREEN }}>
                            {(club?.name ?? "C")[0]}
                        </div>
                    )}
                    <span className="text-sm font-bold truncate" style={{ color: GREEN }}>{club?.name ?? "Club"}</span>
                </div>
                <Link to="/member/announcements" className="p-2 rounded-lg hover:bg-muted transition-colors">
                    <Bell className="w-5 h-5" style={{ color: pathname === "/member/announcements" ? GREEN : "hsl(var(--muted-foreground))" }} />
                </Link>
            </header>

            {/* Body: sidebar + content side by side on desktop */}
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

                {/* Side nav — hidden on mobile (display:none), shown on desktop via CSS */}
                <aside className="side-nav" style={{
                    display: "none",
                    flexDirection: "column",
                    width: 220,
                    background: "white",
                    borderRight: "1px solid #e0f0e9",
                    flexShrink: 0,
                    overflowY: "auto",
                }}>
                    {/* Branding */}
                    <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid #e0f0e9", display: "flex", alignItems: "center", gap: 10 }}>
                        {club?.logo ? (
                            <img src={club.logo} alt="" style={{ height: 36, width: 36, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                        ) : (
                            <div style={{ height: 36, width: 36, borderRadius: 10, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
                                {(club?.name ?? "C")[0]}
                            </div>
                        )}
                        <span style={{ fontWeight: 800, color: GREEN, fontSize: 14, lineHeight: 1.3 }}>{club?.name ?? "Club"}</span>
                    </div>

                    {/* Nav items */}
                    <nav style={{ flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                        {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
                            const active = pathname === path || pathname.startsWith(path + "/");
                            return (
                                <Link
                                    key={path}
                                    to={path}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 12,
                                        padding: "10px 12px", borderRadius: 10,
                                        color: active ? GREEN : "hsl(var(--muted-foreground))",
                                        background: active ? "hsl(var(--secondary))" : "transparent",
                                        fontWeight: active ? 700 : 600,
                                        fontSize: 14,
                                        textDecoration: "none",
                                        transition: "background 0.15s, color 0.15s",
                                    }}
                                >
                                    <div style={{ position: "relative" }}>
                                        <Icon style={{ width: 18, height: 18 }} />
                                        {label === "Wallet" && hasPending && (
                                            <span style={{ position: "absolute", top: -2, right: -4, width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />
                                        )}
                                    </div>
                                    {label}
                                </Link>
                            );
                        })}

                        {/* Network */}
                        <Link
                            to="/member/network"
                            style={{
                                display: "flex", alignItems: "center", gap: 12,
                                padding: "10px 12px", borderRadius: 10,
                                color: pathname === "/member/network" || pathname.startsWith("/member/tree") ? GREEN : "hsl(var(--muted-foreground))",
                                background: pathname === "/member/network" || pathname.startsWith("/member/tree") ? "hsl(var(--secondary))" : "transparent",
                                fontWeight: pathname === "/member/network" || pathname.startsWith("/member/tree") ? 700 : 600,
                                fontSize: 14,
                                textDecoration: "none",
                                transition: "background 0.15s, color 0.15s",
                            }}
                        >
                            <GitBranch style={{ width: 18, height: 18 }} />
                            My Network
                        </Link>

                        {/* Announcements */}
                        <Link
                            to="/member/announcements"
                            style={{
                                display: "flex", alignItems: "center", gap: 12,
                                padding: "10px 12px", borderRadius: 10,
                                color: pathname === "/member/announcements" ? GREEN : "hsl(var(--muted-foreground))",
                                background: pathname === "/member/announcements" ? "hsl(var(--secondary))" : "transparent",
                                fontWeight: pathname === "/member/announcements" ? 700 : 600,
                                fontSize: 14,
                                textDecoration: "none",
                                transition: "background 0.15s, color 0.15s",
                            }}
                        >
                            <Bell style={{ width: 18, height: 18 }} />
                            Announcements
                        </Link>
                    </nav>
                </aside>

                {/* Scrollable content */}
                <main className="member-content flex-1 overflow-y-auto pb-20">
                    {children}
                </main>
            </div>

            {/* Bottom navigation — mobile only, hidden on desktop via CSS */}
            <nav className="bottom-nav fixed bottom-0 left-0 right-0 bg-card border-t flex z-40" style={{ borderColor: "hsl(var(--border))" }}>
                {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
                    const active = pathname === path || pathname.startsWith(path + "/");
                    return (
                        <Link
                            key={path}
                            to={path}
                            className="flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors"
                            style={{ color: active ? GREEN : "hsl(var(--muted-foreground))" }}
                        >
                            <div className="relative">
                                <Icon className="w-5 h-5" />
                                {label === "Wallet" && hasPending && (
                                    <span className="absolute -top-0.5 -right-1 flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                                    </span>
                                )}
                            </div>
                            <span className="text-[10px] font-bold">{label}</span>
                        </Link>
                    );
                })}
            </nav>
            <InstallPrompt />
        </div>
    );
}
