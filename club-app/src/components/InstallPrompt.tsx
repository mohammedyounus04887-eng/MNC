import { useState, useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";

export default function InstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [showInstallBanner, setShowInstallBanner] = useState(false);
    const {
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW();

    useEffect(() => {
        const handler = (e: any) => {
            e.preventDefault();
            setDeferredPrompt(e);

            const dismissed = localStorage.getItem('mnc_install_dismissed');
            if (dismissed) {
                const time = parseInt(dismissed, 10);
                if (Date.now() < time) {
                    return;
                } else {
                    localStorage.removeItem('mnc_install_dismissed');
                }
            }

            // Show prompt after 30 seconds
            setTimeout(() => {
                setShowInstallBanner(true);
            }, 30000);
        };

        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            setShowInstallBanner(false);
            localStorage.setItem('mnc_install_dismissed', String(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10)); // forever
        }
        setDeferredPrompt(null);
    };

    const handleDismiss = () => {
        setShowInstallBanner(false);
        // Dismiss for 7 days
        localStorage.setItem('mnc_install_dismissed', String(Date.now() + 1000 * 60 * 60 * 24 * 7));
    };

    // UI for Update
    if (needRefresh) {
        return (
            <div className="fixed bottom-20 left-4 right-4 md:bottom-6 md:left-auto md:right-6 md:w-96 bg-white border-2 border-green-500 rounded-2xl p-4 shadow-2xl z-[100] animate-in slide-in-from-bottom-5">
                <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                        <span className="text-3xl">🆕</span>
                        <div>
                            <p className="font-bold text-gray-800">New version available!</p>
                            <p className="text-sm text-gray-500">Update now for the latest features & fixes.</p>
                        </div>
                    </div>
                    <div className="flex gap-2 w-full mt-1">
                        <Button
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold"
                            onClick={() => updateServiceWorker(true)}
                        >
                            Update Now
                        </Button>
                        <Button
                            variant="outline"
                            className="px-4 rounded-xl border-gray-300 text-gray-600 font-bold"
                            onClick={() => setNeedRefresh(false)}
                        >
                            Close
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    // UI for Install
    if (showInstallBanner && deferredPrompt) {
        return (
            <div className="fixed bottom-20 left-4 right-4 md:bottom-6 md:left-auto md:right-6 md:w-96 bg-white border-2 border-green-500 rounded-2xl p-4 shadow-2xl z-[100] animate-in slide-in-from-bottom-5">
                <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                        <span className="text-3xl">📱</span>
                        <div>
                            <p className="font-bold text-gray-800">Install MNC App</p>
                            <p className="text-sm text-gray-500">Get quick access directly from your homescreen.</p>
                        </div>
                    </div>
                    <div className="flex gap-2 w-full mt-1">
                        <Button
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold"
                            onClick={handleInstall}
                        >
                            Install
                        </Button>
                        <Button
                            variant="outline"
                            className="flex-1 rounded-xl font-bold border-gray-300 text-gray-600"
                            onClick={handleDismiss}
                        >
                            Not Now
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}
