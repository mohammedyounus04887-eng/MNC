import { useState, useEffect } from "react";
import { Link, useLocation, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, ShoppingCart, HeartHandshake,
  Wallet, CreditCard, Package, GitBranch, Settings, Menu, Bell, ChevronDown, Leaf, X, LogOut,
  CalendarCheck, ExternalLink, Activity, Network, Utensils, Star, Flame
} from "lucide-react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth, signOutUser } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import { usePendingTopupRequests } from "@/hooks/useOwner";

const ownerNavItems = [
  { title: "Dashboard", path: "/owner/dashboard", icon: LayoutDashboard },
  { title: "Announcements", path: "/owner/announcements", icon: Bell },
  { title: "Members", path: "/owner/members", icon: Users },
  { title: "Orders", path: "/owner/orders", icon: ShoppingCart },
  { title: "Membership Plans", path: "/owner/membership-plans", icon: CreditCard },
  { title: "Wallet Approvals", path: "/owner/wallet-approvals", icon: Wallet, showBadge: true },
  { title: "Volunteers", path: "/owner/volunteers", icon: HeartHandshake },
  { title: "Menu", path: "/owner/menu", icon: Utensils },
  { title: "Inventory", path: "/owner/inventory", icon: Package },
  { title: "Expiry Management", path: "/owner/expiry-management", icon: Package },
  { title: "Billing", path: "/owner/billing", icon: ShoppingCart },
  { title: "Billing Reports", path: "/owner/billing-reports", icon: ShoppingCart },
  { title: "Reports & Analytics", path: "/owner/reports", icon: Activity },
  { title: "My Network", path: "/owner/downline", icon: GitBranch },
  { title: "Settings", path: "/owner/settings", icon: Settings },
  { title: "Reviews", path: "/owner/reviews", icon: Star, showReviewsBadge: true },
  { title: "BTC Challenge", path: "/owner/btc", icon: Flame },
];

const memberNavItems = [
  { title: "Dashboard", path: "/member/dashboard", icon: LayoutDashboard },
  { title: "My Profile", path: "/member/profile", icon: Users },
  { title: "My Wallet", path: "/member/wallet", icon: Wallet },
  { title: "Attendance", path: "/member/attendance", icon: CalendarCheck },
  { title: "Todays Menu", path: "/member/menu", icon: ShoppingCart },
  { title: "My Network", path: "/member/tree", icon: Network },
  { title: "My Card", path: "/member/card", icon: CreditCard },
  { title: "My Progress", path: "/member/progress", icon: Activity },
];

const staffNavItems = [
  { title: "Dashboard", path: "/staff/dashboard", icon: LayoutDashboard },
  { title: "Attendance", path: "/staff/attendance", icon: CalendarCheck },
  { title: "New Order", path: "/staff/orders", icon: ShoppingCart },
];

