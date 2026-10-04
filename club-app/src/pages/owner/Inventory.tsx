/**
 * Admin Inventory — simple boxed-inventory system.
 *
 * Replaces the previous recipe/kitchen-linked admin inventory page. Five
 * top-level actions:
 *
 *   1. Add Product        — new SKU (name, flavor, size, optional image)
 *   2. Add Stock          — incoming boxes against an existing product
 *   3. Daily Club Usage   — boxes consumed by the club today
 *   4. Give for Event     — boxes given to another club / event
 *   5. History            — audit log of every movement
 *
 * The kitchen / shake-serving / reception product-sales flows continue
 * to use the legacy inventory collections — this is a parallel system.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Package, Plus, ArrowDownToLine, ClipboardList, Send, History, X, Trash2, AlertCircle, UserPlus, CalendarClock } from "lucide-react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import {
    useSimpleProducts,
    useAddSimpleProduct,
    useDeleteSimpleProduct,
    useAddStock,
    useRecordClubUsage,
    useGiveForEvent,
    useGiveToPerson,
    type SimpleProduct,
} from "@/hooks/useSimpleInventory";
import { useMembers } from "@/hooks/owner/useMembers";
import { useTodayShakes } from "@/hooks/owner/useTodayShakes";
import { printViaRawBT } from "@/utils/printReceipt";
import { buildInventoryGiveReceipt, type ClubPrintData } from "@/utils/receiptBuilder";
import type { User as Member } from "@/types/firestore";

const FONT = "'Inter', system-ui, -apple-system, sans-serif";
const ACCENT = "#2d9653";

// ─── Main ────────────────────────────────────────────────────────────────

export default function Inventory() {
    const { club } = useClubContext();
    const clubId = club?.id || null;

    const productsQ = useSimpleProducts(clubId);
    const products = productsQ.data || [];
    const deleteMutation = useDeleteSimpleProduct();

    const [openModal, setOpenModal] = useState<null | "add" | "stock" | "usage" | "event" | "person">(null);
    const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
    const showToast = (kind: "ok" | "err", text: string) => {
        setToast({ kind, text });
        setTimeout(() => setToast(null), 4000);
    };

    const totalSkus = products.length;
    const totalBoxes = useMemo(
        () => products.reduce((s, p) => s + (Number(p.currentStock) || 0), 0),
        [products],
    );
    const outOfStock = products.filter(p => (Number(p.currentStock) || 0) <= 0).length;

    const handleDelete = async (p: SimpleProduct) => {
        if (!clubId) return;
        if (!confirm(`Delete "${p.name} – ${p.flavor}"? Past history entries are kept.`)) return;
        try {
            await deleteMutation.mutateAsync({ clubId, productId: p.id });
            showToast("ok", "Product deleted");
        } catch (e: any) {
            showToast("err", e.message || "Delete failed");
        }
    };

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: FONT, padding: "20px 16px 60px" }}>
            <div style={{ maxWidth: 1200, margin: "0 auto" }}>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
                    <div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
                            <Package className="w-6 h-6" style={{ color: ACCENT }} />
                            Inventory
                        </div>
                        <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{club?.name}</div>
                    </div>

                    {/* Summary tiles */}
                    <div style={{ display: "flex", gap: 8 }}>
                        <Tile label="Products" value={String(totalSkus)} accent="#0284c7" />
                        <Tile label="Total Boxes" value={String(totalBoxes)} accent={ACCENT} />
                        {outOfStock > 0 && <Tile label="Out of Stock" value={String(outOfStock)} accent="#dc2626" />}
                    </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 20 }}>
                    <ActionButton icon={<Plus className="w-5 h-5" />} label="Add Product" onClick={() => setOpenModal("add")} />
                    <ActionButton icon={<ArrowDownToLine className="w-5 h-5" />} label="Add Stock" onClick={() => setOpenModal("stock")} disabled={products.length === 0} />
                    <ActionButton icon={<ClipboardList className="w-5 h-5" />} label="Daily Club Usage" onClick={() => setOpenModal("usage")} disabled={products.length === 0} />
                    <ActionButton icon={<Send className="w-5 h-5" />} label="Give for Event" onClick={() => setOpenModal("event")} disabled={products.length === 0} />
                    <ActionButton icon={<UserPlus className="w-5 h-5" />} label="Give to Person" onClick={() => setOpenModal("person")} disabled={products.length === 0} />
                    <Link to="deadlines" style={{ textDecoration: "none" }}>
                        <ActionButton icon={<CalendarClock className="w-5 h-5" />} label="Deadlines" onClick={() => {}} variant="dark" />
                    </Link>
                    <Link to="history" style={{ textDecoration: "none" }}>
                        <ActionButton icon={<History className="w-5 h-5" />} label="History" onClick={() => {}} variant="dark" />
                    </Link>
                </div>

                {/* Product grid */}
                {productsQ.isLoading ? (
                    <div style={{ fontSize: 13, color: "#64748b", padding: 30, textAlign: "center" }}>Loading…</div>
                ) : products.length === 0 ? (
                    <EmptyState onAdd={() => setOpenModal("add")} />
                ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                        {products.map(p => (
                            <ProductCard key={p.id} product={p} onDelete={() => handleDelete(p)} />
                        ))}
                    </div>
                )}

                {/* Modals */}
                {openModal === "add" && (
                    <AddProductModal
                        clubId={clubId}
                        onClose={() => setOpenModal(null)}
                        onDone={() => { setOpenModal(null); showToast("ok", "Product added"); }}
                        onErr={msg => showToast("err", msg)}
                    />
                )}
                {openModal === "stock" && (
                    <AddStockModal
                        clubId={clubId}
                        products={products}
                        onClose={() => setOpenModal(null)}
                        onDone={msg => { setOpenModal(null); showToast("ok", msg); }}
                        onErr={msg => showToast("err", msg)}
                    />
                )}
                {openModal === "usage" && (
                    <ClubUsageModal
                        clubId={clubId}
                        products={products}
                        onClose={() => setOpenModal(null)}
                        onDone={msg => { setOpenModal(null); showToast("ok", msg); }}
                        onErr={msg => showToast("err", msg)}
                    />
                )}
                {openModal === "event" && (
                    <EventGiveModal
                        clubId={clubId}
                        club={club}
                        products={products}
                        onClose={() => setOpenModal(null)}
                        onDone={msg => { setOpenModal(null); showToast("ok", msg); }}
                        onErr={msg => showToast("err", msg)}
                    />
                )}
                {openModal === "person" && (
                    <GiveToPersonModal
                        clubId={clubId}
                        club={club}
                        products={products}
                        onClose={() => setOpenModal(null)}
                        onDone={msg => { setOpenModal(null); showToast("ok", msg); }}
                        onErr={msg => showToast("err", msg)}
                    />
                )}

                {/* Toast */}
                {toast && (
                    <div style={{
                        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
                        background: toast.kind === "ok" ? ACCENT : "#dc2626", color: "white",
                        padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 800,
                        zIndex: 1500, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", fontFamily: FONT, maxWidth: "90vw",
                    }}>
                        {toast.kind === "ok" ? "✓ " : "✗ "}{toast.text}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Subcomponents ───────────────────────────────────────────────────────

function ActionButton({ icon, label, onClick, disabled, variant }: {
    icon: React.ReactNode; label: string; onClick: () => void;
    disabled?: boolean; variant?: "dark";
}) {
    const bg = disabled ? "#e2e8f0" : variant === "dark" ? "#0f172a" : ACCENT;
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            style={{
                background: bg, color: "white", border: "none",
                padding: "14px 16px", borderRadius: 10, fontWeight: 800, fontSize: 13,
                cursor: disabled ? "not-allowed" : "pointer", fontFamily: FONT,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                width: "100%", boxShadow: disabled ? "none" : "0 2px 4px rgba(15,23,42,0.08)",
            }}
        >
            {icon}
            {label}
        </button>
    );
}

function Tile({ label, value, accent }: { label: string; value: string; accent: string }) {
    return (
        <div style={{
            background: "white", border: `1px solid ${accent}30`, borderLeft: `4px solid ${accent}`,
            borderRadius: 8, padding: "8px 14px", minWidth: 100,
        }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
        </div>
    );
}

function ProductCard({ product, onDelete }: { product: SimpleProduct; onDelete: () => void }) {
    const stock = Number(product.currentStock) || 0;
    const low = stock <= 0;
    return (
        <div style={{
            background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14,
            display: "flex", flexDirection: "column", gap: 8, position: "relative",
        }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                {product.imageUrl ? (
                    <img src={product.imageUrl} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", border: "1px solid #e2e8f0", flexShrink: 0 }} />
                ) : (
                    <div style={{ width: 52, height: 52, borderRadius: 8, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Package className="w-6 h-6" style={{ color: "#94a3b8" }} />
                    </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.name}</div>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginTop: 2 }}>
                        {product.flavor || "—"} · {product.size || "—"}
                    </div>
                </div>
                <button
                    onClick={onDelete}
                    title="Delete product"
                    style={{ background: "transparent", border: "none", color: "#cbd5e1", cursor: "pointer", padding: 4 }}
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
            <div style={{
                background: low ? "#fef2f2" : "#f0fdf4", border: `1px solid ${low ? "#fecaca" : "#bbf7d0"}`,
                borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: low ? "#991b1b" : "#166534", textTransform: "uppercase", letterSpacing: 0.5 }}>Current Stock</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: low ? "#dc2626" : ACCENT, fontVariantNumeric: "tabular-nums" }}>
                    {stock} <span style={{ fontSize: 11, fontWeight: 700, color: low ? "#991b1b" : "#166534" }}>box{stock === 1 ? "" : "es"}</span>
                </div>
            </div>
        </div>
    );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
    return (
        <div style={{
            background: "white", border: "2px dashed #cbd5e1", borderRadius: 14,
            padding: "60px 20px", textAlign: "center",
        }}>
            <Package className="w-12 h-12" style={{ color: "#cbd5e1", margin: "0 auto 12px" }} />
            <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>No products yet</div>
            <div style={{ fontSize: 13, color: "#64748b", margin: "6px 0 16px" }}>Add your first product to start tracking inventory.</div>
            <button
                onClick={onAdd}
                style={{ background: ACCENT, color: "white", border: "none", padding: "10px 20px", borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: FONT }}
            >+ Add Product</button>
        </div>
    );
}

// ─── Modal shell ─────────────────────────────────────────────────────────

function Modal({ title, onClose, children, maxWidth = 480 }: {
    title: string; onClose: () => void; children: React.ReactNode; maxWidth?: number;
}) {
    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
                display: "flex", alignItems: "center", justifyContent: "center",
                zIndex: 1000, padding: 16, fontFamily: FONT,
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: "white", borderRadius: 14, padding: 22,
                    maxWidth, width: "100%", maxHeight: "90vh", overflowY: "auto",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div style={{ fontSize: 17, fontWeight: 900, color: "#0f172a" }}>{title}</div>
                    <button
                        onClick={onClose}
                        style={{ width: 30, height: 30, border: "none", background: "#f1f5f9", borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}
                        aria-label="Close"
                    ><X className="w-4 h-4" /></button>
                </div>
                {children}
            </div>
        </div>
    );
}

// ─── Add Product modal ───────────────────────────────────────────────────

function AddProductModal({ clubId, onClose, onDone, onErr }: {
    clubId: string | null; onClose: () => void; onDone: () => void; onErr: (msg: string) => void;
}) {
    const m = useAddSimpleProduct();
    const [name, setName] = useState("");
    const [flavor, setFlavor] = useState("");
    const [size, setSize] = useState("");
    const [imageMode, setImageMode] = useState<"file" | "url">("file");
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imageUrl, setImageUrl] = useState("");
    const [imagePreview, setImagePreview] = useState<string>("");

    const canSubmit = !!name.trim() && !!clubId && !m.isPending;

    const submit = async () => {
        if (!clubId) return;
        if (!name.trim()) { onErr("Product name is required"); return; }
        try {
            await m.mutateAsync({
                clubId, name, flavor, size,
                imageFile: imageMode === "file" ? imageFile : null,
                imageUrl: imageMode === "url" ? imageUrl.trim() : "",
            });
            onDone();
        } catch (e: any) {
            onErr(e.message || "Failed to add product");
        }
    };

    return (
        <Modal title="Add Product" onClose={onClose}>
            <Field label="Product Name *">
                <input
                    type="text" value={name} onChange={e => setName(e.target.value)}
                    placeholder="e.g. Formula 1" autoFocus style={inputStyle}
                />
            </Field>
            <Field label="Flavor">
                <input
                    type="text" value={flavor} onChange={e => setFlavor(e.target.value)}
                    placeholder="e.g. Chocolate" style={inputStyle}
                />
            </Field>
            <Field label="Weight / Size">
                <input
                    type="text" value={size} onChange={e => setSize(e.target.value)}
                    placeholder="e.g. 1 kg" style={inputStyle}
                />
            </Field>
            <Field label="Image (optional)">
                <div style={{ display: "flex", gap: 4, marginBottom: 8, background: "#f1f5f9", padding: 3, borderRadius: 8, width: "fit-content" }}>
                    {(["file", "url"] as const).map(mode => (
                        <button
                            key={mode}
                            type="button"
                            onClick={() => {
                                setImageMode(mode);
                                setImagePreview("");
                                setImageFile(null);
                                setImageUrl("");
                            }}
                            style={{
                                padding: "6px 14px", border: "none",
                                background: imageMode === mode ? "white" : "transparent",
                                color: imageMode === mode ? "#0f172a" : "#64748b",
                                borderRadius: 6, fontSize: 11, fontWeight: 800,
                                cursor: "pointer", fontFamily: FONT,
                                boxShadow: imageMode === mode ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                            }}
                        >{mode === "file" ? "Upload" : "URL"}</button>
                    ))}
                </div>
                {imageMode === "file" ? (
                    <input
                        type="file" accept="image/*"
                        onChange={e => {
                            const f = e.target.files?.[0] || null;
                            setImageFile(f);
                            setImagePreview(f ? URL.createObjectURL(f) : "");
                        }}
                        style={{ ...inputStyle, padding: 8 }}
                    />
                ) : (
                    <input
                        type="url"
                        value={imageUrl}
                        onChange={e => {
                            setImageUrl(e.target.value);
                            setImagePreview(e.target.value.trim());
                        }}
                        placeholder="https://example.com/image.jpg"
                        style={inputStyle}
                    />
                )}
                {imagePreview && (
                    <img
                        src={imagePreview}
                        alt="preview"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        onLoad={e => { (e.currentTarget as HTMLImageElement).style.display = "block"; }}
                        style={{ marginTop: 8, width: 80, height: 80, borderRadius: 8, objectFit: "cover", border: "1px solid #e2e8f0" }}
                    />
                )}
            </Field>

            <ModalFooter
                onCancel={onClose}
                onConfirm={submit}
                confirmLabel="Add Product"
                disabled={!canSubmit}
                busy={m.isPending}
            />
        </Modal>
    );
}

// ─── Add Stock modal ─────────────────────────────────────────────────────

function AddStockModal({ clubId, products, onClose, onDone, onErr }: {
    clubId: string | null; products: SimpleProduct[];
    onClose: () => void; onDone: (msg: string) => void; onErr: (msg: string) => void;
}) {
    const m = useAddStock();
    const [activeId, setActiveId] = useState<string | null>(null);
    const [qty, setQty] = useState("");

    const confirm = async () => {
        if (!clubId || !activeId) return;
        const product = products.find(p => p.id === activeId);
        if (!product) return;
        const quantity = parseInt(qty, 10);
        if (!Number.isFinite(quantity) || quantity <= 0) { onErr("Enter a quantity greater than zero"); return; }
        try {
            await m.mutateAsync({ clubId, product, quantity });
            onDone(`+${quantity} box${quantity === 1 ? "" : "es"} added to ${product.name}`);
        } catch (e: any) {
            onErr(e.message || "Failed to add stock");
        }
    };

    if (activeId) {
        const p = products.find(p => p.id === activeId)!;
        return (
            <Modal title={`Add stock — ${p.name}`} onClose={() => { setActiveId(null); setQty(""); }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
                    {p.flavor || "—"} · {p.size || "—"} · Current: <b style={{ color: "#0f172a" }}>{p.currentStock} box{p.currentStock === 1 ? "" : "es"}</b>
                </div>
                <Field label="How many boxes / packs arrived?">
                    <input
                        type="number" value={qty} onChange={e => setQty(e.target.value)}
                        placeholder="e.g. 100" autoFocus min="1" style={inputStyle}
                    />
                </Field>
                <ModalFooter
                    onCancel={() => { setActiveId(null); setQty(""); }}
                    onConfirm={confirm}
                    confirmLabel="Save"
                    disabled={!qty || m.isPending}
                    busy={m.isPending}
                />
            </Modal>
        );
    }

    return (
        <Modal title="Add Stock" onClose={onClose} maxWidth={560}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Pick a product to add stock to.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {products.map(p => (
                    <div key={p.id} style={listRow}>
                        <ProductSummary p={p} />
                        <button onClick={() => setActiveId(p.id)} style={smallBtn}>+ Add</button>
                    </div>
                ))}
            </div>
        </Modal>
    );
}

// ─── Daily Club Usage modal ──────────────────────────────────────────────

function ClubUsageModal({ clubId, products, onClose, onDone, onErr }: {
    clubId: string | null; products: SimpleProduct[];
    onClose: () => void; onDone: (msg: string) => void; onErr: (msg: string) => void;
}) {
    const m = useRecordClubUsage();
    const todayShakes = useTodayShakes(clubId);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [qty, setQty] = useState("");

    const confirm = async () => {
        if (!clubId || !activeId) return;
        const product = products.find(p => p.id === activeId);
        if (!product) return;
        const quantity = parseInt(qty, 10);
        if (!Number.isFinite(quantity) || quantity <= 0) { onErr("Enter a quantity greater than zero"); return; }
        if (quantity > product.currentStock) { onErr(`Only ${product.currentStock} box${product.currentStock === 1 ? "" : "es"} available`); return; }
        try {
            await m.mutateAsync({ clubId, product, quantity });
            onDone(`-${quantity} box${quantity === 1 ? "" : "es"} used (${product.name})`);
        } catch (e: any) {
            onErr(e.message || "Failed to record usage");
        }
    };

    if (activeId) {
        const p = products.find(p => p.id === activeId)!;
        return (
            <Modal title={`Daily usage — ${p.name}`} onClose={() => { setActiveId(null); setQty(""); }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
                    {p.flavor || "—"} · {p.size || "—"} · Available: <b style={{ color: "#0f172a" }}>{p.currentStock} box{p.currentStock === 1 ? "" : "es"}</b>
                </div>
                <Field label="Quantity used today">
                    <input
                        type="number" value={qty} onChange={e => setQty(e.target.value)}
                        placeholder="e.g. 2" autoFocus min="1" max={p.currentStock} style={inputStyle}
                    />
                </Field>
                <ModalFooter
                    onCancel={() => { setActiveId(null); setQty(""); }}
                    onConfirm={confirm}
                    confirmLabel="Save"
                    disabled={!qty || m.isPending}
                    busy={m.isPending}
                />
            </Modal>
        );
    }

    return (
        <Modal title="Daily Club Usage" onClose={onClose} maxWidth={560}>
            {/* Today's served shakes — a cross-check while recording box usage.
                Informational only (simple-inventory SKUs aren't recipe-linked,
                so we don't auto-deduct). */}
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#15803d" }}>🥤 Shakes served today</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: "#15803d" }}>{todayShakes.loading ? "…" : todayShakes.total}</div>
                </div>
                {!todayShakes.loading && todayShakes.byShake.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {todayShakes.byShake.map(s => (
                            <span key={s.name} style={{ fontSize: 11, fontWeight: 700, color: "#166534", background: "white", border: "1px solid #bbf7d0", padding: "3px 9px", borderRadius: 100 }}>
                                {s.name} × {s.qty}
                            </span>
                        ))}
                    </div>
                )}
                <div style={{ fontSize: 10, color: "#15803d", opacity: 0.8, marginTop: 8 }}>
                    Use this to sanity-check the boxes you record below against what was actually served.
                </div>
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Pick a product to record today's usage.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {products.map(p => (
                    <div key={p.id} style={listRow}>
                        <ProductSummary p={p} />
                        <button
                            onClick={() => setActiveId(p.id)}
                            disabled={p.currentStock <= 0}
                            style={{ ...smallBtn, background: p.currentStock <= 0 ? "#cbd5e1" : "#0f172a", cursor: p.currentStock <= 0 ? "not-allowed" : "pointer" }}
                        >Use</button>
                    </div>
                ))}
            </div>
        </Modal>
    );
}

