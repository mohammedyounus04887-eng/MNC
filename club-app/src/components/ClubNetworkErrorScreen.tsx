/**
 * Shown when club detection fails because the device can't reach Firestore
 * (cold start on a slow network, mobile data dropped, etc.). Distinct from
 * the "Club Not Found" dead end — this offers a Retry button + a "Hard
 * reset" that clears every cache and reloads the whole app.
 *
 * Also doubles as a connectivity diagnostic: polls online/offline state and
 * surfaces the current status in plain language so the receptionist isn't
 * left guessing.
 */

import { useEffect, useState } from "react";

const FONT = "'Nunito', sans-serif";

interface Props {
    onRetry: () => void;
    /** Optional override for the page subtitle (rarely needed). */
    detail?: string;
}

export default function ClubNetworkErrorScreen({ onRetry, detail }: Props) {
    const [online, setOnline] = useState<boolean>(navigator.onLine);
    const [retrying, setRetrying] = useState(false);
    const [retryCount, setRetryCount] = useState(0);

    // Watch the browser's online/offline status so the message reflects
    // reality. iOS Safari reports this reliably; older Androids less so —
    // we treat it as a hint, not gospel.
    useEffect(() => {
        const goOnline = () => setOnline(true);
        const goOffline = () => setOnline(false);
        window.addEventListener("online", goOnline);
        window.addEventListener("offline", goOffline);
        return () => {
            window.removeEventListener("online", goOnline);
            window.removeEventListener("offline", goOffline);
        };
    }, []);

    const handleRetry = () => {
        if (retrying) return;
        setRetrying(true);
        setRetryCount(c => c + 1);
        onRetry();
        // Drop the spinner after a generous delay so the button doesn't flicker
        // on a fast retry.
        setTimeout(() => setRetrying(false), 2000);
    };

    const handleHardReset = async () => {
        // Nuclear option: clear caches + unregister service worker + reload.
        // This recovers from cases where a stale SW or cached bundle is the
        // root cause (e.g. an outdated build is intercepting Firestore calls).
        try {
            if ("caches" in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }
        } catch { /* ignore */ }
        try {
            if ("serviceWorker" in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
            }
        } catch { /* ignore */ }
        try { sessionStorage.clear(); } catch { /* ignore */ }
        // Bypass HTTP cache too — force a fresh fetch from origin.
        window.location.reload();
    };

    return (
        <div
            style={{
                minHeight: "100vh",
                background: "linear-gradient(135deg,#f0f9ff,#dbeafe)",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 20, fontFamily: FONT,
            }}
        >
            <div
                style={{
                    background: "white", borderRadius: 24, padding: 28,
                    maxWidth: 420, width: "100%",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.12)",
                    textAlign: "center",
                }}
            >
                {/* Icon */}
                <div
                    style={{
                        width: 80, height: 80, borderRadius: "50%",
                        background: online ? "#fef3c7" : "#fee2e2",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 38, marginBottom: 16,
                    }}
                >
                    {online ? "📡" : "📵"}
                </div>

                {/* Headline */}
                <h1 style={{ fontSize: 22, fontWeight: 900, color: "#0f172a", margin: 0 }}>
                    {online ? "Slow connection" : "You're offline"}
                </h1>
                <p style={{ fontSize: 13, color: "#64748b", marginTop: 8, fontWeight: 600, lineHeight: 1.55 }}>
                    {detail || (online
                        ? "We couldn't reach the server. This usually clears up on its own — tap Retry."
                        : "Your phone says it's not connected to the internet. Reconnect and tap Retry.")}
                </p>

                {/* Status pill */}
                <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: online ? "#fef9c3" : "#fee2e2",
                    color: online ? "#854d0e" : "#991b1b",
                    padding: "6px 12px", borderRadius: 100,
                    fontSize: 11, fontWeight: 800, marginTop: 16,
                }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: online ? "#eab308" : "#dc2626", display: "inline-block" }} />
                    {online ? "Network online · server unreachable" : "Device offline"}
                </div>

                {/* Buttons */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
                    <button
                        onClick={handleRetry}
                        disabled={retrying}
                        style={{
                            padding: "14px 22px",
                            background: retrying ? "#cbd5e1" : "linear-gradient(135deg,#3b82f6,#2563eb)",
                            color: "white", border: "none", borderRadius: 12,
                            fontSize: 15, fontWeight: 900,
                            cursor: retrying ? "not-allowed" : "pointer", fontFamily: FONT,
                        }}
                    >
                        {retrying ? "Retrying…" : retryCount > 0 ? `🔄 Retry again (tried ${retryCount}×)` : "🔄 Retry"}
                    </button>
                    <button
                        onClick={handleHardReset}
                        style={{
                            padding: "12px 18px",
                            background: "white",
                            color: "#475569",
                            border: "1.5px solid #cbd5e1", borderRadius: 12,
                            fontSize: 13, fontWeight: 800,
                            cursor: "pointer", fontFamily: FONT,
                        }}
                    >
                        ⚡ Hard reset (clear cache & reload)
                    </button>
                </div>

                {/* Help text */}
                <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 16, fontWeight: 600, lineHeight: 1.6 }}>
                    Hard reset clears the app cache and reloads — use this if Retry isn't helping. Your data is safe; nothing local will be lost.
                </p>
            </div>
        </div>
    );
}
