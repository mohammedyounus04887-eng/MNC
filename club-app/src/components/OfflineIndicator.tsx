import { useState, useEffect } from "react";

export default function OfflineIndicator() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [showOnlineBanner, setShowOnlineBanner] = useState(false);

    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            setShowOnlineBanner(true);
            setTimeout(() => setShowOnlineBanner(false), 3000);
        };

        const handleOffline = () => {
            setIsOnline(false);
            setShowOnlineBanner(false);
        };

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    if (isOnline && !showOnlineBanner) return null;

    if (!isOnline) {
        return (
            <div className="bg-red-500 text-white text-xs font-bold text-center py-1.5 px-4 sticky top-0 z-[100] shadow-sm flex items-center justify-center gap-2">
                <span>📡</span>
                <span>No internet connection — showing cached data</span>
            </div>
        );
    }

    if (showOnlineBanner) {
        return (
            <div className="bg-green-600 text-white text-xs font-bold text-center py-1.5 px-4 sticky top-0 z-[100] shadow-sm flex items-center justify-center gap-2">
                <span>✅</span>
                <span>Back online — syncing data...</span>
            </div>
        );
    }

    return null;
}