// ─── Give for Event modal ────────────────────────────────────────────────

function EventGiveModal({ clubId, club, products, onClose, onDone, onErr }: {
    clubId: string | null; club: any; products: SimpleProduct[];
    onClose: () => void; onDone: (msg: string) => void; onErr: (msg: string) => void;
}) {
    const m = useGiveForEvent();
    const [eventName, setEventName] = useState("");
    const [picks, setPicks] = useState<Record<string, string>>({});
    const [notes, setNotes] = useState("");

    const total = Object.values(picks).reduce((s, q) => s + (parseInt(q, 10) || 0), 0);
    const validPicks = Object.entries(picks)
        .map(([id, q]) => ({ id, q: parseInt(q, 10) || 0 }))
        .filter(x => x.q > 0);

    const submit = async () => {
        if (!clubId) return;
        if (!eventName.trim()) { onErr("Event name is required"); return; }
        if (validPicks.length === 0) { onErr("Add at least one product"); return; }
        for (const x of validPicks) {
            const p = products.find(pp => pp.id === x.id);
            if (!p) continue;
            if (x.q > p.currentStock) { onErr(`Only ${p.currentStock} of ${p.name} available`); return; }
        }
        const items = validPicks.map(x => {
            const p = products.find(pp => pp.id === x.id)!;
            return { product: p, quantity: x.q };
        });
        try {
            await m.mutateAsync({ clubId, eventName, notes, items });
            // Auto-print RawBT receipt
            try {
                const clubPrint: ClubPrintData = {
                    name: club?.name || "Magic Nutrition Club",
                    address: club?.address,
                    phone: club?.phone,
                    email: club?.email,
                    gstNumber: club?.gstNumber,
                };
                printViaRawBT(buildInventoryGiveReceipt({
                    club: clubPrint,
                    kind: "event",
                    recipientName: eventName.trim(),
                    items: items.map(i => ({
                        name: i.product.name,
                        flavor: i.product.flavor,
                        size: i.product.size,
                        quantity: i.quantity,
                    })),
                    totalBoxes: total,
                    notes: notes.trim() || undefined,
                    timestamp: new Date(),
                }));
            } catch (printErr) {
                console.warn("[inventory] event receipt print failed", printErr);
            }
            onDone(`${total} box${total === 1 ? "" : "es"} given to "${eventName}" — receipt sent to printer`);
        } catch (e: any) {
            onErr(e.message || "Failed to record event give-away");
        }
    };

    return (
        <Modal title="Give for Event" onClose={onClose} maxWidth={620}>
            <Field label="Event / Group Name *">
                <input
                    type="text" value={eventName} onChange={e => setEventName(e.target.value)}
                    placeholder="e.g. Bangalore BTC Event" autoFocus style={inputStyle}
                />
            </Field>

            <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, margin: "12px 0 6px" }}>
                Products & Quantities
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8, padding: 8 }}>
                {products.map(p => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>
                                {p.flavor || "—"} · {p.size || "—"} · {p.currentStock} avail
                            </div>
                        </div>
                        <input
                            type="number" min="0" max={p.currentStock}
                            value={picks[p.id] || ""}
                            onChange={e => setPicks(s => ({ ...s, [p.id]: e.target.value }))}
                            placeholder="0"
                            disabled={p.currentStock <= 0}
                            style={{ width: 90, padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, fontFamily: FONT, fontVariantNumeric: "tabular-nums", textAlign: "right" }}
                        />
                    </div>
                ))}
            </div>

            <Field label="Notes (optional)" style={{ marginTop: 12 }}>
                <input
                    type="text" value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. picked up by Ravi, return by Sunday" style={inputStyle}
                />
            </Field>

            {validPicks.length > 0 && (
                <div style={{
                    marginTop: 12, padding: "10px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0",
                    borderRadius: 8, display: "flex", alignItems: "center", gap: 8,
                }}>
                    <AlertCircle className="w-4 h-4" style={{ color: "#166534" }} />
                    <div style={{ fontSize: 12, color: "#166534", fontWeight: 700 }}>
                        {validPicks.length} product{validPicks.length === 1 ? "" : "s"} · {total} box{total === 1 ? "" : "es"} total — stock will be reduced on save.
                    </div>
                </div>
            )}

            <ModalFooter
                onCancel={onClose}
                onConfirm={submit}
                confirmLabel="Give for Event"
                disabled={!eventName.trim() || validPicks.length === 0 || m.isPending}
                busy={m.isPending}
            />
        </Modal>
    );
}

