import { useState, useEffect } from "react";
import { Link, useLocation, Outlet, useNavigate } from "react-router-dom";
import {
    LayoutDashboard,
    Building2,
    GitBranch,
    LogOut,
    Menu,
    X,
    Shield,
    Settings,
    MessageSquare,
    Store,
    ToggleRight,
    UtensilsCrossed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useUnreadClubFeedbackCount } from "@/hooks/superadmin/useEnquiries";

const baseNavItems = [
    { title: "Dashboard", path: "/superadmin/dashboard", icon: LayoutDashboard },
    { title: "Clubs", path: "/superadmin/clubs", icon: Building2 },
    { title: "Global Menu", path: "/superadmin/global-menu", icon: UtensilsCrossed },
    { title: "Club Feedback", path: "/superadmin/enquiries", icon: MessageSquare },
    { title: "Platform Tree", path: "/superadmin/tree", icon: GitBranch },
    { title: "Club Requests", path: "/superadmin/upgrade-requests", icon: Store },
    { title: "App Versions", path: "/superadmin/app-versions", icon: ToggleRight },
    { title: "Settings", path: "/superadmin/settings", icon: Settings },
];

export default function SuperAdminLayout() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const { signOut, userProfile } = useAuth();
    const { data: unreadEnquiries = 0 } = useUnreadClubFeedbackCount();

    useEffect(() => {
        const mq = window.matchMedia("(min-width: 768px)");
        const handler = () => setSidebarOpen(mq.matches);
        handler();
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, []);

    const handleNavClick = () => {
        if (window.innerWidth < 768) setSidebarOpen(false);
    };

    return (
        <div className="flex h-screen overflow-hidden bg-gray-50">
            {/* Mobile backdrop */}
            <div
                aria-hidden
                className={`fixed inset-0 z-20 bg-black/40 transition-opacity duration-300 md:hidden ${sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
                    }`}
                onClick={() => setSidebarOpen(false)}
            />

            {/* Sidebar */}
            <aside
                className={`fixed md:relative inset-y-0 left-0 z-30 h-full w-64 flex-shrink-0 bg-gray-950 transition-transform duration-300 ease-out flex flex-col
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          ${!sidebarOpen ? "md:w-16" : "md:w-64"}`}
            >
                {/* Brand */}
                <div
                    className={`p-4 border-b border-gray-800 flex items-center gap-3 min-h-[64px] ${!sidebarOpen ? "md:justify-center md:px-2" : ""
                        }`}
                >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-emerald-500 flex items-center justify-center flex-shrink-0">
                        <Shield className="w-5 h-5 text-white" />
                    </div>
                    {sidebarOpen && (
                        <div className="overflow-hidden min-w-0">
                            <p className="font-bold text-sm text-white truncate">MNC Platform</p>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-400">
                                Super Admin
                            </p>
                        </div>
                    )}
                </div>

                {/* Nav */}
                <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
                    {baseNavItems.map((item) => {
                        const active =
                            location.pathname === item.path ||
                            (item.path !== "/superadmin/dashboard" &&
                                location.pathname.startsWith(item.path));
                        const badge = item.path === "/superadmin/enquiries" && unreadEnquiries > 0
                            ? unreadEnquiries
                            : 0;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                onClick={handleNavClick}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${!sidebarOpen ? "md:justify-center md:px-2" : ""
                                    } ${active
                                        ? "bg-violet-600 text-white"
                                        : "text-gray-400 hover:bg-gray-800 hover:text-white"
                                    }`}
                            >
                                <div className="relative flex-shrink-0">
                                    <item.icon className="w-5 h-5" />
                                    {badge > 0 && (
                                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5">
                                            {badge > 99 ? "99+" : badge}
                                        </span>
                                    )}
                                </div>
                                {sidebarOpen && (
                                    <span className="flex-1 truncate">{item.title}</span>
                                )}
                                {sidebarOpen && badge > 0 && (
                                    <span className="ml-auto min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                                        {badge > 99 ? "99+" : badge}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                {/* Sign Out */}
                <div className={`p-3 border-t border-gray-800 ${!sidebarOpen ? "md:flex md:justify-center" : ""}`}>
                    {sidebarOpen && userProfile && (
                        <div className="flex items-center gap-2 mb-3 px-2">
                            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                {userProfile.name?.[0]?.toUpperCase() || "S"}
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-white truncate">{userProfile.name}</p>
                                <p className="text-[10px] text-gray-500 truncate">{userProfile.email}</p>
                            </div>
                        </div>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        className={`text-gray-400 hover:text-red-400 hover:bg-gray-800 ${sidebarOpen ? "w-full justify-start" : "w-full justify-center"
                            }`}
                        onClick={async () => { await signOut(); navigate("/superadmin/login", { replace: true }); }}
                    >
                        <LogOut className="w-4 h-4" />
                        {sidebarOpen && <span className="ml-2 text-sm">Sign Out</span>}
                    </Button>
                </div>
            </aside>

            {/* Main */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Top bar */}
                <header className="h-14 bg-white border-b border-border flex items-center justify-between px-4 flex-shrink-0 z-10">
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="p-2 rounded-lg border border-border bg-white text-muted-foreground hover:text-violet-600 transition-all"
                    >
                        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-violet-600 bg-violet-50 px-3 py-1 rounded-full">
                            SUPER ADMIN
                        </span>
                    </div>
                </header>

                {/* Content */}
                <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                    <div className="max-w-[1400px] mx-auto">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
}