const closeSidebarOnNavigate = () => {
  if (typeof window !== "undefined" && window.innerWidth < 768) {
    return true;
  }
  return false;
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { club } = useClubContext();
  const { requests: pendingTopups } = usePendingTopupRequests();
  const [pendingReviewsCount, setPendingReviewsCount] = useState(0);

  useEffect(() => {
    const clubId = club?.id;
    if (!clubId) return;
    return onSnapshot(
      query(collection(db, 'clubs', clubId, 'reviews'), where('status', '==', 'pending')),
      snap => setPendingReviewsCount(snap.size)
    );
  }, [club?.id]);

  useEffect(() => {
    if (club) {
      document.documentElement.style.setProperty("--club-primary", club.primaryColor || "#8B5CF6");
      document.documentElement.style.setProperty("--club-secondary", club.secondaryColor || "#10B981");
      document.documentElement.style.setProperty("--club-tertiary", club.tertiaryColor || "#F59E0B");
    }
  }, [club]);

  const activeNavItems = userProfile?.role === "member" ? memberNavItems : userProfile?.role === "staff" ? staffNavItems : ownerNavItems;

  const ownerName = userProfile?.name || "User";
  const ownerInitials = ownerName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = () => setSidebarOpen(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const handleNavClick = () => {
    if (closeSidebarOnNavigate()) setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-wellness-cream">
      {/* Mobile backdrop */}
      <div
        aria-hidden
        className={`fixed inset-0 z-20 bg-black/40 transition-opacity duration-300 md:hidden ${sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar: overlay on mobile, inline on desktop */}
      <aside
        className={`fixed md:relative inset-y-0 left-0 z-30 h-full w-72 flex-shrink-0 bg-white border-r border-border transition-transform duration-300 ease-out flex flex-col shadow-soft
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          ${!sidebarOpen ? "md:w-20" : "md:w-72"}`}
      >
        {/* Brand */}
        <div className={`p-4 md:p-6 border-b border-border flex items-center gap-3 min-h-[72px] ${!sidebarOpen ? "md:justify-center md:px-2" : ""}`}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-premium" style={{ backgroundColor: "var(--club-primary)" }}>
            <Leaf className="w-6 h-6 text-white" />
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden animate-in flex-1 min-w-0">
              <p className="font-bold text-base text-wellness-forest leading-tight truncate">Magic Nutrition Club</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-primary truncate">Usha Prasad Enterprise</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 md:py-6 px-3 md:px-4 space-y-1">
          {activeNavItems.map((item) => {
            const active = location.pathname === item.path || location.pathname.startsWith(item.path + "/");
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={handleNavClick}
                className={`flex items-center gap-3 md:gap-4 px-3 md:px-4 py-3 rounded-2xl text-sm font-bold transition-all duration-300 group min-h-[44px] touch-manipulation ${!sidebarOpen ? "md:justify-center md:px-2" : ""} ${active
                  ? "text-white shadow-premium"
                  : "text-muted-foreground hover:bg-secondary/30 hover:text-primary active:bg-secondary/50"
                  }`}
                style={active ? { backgroundColor: "var(--club-primary)", borderLeft: "3px solid var(--club-primary)" } : {}}
              >
                <item.icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-300 group-hover:scale-110 ${active ? "text-white" : ""}`} style={!active ? { color: "var(--club-primary)" } : {}} />
                {sidebarOpen && (
                  <span className="truncate flex-1">{item.title}</span>
                )}
                {sidebarOpen && (item as any).showBadge && pendingTopups.length > 0 && (
                  <Badge variant="destructive" className="text-[10px] h-5 min-w-[20px] px-1 pointer-events-none">{pendingTopups.length}</Badge>
                )}
                {sidebarOpen && (item as any).showReviewsBadge && pendingReviewsCount > 0 && (
                  <Badge variant="destructive" className="text-[10px] h-5 min-w-[20px] px-1 pointer-events-none">{pendingReviewsCount}</Badge>
                )}
              </Link>
            );
          })}
          {/* Sign Out */}
          <button
            onClick={async () => { await signOutUser(); navigate("/login"); }}
            className="flex items-center gap-3 md:gap-4 px-3 md:px-4 py-3 rounded-2xl text-sm font-bold text-red-500 hover:bg-red-50 transition-all mt-4 w-full min-h-[44px]"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && <span className="truncate">Sign Out</span>}
          </button>
        </nav>

        {/* Bottom Profile */}
        <div className={`p-3 md:p-4 bg-secondary/20 m-3 md:m-4 rounded-2xl border border-primary/10 ${!sidebarOpen ? "md:flex md:justify-center" : ""}`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0" style={{ backgroundColor: "var(--club-primary)" }}>{ownerInitials}</div>
            {sidebarOpen && (
              <div className="overflow-hidden min-w-0">
                <p className="text-sm font-bold text-wellness-forest truncate">{ownerName}</p>
                <p className="text-[10px] text-muted-foreground font-bold truncate capitalize">{userProfile?.role === "clubOwner" ? "Club Owner" : userProfile?.role}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top Navbar */}
        <header className="h-14 md:h-20 bg-white/80 backdrop-blur-md border-b border-border flex items-center justify-between px-4 md:px-6 lg:px-8 flex-shrink-0 z-10 shadow-sm safe-area-top">
          <div className="flex items-center gap-3 md:gap-6 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2.5 md:p-2 rounded-xl border border-border bg-white text-muted-foreground hover:text-primary hover:border-primary transition-all shadow-sm active:scale-95 min-h-[44px] min-w-[44px] touch-manipulation flex items-center justify-center"
              aria-label={sidebarOpen ? "Close menu" : "Open menu"}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="min-w-0">
              <h1 className="font-black text-wellness-forest text-base sm:text-lg md:text-2xl tracking-tight truncate">
                {activeNavItems.find(n => location.pathname === n.path || location.pathname.startsWith(n.path + "/"))?.title || "Dashboard"}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
            <div className="hidden md:flex flex-col text-right mr-2">
              <p className="text-xs font-black uppercase tracking-wider" style={{ color: "var(--club-primary)" }}>Welcome Back</p>
              <p className="text-sm font-bold text-wellness-forest">{ownerName}</p>
            </div>
            <button className="p-2.5 md:p-3 rounded-2xl bg-white border border-border text-muted-foreground hover:text-primary transition-all relative shadow-sm group min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation">
              <Bell className="w-5 h-5 group-hover:animate-bounce" />
              <span className="absolute top-2 right-2 w-2 h-2 md:w-2.5 md:h-2.5 bg-accent rounded-full border-2 border-white" />
            </button>
            <div className="h-8 md:h-10 w-px bg-border hidden sm:block" />
            <Button variant="ghost" className="gap-2 md:gap-3 px-2 hover:bg-transparent min-h-[44px] touch-manipulation">
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-2xl flex items-center justify-center text-white text-xs md:text-sm font-black shadow-premium active:scale-95 transition-transform" style={{ backgroundColor: "var(--club-primary)" }}>{ownerInitials}</div>
              <ChevronDown className="w-4 h-4 text-muted-foreground hidden sm:inline" />
            </Button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8 lg:p-10 relative">
          <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-white to-transparent -z-10 pointer-events-none" />
          <div className="max-w-[1600px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
