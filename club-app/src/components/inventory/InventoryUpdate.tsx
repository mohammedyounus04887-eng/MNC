import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import {
    useInventoryProducts, useAddInventoryProduct,
    useUpdateInventoryQuantities,
} from "@/hooks/useInventoryManagement";
import FaceVerification from "@/components/FaceVerification";
import type { InventoryProduct } from "@/types/firestore";

const GREEN = "#2d9653";

interface Props {
    clubId: string;
    onClose?: () => void;
}

type Step = "verify_initial" | "edit" | "add_new" | "summary" | "verify_final" | "done";

export default function InventoryUpdate({ clubId, onClose }: Props) {
    const { toast } = useToast();
    const { products, loading } = useInventoryProducts();
    const addProduct = useAddInventoryProduct();
    const updateQuantities = useUpdateInventoryQuantities();

    const [step, setStep] = useState<Step>("verify_initial");
    const [verifierName, setVerifierName] = useState("");
    const [inventoryManagers, setInventoryManagers] = useState<any[]>([]);
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [search, setSearch] = useState("");

    // New product form
    const [newName, setNewName] = useState("");
    const [newCategory, setNewCategory] = useState("other");
    const [newUnit, setNewUnit] = useState("pcs");
    const [newQty, setNewQty] = useState(0);
    const [newPrice, setNewPrice] = useState(0);
    const [newThreshold, setNewThreshold] = useState(5);
    const [newIsForSale, setNewIsForSale] = useState(false);

    useEffect(() => {
        if (!clubId) return;
        // Prefer the dedicated inventoryManagers collection (Settings → Inventory
        // Managers). Fall back to legacy member-flag filter only if no manager
        // has been assigned yet, so existing clubs continue to work.
        const unsub = onSnapshot(collection(db, "clubs", clubId, "inventoryManagers"), (snap) => {
            const mgrs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            if (mgrs.length > 0) {
                setInventoryManagers(mgrs);
                return;
            }
            // Legacy fallback — read from members where isInventoryManager flag is set
            onSnapshot(collection(db, "clubs", clubId, "members"), (msnap) => {
                setInventoryManagers(msnap.docs
                    .map((d) => ({ id: d.id, ...d.data() }))
                    .filter((m: any) => m.isInventoryManager || m.isAccountant || m.role === "staff"));
            });
        });
        return unsub;
    }, [clubId]);

    // Initialize quantities from current products
    useEffect(() => {
        if (products.length > 0 && Object.keys(quantities).length === 0) {
            const q: Record<string, number> = {};
            products.forEach((p) => { q[p.id] = p.quantity; });
            setQuantities(q);
        }
    }, [products]);

    const changes = products
        .map((p) => ({
            productId: p.id,
            productName: p.name,
            oldQty: p.quantity,
            newQty: quantities[p.id] ?? p.quantity,
            unit: p.unit,
        }))
        .filter((c) => c.oldQty !== c.newQty);

    const handleInitialVerified = (verifier: { id: string; name: string }) => {
        setVerifierName(verifier.name);
        // Initialize quantities
        const q: Record<string, number> = {};
        products.forEach((p) => { q[p.id] = p.quantity; });
        setQuantities(q);
        setStep("edit");
    };

    const handleFinalVerified = async (verifier: { id: string; name: string }) => {
        try {
            await updateQuantities.mutateAsync({
                updates: changes,
                verifiedBy: verifier.name,
            });
            toast({ title: "Inventory updated successfully" });
            setStep("done");
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
            setStep("summary");
        }
    };

    const handleAddNew = async () => {
        if (!newName.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
        try {
            await addProduct.mutateAsync({
                name: newName.trim(),
                category: newCategory,
                unit: newUnit,
                imageUrl: "",
                quantity: newQty,
                price: newPrice,
                lowStockThreshold: newThreshold,
                isForSale: newIsForSale,
            });
            toast({ title: "Product added" });
            setNewName(""); setNewQty(0); setNewPrice(0);
            setStep("edit");
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

    const filteredProducts = products.filter(
        (p) => !search || p.name.toLowerCase().includes(search.toLowerCase())
    );

    // Done
    if (step === "done") {
        return (
            <div style={{ padding: 24, textAlign: "center", fontFamily: "Nunito, sans-serif" }}>
                <div style={{ fontSize: 60, marginBottom: 16 }}>✅</div>
                <h3 style={{ fontSize: 22, fontWeight: 900, color: "#1a3a2a", marginBottom: 8 }}>Inventory Updated!</h3>
                <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>
                    {changes.length} product{changes.length !== 1 ? "s" : ""} updated by {verifierName}
                </p>
                {onClose && (
                    <button onClick={onClose} style={{
                        padding: "12px 32px", borderRadius: 12, border: "none", background: GREEN,
                        color: "white", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Close</button>
                )}
            </div>
        );
    }

    // Final verification
    if (step === "verify_final") {
        return (
            <FaceVerification
                clubId={clubId}
                verifiers={inventoryManagers.map((m) => ({
                    id: m.id, name: m.name, photo: m.photo,
                    faceDescriptor: m.faceDescriptor, role: "Inventory Manager",
                }))}
                title="Confirm Inventory Update"
                subtitle={`${changes.length} change${changes.length !== 1 ? "s" : ""} to save`}
                onVerified={handleFinalVerified}
                onCancel={() => setStep("summary")}
                pinFallback={{ pin: "1234", onPinVerified: (name) => handleFinalVerified({ id: "pin", name }) }}
            />
        );
    }

    // Summary
    if (step === "summary") {
        return (
            <div style={{ padding: 24, fontFamily: "Nunito, sans-serif" }}>
                <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", marginBottom: 4, textAlign: "center" }}>
                    Update Summary
                </h3>
                <p style={{ fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 20 }}>
                    {changes.length} change{changes.length !== 1 ? "s" : ""} to confirm
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                    {changes.map((c) => (
                        <div key={c.productId} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "12px 16px", background: "white", borderRadius: 12, border: "1.5px solid #e0f0e9",
                        }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a2a" }}>{c.productName}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 14, color: "#6b7280" }}>{c.oldQty}</span>
                                <span style={{ fontSize: 14, color: "#9ca3af" }}>→</span>
                                <span style={{
                                    fontSize: 14, fontWeight: 700,
                                    color: c.newQty > c.oldQty ? GREEN : "#ef4444",
                                }}>{c.newQty}</span>
                                <span style={{ fontSize: 12, color: "#6b7280" }}>{c.unit}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {changes.length === 0 && (
                    <div style={{ textAlign: "center", padding: 20, color: "#6b7280" }}>No changes made.</div>
                )}

                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <button onClick={() => setStep("edit")} style={{
                        padding: "12px 28px", borderRadius: 12, border: "1.5px solid #e0f0e9",
                        background: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Edit</button>
                    <button
                        onClick={() => changes.length > 0 ? setStep("verify_final") : toast({ title: "No changes to save" })}
                        style={{
                            padding: "12px 28px", borderRadius: 12, border: "none",
                            background: changes.length > 0 ? GREEN : "#d1d5db",
                            color: "white", fontSize: 14, fontWeight: 700,
                            cursor: changes.length > 0 ? "pointer" : "default", fontFamily: "Nunito, sans-serif",
                        }}
                    >Confirm & Verify</button>
                </div>
            </div>
        );
    }

    // Add new product
    if (step === "add_new") {
        return (
            <div style={{ padding: 24, fontFamily: "Nunito, sans-serif" }}>
                <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", marginBottom: 16, textAlign: "center" }}>
                    Add New Product
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                        <label style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 4, display: "block" }}>Product Name</label>
                        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Enter name"
                            style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: "Nunito, sans-serif", outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 4, display: "block" }}>Category</label>
                            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
                                style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: "Nunito, sans-serif" }}>
                                <option value="shake">Shake</option>
                                <option value="supplement">Supplement</option>
                                <option value="snack">Snack</option>
                                <option value="protein">Protein</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 4, display: "block" }}>Unit</label>
                            <select value={newUnit} onChange={(e) => setNewUnit(e.target.value)}
                                style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: "Nunito, sans-serif" }}>
                                <option value="pcs">Pieces</option>
                                <option value="kg">Kg</option>
                                <option value="g">Grams</option>
                                <option value="L">Liters</option>
                                <option value="ml">Milliliters</option>
                                <option value="box">Boxes</option>
                            </select>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 4, display: "block" }}>Quantity</label>
                            <input type="number" value={newQty} onChange={(e) => setNewQty(Number(e.target.value))}
                                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: "Nunito, sans-serif", outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 4, display: "block" }}>Price (₹)</label>
                            <input type="number" value={newPrice} onChange={(e) => setNewPrice(Number(e.target.value))}
                                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: "Nunito, sans-serif", outline: "none", boxSizing: "border-box" }} />
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 4, display: "block" }}>Low Stock Alert</label>
                            <input type="number" value={newThreshold} onChange={(e) => setNewThreshold(Number(e.target.value))}
                                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: "Nunito, sans-serif", outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ flex: 1, display: "flex", alignItems: "end", paddingBottom: 2 }}>
                            <button onClick={() => setNewIsForSale(!newIsForSale)} style={{
                                display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
                                borderRadius: 10, border: newIsForSale ? `2px solid ${GREEN}` : "1.5px solid #e0f0e9",
                                background: newIsForSale ? "#f0fdf4" : "white", cursor: "pointer", fontFamily: "Nunito, sans-serif",
                            }}>
                                <span style={{ fontSize: 14, fontWeight: 700, color: newIsForSale ? GREEN : "#6b7280" }}>
                                    {newIsForSale ? "✅ For Sale" : "Not for Sale"}
                                </span>
                            </button>
                        </div>
                    </div>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button onClick={() => setStep("edit")} style={{
                        flex: 1, padding: "12px", borderRadius: 10, border: "1.5px solid #e0f0e9",
                        background: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Cancel</button>
                    <button onClick={handleAddNew} disabled={addProduct.isPending} style={{
                        flex: 1, padding: "12px", borderRadius: 10, border: "none",
                        background: GREEN, color: "white", fontSize: 14, fontWeight: 700,
                        cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>{addProduct.isPending ? "Adding..." : "Add Product"}</button>
                </div>
            </div>
        );
    }

    // Initial verification
    if (step === "verify_initial") {
        return (
            <FaceVerification
                clubId={clubId}
                verifiers={inventoryManagers.map((m) => ({
                    id: m.id, name: m.name, photo: m.photo,
                    faceDescriptor: m.faceDescriptor, role: "Inventory Manager",
                }))}
                title="Inventory Manager Verification"
                subtitle="Verify identity to update inventory"
                onVerified={handleInitialVerified}
                onCancel={() => onClose?.()}
                pinFallback={{ pin: "1234", onPinVerified: (name) => handleInitialVerified({ id: "pin", name }) }}
            />
        );
    }

    // Edit quantities
    return (
        <div style={{ padding: 20, fontFamily: "Nunito, sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                    <h3 style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a", margin: 0 }}>Update Inventory</h3>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>Verified by: {verifierName}</p>
                </div>
                <button onClick={() => setStep("add_new")} style={{
                    padding: "8px 16px", borderRadius: 8, border: "none", background: GREEN,
                    color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                }}>+ Add New</button>
            </div>

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

            {loading ? (
                <div style={{ textAlign: "center", padding: 30, color: "#6b7280" }}>Loading...</div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
                    {filteredProducts.map((p) => {
                        const qty = quantities[p.id] ?? p.quantity;
                        const changed = qty !== p.quantity;
                        return (
                            <div key={p.id} style={{
                                display: "flex", alignItems: "center", gap: 12,
                                padding: "12px 14px", background: changed ? "#fef3c7" : "white",
                                borderRadius: 12, border: changed ? "1.5px solid #f59e0b" : "1.5px solid #e0f0e9",
                            }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a2a" }}>{p.name}</div>
                                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                                        Current: {p.quantity} {p.unit} · {p.category}
                                    </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <button
                                        onClick={() => setQuantities((prev) => ({ ...prev, [p.id]: Math.max(0, (prev[p.id] ?? p.quantity) - 1) }))}
                                        style={{
                                            width: 32, height: 32, borderRadius: 8, border: "1px solid #e0f0e9",
                                            background: "white", fontSize: 18, fontWeight: 700, cursor: "pointer",
                                        }}
                                    >-</button>
                                    <input
                                        type="number"
                                        value={qty}
                                        onChange={(e) => setQuantities((prev) => ({ ...prev, [p.id]: Math.max(0, Number(e.target.value)) }))}
                                        style={{
                                            width: 60, textAlign: "center", padding: "6px 4px", borderRadius: 8,
                                            border: "1.5px solid #e0f0e9", fontSize: 15, fontWeight: 700,
                                            fontFamily: "Nunito, sans-serif", outline: "none",
                                        }}
                                    />
                                    <button
                                        onClick={() => setQuantities((prev) => ({ ...prev, [p.id]: (prev[p.id] ?? p.quantity) + 1 }))}
                                        style={{
                                            width: 32, height: 32, borderRadius: 8, border: "none",
                                            background: GREEN, fontSize: 18, fontWeight: 700, cursor: "pointer", color: "white",
                                        }}
                                    >+</button>
                                    <span style={{ fontSize: 12, color: "#6b7280", minWidth: 24 }}>{p.unit}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center" }}>
                {onClose && (
                    <button onClick={onClose} style={{
                        padding: "12px 28px", borderRadius: 12, border: "1.5px solid #e0f0e9",
                        background: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Cancel</button>
                )}
                <button onClick={() => setStep("summary")} style={{
                    padding: "12px 28px", borderRadius: 12, border: "none",
                    background: GREEN, color: "white", fontSize: 14, fontWeight: 700,
                    cursor: "pointer", fontFamily: "Nunito, sans-serif",
                }}>
                    Save ({changes.length} change{changes.length !== 1 ? "s" : ""})
                </button>
            </div>
        </div>
    );
}
