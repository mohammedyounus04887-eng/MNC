import { useState, useEffect, useRef, useMemo } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
    useAddGuestEntry,
    lookupGuestsByPhone,
    type AddGuestEntryItemInput,
    type GuestPhoneSuggestion,
} from "@/hooks/useGuestEntries";
import type { InventoryProduct } from "@/types/firestore";
import * as faceapi from "face-api.js";
import { loadFaceModels, FACE_DETECTOR_OPTS } from "@/lib/faceApi";
import { fetchClubAndPrint, fetchShakeTokenToggles } from "@/utils/printReceipt";
import { buildShakeTokenReceipt, buildAfreshToken, buildGuestPaymentReceipt } from "@/utils/receiptBuilder";
import PaymentMethodPicker, { emptyPaymentSelection, validatePayment, type PaymentSelection, type UpiAccount } from "@/components/PaymentMethodPicker";
import { doc as firestoreDoc, onSnapshot as onSnapshotDoc } from "firebase/firestore";

const GREEN = "#2d9653";
const FONT = "'Nunito', sans-serif";
const GUEST_SHAKE_PRICE = 240; // fixed per-shake price for guest orders

type GuestType = "paid" | "unpaid";
type Step = "type" | "info" | "items" | "faces" | "payment" | "saving" | "done";

interface CartShake {
    kind: "shake";
    productId: string;
    productName: string;
    photo?: string | null;
    icePreference?: string;
    stockType?: "limited" | "unlimited";
    qty: number;
}
interface CartProduct {
    kind: "product";
    productId: string;
    productName: string;
    unit?: string;
    unitPrice: number;
    maxStock: number;
    qty: number;
}
type CartItem = CartShake | CartProduct;

interface Props {
    clubId: string;
    onClose: () => void;
    faceVerificationEnabled?: boolean;
}

