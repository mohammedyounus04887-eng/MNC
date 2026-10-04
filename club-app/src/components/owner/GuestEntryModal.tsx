import { useState, useEffect, useRef } from "react";
import { X, Camera, ShoppingBag, Package, CheckCircle2, Lock, RotateCcw, CameraOff } from "lucide-react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useAuth } from "@/lib/auth";
import { useAddGuestEntry, useUpdateGuestEntry } from "@/hooks/useGuestEntries";
import type { GuestEntry, InventoryProduct, Product } from "@/types/firestore";
import PaymentMethodPicker, { emptyPaymentSelection, validatePayment, type PaymentSelection } from "@/components/PaymentMethodPicker";

type GuestType = "paid" | "unpaid";
type ItemType = "shake" | "inventory_product" | "membership_plan";
type UpiAccount = { id: string; app: string; number: string; holderName: string };

interface GuestEntryModalProps {
    onClose: () => void;
    /** Pass an existing entry to open in edit mode */
    editEntry?: GuestEntry;
    /** Club ID override (needed when opened from Reports history page) */
    clubIdOverride?: string;
}

export default function GuestEntryModal({ onClose, editEntry, clubIdOverride }: GuestEntryModalProps) {
    const { club } = useClubContext();
    const { userProfile } = useAuth();
    const isEditMode = !!editEntry;

    const addGuestEntry = useAddGuestEntry();
    const updateGuestEntry = useUpdateGuestEntry();

    const [inventoryProducts, setInventoryProducts] = useState<InventoryProduct[]>([]);
    const [menuProducts, setMenuProducts] = useState<Product[]>([]);
    const [menuLoading, setMenuLoading] = useState(true);
    const effectiveClubId = clubIdOverride || club?.id;

    // Load inventory (any qty) so audit can still record a given item even if stock was already zeroed.
    useEffect(() => {
        if (!effectiveClubId) return;
        const unsub = onSnapshot(collection(db, `clubs/${effectiveClubId}/inventory`), (snap) => {
            setInventoryProducts(
                snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InventoryProduct)
            );
        });
        return () => unsub();
    }, [effectiveClubId]);

    // Load the full menu (not just today's special) so audit entries never get blocked by
    // "no shakes available today". Today's specials are just shown first.
    useEffect(() => {
        if (!effectiveClubId) return;
        const unsub = onSnapshot(collection(db, `clubs/${effectiveClubId}/menu`), (snap) => {
            setMenuProducts(
                snap.docs
                    .map((d) => ({ id: d.id, ...d.data() }) as Product)
                    .filter((p) => !p.isDeleted)
            );
            setMenuLoading(false);
        });
        return () => unsub();
    }, [effectiveClubId]);

    const upiAccounts: UpiAccount[] = ((club as any)?.upiAccounts ?? []) as UpiAccount[];

    // ── Form state — seeded from editEntry when in edit mode ──
    const [guestName, setGuestName] = useState(editEntry?.guestName ?? "");
    const [guestPhone, setGuestPhone] = useState(editEntry?.guestPhone ?? "");
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(editEntry?.guestPhoto ?? null);
    const [guestType, setGuestType] = useState<GuestType>(editEntry?.type ?? "unpaid");
    const [itemType, setItemType] = useState<ItemType>(editEntry?.itemType ?? "shake");
    const [selectedShake, setSelectedShake] = useState<Product | null>(null);
    const [selectedInvProduct, setSelectedInvProduct] = useState<InventoryProduct | null>(null);
    const [invQty, setInvQty] = useState(editEntry?.inventoryQuantity ?? 1);
    const [amountPaid, setAmountPaid] = useState(editEntry?.amountPaid?.toString() ?? "");
    const [payment, setPayment] = useState<PaymentSelection>(() => {
        const m = (editEntry?.paymentMethod as any) ?? 'cash';
        const amt = editEntry?.amountPaid ?? 0;
        return {
            method: m,
            cashAmount: m === 'cash' ? amt : (editEntry?.cashAmount ?? 0),
            upiAmount: m === 'upi' ? amt : (editEntry?.upiAmount ?? 0),
            upiAccountId: editEntry?.upiAccountId,
            upiAccountName: editEntry?.upiAccountName,
            upiNumber: editEntry?.upiNumber,
        };
    });
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);

    // ── Camera state ──
    const [cameraOpen, setCameraOpen] = useState(false);
    const [cameraError, setCameraError] = useState("");
    const [facing, setFacing] = useState<"user" | "environment">("user");
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    function stopCamera() {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }
        setCameraOpen(false);
    }

    async function openCamera(nextFacing: "user" | "environment" = facing) {
        setCameraError("");
        try {
            // Stop any existing stream first (if switching camera)
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: nextFacing, width: { ideal: 720 }, height: { ideal: 720 } },
                audio: false,
            });
            streamRef.current = stream;
            setFacing(nextFacing);
            setCameraOpen(true);
        } catch (err: any) {
            setCameraError(err?.message || "Could not access camera. You can skip the photo.");
            setCameraOpen(false);
        }
    }

    // Attach stream to <video> once it's mounted.
    useEffect(() => {
        if (cameraOpen && videoRef.current && streamRef.current) {
            videoRef.current.srcObject = streamRef.current;
            videoRef.current.play().catch(() => { });
        }
    }, [cameraOpen]);

    // Cleanup on unmount.
    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
            }
        };
    }, []);

    function capturePhoto() {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0);
        canvas.toBlob(
            (blob) => {
                if (!blob) return;
                const file = new File([blob], `guest_${Date.now()}.jpg`, { type: "image/jpeg" });
                setPhotoFile(file);
                if (photoPreview && photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
                setPhotoPreview(URL.createObjectURL(blob));
                stopCamera();
            },
            "image/jpeg",
            0.85
        );
    }

    function clearPhoto() {
        if (photoPreview && photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
        setPhotoFile(null);
        setPhotoPreview(null);
    }

    function validate(): string | null {
        if (!guestName.trim()) return "Please enter guest name.";
        if (!guestPhone.trim()) return "Please enter guest phone number.";
        if (!isEditMode) {
            if (itemType === "shake" && !selectedShake) return "Please select what was given (shake).";
            if (itemType === "inventory_product" && !selectedInvProduct) return "Please select a product.";
        }
        if (guestType === "paid") {
            if (!amountPaid || parseFloat(amountPaid) <= 0) return "Please enter a valid amount paid.";
            const v = validatePayment(payment, parseFloat(amountPaid), { requireUpiAccount: upiAccounts.length > 0 });
            if (!v.ok) return v.reason ?? "Complete the payment details.";
        }
        return null;
    }

    async function handleSave() {
        const err = validate();
        if (err) { setError(err); return; }
        setError("");
        setSaving(true);
        try {
            if (isEditMode && editEntry) {
                await updateGuestEntry.mutateAsync({
                    entryId: editEntry.id,
                    clubId: effectiveClubId!,
                    guestName: guestName.trim(),
                    guestPhone: guestPhone.trim(),
                    type: guestType,
                    amountPaid: guestType === "paid" ? parseFloat(amountPaid) : undefined,
                    paymentMethod: guestType === "paid" ? payment.method : undefined,
                    cashAmount: guestType === "paid" ? payment.cashAmount : undefined,
                    upiAmount: guestType === "paid" ? payment.upiAmount : undefined,
                    upiAccountId: guestType === "paid" ? payment.upiAccountId : undefined,
                    upiAccountName: guestType === "paid" ? payment.upiAccountName : undefined,
                    upiNumber: guestType === "paid" ? payment.upiNumber : undefined,
                    existingEntry: editEntry,
                });
            } else {
                // Owner-side manual entry only adds one item at a time. Build a
                // single-element items[] array so the new multi-item hook accepts it.
                const totalPaid = guestType === "paid" ? parseFloat(amountPaid) || 0 : 0;
                const isShake = itemType === "shake";
                const qty = isShake ? 1 : invQty;
                const unitPrice = totalPaid > 0 ? totalPaid / qty : 0;
                await addGuestEntry.mutateAsync({
                    guestName: guestName.trim(),
                    guestPhone: guestPhone.trim(),
                    type: guestType,
                    items: [
                        isShake
                            ? {
                                type: "shake",
                                productId: selectedShake?.id ?? "",
                                productName: selectedShake?.name ?? "",
                                qty: 1,
                                unitPrice,
                                faceFiles: photoFile ? [photoFile] : [],
                            }
                            : {
                                type: "inventory_product",
                                productId: selectedInvProduct?.id ?? "",
                                productName: selectedInvProduct?.name ?? "",
                                qty: invQty,
                                unitPrice,
                                unit: selectedInvProduct?.unit,
                            },
                    ],
                    totalAmount: totalPaid,
                    amountPaid: totalPaid,
                    paymentMethod: guestType === "paid" ? payment.method : undefined,
                    cashAmount: guestType === "paid" ? payment.cashAmount : undefined,
                    upiAmount: guestType === "paid" ? payment.upiAmount : undefined,
                    upiAccountId: guestType === "paid" ? payment.upiAccountId : undefined,
                    upiAccountName: guestType === "paid" ? payment.upiAccountName : undefined,
                    upiNumber: guestType === "paid" ? payment.upiNumber : undefined,
                    recordedBy: userProfile?.name || userProfile?.email || "owner",
                });
            }
            setSuccess(true);
            setTimeout(onClose, 1200);
        } catch (e: any) {
            setError(e.message || "Failed to save guest entry.");
        } finally {
            setSaving(false);
        }
    }

    // ── Success screen ──
    if (success) {
        return (
            <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
                <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden" style={{ fontFamily: "'Nunito', sans-serif" }}>
                    <div className="py-12 text-center px-5">
                        <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                        </div>
                        <p className="font-black text-slate-900 text-lg">{isEditMode ? "Entry Updated!" : "Guest Entry Saved!"}</p>
                        <p className="text-sm text-slate-500 mt-1">
                            {isEditMode
                                ? "Guest details have been updated."
                                : "Recorded in today's report."}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // ── Camera capture full-screen overlay ──
    if (cameraOpen) {
        return (
            <div className="fixed inset-0 z-[70] bg-black flex flex-col" style={{ fontFamily: "'Nunito', sans-serif" }}>
                <div className="flex items-center justify-between px-4 py-3 text-white">
                    <button onClick={stopCamera} className="p-2 rounded-full hover:bg-white/10">
                        <X className="w-6 h-6" />
                    </button>
                    <span className="text-sm font-bold">Capture guest photo</span>
                    <button
                        onClick={() => openCamera(facing === "user" ? "environment" : "user")}
                        className="p-2 rounded-full hover:bg-white/10"
                        title="Flip camera"
                    >
                        <RotateCcw className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 flex items-center justify-center overflow-hidden bg-black">
                    <video
                        ref={videoRef}
                        playsInline
                        muted
                        autoPlay
                        className="w-full h-full object-cover"
                        style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
                    />
                </div>

                <div className="p-6 flex items-center justify-center gap-6 bg-black">
                    <button
                        onClick={stopCamera}
                        className="px-5 py-3 rounded-2xl bg-white/10 text-white font-bold text-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={capturePhoto}
                        className="w-20 h-20 rounded-full bg-white border-4 border-white/40 shadow-lg active:scale-95 transition-transform flex items-center justify-center"
                        aria-label="Capture"
                    >
                        <span className="w-16 h-16 rounded-full bg-white ring-2 ring-slate-900" />
                    </button>
                    <button
                        onClick={() => {
                            stopCamera();
                        }}
                        className="px-5 py-3 rounded-2xl bg-white/10 text-white font-bold text-sm invisible"
                        tabIndex={-1}
                    >
                        Skip
                    </button>
                </div>
            </div>
        );
    }

    // Sort: today's specials first (by availableDate or isAvailableToday), then the rest by name.
    const todayStr = new Date().toISOString().slice(0, 10);
    const shakesForSelection = [...menuProducts].sort((a, b) => {
        const aToday = a.isAvailableToday || a.availableDate === todayStr ? 0 : 1;
        const bToday = b.isAvailableToday || b.availableDate === todayStr ? 0 : 1;
        if (aToday !== bToday) return aToday - bToday;
        return (a.name || "").localeCompare(b.name || "");
    });

    return (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]" style={{ fontFamily: "'Nunito', sans-serif" }}>

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b">
                    <div>
                        <h2 className="text-base font-black text-slate-900">
                            {isEditMode ? "Edit Guest Entry" : "Add Missed Guest"}
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {isEditMode ? "Update guest details" : "Quick audit entry — recorded in today's report"}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="overflow-y-auto flex-1 p-5 space-y-4">

                    {/* Guest photo + info */}
                    <div className="flex items-start gap-4">
                        {/* Photo: tap to open camera */}
                        <div className="flex-shrink-0">
                            <button
                                onClick={() => openCamera(facing)}
                                className="w-16 h-16 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center gap-1 hover:bg-slate-100 transition-colors overflow-hidden"
                                type="button"
                            >
                                {photoPreview ? (
                                    <img src={photoPreview} alt="Guest" className="w-full h-full object-cover" />
                                ) : (
                                    <>
                                        <Camera className="w-5 h-5 text-slate-400" />
                                        <span className="text-[9px] font-bold text-slate-400">CAMERA</span>
                                    </>
                                )}
                            </button>
                            {photoPreview && (
                                <button
                                    onClick={clearPhoto}
                                    type="button"
                                    className="mt-1 w-16 text-[10px] text-slate-500 hover:text-red-600 flex items-center justify-center gap-1"
                                >
                                    <CameraOff className="w-3 h-3" /> remove
                                </button>
                            )}
                        </div>

                        {/* Name + phone */}
                        <div className="flex-1 space-y-2">
                            <input
                                type="text"
                                value={guestName}
                                onChange={(e) => setGuestName(e.target.value)}
                                placeholder="Guest name *"
                                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-400"
                            />
                            <input
                                type="tel"
                                value={guestPhone}
                                onChange={(e) => setGuestPhone(e.target.value)}
                                placeholder="Phone number *"
                                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-400"
                            />
                        </div>
                    </div>

                    {cameraError && (
                        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl">
                            Camera unavailable — {cameraError}. You can save without a photo.
                        </p>
                    )}

                    {/* Guest type: Paid / Unpaid */}
                    <div>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Guest Type</p>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setGuestType("unpaid")}
                                className={`py-2.5 rounded-xl border text-sm font-bold transition-colors ${guestType === "unpaid" ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                            >
                                Unpaid (Free)
                            </button>
                            <button
                                onClick={() => setGuestType("paid")}
                                className={`py-2.5 rounded-xl border text-sm font-bold transition-colors ${guestType === "paid" ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                            >
                                Paid
                            </button>
                        </div>
                    </div>

                    {/* Item given — read-only in edit mode */}
                    {isEditMode ? (
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                            <Lock className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Item Given (cannot change)</p>
                                <p className="text-sm font-bold text-slate-800 mt-0.5">
                                    {editEntry?.itemType === "shake"
                                        ? `🥤 ${editEntry.shakeProductName}`
                                        : `📦 ${editEntry?.inventoryProductName} × ${editEntry?.inventoryQuantity ?? 1} ${editEntry?.inventoryProductUnit ?? ""}`}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Item type: Shake / Inventory product */}
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">What was given?</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => { setItemType("shake"); setSelectedInvProduct(null); }}
                                        className={`flex flex-col items-center gap-1 p-3 rounded-2xl border text-xs font-bold transition-colors ${itemType === "shake" ? "bg-purple-50 border-purple-300 text-purple-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                                    >
                                        <ShoppingBag className="w-4 h-4" />
                                        Shake
                                    </button>
                                    <button
                                        onClick={() => { setItemType("inventory_product"); setSelectedShake(null); }}
                                        className={`flex flex-col items-center gap-1 p-3 rounded-2xl border text-xs font-bold transition-colors ${itemType === "inventory_product" ? "bg-amber-50 border-amber-300 text-amber-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                                    >
                                        <Package className="w-4 h-4" />
                                        Product / Gift
                                    </button>
                                </div>
                            </div>

                            {/* Shake selection — always shows all menu items, today's special first */}
                            {itemType === "shake" && (
                                <div>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Select Shake</p>
                                    {menuLoading ? (
                                        <p className="text-xs text-slate-400 py-3 text-center">Loading menu...</p>
                                    ) : shakesForSelection.length === 0 ? (
                                        <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-center">
                                            No menu items set up yet. Add one from the Menu screen first.
                                        </p>
                                    ) : (
                                        <div className="space-y-2 max-h-48 overflow-y-auto">
                                            {shakesForSelection.map((p) => {
                                                const isToday = p.isAvailableToday || p.availableDate === todayStr;
                                                return (
                                                    <button key={p.id} onClick={() => setSelectedShake(p)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm transition-colors ${selectedShake?.id === p.id ? "bg-purple-50 border-purple-300" : "border-slate-200 hover:bg-slate-50"}`}
                                                    >
                                                        {p.photo ? <img src={p.photo} className="w-9 h-9 rounded-lg object-cover" /> : <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-base">🥤</div>}
                                                        <div className="flex-1 text-left">
                                                            <p className="font-bold text-slate-900 text-xs">{p.name}</p>
                                                            <p className="text-[10px] text-slate-400">
                                                                {isToday ? <span className="text-emerald-600 font-bold">Today's special</span> : "Menu item"}
                                                                {" · "}Stock: {p.stock ?? 0}
                                                            </p>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Inventory product selection */}
                            {itemType === "inventory_product" && (
                                <div>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Select Product / Gift</p>
                                    {inventoryProducts.length === 0 ? (
                                        <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-center">
                                            No inventory products set up.
                                        </p>
                                    ) : (
                                        <div className="space-y-2 max-h-48 overflow-y-auto">
                                            {inventoryProducts.map((p) => (
                                                <button key={p.id} onClick={() => { setSelectedInvProduct(p); setInvQty(1); }}
                                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm transition-colors ${selectedInvProduct?.id === p.id ? "bg-amber-50 border-amber-300" : "border-slate-200 hover:bg-slate-50"}`}
                                                >
                                                    {p.imageUrl ? <img src={p.imageUrl} className="w-9 h-9 rounded-lg object-cover" /> : <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-base">📦</div>}
                                                    <div className="flex-1 text-left">
                                                        <p className="font-bold text-slate-900 text-xs">{p.name}</p>
                                                        <p className="text-[10px] text-slate-400">Stock: {p.quantity} {p.unit}</p>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {selectedInvProduct && (
                                        <div className="mt-3">
                                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Quantity</p>
                                            <div className="flex items-center gap-3">
                                                <button onClick={() => setInvQty(Math.max(1, invQty - 1))} className="w-10 h-10 rounded-xl border border-slate-200 font-bold text-slate-700">−</button>
                                                <input type="number" min="1" value={invQty}
                                                    onChange={(e) => setInvQty(Math.max(1, Number(e.target.value) || 1))}
                                                    className="w-20 text-center px-3 py-2 border border-slate-200 rounded-xl text-sm font-bold" />
                                                <button onClick={() => setInvQty(invQty + 1)} className="w-10 h-10 rounded-xl bg-emerald-600 text-white font-bold">+</button>
                                                <span className="text-xs text-slate-500">{selectedInvProduct.unit}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {/* Payment details for paid guests */}
                    {guestType === "paid" && (
                        <>
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Amount Paid (₹)</p>
                                <input
                                    type="number" min="1" value={amountPaid}
                                    onChange={(e) => setAmountPaid(e.target.value)} placeholder="0"
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400"
                                />
                                <p className="text-[10px] text-slate-400 mt-1 px-1">Enter the actual amount paid (can be an offer/discounted price)</p>
                            </div>
                            <div>
                                <PaymentMethodPicker
                                    total={parseFloat(amountPaid) || 0}
                                    upiAccounts={upiAccounts}
                                    value={payment}
                                    onChange={setPayment}
                                />
                            </div>
                        </>
                    )}

                    {/* Summary pill */}
                    {guestName && (isEditMode || (itemType === "shake" ? selectedShake : selectedInvProduct)) && (
                        <div className={`rounded-2xl px-4 py-3 border text-sm font-semibold ${guestType === "paid" ? "bg-blue-50 border-blue-200 text-blue-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
                            <p className="font-black">{guestType === "paid" ? "💳 Paid Guest" : "🎁 Complimentary"}</p>
                            <p className="text-xs mt-0.5 opacity-80">
                                {guestName}
                                {isEditMode
                                    ? ` · ${editEntry?.shakeProductName || editEntry?.inventoryProductName}`
                                    : ` · ${itemType === "shake" ? selectedShake?.name : `${invQty} ${selectedInvProduct?.unit} ${selectedInvProduct?.name}`}`}
                                {guestType === "paid" && amountPaid ? ` · ₹${amountPaid}` : ""}
                            </p>
                        </div>
                    )}

                    {error && (
                        <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{error}</p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t bg-white">
                    <button onClick={handleSave} disabled={saving}
                        className="w-full py-3 rounded-2xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 transition-colors disabled:opacity-60"
                    >
                        {saving ? "Saving..." : isEditMode ? "Update Guest Entry" : "Save Guest Entry"}
                    </button>
                </div>
            </div>
        </div>
    );
}
