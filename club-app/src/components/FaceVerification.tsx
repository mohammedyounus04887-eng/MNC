import { useState, useEffect, useRef } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import * as faceapi from "face-api.js";
import { loadFaceModels, FACE_DETECTOR_OPTS } from "@/lib/faceApi";

const GREEN = "#2d9653";

interface Props {
    clubId: string;
    /** List of members with role that can verify (e.g. accountants, inventory managers) */
    verifiers: { id: string; name: string; photo?: string; faceDescriptor?: any; role?: string }[];
    title: string;
    subtitle?: string;
    onVerified: (verifier: { id: string; name: string }) => void;
    onCancel: () => void;
    /** Optional PIN fallback */
    pinFallback?: { pin: string; onPinVerified: (name: string) => void };
}

export default function FaceVerification({ clubId, verifiers, title, subtitle, onVerified, onCancel, pinFallback }: Props) {
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [status, setStatus] = useState("Loading face models...");
    const [selectedVerifier, setSelectedVerifier] = useState<any | null>(null);
    const [showPinFallback, setShowPinFallback] = useState(false);
    const [pinInput, setPinInput] = useState("");
    const [pinError, setPinError] = useState("");
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const intervalRef = useRef<any>(null);

    // Load models via the shared loader (cached app-wide — no duplicate download)
    useEffect(() => {
        loadFaceModels()
            .then(() => { setModelsLoaded(true); setStatus("Select a person to verify"); })
            .catch((e: any) => {
                console.error("[FaceVerification] model load failed", e);
                setStatus(`Face models failed to load: ${e?.message || "unknown error"}`);
            });
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            streamRef.current?.getTracks().forEach((t) => t.stop());
        };
    }, []);

    const startCamera = async () => {
        // getUserMedia is only available in a secure context (HTTPS or
        // localhost). On a plain-HTTP LAN IP, navigator.mediaDevices is
        // undefined — surface that clearly instead of "permission denied".
        if (!navigator.mediaDevices?.getUserMedia) {
            const reason = !window.isSecureContext
                ? "Camera needs HTTPS. Open the site via https:// or localhost (not a plain http:// IP address)."
                : "Camera API unavailable in this browser.";
            console.error("[FaceVerification] camera unavailable", { isSecureContext: window.isSecureContext, origin: window.location.origin });
            setStatus(reason);
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
        } catch (e: any) {
            console.error("[FaceVerification] getUserMedia failed", e);
            const name = e?.name || "";
            if (name === "NotAllowedError" || name === "SecurityError") {
                setStatus("Camera permission denied. Allow camera access for this site.");
            } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
                setStatus("No camera found on this device.");
            } else if (name === "NotReadableError") {
                setStatus("Camera is in use by another app. Close it and retry.");
            } else {
                setStatus(`Camera error: ${e?.message || name || "unknown"}`);
            }
        }
    };

    const stopCamera = () => {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
    };

    const startVerification = async (verifier: any) => {
        if (!modelsLoaded) { setStatus("Face models still loading..."); return; }

        // Fetch face descriptor from member doc if not on object
        let faceDescriptor = verifier.faceDescriptor;
        if (!faceDescriptor && clubId) {
            try {
                const snap = await getDoc(doc(db, "clubs", clubId, "members", verifier.id));
                if (snap.exists()) faceDescriptor = snap.data().faceDescriptor;
            } catch {}
        }

        if (!faceDescriptor) {
            setStatus(`No face enrolled for ${verifier.name}. Please enroll their face first.`);
            return;
        }

        const verifierWithFace = { ...verifier, faceDescriptor };
        setSelectedVerifier(verifierWithFace);
        setStatus("Look at the camera");
        await startCamera();
        await new Promise((r) => setTimeout(r, 1500));

        let attempts = 0;
        let isDetecting = false;
        intervalRef.current = setInterval(async () => {
            if (isDetecting || !videoRef.current) return;
            isDetecting = true;
            attempts++;
            try {
                const det = await faceapi
                    .detectSingleFace(videoRef.current, FACE_DETECTOR_OPTS)
                    .withFaceLandmarks()
                    .withFaceDescriptor();
                if (!det) {
                    if (attempts % 8 === 0) setStatus("No face detected. Move closer.");
                    return;
                }
                const saved = new Float32Array(Object.values(verifierWithFace.faceDescriptor) as number[]);
                const dist = faceapi.euclideanDistance(det.descriptor, saved);
                if (dist < 0.5) {
                    clearInterval(intervalRef.current);
                    stopCamera();
                    setStatus("Verified!");
                    onVerified({ id: verifierWithFace.id, name: verifierWithFace.name });
                } else if (attempts > 40) {
                    clearInterval(intervalRef.current);
                    stopCamera();
                    setStatus("Face not recognised. Please try again.");
                } else if (attempts % 12 === 0) {
                    setStatus("Still scanning... hold steady");
                }
            } catch {
            } finally {
                isDetecting = false;
            }
        }, 300);
    };

    const handlePinSubmit = () => {
        if (!pinFallback) return;
        if (pinInput === pinFallback.pin) {
            pinFallback.onPinVerified(selectedVerifier?.name || "PIN Verified");
        } else {
            setPinError("Incorrect PIN");
        }
    };

    // PIN fallback view
    if (showPinFallback && pinFallback) {
        return (
            <div style={{ padding: 24, textAlign: "center", fontFamily: "Nunito, sans-serif" }}>
                <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", marginBottom: 8 }}>PIN Verification</h3>
                <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>Enter the admin PIN to verify</p>
                <input
                    type="password"
                    value={pinInput}
                    onChange={(e) => { setPinInput(e.target.value); setPinError(""); }}
                    placeholder="Enter PIN"
                    style={{
                        width: "100%", maxWidth: 200, padding: "12px 16px", borderRadius: 12,
                        border: "1.5px solid #e0f0e9", fontSize: 18, textAlign: "center",
                        fontFamily: "Nunito, sans-serif", outline: "none",
                    }}
                />
                {pinError && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>{pinError}</p>}
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
                    <button onClick={onCancel} style={{
                        padding: "10px 24px", borderRadius: 10, border: "1.5px solid #e0f0e9",
                        background: "white", fontSize: 14, fontWeight: 700, cursor: "pointer",
                        fontFamily: "Nunito, sans-serif",
                    }}>Cancel</button>
                    <button onClick={handlePinSubmit} style={{
                        padding: "10px 24px", borderRadius: 10, border: "none",
                        background: GREEN, color: "white", fontSize: 14, fontWeight: 700,
                        cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Verify</button>
                </div>
            </div>
        );
    }

    // Camera / face verification view
    if (selectedVerifier) {
        return (
            <div style={{ padding: 24, textAlign: "center", fontFamily: "Nunito, sans-serif" }}>
                <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", marginBottom: 4 }}>{title}</h3>
                <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 16 }}>
                    Verifying: {selectedVerifier.name}
                </p>
                <div style={{
                    width: 280, height: 210, margin: "0 auto 16px", borderRadius: 16,
                    overflow: "hidden", background: "#000", position: "relative",
                }}>
                    <video
                        ref={videoRef}
                        style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
                        muted
                        playsInline
                    />
                </div>
                <p style={{ fontSize: 14, color: GREEN, fontWeight: 700 }}>{status}</p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
                    <button onClick={() => { stopCamera(); setSelectedVerifier(null); setStatus("Select a person to verify"); }} style={{
                        padding: "10px 24px", borderRadius: 10, border: "1.5px solid #e0f0e9",
                        background: "white", fontSize: 14, fontWeight: 700, cursor: "pointer",
                        fontFamily: "Nunito, sans-serif",
                    }}>Back</button>
                    <button onClick={() => { stopCamera(); startVerification(selectedVerifier); }} style={{
                        padding: "10px 24px", borderRadius: 10, border: "none",
                        background: GREEN, color: "white", fontSize: 14, fontWeight: 700,
                        cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Retry</button>
                    <button onClick={onCancel} style={{
                        padding: "10px 24px", borderRadius: 10, border: "none",
                        background: "#ef4444", color: "white", fontSize: 14, fontWeight: 700,
                        cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Cancel</button>
                </div>
            </div>
        );
    }

    // Verifier selection screen
    return (
        <div style={{ padding: 24, fontFamily: "Nunito, sans-serif" }}>
            <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", marginBottom: 4, textAlign: "center" }}>{title}</h3>
            {subtitle && <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 16, textAlign: "center" }}>{subtitle}</p>}
            <p style={{ fontSize: 13, color: GREEN, fontWeight: 700, textAlign: "center", marginBottom: 16 }}>{status}</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {verifiers.map((v) => (
                    <button
                        key={v.id}
                        onClick={() => startVerification(v)}
                        style={{
                            display: "flex", alignItems: "center", gap: 12, padding: "14px 18px",
                            background: "white", border: "1.5px solid #e0f0e9", borderRadius: 12,
                            cursor: "pointer", fontFamily: "Nunito, sans-serif", textAlign: "left",
                        }}
                    >
                        <div style={{
                            width: 44, height: 44, borderRadius: "50%", background: "#f0fdf4",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            overflow: "hidden", flexShrink: 0,
                        }}>
                            {v.photo ? (
                                <img src={v.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                            ) : (
                                <span style={{ fontSize: 18, fontWeight: 700, color: GREEN }}>
                                    {v.name.charAt(0).toUpperCase()}
                                </span>
                            )}
                        </div>
                        <div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a2a" }}>{v.name}</div>
                            {v.role && <div style={{ fontSize: 12, color: "#6b7280" }}>{v.role}</div>}
                        </div>
                    </button>
                ))}
            </div>

            {verifiers.length === 0 && (
                <div style={{ textAlign: "center", marginTop: 20, padding: "20px 16px", background: "#fef2f2", borderRadius: 14, border: "1px solid #fecaca" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
                    <p style={{ fontSize: 15, fontWeight: 800, color: "#991b1b", marginBottom: 4 }}>
                        No accountants available
                    </p>
                    <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
                        Please assign staff members as accountants and enroll their face from the Settings panel.
                    </p>
                </div>
            )}

            <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
                <button onClick={onCancel} style={{
                    padding: "10px 24px", borderRadius: 10, border: "none",
                    background: "#ef4444", color: "white", fontSize: 14, fontWeight: 700,
                    cursor: "pointer", fontFamily: "Nunito, sans-serif",
                }}>Cancel</button>
            </div>
        </div>
    );
}