// ─── Give to Person modal ───────────────────────────────────────────────

function GiveToPersonModal({ clubId, club, products, onClose, onDone, onErr }: {
    clubId: string | null; club: any; products: SimpleProduct[];
    onClose: () => void; onDone: (msg: string) => void; onErr: (msg: string) => void;
}) {
    const m = useGiveToPerson();
    const membersQ = useMembers(clubId);
    const members: Member[] = membersQ.data || [];

    const [personName, setPersonName] = useState("");
    const [personPhone, setPersonPhone] = useState("");
    // When the receptionist picks a real member, we remember their id so we
    // can also append a transaction row to their /transactions subcollection.
    const [selectedMember, setSelectedMember] = useState<Member | null>(null);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [notes, setNotes] = useState("");
    // Default to 7 days from today
    const defaultDeadline = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    const [deadline, setDeadline] = useState(defaultDeadline);
    const [picks, setPicks] = useState<Record<string, string>>({});

    const total = Object.values(picks).reduce((s, q) => s + (parseInt(q, 10) || 0), 0);
    const validPicks = Object.entries(picks)
        .map(([id, q]) => ({ id, q: parseInt(q, 10) || 0 }))
        .filter(x => x.q > 0);

    // Member autocomplete — match by name / memberId / phone, cap at 8 rows.
    const memberSuggestions = useMemo(() => {
        const q = personName.trim().toLowerCase();
        if (!q || q.length < 1) return [];
        const filtered = members.filter(mem => {
            const name = (mem.name || "").toLowerCase();
            const mid = String((mem as any).memberId || "").toLowerCase();
            const phone = (mem.phone || "").toLowerCase();
            return name.includes(q) || mid.includes(q) || phone.includes(q);
        });
        // Promote startsWith matches above includes matches
        filtered.sort((a, b) => {
            const an = (a.name || "").toLowerCase();
            const bn = (b.name || "").toLowerCase();
            const aStarts = an.startsWith(q) ? 0 : 1;
            const bStarts = bn.startsWith(q) ? 0 : 1;
            if (aStarts !== bStarts) return aStarts - bStarts;
            return an.localeCompare(bn);
        });
        return filtered.slice(0, 8);
    }, [members, personName]);

    const pickMember = (mem: Member) => {
        setSelectedMember(mem);
        setPersonName(mem.name || "");
        setPersonPhone(mem.phone || "");
        setShowSuggestions(false);
    };

    const submit = async () => {
        if (!clubId) return;
        if (!personName.trim()) { onErr("Person name is required"); return; }
        if (!deadline) { onErr("Return deadline is required"); return; }
        if (validPicks.length === 0) { onErr("Add at least one product"); return; }
        for (const x of validPicks) {
            const p = products.find(pp => pp.id === x.id);
            if (!p) continue;
            if (x.q > p.currentStock) { onErr(`Only ${p.currentStock} of ${p.name} available`); return; }
        }
        const items = validPicks.map(x => {
            const p = products.find(pp => pp.id === x.id)!;
            return { product: p, quantity: x.q };
        });
        try {
            await m.mutateAsync({
                clubId,
                personName,
                personPhone,
                notes,
                returnDeadline: deadline,
                items,
            });

            // If recipient is a registered member, mirror the give-away into
            // their /transactions subcollection so it appears on the member
            // dashboard's recent activity list.
            if (selectedMember?.id && selectedMember.name?.toLowerCase() === personName.trim().toLowerCase()) {
                try {
                    const itemSummary = items.map(i => `${i.quantity}× ${i.product.name}${i.product.flavor ? ` (${i.product.flavor})` : ''}`).join(", ");
                    await addDoc(
                        collection(db, `clubs/${clubId}/members/${selectedMember.id}/transactions`),
                        {
                            type: "credit",
                            amount: 0,                         // not a money txn
                            reason: "inventory_received",
                            itemsCount: total,
                            note: `Received from club inventory: ${itemSummary}`,
                            description: `Inventory issued — return by ${deadline}`,
                            returnDeadline: deadline,
                            createdAt: serverTimestamp(),
                        }
                    );
                } catch (txErr) {
                    console.warn("[inventory] failed to write member transaction", txErr);
                }
            }

            // Auto-print RawBT receipt
            try {
                const clubPrint: ClubPrintData = {
                    name: club?.name || "Magic Nutrition Club",
                    address: club?.address,
                    phone: club?.phone,
                    email: club?.email,
                    gstNumber: club?.gstNumber,
                };
                printViaRawBT(buildInventoryGiveReceipt({
                    club: clubPrint,
                    kind: "person",
                    recipientName: personName.trim(),
                    recipientPhone: personPhone.trim() || undefined,
                    memberId: selectedMember ? String((selectedMember as any).memberId || "") : undefined,
                    items: items.map(i => ({
                        name: i.product.name,
                        flavor: i.product.flavor,
                        size: i.product.size,
                        quantity: i.quantity,
                    })),
                    totalBoxes: total,
                    returnDeadline: deadline,
                    notes: notes.trim() || undefined,
                    timestamp: new Date(),
                }));
            } catch (printErr) {
                console.warn("[inventory] person receipt print failed", printErr);
            }

            onDone(`${total} box${total === 1 ? "" : "es"} given to "${personName}" · return by ${deadline} — receipt sent to printer`);
        } catch (e: any) {
            onErr(e.message || "Failed to record borrow");
        }
    };

    return (
        <Modal title="Give to Person" onClose={onClose} maxWidth={620}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Person Name *">
                    <div style={{ position: "relative" }}>
                        <input
                            type="text"
                            value={personName}
                            onChange={e => {
                                setPersonName(e.target.value);
                                setSelectedMember(null);
                                setShowSuggestions(true);
                            }}
                            onFocus={() => setShowSuggestions(true)}
                            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                            placeholder={membersQ.isLoading ? "Loading members…" : "Type to search members…"}
                            autoFocus
                            style={inputStyle}
                            autoComplete="off"
                        />
                        {selectedMember && (
                            <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 10, fontWeight: 800, color: "#16a34a", background: "#dcfce7", padding: "2px 8px", borderRadius: 999, pointerEvents: "none" }}>
                                ✓ {String((selectedMember as any).memberId || "MEMBER")}
                            </div>
                        )}
                        {showSuggestions && memberSuggestions.length > 0 && (
                            <div style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", background: "white", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 10px 24px rgba(0,0,0,0.12)", zIndex: 50, maxHeight: 260, overflowY: "auto" }}>
                                {memberSuggestions.map(mem => (
                                    <button
                                        type="button"
                                        key={mem.id}
                                        onMouseDown={(e) => { e.preventDefault(); pickMember(mem); }}
                                        style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid #f1f5f9", padding: "8px 12px", cursor: "pointer", fontFamily: FONT }}
                                    >
                                        <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{mem.name}</div>
                                        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                                            {(mem as any).memberId || "—"}{mem.phone ? ` · ${mem.phone}` : ""}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </Field>
                <Field label="Phone (optional)">
                    <input
                        type="tel" value={personPhone} onChange={e => setPersonPhone(e.target.value)}
                        placeholder="e.g. 9876543210" style={inputStyle}
                    />
                </Field>
            </div>

            <Field label="Return Deadline *">
                <input
                    type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    style={inputStyle}
                />
            </Field>

            <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, margin: "12px 0 6px" }}>
                Products & Quantities
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8, padding: 8 }}>
                {products.map(p => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>
                                {p.flavor || "—"} · {p.size || "—"} · {p.currentStock} avail
                            </div>
                        </div>
                        <input
                            type="number" min="0" max={p.currentStock}
                            value={picks[p.id] || ""}
                            onChange={e => setPicks(s => ({ ...s, [p.id]: e.target.value }))}
                            placeholder="0"
                            disabled={p.currentStock <= 0}
                            style={{ width: 90, padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, fontFamily: FONT, fontVariantNumeric: "tabular-nums", textAlign: "right" }}
                        />
                    </div>
                ))}
            </div>

            <Field label="Notes (optional)" style={{ marginTop: 12 }}>
                <input
                    type="text" value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. picked up for personal use" style={inputStyle}
                />
            </Field>

            {validPicks.length > 0 && (
                <div style={{
                    marginTop: 12, padding: "10px 12px", background: "#fef3c7", border: "1px solid #fcd34d",
                    borderRadius: 8, display: "flex", alignItems: "center", gap: 8,
                }}>
                    <AlertCircle className="w-4 h-4" style={{ color: "#92400e" }} />
                    <div style={{ fontSize: 12, color: "#92400e", fontWeight: 700 }}>
                        {validPicks.length} product{validPicks.length === 1 ? "" : "s"} · {total} box{total === 1 ? "" : "es"} · return by {deadline || "—"} — status will be "Pending Return".
                    </div>
                </div>
            )}

            <ModalFooter
                onCancel={onClose}
                onConfirm={submit}
                confirmLabel="Give to Person"
                disabled={!personName.trim() || !deadline || validPicks.length === 0 || m.isPending}
                busy={m.isPending}
            />
        </Modal>
    );
}

