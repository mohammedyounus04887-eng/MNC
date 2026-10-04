import { useState } from "react";
import { useInventoryProducts, useVirtualProductSets, useSaveVirtualProductSet } from "@/hooks/useInventoryManagement";
import { useToast } from "@/hooks/use-toast";
import type { VirtualProductSetItem } from "@/types/firestore";

const GREEN = "#2d9653";

interface Props {
    clubId: string;
}

export default function VirtualProductSets({ clubId }: Props) {
    const { toast } = useToast();
    const { products } = useInventoryProducts();
    const { sets, loading } = useVirtualProductSets();
    const saveSet = useSaveVirtualProductSet();

    const [editing, setEditing] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [items, setItems] = useState<(VirtualProductSetItem & { _key: number })[]>([]);
    const [isActive, setIsActive] = useState(true);

    const startNew = () => {
        setEditId(null);
        setName("");
        setItems([]);
        setIsActive(true);
        setEditing(true);
    };

    const startEdit = (set: any) => {
        setEditId(set.id);
        setName(set.name);
        setItems(set.items.map((i: any, idx: number) => ({ ...i, _key: idx })));
        setIsActive(set.isActive);
        setEditing(true);
    };

    const addItem = () => {
        setItems((prev) => [...prev, { productId: "", productName: "", quantity: 1, unit: "", _key: Date.now() }]);
    };

    const updateItem = (key: number, field: string, value: any) => {
        setItems((prev) => prev.map((i) => {
            if (i._key !== key) return i;
            if (field === "productId") {
                const p = products.find((pr) => pr.id === value);
                return { ...i, productId: value, productName: p?.name || "", unit: p?.unit || "" };
            }
            return { ...i, [field]: value };
        }));
    };

    const removeItem = (key: number) => {
        setItems((prev) => prev.filter((i) => i._key !== key));
    };

    const handleSave = async () => {
        if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
        if (items.length === 0) { toast({ title: "Add at least one product", variant: "destructive" }); return; }
        const validItems = items.filter((i) => i.productId && i.quantity > 0);
        if (validItems.length === 0) { toast({ title: "Configure at least one product", variant: "destructive" }); return; }

        try {
            await saveSet.mutateAsync({
                id: editId || undefined,
                name: name.trim(),
                items: validItems.map(({ _key, ...rest }) => rest),
                isActive,
            });
            toast({ title: editId ? "Set updated" : "Set created" });
            setEditing(false);
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

    if (editing) {
        return (
            <div style={{ fontFamily: "Nunito, sans-serif" }}>
                <h4 style={{ fontSize: 18, fontWeight: 900, color: "#1a3a2a", marginBottom: 16 }}>
                    {editId ? "Edit" : "New"} Virtual Product Set
                </h4>

                <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 4, display: "block" }}>Set Name</label>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Standard Daily Pack"
                        style={{
                            width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9",
                            fontSize: 14, fontFamily: "Nunito, sans-serif", outline: "none", boxSizing: "border-box",
                        }}
                    />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <button
                        onClick={() => setIsActive(!isActive)}
                        style={{
                            width: 44, height: 24, borderRadius: 12, border: "none",
                            background: isActive ? GREEN : "#d1d5db", cursor: "pointer", position: "relative",
                        }}
                    >
                        <div style={{
                            width: 20, height: 20, borderRadius: "50%", background: "white",
                            position: "absolute", top: 2, left: isActive ? 22 : 2, transition: "left 0.2s",
                        }} />
                    </button>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#1a3a2a" }}>Active</span>
                </div>

                <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Products in Set</div>
                {items.map((item) => (
                    <div key={item._key} style={{
                        display: "flex", gap: 8, marginBottom: 8, alignItems: "center",
                        padding: "10px 12px", background: "#f9fafb", borderRadius: 10,
                    }}>
                        <select
                            value={item.productId}
                            onChange={(e) => updateItem(item._key, "productId", e.target.value)}
                            style={{
                                flex: 2, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e0f0e9",
                                fontSize: 13, fontFamily: "Nunito, sans-serif",
                            }}
                        >
                            <option value="">Select product</option>
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>{p.name} ({p.quantity} {p.unit})</option>
                            ))}
                        </select>
                        <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateItem(item._key, "quantity", Math.max(0, Number(e.target.value)))}
                            style={{
                                width: 60, padding: "8px", borderRadius: 8, border: "1.5px solid #e0f0e9",
                                fontSize: 13, fontFamily: "Nunito, sans-serif", textAlign: "center",
                            }}
                        />
                        <span style={{ fontSize: 12, color: "#6b7280", minWidth: 24 }}>{item.unit}</span>
                        <button onClick={() => removeItem(item._key)} style={{
                            background: "#fee2e2", border: "none", borderRadius: 6, padding: "6px 8px",
                            color: "#dc2626", fontWeight: 700, fontSize: 14, cursor: "pointer",
                        }}>×</button>
                    </div>
                ))}

                <button onClick={addItem} style={{
                    width: "100%", padding: "10px", borderRadius: 10, border: "1.5px dashed #d1d5db",
                    background: "white", fontSize: 13, fontWeight: 700, color: "#6b7280",
                    cursor: "pointer", fontFamily: "Nunito, sans-serif", marginBottom: 16,
                }}>+ Add Product</button>

                <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => setEditing(false)} style={{
                        flex: 1, padding: "12px", borderRadius: 10, border: "1.5px solid #e0f0e9",
                        background: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>Cancel</button>
                    <button onClick={handleSave} disabled={saveSet.isPending} style={{
                        flex: 1, padding: "12px", borderRadius: 10, border: "none",
                        background: GREEN, color: "white", fontSize: 14, fontWeight: 700,
                        cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    }}>{saveSet.isPending ? "Saving..." : "Save Set"}</button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ fontFamily: "Nunito, sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                    <h4 style={{ fontSize: 18, fontWeight: 900, color: "#1a3a2a", margin: 0 }}>Virtual Product Sets</h4>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: "2px 0 0" }}>
                        Auto-deducted when virtual members pay
                    </p>
                </div>
                <button onClick={startNew} style={{
                    padding: "8px 16px", borderRadius: 8, border: "none", background: GREEN,
                    color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                }}>+ New Set</button>
            </div>

            {loading ? (
                <div style={{ textAlign: "center", padding: 30, color: "#6b7280" }}>Loading...</div>
            ) : sets.length === 0 ? (
                <div style={{ textAlign: "center", padding: 30, color: "#6b7280" }}>
                    No virtual product sets defined yet.
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {sets.map((set) => (
                        <div
                            key={set.id}
                            style={{
                                padding: "14px 16px", background: "white", borderRadius: 12,
                                border: set.isActive ? `1.5px solid ${GREEN}` : "1.5px solid #e0f0e9",
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a2a" }}>{set.name}</div>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <span style={{
                                        fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                                        background: set.isActive ? "#dcfce7" : "#f3f4f6",
                                        color: set.isActive ? "#16a34a" : "#9ca3af",
                                    }}>{set.isActive ? "Active" : "Inactive"}</span>
                                    <button onClick={() => startEdit(set)} style={{
                                        background: "#f3f4f6", border: "none", borderRadius: 6, padding: "3px 8px",
                                        fontSize: 11, fontWeight: 700, color: "#374151", cursor: "pointer",
                                    }}>Edit</button>
                                </div>
                            </div>
                            <div style={{ fontSize: 12, color: "#6b7280" }}>
                                {set.items.map((i) => `${i.productName} (${i.quantity} ${i.unit})`).join(", ")}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
