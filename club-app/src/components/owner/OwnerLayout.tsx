import { useState, ReactNode } from "react";
import { Menu } from "lucide-react";
import { useLocation } from "react-router-dom";
import OwnerSidebar from "./OwnerSidebar";
import InstallPrompt from "../InstallPrompt";
import { useAppVersion } from "@/lib/appVersion";

interface OwnerLayoutProps {
    children: ReactNode;
}

// Determine the base mount point from the current URL.
// AdminAccess is mounted at /admin/* or /login/* — derive which one.
function useBasePath(): string {
    const { pathname } = useLocation();
    if (pathname.startsWith("/owner")) return "/owner";
    if (pathname.startsWith("/login")) return "/login";
    if (pathname.startsWith("/admin")) return "/admin";
    return "/admin"; // safe fallback
}

export default function OwnerLayout({ children }: OwnerLayoutProps) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const base = useBasePath();
    // Admin switched to "new" puts the whole section on the club theme. Because
    // the palette lives in CSS variables, this retints every admin page at once
    // — including the ones that were never rebuilt — rather than leaving the
    // section half converted. Switching back is instant.
    const { version } = useAppVersion("admin");
    const dark = version === "new";

    return (
        <div
            className={dark ? "dark" : undefined}
            style={{
                display: "flex", height: "100dvh", overflow: "hidden",
                fontFamily: "var(--font-sans)",
                ...(dark ? { background: "hsl(var(--background))", color: "hsl(var(--foreground))" } : {}),
            }}
        >
            {/* Sidebar */}
            <OwnerSidebar
                base={base}
                open={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            />

            {/* Main area */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
                {/* Mobile top bar */}
                <header
                    className="md:hidden flex items-center gap-3 px-4 h-14 flex-shrink-0 bg-card border-b"
                    style={{ borderColor: "hsl(var(--border))" }}
                >
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="p-2 rounded-xl border text-muted-foreground hover:text-foreground transition-colors"
                        style={{ borderColor: "hsl(var(--border))" }}
                        aria-label="Open navigation"
                    >
                        <Menu className="w-5 h-5" />
                    </button>
                    <span className="text-sm font-black text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
                        Menu
                    </span>
                </header>

                {/* Scrollable content area */}
                <main style={{ flex: 1, overflowY: "auto", background: "#f8fafc" }}>
                    <div className="main-content">
                        {children}
                    </div>
                </main>
            </div>
            <InstallPrompt />
        </div>
    );
}
