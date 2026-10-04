/**
 * Add / edit a single inventory item. Unit-first: the operator picks the
 * unit (g, kg, ml, L, pcs) at create time, and from then on every recipe
 * or stock action against this item is locked to that unit.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { UNIT_OPTIONS } from "@/utils/inventoryUnits";
import type { InventoryItem } from "@/types/firestore";

interface Props {
    initial?: Partial<InventoryItem>;
    onSubmit: (data: {
        name: string; size: number; unit: string; category?: string;
        price?: number; isForSale?: boolean; lowStockThreshold?: number;
    }) => Promise<void>;
    onClose: () => void;
    saving?: boolean;
}

export default function InventoryItemForm({ initial, onSubmit, onClose, saving }: Props) {
    const [name, setName] = useState(initial?.name ?? "");
    const [size, setSize] = useState<string>(initial?.size != null ? String(initial.size) : "");
    const [unit, setUnit] = useState<string>(initial?.unit ?? "g");
    const [category, setCategory] = useState(initial?.category ?? "");
    const [isForSale, setIsForSale] = useState(initial?.isForSale ?? false);
    const [price, setPrice] = useState<string>(initial?.price != null ? String(initial.price) : "");
    const [threshold, setThreshold] = useState<string>(
        initial?.lowStockThreshold != null ? String(initial.lowStockThreshold) : ""
    );
    const [error, setError] = useState("");

    async function handleSubmit() {
        setError("");
        const trimmedName = name.trim();
        const sizeNum = Number(size);
        if (!trimmedName) { setError("Name is required"); return; }
        if (!Number.isFinite(sizeNum) || sizeNum <= 0) { setError("Size must be a positive number"); return; }
        if (!unit) { setError("Unit is required"); return; }
        try {
            await onSubmit({
                name: trimmedName,
                size: sizeNum,
                unit,
                category: category.trim() || undefined,
                isForSale,
                price: isForSale ? Number(price) || 0 : 0,
                lowStockThreshold: Number(threshold) || 0,
            });
        } catch (e: any) {
            setError(e?.message || "Failed to save");
        }
    }

    return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 12, padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", fontFamily: "Inter, system-ui, sans-serif" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, paddingBottom: 12, borderBottom: "1px solid #ecfdf5" }}>
                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#0a3d2e" }}>
                        {initial?.id ? "Edit Item" : "Add Item"}
                    </h2>
                    <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>
                        <X size={18} />
                    </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <Field label="Name *">
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Whey Protein" style={inputStyle} />
                        <p style={hintStyle}>Tip: include the size in the name (e.g. "Whey Protein 1000g") so different sizes are easy to tell apart.</p>
                    </Field>
                    <div style={{ display: "flex", gap: 12 }}>
                        <Field label="Pack size *" style={{ flex: 1 }}>
                            <input type="number" value={size} onChange={(e) => setSize(e.target.value)} placeholder="1000" min={0} style={inputStyle} disabled={!!initial?.id} />
                            {initial?.id && <p style={hintStyle}>Size can't change once set.</p>}
                        </Field>
                        <Field label="Unit *" style={{ flex: 1 }}>
                            <select value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle} disabled={!!initial?.id}>
                                {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                        </Field>
                    </div>
                    <Field label="Category">
                        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Formula 1, Protein, Snack…" style={inputStyle} />
                    </Field>

                    <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #d1fae5", borderRadius: 8, background: "#f0fdf4", cursor: "pointer" }}>
                        <input type="checkbox" checked={isForSale} onChange={(e) => setIsForSale(e.target.checked)} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#0a3d2e" }}>Sell to members</div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>Show on reception/guest sale screens</div>
                        </div>
                    </label>

                    {isForSale && (
                        <Field label="Sell price (per packet)">
                            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" min={0} style={inputStyle} />
                        </Field>
                    )}

                    <Field label="Low-stock threshold (packets)">
                        <input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="0" min={0} style={inputStyle} />
                        <p style={hintStyle}>Get a warning when admin packets fall to this number.</p>
                    </Field>
                </div>

                {error && (
                    <p style={{ fontSize: 12, color: "#9f1239", background: "#fef2f2", border: "1px solid #fecaca", padding: "8px 12px", borderRadius: 8, marginTop: 14 }}>
                        {error}
                    </p>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button onClick={onClose} style={{ ...secondaryBtn, flex: 1 }}>Cancel</button>
                    <button onClick={handleSubmit} disabled={saving} style={{ ...primaryBtn, flex: 1 }}>
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <label style={{ display: "block", ...style }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
            {children}
        </label>
    );
}

const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 12px", borderRadius: 6,
    border: "1px solid #bbf7d0", fontSize: 13, outline: "none",
    boxSizing: "border-box", color: "#0a3d2e", background: "white",
};

const hintStyle: React.CSSProperties = {
    fontSize: 11, color: "#94a3b8", marginTop: 4,
};

const primaryBtn: React.CSSProperties = {
    background: "#2d9653", border: "1px solid #2d9653", color: "white",
    padding: "9px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
    background: "white", border: "1px solid #bbf7d0", color: "#334155",
    padding: "9px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
};
