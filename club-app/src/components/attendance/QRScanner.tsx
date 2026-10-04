import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
    onScanSuccess: (decodedText: string) => void;
    onScanError?: (error: string) => void;
}

const SCANNER_ID = "qr-scanner-region";
const QR_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes

export default function QRScanner({ onScanSuccess, onScanError }: Props) {
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [started, setStarted] = useState(false);
    const processedRef = useRef(false);

    useEffect(() => {
        let mounted = true;
        const scanner = new Html5Qrcode(SCANNER_ID);
        scannerRef.current = scanner;

        scanner
            .start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 250, height: 250 } },
                (decodedText) => {
                    if (processedRef.current) return;
                    // Validate QR format: mnc-checkin:{userId}:{clubId}:{timestamp}
                    const parts = decodedText.split(":");
                    if (parts.length < 4 || parts[0] !== "mnc-checkin") {
                        onScanError?.("Invalid QR code");
                        return;
                    }
                    const ts = parseInt(parts[3]);
                    if (isNaN(ts) || Date.now() - ts > QR_EXPIRY_MS) {
                        onScanError?.("QR code expired. Please generate a new one.");
                        return;
                    }
                    processedRef.current = true;
                    onScanSuccess(decodedText);
                },
                () => { /* ignore scan failures (no QR in frame) */ }
            )
            .then(() => { if (mounted) setStarted(true); })
            .catch((err) => {
                if (mounted) {
                    setCameraError(
                        err?.toString?.().includes("NotAllowed")
                            ? "Camera permission denied. Please allow camera access and reload."
                            : "Could not start camera. Make sure no other app is using it."
                    );
                }
            });

        return () => {
            mounted = false;
            if (scanner.isScanning) {
                scanner.stop().catch(() => { });
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (cameraError) {
        return (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center space-y-3">
                <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
                <p className="text-sm text-red-700 font-medium">{cameraError}</p>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                    Retry
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div
                id={SCANNER_ID}
                className="rounded-2xl overflow-hidden border-2 border-dashed border-gray-200 bg-black min-h-[280px]"
            />
            {!started && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Camera className="w-4 h-4 animate-pulse" />
                    <span>Starting camera…</span>
                </div>
            )}
        </div>
    );
}

// Helper to parse QR value
export function parseQRValue(decoded: string) {
    const parts = decoded.split(":");
    if (parts.length < 4 || parts[0] !== "mnc-checkin") return null;
    return {
        userId: parts[1],
        clubId: parts[2],
        timestamp: parseInt(parts[3]),
    };
}