// ─── Shared bits ─────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", border: "1px solid #cbd5e1",
    borderRadius: 8, fontSize: 13, fontFamily: FONT, outline: "none", background: "white",
};
const listRow: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 12,
    padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8,
};
const smallBtn: React.CSSProperties = {
    background: ACCENT, color: "white", border: "none",
    padding: "8px 14px", borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
};

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <div style={{ marginBottom: 12, ...style }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</label>
            {children}
        </div>
    );
}

function ProductSummary({ p }: { p: SimpleProduct }) {
    return (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flex: 1, minWidth: 0 }}>
            {p.imageUrl ? (
                <img src={p.imageUrl} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", border: "1px solid #e2e8f0", flexShrink: 0 }} />
            ) : (
                <div style={{ width: 36, height: 36, borderRadius: 6, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Package className="w-4 h-4" style={{ color: "#94a3b8" }} />
                </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>
                    {p.flavor || "—"} · {p.size || "—"} · <span style={{ color: p.currentStock <= 0 ? "#dc2626" : "#16a34a", fontWeight: 800 }}>{p.currentStock} box{p.currentStock === 1 ? "" : "es"}</span>
                </div>
            </div>
        </div>
    );
}

function ModalFooter({ onCancel, onConfirm, confirmLabel, disabled, busy }: {
    onCancel: () => void; onConfirm: () => void; confirmLabel: string;
    disabled?: boolean; busy?: boolean;
}) {
    return (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button
                onClick={onCancel} disabled={busy}
                style={{ padding: "10px 16px", background: "white", border: "1.5px solid #e2e8f0", color: "#475569", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", fontFamily: FONT }}
            >Cancel</button>
            <button
                onClick={onConfirm} disabled={disabled || busy}
                style={{ padding: "10px 22px", background: (disabled || busy) ? "#cbd5e1" : ACCENT, color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 900, cursor: (disabled || busy) ? "not-allowed" : "pointer", fontFamily: FONT }}
            >{busy ? "Saving…" : confirmLabel}</button>
        </div>
    );
}