export default function ReceptionGuestWizard({ clubId, onClose, faceVerificationEnabled = true }: Props) {
    // Master toggle: when face verification is OFF, the guest flow skips the
    // face-capture step entirely (and never loads face models).
    const faceOn = faceVerificationEnabled !== false;
    // ── Step state ──
    const [step, setStep] = useState<Step>("type");
    const [guestType, setGuestType] = useState<GuestType>("unpaid");
    const [guestName, setGuestName] = useState("");
    const [guestPhone, setGuestPhone] = useState("");
    const [error, setError] = useState("");

    // ── Phone autocomplete suggestions ──
    const [phoneSuggestions, setPhoneSuggestions] = useState<GuestPhoneSuggestion[]>([]);
    const lookupTimer = useRef<any>(null);
    useEffect(() => {
        if (lookupTimer.current) clearTimeout(lookupTimer.current);
        if (guestPhone.length < 3) { setPhoneSuggestions([]); return; }
        lookupTimer.current = setTimeout(async () => {
            try {
                const results = await lookupGuestsByPhone(clubId, guestPhone);
                // Hide a suggestion if it's an exact match for the current phone
                // (no point suggesting what they've already typed in full).
                setPhoneSuggestions(results.filter(r => r.phone !== guestPhone));
            } catch { /* swallow */ }
        }, 300);
        return () => { if (lookupTimer.current) clearTimeout(lookupTimer.current); };
    }, [guestPhone, clubId]);

    // ── Today's specials (shakes) ──
    const [shakeProducts, setShakeProducts] = useState<any[]>([]);
    const [shakesLoading, setShakesLoading] = useState(true);
    useEffect(() => {
        const todayStr = new Date().toISOString().split("T")[0];
        const q = query(
            collection(db, "clubs", clubId, "todaysSpecial"),
            where("date", "==", todayStr),
            where("isActive", "==", true)
        );
        const unsub = onSnapshot(q, (snap) => {
            setShakeProducts(snap.docs.map(d => {
                const data = d.data();
                return {
                    id: data.itemId || d.id,
                    name: data.itemName || data.name || "Shake",
                    photo: data.imageUrl || null,
                    stock: data.stockType === "unlimited" ? 999 : (data.remainingStock ?? 0),
                    stockType: (data.stockType as "limited" | "unlimited") ?? "unlimited",
                };
            }));
            setShakesLoading(false);
        });
        return () => unsub();
    }, [clubId]);

    const [inventoryProducts, setInventoryProducts] = useState<InventoryProduct[]>([]);
    useEffect(() => {
        // Unified inventory model — same fields (name, quantity, unit, price,
        // imageUrl, isForSale) so InventoryProduct shape still works as a read view.
        const unsub = onSnapshot(collection(db, `clubs/${clubId}/inventory`), (snap) => {
            setInventoryProducts(
                snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InventoryProduct)
            );
        });
        return () => unsub();
    }, [clubId]);

    // ── Cart state ──
    const [cart, setCart] = useState<CartItem[]>([]);
    const [activeTab, setActiveTab] = useState<"shake" | "product">("shake");

    const totalShakeQty = useMemo(
        () => cart.filter((c): c is CartShake => c.kind === "shake").reduce((s, c) => s + c.qty, 0),
        [cart]
    );
    const totalAmount = useMemo(() => {
        const shakeTotal = cart
            .filter((c): c is CartShake => c.kind === "shake")
            .reduce((s, c) => s + GUEST_SHAKE_PRICE * c.qty, 0);
        const productTotal = cart
            .filter((c): c is CartProduct => c.kind === "product")
            .reduce((s, c) => s + c.unitPrice * c.qty, 0);
        return shakeTotal + productTotal;
    }, [cart]);

    // ── Cart manipulation helpers ──
    const addShake = (p: any) => {
        setCart(prev => {
            const idx = prev.findIndex(c => c.kind === "shake" && c.productId === p.id);
            if (idx >= 0) {
                const copy = [...prev];
                (copy[idx] as CartShake).qty += 1;
                return copy;
            }
            return [...prev, { kind: "shake", productId: p.id, productName: p.name, photo: p.photo, stockType: p.stockType, qty: 1 }];
        });
    };
    const addProduct = (p: InventoryProduct) => {
        setCart(prev => {
            const idx = prev.findIndex(c => c.kind === "product" && c.productId === p.id);
            if (idx >= 0) {
                const copy = [...prev];
                if ((copy[idx] as CartProduct).qty < (copy[idx] as CartProduct).maxStock) {
                    (copy[idx] as CartProduct).qty += 1;
                }
                return copy;
            }
            return [...prev, { kind: "product", productId: p.id, productName: p.name, unit: p.unit, unitPrice: (p as any).price ?? 0, maxStock: p.quantity ?? 0, qty: 1 }];
        });
    };
    const incCartItem = (i: number) => {
        setCart(prev => {
            const copy = [...prev];
            const it = copy[i];
            if (it.kind === "product" && it.qty >= it.maxStock) return prev;
            it.qty += 1;
            return copy;
        });
    };
    const decCartItem = (i: number) => {
        setCart(prev => {
            const copy = [...prev];
            copy[i].qty -= 1;
            return copy.filter(c => c.qty > 0);
        });
    };

    // ── Camera / face-api refs ──
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [cameraStatus, setCameraStatus] = useState("Loading face models...");
    const [faceDetected, setFaceDetected] = useState(false);
    // True once getUserMedia has resolved and the video is actually playing.
    const [cameraReady, setCameraReady] = useState(false);
    const detectIntervalRef = useRef<any>(null);
    const lastCaptureAtRef = useRef<number>(0);

    // Captured faces (one per shake instance, in cart order)
    const [capturedFaces, setCapturedFaces] = useState<{ file: File; url: string }[]>([]);
    const faceIdx = capturedFaces.length; // next face to capture

    useEffect(() => {
        if (faceOn) {
            loadFaceModels()
                .then(() => setModelsLoaded(true))
                .catch(() => setCameraStatus("Face models failed to load"));
        }
        return () => {
            if (detectIntervalRef.current) clearInterval(detectIntervalRef.current);
            streamRef.current?.getTracks().forEach((t) => t.stop());
        };
    }, [faceOn]);

    // Compute label for the current capture
    const currentCaptureLabel = useMemo(() => {
        if (faceIdx >= totalShakeQty) return "All faces captured ✓";
        const shakes = cart.filter((c): c is CartShake => c.kind === "shake");
        let cursor = 0;
        for (const s of shakes) {
            if (faceIdx < cursor + s.qty) {
                const within = faceIdx - cursor + 1;
                return `Person ${faceIdx + 1} of ${totalShakeQty} — ${s.productName} (${within}/${s.qty})`;
            }
            cursor += s.qty;
        }
        return "";
    }, [faceIdx, totalShakeQty, cart]);

    const stopCamera = () => {
        if (detectIntervalRef.current) { clearInterval(detectIntervalRef.current); detectIntervalRef.current = null; }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
    };

    // Start camera when entering 'faces' step
    useEffect(() => {
        if (step !== "faces") return;
        // The photo is how the KITCHEN knows whose shake is whose, which is a
        // different job from face *matching*. Matching was dropped, and the
        // photo step was gated behind the same switch — so turning matching off
        // silently stopped guest photos and the kitchen lost the only way it
        // had to identify a guest. Only "no shakes in the cart" skips this now.
        if (totalShakeQty === 0) { setStep("payment"); return; }
        let cancelled = false;
        setFaceDetected(false);
        setCameraReady(false);
        setCameraStatus(faceOn ? "Position face in the frame" : "Tap Capture when they are in frame");

        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
                });
                if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                    setCameraReady(true);
                }
                // Auto-shutter only when face matching is on — that path needs
                // the 6.8 MB face models. With matching off the receptionist
                // taps Capture, which costs no download at all.
                if (!faceOn) return;
                setTimeout(() => {
                    if (cancelled) return;
                    detectIntervalRef.current = setInterval(async () => {
                        if (!videoRef.current || cancelled) return;
                        if (Date.now() - lastCaptureAtRef.current < 1500) return; // cooldown
                        try {
                            const det = await faceapi.detectSingleFace(
                                videoRef.current,
                                FACE_DETECTOR_OPTS
                            );
                            if (det) {
                                setFaceDetected(true);
                                setCameraStatus("Face detected — capturing...");
                                lastCaptureAtRef.current = Date.now();
                                setTimeout(() => { if (!cancelled) capturePhoto(); }, 600);
                            } else {
                                setFaceDetected(false);
                            }
                        } catch { /* skip */ }
                    }, 400);
                }, 1000);
            } catch {
                setCameraStatus("Camera permission denied. Tap 'Skip remaining' to continue.");
            }
        })();

        return () => { cancelled = true; stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step]);

    function capturePhoto() {
        if (!videoRef.current || !canvasRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(video, 0, 0);

        canvas.toBlob((blob) => {
            if (!blob) return;
            const idx = capturedFaces.length;
            const file = new File([blob], `guest_face_${idx}_${Date.now()}.jpg`, { type: "image/jpeg" });
            const url = URL.createObjectURL(blob);
            setCapturedFaces(prev => {
                const next = [...prev, { file, url }];
                if (next.length >= totalShakeQty) {
                    // All faces captured — stop camera and move on
                    stopCamera();
                    setTimeout(() => setStep("payment"), 600);
                }
                return next;
            });
            setFaceDetected(false);
            setCameraStatus("Captured ✓ — next person, please position face");
        }, "image/jpeg", 0.85);
    }

    function skipRemainingFaces() {
        // Pad out with nulls — empty File so we still produce per-shake orders.
        // Backend treats missing photos as just absent guestPhoto for that order.
        stopCamera();
        setStep("payment");
    }

    // ── Payment / save ──
    const [payment, setPayment] = useState<PaymentSelection>(emptyPaymentSelection);
    const [upiAccounts, setUpiAccounts] = useState<UpiAccount[]>([]);
    useEffect(() => {
        const unsub = onSnapshotDoc(firestoreDoc(db, "clubs", clubId), (snap) => {
            const raw = snap.data() as any;
            setUpiAccounts(((raw?.upiAccounts ?? []) as UpiAccount[]));
        });
        return () => unsub();
    }, [clubId]);
    const addGuestEntry = useAddGuestEntry();

    async function handleSave() {
        setError("");
        if (cart.length === 0) { setError("Cart is empty"); return; }
        if (guestType === "paid") {
            const v = validatePayment(payment, totalAmount, { requireUpiAccount: upiAccounts.length > 0 });
            if (!v.ok) { setError(v.reason || "Complete payment details"); return; }
        }
        setStep("saving");
        try {
            // Build items for the hook — distribute captured faces across shakes in cart order.
            const items: AddGuestEntryItemInput[] = [];
            let shakeCursor = 0;
            for (const c of cart) {
                if (c.kind === "shake") {
                    const faces = capturedFaces.slice(shakeCursor, shakeCursor + c.qty).map(f => f.file);
                    shakeCursor += c.qty;
                    items.push({
                        type: "shake",
                        productId: c.productId,
                        productName: c.productName,
                        qty: c.qty,
                        unitPrice: guestType === "paid" ? GUEST_SHAKE_PRICE : 0,
                        icePreference: "",
                        stockType: c.stockType,
                        faceFiles: faces,
                    });
                } else {
                    items.push({
                        type: "inventory_product",
                        productId: c.productId,
                        productName: c.productName,
                        qty: c.qty,
                        unitPrice: guestType === "paid" ? c.unitPrice : 0,
                        unit: c.unit,
                    });
                }
            }
            const computedTotal = guestType === "paid" ? totalAmount : 0;
            const result = await addGuestEntry.mutateAsync({
                guestName: guestName.trim(),
                guestPhone: guestPhone.trim(),
                type: guestType,
                items,
                totalAmount: computedTotal,
                amountPaid: computedTotal,
                paymentMethod: guestType === "paid" ? payment.method : undefined,
                cashAmount: guestType === "paid" ? payment.cashAmount : undefined,
                upiAmount: guestType === "paid" ? payment.upiAmount : undefined,
                upiAccountId: guestType === "paid" ? payment.upiAccountId : undefined,
                upiAccountName: guestType === "paid" ? payment.upiAccountName : undefined,
                upiNumber: guestType === "paid" ? payment.upiNumber : undefined,
                recordedBy: "reception",
            });

            // ── Auto-print: per-shake (shake token + afresh) pairs, then
            // one payment receipt — same RawBT job. Each shake unit gets
            // its own token number; the matching afresh token reuses it
            // so kitchen and refreshment counter share the identifier.
            try {
                const { printData } = result;
                const tokenToggles = await fetchShakeTokenToggles(clubId);
                fetchClubAndPrint(clubId, (freshClub) => {
                    const lines: string[] = [];
                    let cursor = 0;
                    for (const shake of printData.shakes) {
                        for (let i = 0; i < shake.qty; i++) {
                            const tokenNumber = printData.tokenNumbers[cursor++];
                            if (!tokenNumber) continue;
                            if (tokenToggles.printShakeToken) {
                                lines.push(...buildShakeTokenReceipt({
                                    memberName: printData.guestName,
                                    items: [{ name: shake.name, qty: 1, ice: shake.ice }],
                                    tokenNumber,
                                    timestamp: printData.timestamp,
                                }));
                            }
                            if (tokenToggles.printRefreshmentToken) {
                                lines.push(...buildAfreshToken({
                                    memberName: printData.guestName,
                                    tokenNumber,
                                    timestamp: printData.timestamp,
                                }));
                            }
                        }
                    }
                    lines.push(...buildGuestPaymentReceipt({
                        club: freshClub,
                        guestName: printData.guestName,
                        guestPhone: printData.guestPhone,
                        items: printData.items,
                        totalAmount: printData.totalAmount,
                        amountPaid: printData.amountPaid,
                        paymentMethod: printData.paymentMethod,
                        cashAmount: printData.cashAmount,
                        upiAmount: printData.upiAmount,
                        upiAccountName: printData.upiAccountName,
                        upiNumber: printData.upiNumber,
                        receiptNumber: printData.receiptNumber,
                        tokenNumbers: printData.tokenNumbers,
                        timestamp: printData.timestamp,
                    }));
                    return lines;
                });
            } catch (printErr) {
                console.error("[guest print]", printErr);
            }

            setStep("done");
            setTimeout(onClose, 2200);
        } catch (e: any) {
            setError(e.message || "Failed to save.");
            setStep("payment");
        }
    }

    // ─── STEP HEADER ────────────────────────────────────────────────────────
    const stepLabels: Record<Step, string> = {
        type: "Guest Type",
        info: "Phone & Name",
        items: "Select Items",
        faces: "Face Scan",
        payment: "Payment",
        saving: "Saving...",
        done: "Done!",
    };
    const stepOrder: Step[] = ["type", "info", "items", "faces", "payment"];
    const stepNumber = stepOrder.indexOf(step) + 1;
    const totalSteps = totalShakeQty > 0 ? 5 : 4;

    const availableShakes = shakeProducts.filter((p) => p.stock > 0);

    return (
        <div style={{ fontFamily: FONT, padding: 24 }}>
            {/* Header */}
            {step !== "saving" && step !== "done" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#1a3a2a" }}>👤 Add Guest</h2>
                        <p style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 700, color: "#9ca3af" }}>
                            Step {stepNumber > 0 ? stepNumber : "–"} of {totalSteps} · {stepLabels[step]}
                        </p>
                    </div>
                    <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
                </div>
            )}

            {step !== "saving" && step !== "done" && stepNumber > 0 && (
                <div style={{ height: 4, borderRadius: 2, background: "#f1f5f9", marginBottom: 20, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 2, background: GREEN, width: `${(stepNumber / totalSteps) * 100}%`, transition: "width 0.3s ease" }} />
                </div>
            )}

            {/* ═══════ STEP 1: PAID / UNPAID ═══════ */}
            {step === "type" && (
                <div>
                    <p style={{ fontSize: 15, fontWeight: 800, color: "#374151", marginBottom: 16 }}>Is this guest paying?</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <button
                            onClick={() => { setGuestType("unpaid"); setStep("info"); }}
                            style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 20px", background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 16, cursor: "pointer", fontFamily: FONT, textAlign: "left" }}
                        >
                            <span style={{ fontSize: 32 }}>🎁</span>
                            <div>
                                <div style={{ fontSize: 15, fontWeight: 900, color: "#16a34a" }}>Unpaid (Complimentary)</div>
                                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Free shakes / products — no payment</div>
                            </div>
                        </button>
                        <button
                            onClick={() => { setGuestType("paid"); setStep("info"); }}
                            style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 20px", background: "#eff6ff", border: "2px solid #93c5fd", borderRadius: 16, cursor: "pointer", fontFamily: FONT, textAlign: "left" }}
                        >
                            <span style={{ fontSize: 32 }}>💳</span>
                            <div>
                                <div style={{ fontSize: 15, fontWeight: 900, color: "#1d4ed8" }}>Paid Guest</div>
                                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>₹{GUEST_SHAKE_PRICE}/shake + product prices, total auto-calculated</div>
                            </div>
                        </button>
                    </div>
                </div>
            )}

            {/* ═══════ STEP 2: PHONE → NAME ═══════ */}
            {step === "info" && (
                <div>
                    <p style={{ fontSize: 15, fontWeight: 800, color: "#374151", marginBottom: 16 }}>Enter guest details</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div style={{ position: "relative" }}>
                            <label style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 6 }}>MOBILE NUMBER *</label>
                            <input
                                type="tel"
                                inputMode="numeric"
                                value={guestPhone}
                                onChange={(e) => setGuestPhone(e.target.value.replace(/\D/g, "").slice(0, 15))}
                                placeholder="10-digit number"
                                autoFocus
                                style={{ width: "100%", padding: "12px 14px", border: "2px solid #e5e7eb", borderRadius: 12, fontSize: 15, fontWeight: 600, fontFamily: FONT, outline: "none", boxSizing: "border-box" }}
                            />
                            {phoneSuggestions.length > 0 && (
                                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1px solid #e5e7eb", borderRadius: 12, marginTop: 4, boxShadow: "0 6px 16px rgba(0,0,0,0.08)", zIndex: 10, overflow: "hidden" }}>
                                    {phoneSuggestions.map((s) => (
                                        <button
                                            key={s.phone}
                                            onClick={() => { setGuestName(s.name); setGuestPhone(s.phone); setPhoneSuggestions([]); }}
                                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "10px 14px", background: "white", border: "none", cursor: "pointer", fontFamily: FONT, borderBottom: "1px solid #f1f5f9" }}
                                        >
                                            <div>
                                                <div style={{ fontWeight: 800, fontSize: 13, color: "#1a3a2a" }}>{s.name}</div>
                                                <div style={{ fontSize: 11, color: "#9ca3af" }}>{s.phone}</div>
                                            </div>
                                            <span style={{ fontSize: 10, color: "#9ca3af" }}>last: {s.lastDate || "—"}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 6 }}>NAME *</label>
                            <input
                                type="text"
                                value={guestName}
                                onChange={(e) => setGuestName(e.target.value)}
                                placeholder="Guest's full name"
                                style={{ width: "100%", padding: "12px 14px", border: "2px solid #e5e7eb", borderRadius: 12, fontSize: 15, fontWeight: 600, fontFamily: FONT, outline: "none", boxSizing: "border-box" }}
                            />
                        </div>
                    </div>
                    {error && <p style={{ color: "#dc2626", fontSize: 13, fontWeight: 700, marginTop: 10 }}>{error}</p>}
                    <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                        <button onClick={() => setStep("type")} style={{ flex: 1, padding: "12px", background: "#f1f5f9", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer", color: "#6b7280", fontFamily: FONT }}>← Back</button>
                        <button
                            onClick={() => {
                                if (!guestPhone.trim()) { setError("Enter phone number"); return; }
                                if (!guestName.trim()) { setError("Enter guest name"); return; }
                                setError("");
                                setStep("items");
                            }}
                            style={{ flex: 2, padding: "12px", background: GREEN, border: "none", borderRadius: 12, fontSize: 14, fontWeight: 900, cursor: "pointer", color: "white", fontFamily: FONT }}
                        >Next → Select Items</button>
                    </div>
                </div>
            )}

            {/* ═══════ STEP 3: ITEMS (multi-shake + multi-product) ═══════ */}
            {step === "items" && (
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, background: "#f8fafc", borderRadius: 12, padding: "10px 14px" }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>👤</div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 800, fontSize: 14, color: "#1a3a2a" }}>{guestName}</div>
                            <div style={{ fontSize: 11, color: "#9ca3af" }}>{guestPhone} · {guestType === "paid" ? "💳 Paid" : "🎁 Free"}</div>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                        <button
                            onClick={() => setActiveTab("shake")}
                            style={{ flex: 1, padding: "10px", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT, border: "none", background: activeTab === "shake" ? "#f3e8ff" : "#f1f5f9", color: activeTab === "shake" ? "#7c3aed" : "#64748b" }}
                        >🥤 Shakes</button>
                        <button
                            onClick={() => setActiveTab("product")}
                            style={{ flex: 1, padding: "10px", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT, border: "none", background: activeTab === "product" ? "#fef3c7" : "#f1f5f9", color: activeTab === "product" ? "#92400e" : "#64748b" }}
                        >📦 Products</button>
                    </div>

                    {/* Shake list — picking one adds with-ice / without-ice variant */}
                    {activeTab === "shake" && (
                        <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                            {shakesLoading ? (
                                <p style={{ textAlign: "center", color: "#9ca3af", padding: 16, fontSize: 13 }}>Loading...</p>
                            ) : availableShakes.length === 0 ? (
                                <p style={{ textAlign: "center", color: "#f59e0b", fontSize: 13, padding: 16, background: "#fffbeb", borderRadius: 12 }}>No shakes available today</p>
                            ) : (
                                availableShakes.map((p) => (
                                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "white" }}>
                                        {p.photo
                                            ? <img src={p.photo} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />
                                            : <div style={{ width: 36, height: 36, borderRadius: 8, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🥤</div>
                                        }
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 800, fontSize: 13, color: "#1a3a2a" }}>{p.name}</div>
                                            <div style={{ fontSize: 11, color: "#9ca3af" }}>Stock: {p.stock} · ₹{GUEST_SHAKE_PRICE}/ea</div>
                                        </div>
                                        <button onClick={() => addShake(p)} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "#dcfce7", color: "#16a34a", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>+ Add</button>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {/* Product list */}
                    {activeTab === "product" && (
                        <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                            {inventoryProducts.length === 0 ? (
                                <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: 16 }}>No products</p>
                            ) : (
                                inventoryProducts.map((p) => (
                                    <button
                                        key={p.id}
                                        onClick={() => addProduct(p)}
                                        disabled={(p.quantity ?? 0) <= 0}
                                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "white", cursor: (p.quantity ?? 0) > 0 ? "pointer" : "not-allowed", opacity: (p.quantity ?? 0) > 0 ? 1 : 0.5, textAlign: "left", fontFamily: FONT }}
                                    >
                                        {(p as any).imageUrl
                                            ? <img src={(p as any).imageUrl} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />
                                            : <div style={{ width: 36, height: 36, borderRadius: 8, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📦</div>
                                        }
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 800, fontSize: 13, color: "#1a3a2a" }}>{p.name}</div>
                                            <div style={{ fontSize: 11, color: "#9ca3af" }}>{p.quantity} {p.unit} in stock · ₹{(p as any).price ?? 0}/ea</div>
                                        </div>
                                        <span style={{ fontSize: 18, color: "#16a34a", fontWeight: 900 }}>+</span>
                                    </button>
                                ))
                            )}
                        </div>
                    )}

                    {/* Cart summary */}
                    {cart.length > 0 && (
                        <div style={{ marginTop: 16, background: "#f8fafc", borderRadius: 12, padding: 12 }}>
                            <p style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Cart ({cart.length})</p>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {cart.map((c, i) => (
                                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "white", padding: "8px 10px", borderRadius: 8 }}>
                                        <span style={{ fontSize: 16 }}>{c.kind === "shake" ? "🥤" : "📦"}</span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 800, fontSize: 12, color: "#1a3a2a" }}>{c.productName}</div>
                                            <div style={{ fontSize: 10, color: "#9ca3af" }}>
                                                {c.kind === "shake" ? `₹${GUEST_SHAKE_PRICE}/ea` : `${c.unit} · ₹${c.unitPrice}/ea`}
                                            </div>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <button onClick={() => decCartItem(i)} style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e5e7eb", background: "white", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>−</button>
                                            <span style={{ fontSize: 13, fontWeight: 900, minWidth: 18, textAlign: "center" }}>{c.qty}</span>
                                            <button onClick={() => incCartItem(i)} style={{ width: 26, height: 26, borderRadius: 6, border: "none", background: GREEN, color: "white", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>+</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {guestType === "paid" && (
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
                                    <span style={{ fontSize: 13, fontWeight: 800, color: "#374151" }}>Total</span>
                                    <span style={{ fontSize: 18, fontWeight: 900, color: GREEN }}>₹{totalAmount}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {error && <p style={{ color: "#dc2626", fontSize: 13, fontWeight: 700, marginTop: 10 }}>{error}</p>}

                    <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                        <button onClick={() => setStep("info")} style={{ flex: 1, padding: "12px", background: "#f1f5f9", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer", color: "#6b7280", fontFamily: FONT }}>← Back</button>
                        <button
                            onClick={() => {
                                if (cart.length === 0) { setError("Add at least one item"); return; }
                                setError("");
                                // NOT gated on faceOn. The photo is how the
                                // KITCHEN identifies a guest, which is a
                                // different job from face matching. Gating the
                                // way in on the matching switch is what stopped
                                // guest photos being taken at all — the step
                                // itself was fixed earlier, but nothing could
                                // reach it.
                                if (totalShakeQty > 0) {
                                    setCapturedFaces([]);
                                    setStep("faces");
                                } else {
                                    setStep("payment");
                                }
                            }}
                            style={{ flex: 2, padding: "12px", background: GREEN, border: "none", borderRadius: 12, fontSize: 14, fontWeight: 900, cursor: "pointer", color: "white", fontFamily: FONT }}
                        >{totalShakeQty > 0
                            ? `Next → ${faceOn ? "Scan" : "Photo"} ${totalShakeQty > 1 ? `${totalShakeQty} Guests` : "Guest"}`
                            : "Next → Payment"}</button>
                    </div>
                </div>
            )}

            {/* ═══════ STEP 4: FACES (sequential capture, one per shake) ═══════ */}
            {step === "faces" && (
                <div>
                    <p style={{ fontSize: 14, fontWeight: 800, color: "#374151", marginBottom: 6 }}>{currentCaptureLabel}</p>
                    <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 12 }}>Captured: {capturedFaces.length} / {totalShakeQty}</p>
                    <div style={{ position: "relative", width: "100%", aspectRatio: "4/3", background: "#0f172a", borderRadius: 16, overflow: "hidden", marginBottom: 12 }}>
                        <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                            <div style={{ width: 140, height: 180, border: `3px solid ${faceDetected ? "#22c55e" : "#ffffff80"}`, borderRadius: "50%", boxShadow: faceDetected ? "0 0 20px rgba(34,197,94,0.4)" : "none", transition: "all 0.3s" }} />
                        </div>
                        <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", background: faceDetected ? "#16a34a" : "#1e293b", color: "white", padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 800 }}>
                            {modelsLoaded ? cameraStatus : "Loading face models..."}
                        </div>
                    </div>
                    <canvas ref={canvasRef} style={{ display: "none" }} />

                    {/* Captured thumbnails */}
                    {capturedFaces.length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                            {capturedFaces.map((f, i) => (
                                <img key={i} src={f.url} style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", border: "2px solid #16a34a" }} />
                            ))}
                        </div>
                    )}

                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => { stopCamera(); setStep("items"); }} style={{ flex: 1, padding: "12px", background: "#f1f5f9", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer", color: "#6b7280", fontFamily: FONT }}>← Back</button>
                        <button onClick={skipRemainingFaces} style={{ flex: 1, padding: "12px", background: "#fef3c7", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer", color: "#92400e", fontFamily: FONT }}>Skip remaining →</button>
                        {/* With face matching off there is no auto-shutter, so
                            Capture must always be pressable — otherwise the
                            button sits greyed out forever and no guest photo is
                            ever taken. */}
                        {/* Also requires a live camera. capturePhoto's own guard
                            only checks that the <video> element exists, which it
                            always does, so with no stream it drew a blank frame
                            and "captured" nothing — the button appeared to work
                            and produced an empty photo. */}
                        <button
                            onClick={capturePhoto}
                            disabled={!cameraReady || (faceOn && !faceDetected)}
                            style={{ flex: 2, padding: "12px", background: (cameraReady && (!faceOn || faceDetected)) ? GREEN : "#94a3b8", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 900, cursor: (cameraReady && (!faceOn || faceDetected)) ? "pointer" : "not-allowed", color: "white", fontFamily: FONT }}
                        >📸 {cameraReady ? "Capture" : "Starting camera…"}</button>
                    </div>
                </div>
            )}

            {/* ═══════ STEP 5: PAYMENT ═══════ */}
            {step === "payment" && (
                <div>
                    <p style={{ fontSize: 15, fontWeight: 800, color: "#374151", marginBottom: 16 }}>{guestType === "paid" ? "Payment" : "Confirm complimentary entry"}</p>

                    <div style={{ background: "#f8fafc", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                        <p style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", marginBottom: 8 }}>Order Summary</p>
                        {cart.map((c, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#374151", marginBottom: 4 }}>
                                <span>{c.kind === "shake" ? "🥤" : "📦"} {c.productName} × {c.qty}</span>
                                <span>{guestType === "paid" ? `₹${c.kind === "shake" ? GUEST_SHAKE_PRICE * c.qty : c.unitPrice * c.qty}` : "FREE"}</span>
                            </div>
                        ))}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
                            <span style={{ fontSize: 14, fontWeight: 800, color: "#1a3a2a" }}>Total</span>
                            <span style={{ fontSize: 22, fontWeight: 900, color: GREEN }}>₹{guestType === "paid" ? totalAmount : 0}</span>
                        </div>
                    </div>

                    {guestType === "paid" && (
                        <div style={{ marginBottom: 16 }}>
                            <PaymentMethodPicker
                                total={totalAmount}
                                upiAccounts={upiAccounts}
                                value={payment}
                                onChange={setPayment}
                            />
                        </div>
                    )}

                    {error && <p style={{ color: "#dc2626", fontSize: 13, fontWeight: 700, marginTop: 10 }}>{error}</p>}

                    <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                        <button onClick={() => setStep(totalShakeQty > 0 ? "faces" : "items")} style={{ flex: 1, padding: "12px", background: "#f1f5f9", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer", color: "#6b7280", fontFamily: FONT }}>← Back</button>
                        <button onClick={handleSave} style={{ flex: 2, padding: "12px", background: GREEN, border: "none", borderRadius: 12, fontSize: 14, fontWeight: 900, cursor: "pointer", color: "white", fontFamily: FONT }}>
                            ✓ Save & Print
                        </button>
                    </div>
                </div>
            )}

            {/* ═══════ SAVING ═══════ */}
            {step === "saving" && (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
                    <p style={{ fontSize: 16, fontWeight: 800, color: "#374151" }}>Saving guest entry...</p>
                </div>
            )}

            {/* ═══════ DONE ═══════ */}
            {step === "done" && (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                    <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", fontSize: 30 }}>✓</div>
                    <p style={{ fontSize: 18, fontWeight: 900, color: "#1a3a2a" }}>Guest Entry Saved!</p>
                    <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                        {guestName} · {cart.length} item{cart.length !== 1 ? "s" : ""}
                        {guestType === "paid" ? ` · ₹${totalAmount}` : " · Complimentary"}
                    </p>
                    {totalShakeQty > 0 && (
                        <p style={{ fontSize: 12, color: GREEN, fontWeight: 700, marginTop: 8 }}>🥤 {totalShakeQty} shake{totalShakeQty > 1 ? "s" : ""} sent to kitchen</p>
                    )}
                    <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>🖨️ Token slip + receipt printed</p>
                </div>
            )}
        </div>
    );
}
