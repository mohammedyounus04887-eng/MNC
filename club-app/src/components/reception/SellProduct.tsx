import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { useSaveProductSale } from "@/hooks/useInventoryManagement";
import FaceVerification from "@/components/FaceVerification";
import type { InventoryProduct } from "@/types/firestore";
import PaymentMethodPicker, { emptyPaymentSelection, validatePayment, type PaymentSelection, type UpiAccount } from "@/components/PaymentMethodPicker";
import { doc as firestoreDoc, onSnapshot as onSnapshotDoc } from "firebase/firestore";
import { fetchClubAndPrint, generateTxnId } from "@/utils/printReceipt";
import { buildProductSaleReceipt } from "@/utils/receiptBuilder";

const GREEN = "#2d9653";

interface Props {
    clubId: string;
    onClose: () => void;
    initialProductName?: string;
}

type Step = "select_product" | "select_buyer" | "payment" | "verify_accountant" | "verify_inventory" | "done";

export default function SellProduct({ clubId, onClose, initialProductName }: Props) {
    const { toast } = useToast();
    const saveSale = useSaveProductSale();

    const [step, setStep] = useState<Step>("select_product");
    const [products, setProducts] = useState<InventoryProduct[]>([]);
    const [members, setMembers] = useState<any[]>([]);
    const [accountants, setAccountants] = useState<any[]>([]);
    const [inventoryManagers, setInventoryManagers] = useState<any[]>([]);
    const [search, setSearch] = useState("");

    // Selections
    const [selectedProduct, setSelectedProduct] = useState<InventoryProduct | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [selectedBuyer, setSelectedBuyer] = useState<any>(null);
    const [isGift, setIsGift] = useState(false);
    const [payment, setPayment] = useState<PaymentSelection>(emptyPaymentSelection);
    const [accountantVerifier, setAccountantVerifier] = useState<{ id: string; name: string } | null>(null);
    const [upiAccounts, setUpiAccounts] = useState<UpiAccount[]>([]);
    useEffect(() => {
        const unsub = onSnapshotDoc(firestoreDoc(db, "clubs", clubId), (snap) => {
            const raw = snap.data() as any;
            setUpiAccounts(((raw?.upiAccounts ?? []) as UpiAccount[]));
        });
        return () => unsub();
    }, [clubId]);

    // Fetch data
    useEffect(() => {
        if (!clubId) return;
        const unsub1 = onSnapshot(collection(db, "clubs", clubId, "inventory"), (snap) => {
            const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InventoryProduct);
            setProducts(items.filter((p) => p.isForSale && p.quantity > 0));
        });
        const unsub2 = onSnapshot(collection(db, "clubs", clubId, "members"), (snap) => {
            setMembers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        const unsub3 = onSnapshot(collection(db, "clubs", clubId, "accountants"), (snap) => {
            setAccountants(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        // Inventory managers live in their own collection now — keeping them
        // separate from accountants ensures the inventory verification step
        // shows the right faces (not the cashier's). Falls back to accountants
        // only if no inventory manager has been assigned yet.
        const unsub4 = onSnapshot(collection(db, "clubs", clubId, "inventoryManagers"), (snap) => {
            const mgrs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setInventoryManagers(mgrs);
        });
        return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
    }, [clubId]);

    // Fallback to accountants only if NO inventory manager is configured yet —
    // prevents existing clubs from being unable to verify product sales until
    // they assign their first inventory manager via Settings.
    const inventoryVerifiers = inventoryManagers.length > 0 ? inventoryManagers : accountants;

    // Pre-select a product by name when opened from a quick-action button
    useEffect(() => {
        if (!initialProductName || selectedProduct || products.length === 0) return;
        const needle = initialProductName.trim().toLowerCase();
        const match = products.find((p) => p.name?.toLowerCase().includes(needle));
        if (match) setSelectedProduct(match);
    }, [initialProductName, products, selectedProduct]);

    const totalAmount = (selectedProduct?.price || 0) * quantity;

    const handleAccountantVerified = (verifier: { id: string; name: string }) => {
        setAccountantVerifier(verifier);
        setStep("verify_inventory");
    };

    const handleInventoryVerified = async (verifier: { id: string; name: string }) => {
        if (!selectedProduct || !selectedBuyer || !accountantVerifier) return;
        try {
            await saveSale.mutateAsync({
                productId: selectedProduct.id,
                productName: selectedProduct.name,
                quantity,
                unit: selectedProduct.unit,
                price: selectedProduct.price,
                totalAmount: isGift ? 0 : totalAmount,
                buyerId: selectedBuyer.id,
                buyerName: selectedBuyer.name,
                isGift,
                paymentMethod: isGift ? "cash" : payment.method,
                cashAmount: isGift ? 0
                          : payment.method === "cash" ? totalAmount
                          : payment.method === "split" ? payment.cashAmount
                          : 0,
                upiAmount: isGift ? 0
                         : payment.method === "upi" ? totalAmount
                         : payment.method === "split" ? payment.upiAmount
                         : 0,
                upiAccountId: !isGift && payment.method !== "cash" ? payment.upiAccountId : undefined,
                upiAccountName: !isGift && payment.method !== "cash" ? payment.upiAccountName : undefined,
                upiNumber: !isGift && payment.method !== "cash" ? payment.upiNumber : undefined,
                accountantVerifiedBy: accountantVerifier.name,
                accountantVerifiedById: accountantVerifier.id,
                inventoryVerifiedBy: verifier.name,
                inventoryVerifiedById: verifier.id,
            });

            // Auto-print product sale receipt
            try {
                fetchClubAndPrint(clubId, (freshClub) => buildProductSaleReceipt({
                    club: freshClub,
                    buyerName: selectedBuyer.name,
                    buyerId: selectedBuyer.memberId || selectedBuyer.id,
                    productName: selectedProduct.name,
                    quantity,
                    unit: selectedProduct.unit,
                    unitPrice: selectedProduct.price,
                    totalAmount: isGift ? 0 : totalAmount,
                    isGift,
                    paymentMethod: isGift ? 'cash' : payment.method,
                    cashAmount: isGift ? 0 : payment.method === 'cash' ? totalAmount : payment.method === 'split' ? payment.cashAmount : 0,
                    upiAmount: isGift ? 0 : payment.method === 'upi' ? totalAmount : payment.method === 'split' ? payment.upiAmount : 0,
                    upiAccountName: !isGift && payment.method !== 'cash' ? payment.upiAccountName : undefined,
                    accountantVerifiedBy: accountantVerifier.name,
                    inventoryVerifiedBy: verifier.name,
                    receiptNumber: generateTxnId(),
                    timestamp: new Date(),
                }));
            } catch (printErr) {
                console.error('[product sale print]', printErr);
            }

            setStep("done");
        } catch (err: any) {
            toast({ title: "Error saving sale", description: err.message, variant: "destructive" });
            setStep("payment");
        }
    };

    // Done
    if (step === "done") {
        return (
            <div style={{ padding: 24, textAlign: "center", fontFamily: "Nunito, sans-serif" }}>
                <div style={{ fontSize: 60, marginBottom: 16 }}>{isGift ? "🎁" : "✅"}</div>
                <h3 style={{ fontSize: 22, fontWeight: 900, color: "#1a3a2a", marginBottom: 8 }}>
                    {isGift ? "Gift Recorded!" : "Sale Complete!"}
                </h3>
                <p style={{ fontSize: 14, color: "#6b7280" }}>
                    {selectedProduct?.name} x{quantity} {isGift ? "gifted to" : "sold to"} {selectedBuyer?.name}
                </p>
                {!isGift && <p style={{ fontSize: 16, fontWeight: 700, color: GREEN }}>Total: ₹{totalAmount}</p>}
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
                    <button onClick={() => { setStep("select_product"); setSelectedProduct(null); setSelectedBuyer(null); setQuantity(1); setIsGift(false); setAccountantVerifier(null); }} style={{
                        padding: "12px 28px", borderRadius: 12, border: "none", background: GREEN,
                        color: "white", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Sell Another</button>
                    <button onClick={onClose} style={{
                        padding: "12px 28px", borderRadius: 12, border: "1.5px solid #e0f0e9",
                        background: "white", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Close</button>
                </div>
            </div>
        );
    }

    // Verify inventory manager
    if (step === "verify_inventory") {
        return (
            <FaceVerification
                clubId={clubId}
                verifiers={inventoryVerifiers.map((m) => ({
                    id: m.id, name: m.name, photo: m.photoUrl || m.photo,
                    faceDescriptor: m.faceDescriptor, role: "Inventory Manager",
                }))}
                title="Inventory Manager Verification"
                subtitle={`${selectedProduct?.name} x${quantity} to ${selectedBuyer?.name}`}
                onVerified={handleInventoryVerified}
                onCancel={() => setStep("payment")}
            />
        );
    }

    // Verify accountant
    if (step === "verify_accountant") {
        return (
            <FaceVerification
                clubId={clubId}
                verifiers={accountants.map((m) => ({
                    id: m.id, name: m.name, photo: m.photoUrl || m.photo,
                    faceDescriptor: m.faceDescriptor, role: "Accountant",
                }))}
                title="Accountant Verification"
                subtitle={isGift ? `Gift: ${selectedProduct?.name}` : `Sale: ₹${totalAmount}`}
                onVerified={handleAccountantVerified}
                onCancel={() => setStep("payment")}
            />
        );
    }

    // Payment details
    if (step === "payment") {
        return (
            <div style={{ padding: 24, fontFamily: "Nunito, sans-serif" }}>
                <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", marginBottom: 16, textAlign: "center" }}>
                    Payment Details
                </h3>

                <div style={{ background: "#f0fdf4", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a2a" }}>{selectedProduct?.name}</div>
                    <div style={{ fontSize: 13, color: "#6b7280" }}>
                        Qty: {quantity} {selectedProduct?.unit} · Price: ₹{selectedProduct?.price}/{selectedProduct?.unit}
                    </div>
                    <div style={{ fontSize: 13, color: "#6b7280" }}>Buyer: {selectedBuyer?.name}</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: GREEN, marginTop: 8 }}>
                        Total: ₹{totalAmount}
                    </div>
                </div>

                {/* Gift toggle */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: "12px 16px", background: isGift ? "#fef3c7" : "white", borderRadius: 10, border: "1.5px solid #e0f0e9" }}>
                    <button
                        onClick={() => setIsGift(!isGift)}
                        style={{
                            width: 44, height: 24, borderRadius: 12, border: "none",
                            background: isGift ? "#f59e0b" : "#d1d5db", cursor: "pointer",
                            position: "relative", transition: "background 0.2s",
                        }}
                    >
                        <div style={{
                            width: 20, height: 20, borderRadius: "50%", background: "white",
                            position: "absolute", top: 2, left: isGift ? 22 : 2, transition: "left 0.2s",
                        }} />
                    </button>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a2a" }}>🎁 This is a gift</div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>No payment will be collected</div>
                    </div>
                </div>

                {/* Payment method (only if not gift) */}
                {!isGift && (
                    <div style={{ marginBottom: 20 }}>
                        <PaymentMethodPicker
                            total={totalAmount}
                            upiAccounts={upiAccounts}
                            value={payment}
                            onChange={setPayment}
                        />
                    </div>
                )}

                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <button onClick={() => setStep("select_buyer")} style={{
                        padding: "12px 28px", borderRadius: 12, border: "1.5px solid #e0f0e9",
                        background: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Back</button>
                    <button
                        onClick={() => {
                            if (!isGift) {
                                const v = validatePayment(payment, totalAmount, { requireUpiAccount: upiAccounts.length > 0 });
                                if (!v.ok) { toast({ title: "Payment incomplete", description: v.reason, variant: "destructive" }); return; }
                            }
                            setStep("verify_accountant");
                        }}
                        style={{
                        padding: "12px 28px", borderRadius: 12, border: "none", background: GREEN,
                        color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Verify & Sell</button>
                </div>
            </div>
        );
    }

    // Select buyer
    if (step === "select_buyer") {
        const filteredMembers = members.filter((m) =>
            !search || m.name?.toLowerCase().includes(search.toLowerCase()) || m.phone?.includes(search)
        );
        return (
            <div style={{ padding: 24, fontFamily: "Nunito, sans-serif" }}>
                <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", marginBottom: 4, textAlign: "center" }}>
                    Select Buyer
                </h3>
                <p style={{ fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 12 }}>
                    {selectedProduct?.name} x{quantity}
                </p>
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search member..."
                    style={{
                        width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9",
                        fontSize: 14, outline: "none", fontFamily: "Nunito, sans-serif", marginBottom: 12,
                        boxSizing: "border-box",
                    }}
                />
                <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                    {filteredMembers.map((m) => (
                        <button
                            key={m.id}
                            onClick={() => { setSelectedBuyer(m); setSearch(""); setStep("payment"); }}
                            style={{
                                display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                                background: "white", border: "1.5px solid #e0f0e9", borderRadius: 10,
                                cursor: "pointer", fontFamily: "Nunito, sans-serif", textAlign: "left",
                            }}
                        >
                            <div style={{
                                width: 40, height: 40, borderRadius: "50%", background: "#f0fdf4",
                                overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                                {(m.photoUrl || m.photo) ? <img src={m.photoUrl || m.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                                    : <span style={{ fontSize: 16, fontWeight: 700, color: GREEN }}>{(m.name || "?")[0]}</span>}
                            </div>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a2a" }}>{m.name}</div>
                                <div style={{ fontSize: 12, color: "#6b7280" }}>{m.phone || ""}</div>
                            </div>
                        </button>
                    ))}
                </div>
                <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                    <button onClick={() => { setStep("select_product"); setSearch(""); }} style={{
                        padding: "10px 24px", borderRadius: 10, border: "1.5px solid #e0f0e9",
                        background: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Back</button>
                </div>
            </div>
        );
    }

    // Select product
    const filteredProducts = products.filter((p) =>
        !search || p.name.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div style={{ padding: 24, fontFamily: "Nunito, sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", margin: 0 }}>Sell Product</h3>
                <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>

            {selectedProduct ? (
                <div style={{ marginBottom: 16 }}>
                    <div style={{ background: "#f0fdf4", borderRadius: 12, padding: 16, marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 50, height: 50, borderRadius: 10, background: "#f3f4f6", overflow: "hidden", flexShrink: 0 }}>
                            {selectedProduct.imageUrl ? <img src={selectedProduct.imageUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                                : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>📦</div>}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a2a" }}>{selectedProduct.name}</div>
                            <div style={{ fontSize: 13, color: "#6b7280" }}>₹{selectedProduct.price}/{selectedProduct.unit} · Stock: {selectedProduct.quantity}</div>
                        </div>
                        <button onClick={() => setSelectedProduct(null)} style={{
                            background: "#fee2e2", border: "none", borderRadius: 8, padding: "6px 12px",
                            fontSize: 12, fontWeight: 700, color: "#dc2626", cursor: "pointer",
                        }}>Change</button>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 6, display: "block" }}>Quantity</label>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <button onClick={() => setQuantity(Math.max(1, quantity - 1))} style={{
                                width: 40, height: 40, borderRadius: 10, border: "1px solid #e0f0e9",
                                background: "white", fontSize: 20, fontWeight: 700, cursor: "pointer",
                            }}>-</button>
                            <input
                                type="number"
                                value={quantity}
                                onChange={(e) => setQuantity(Math.max(1, Math.min(selectedProduct.quantity, Number(e.target.value))))}
                                style={{
                                    width: 80, textAlign: "center", padding: "8px", borderRadius: 10,
                                    border: "1.5px solid #e0f0e9", fontSize: 18, fontWeight: 700,
                                    fontFamily: "Nunito, sans-serif", outline: "none",
                                }}
                            />
                            <button onClick={() => setQuantity(Math.min(selectedProduct.quantity, quantity + 1))} style={{
                                width: 40, height: 40, borderRadius: 10, border: "none",
                                background: GREEN, fontSize: 20, fontWeight: 700, cursor: "pointer", color: "white",
                            }}>+</button>
                            <span style={{ fontSize: 14, color: "#6b7280" }}>{selectedProduct.unit}</span>
                        </div>
                    </div>

                    <button onClick={() => { setSearch(""); setStep("select_buyer"); }} style={{
                        width: "100%", padding: "14px", borderRadius: 12, border: "none", background: GREEN,
                        color: "white", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Select Buyer →</button>
                </div>
            ) : (
                <>
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search products..."
                        style={{
                            width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9",
                            fontSize: 14, outline: "none", fontFamily: "Nunito, sans-serif", marginBottom: 12,
                            boxSizing: "border-box",
                        }}
                    />
                    <div style={{ maxHeight: 350, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                        {filteredProducts.length === 0 ? (
                            <div style={{ textAlign: "center", padding: 30, color: "#6b7280" }}>
                                No products available for sale. Add products in inventory settings.
                            </div>
                        ) : filteredProducts.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => setSelectedProduct(p)}
                                style={{
                                    display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                                    background: "white", border: "1.5px solid #e0f0e9", borderRadius: 12,
                                    cursor: "pointer", fontFamily: "Nunito, sans-serif", textAlign: "left",
                                }}
                            >
                                <div style={{ width: 44, height: 44, borderRadius: 10, background: "#f3f4f6", overflow: "hidden", flexShrink: 0 }}>
                                    {p.imageUrl ? <img src={p.imageUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📦</div>}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a2a" }}>{p.name}</div>
                                    <div style={{ fontSize: 12, color: "#6b7280" }}>₹{p.price} · Stock: {p.quantity} {p.unit}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
