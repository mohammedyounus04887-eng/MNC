import { useEffect, useRef, useState } from "react";
import * as faceapi from "face-api.js";
import { loadFaceModels, FACE_DETECTOR_OPTS } from "@/lib/faceApi";

// ─── FaceAutoCapture ───────────────────────────────────────────────────
// Self-contained modal that opens the camera, runs face-api.js to detect
// a face in the circular target, and auto-snaps the moment a face is
// detected (no button press). Returns a JPEG File via onCapture.
//
// Mirrors the auto-capture pattern from ReceptionGuestWizard so guests
// captured here flow into the same Firebase Storage path + kitchen
// display photo column.

interface Props {
    open: boolean;
    title?: string;
    subtitle?: string;
    onCapture: (file: File, dataUrl: string) => void;
    onCancel: () => void;
    onSkip?: () => void;            // fallback when camera permission denied
}

export default function FaceAutoCapture({
    open, title = "Capture face", subtitle = "Position the person in the circle",
    onCapture, onCancel, onSkip,
}: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const detectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const capturedRef = useRef(false);

    const [status, setStatus] = useState("Starting camera…");
    const [faceDetected, setFaceDetected] = useState(false);
    const [cameraFailed, setCameraFailed] = useState(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        capturedRef.current = false;
        setStatus("Starting camera…");
        setFaceDetected(false);
        setCameraFailed(false);

        const stopCamera = () => {
            if (detectIntervalRef.current) {
                clearInterval(detectIntervalRef.current);
                detectIntervalRef.current = null;
            }
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        };

        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
                });
                if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                }
                setStatus("Look at the camera");
                // Ensure the shared face models are loaded (cached app-wide; this
                // is a no-op if a parent already triggered the load).
                await loadFaceModels().catch(() => {});
                if (cancelled) return;

                // Small warm-up delay so the first detection isn't on a black frame
                setTimeout(() => {
                    if (cancelled) return;
                    detectIntervalRef.current = setInterval(async () => {
                        if (!videoRef.current || cancelled || capturedRef.current) return;
                        try {
                            const det = await faceapi.detectSingleFace(
                                videoRef.current,
                                FACE_DETECTOR_OPTS,
                            );
                            if (det) {
                                if (capturedRef.current) return;  // race guard
                                capturedRef.current = true;
                                setFaceDetected(true);
                                setStatus("Got it!");
                                // Tiny pause so the user sees the green "Got it!" before snap
                                setTimeout(() => {
                                    if (cancelled) return;
                                    snap();
                                    stopCamera();
                                }, 200);
                            }
                        } catch { /* face-api can throw transient errors; ignore */ }
                    }, 250);
                }, 800);
            } catch {
                setCameraFailed(true);
                setStatus("Camera permission denied or unavailable.");
            }
        })();

        return () => { cancelled = true; stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    function snap() {
        if (!videoRef.current || !canvasRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        canvas.toBlob((blob) => {
            if (!blob) return;
            const file = new File([blob], `face_${Date.now()}.jpg`, { type: "image/jpeg" });
            onCapture(file, dataUrl);
        }, "image/jpeg", 0.85);
    }

    if (!open) return null;

    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(15,23,42,0.92)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: 24, fontFamily: "Nunito, sans-serif",
        }}>
            <div style={{ color: "white", fontSize: 22, fontWeight: 900, marginBottom: 8 }}>{title}</div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, marginBottom: 24, textAlign: "center", maxWidth: 360 }}>
                {subtitle}
            </div>

            <div style={{
                position: "relative", width: 280, height: 280, marginBottom: 24,
            }}>
                <video
                    ref={videoRef}
                    autoPlay muted playsInline
                    style={{
                        width: 280, height: 280, borderRadius: "50%",
                        objectFit: "cover", transform: "scaleX(-1)",
                        border: `4px solid ${faceDetected ? "#22c55e" : "rgba(255,255,255,0.3)"}`,
                        transition: "border-color 0.2s",
                        background: "#0f172a",
                    }}
                />
                <canvas ref={canvasRef} style={{ display: "none" }} />
                {/* scan animation ring */}
                {!cameraFailed && !faceDetected && (
                    <div style={{
                        position: "absolute", inset: -8, borderRadius: "50%",
                        border: "2px solid rgba(124,58,237,0.5)",
                        animation: "faceCaptureRing 1.5s ease-in-out infinite",
                        pointerEvents: "none",
                    }} />
                )}
                <style>{`
                    @keyframes faceCaptureRing {
                        0%, 100% { transform: scale(1); opacity: 0.5; }
                        50%      { transform: scale(1.06); opacity: 1; }
                    }
                `}</style>
            </div>

            <div style={{
                color: faceDetected ? "#22c55e" : "rgba(255,255,255,0.85)",
                fontSize: 15, fontWeight: 700, marginBottom: 24, textAlign: "center", minHeight: 22,
            }}>
                {status}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
                <button
                    onClick={onCancel}
                    style={{
                        padding: "10px 22px",
                        background: "rgba(255,255,255,0.12)",
                        border: "1.5px solid rgba(255,255,255,0.3)",
                        color: "white", borderRadius: 10, fontSize: 14,
                        fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                    }}
                >
                    Cancel
                </button>
                {onSkip && (
                    <button
                        onClick={onSkip}
                        style={{
                            padding: "10px 22px",
                            background: cameraFailed ? "#f59e0b" : "rgba(255,255,255,0.12)",
                            border: "1.5px solid rgba(255,255,255,0.3)",
                            color: "white", borderRadius: 10, fontSize: 14,
                            fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                        }}
                    >
                        Skip face capture
                    </button>
                )}
            </div>
        </div>
    );
}
