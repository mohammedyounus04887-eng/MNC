/**
 * Recipe editor for the unified inventory model.
 *
 *   - Recipes can only be defined for menu items (passed in via props).
 *   - Each ingredient pins one specific inventory item (e.g. "Protein
 *     1000g") so deduction has no ambiguity. The unit is inherited from
 *     the chosen item — the operator only types "how many <unit> per
 *     shake?" and never picks a unit themselves.
 */

import { useEffect, useState } from "react";
import { Plus, Trash2, ChefHat, X, Edit2, Check } from "lucide-react";
import {
    collection, doc, setDoc, updateDoc, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useRecipesUnified } from "@/hooks/useUnifiedInventory";
import type { InventoryItem, Recipe, RecipeIngredient } from "@/types/firestore";

interface Props {
    menuItems: { id: string; name: string }[];
    inventoryItems: InventoryItem[];
}

interface DraftIngredient {
    inventoryItemId: string;
    inventoryItemName: string;
    unit: string;
    amountPerServing: number;
}

function genId(prefix: string) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

export default function RecipeEditor({ menuItems, inventoryItems }: Props) {
    const { club } = useClubContext();
    const clubId = club?.id ?? "";
    const { recipes, loading } = useRecipesUnified();

    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [menuItemId, setMenuItemId] = useState("");
    const [ingredients, setIngredients] = useState<DraftIngredient[]>([]);
    const [saving, setSaving] = useState(false);

    function resetForm() {
        setShowForm(false); setEditingId(null);
        setName(""); setMenuItemId(""); setIngredients([]);
    }

    function startEdit(r: Recipe) {
        setEditingId(r.id);
        setName(r.name);
        setMenuItemId(r.menuItemId);
        setIngredients(r.ingredients
            .filter((ing) => ing.inventoryItemId)        // skip legacy boxYield rows
            .map((ing) => ({
                inventoryItemId: ing.inventoryItemId,
                inventoryItemName: ing.inventoryItemName ?? "",
                unit: ing.unit,
                amountPerServing: ing.amountPerServing ?? 0,
            })));
        setShowForm(true);
    }

    function addIngredient() {
        setIngredients((prev) => [...prev, {
            inventoryItemId: "", inventoryItemName: "", unit: "", amountPerServing: 0,
        }]);
    }

    function pickInventory(idx: number, inventoryItemId: string) {
        const item = inventoryItems.find((i) => i.id === inventoryItemId);
        if (!item) return;
        setIngredients((prev) => prev.map((ing, i) =>
            i === idx
                ? { ...ing, inventoryItemId, inventoryItemName: item.name, unit: item.unit }
                : ing,
        ));
    }

    function setAmount(idx: number, amount: number) {
        setIngredients((prev) => prev.map((ing, i) =>
            i === idx ? { ...ing, amountPerServing: amount } : ing,
        ));
    }

    function removeIngredient(idx: number) {
        setIngredients((prev) => prev.filter((_, i) => i !== idx));
    }

    async function handleSave() {
        const menuItem = menuItems.find((m) => m.id === menuItemId);
        const cleanIngredients: RecipeIngredient[] = ingredients
            .filter((i) => i.inventoryItemId && i.amountPerServing > 0)
            .map((i) => ({
                inventoryItemId: i.inventoryItemId,
                inventoryItemName: i.inventoryItemName,
                unit: i.unit,
                amountPerServing: i.amountPerServing,
            }));
        if (!menuItemId || !menuItem || cleanIngredients.length === 0) return;
        const finalName = name.trim() || menuItem.name;

        setSaving(true);
        const now = Timestamp.now();
        try {
            if (editingId) {
                await updateDoc(doc(db, `clubs/${clubId}/recipes`, editingId), {
                    name: finalName,
                    menuItemId,
                    menuItemName: menuItem.name,
                    ingredients: cleanIngredients,
                    isActive: true,
                    updatedAt: now,
                });
            } else {
                const id = genId("rec");
                await setDoc(doc(db, `clubs/${clubId}/recipes`, id), {
                    id,
                    name: finalName,
                    menuItemId,
                    menuItemName: menuItem.name,
                    ingredients: cleanIngredients,
                    isActive: true,
                    createdAt: now,
                    updatedAt: now,
                });
            }
            resetForm();
        } finally {
            setSaving(false);
        }
    }

    async function toggleActive(r: Recipe) {
        await updateDoc(doc(db, `clubs/${clubId}/recipes`, r.id), {
            isActive: !r.isActive,
            updatedAt: Timestamp.now(),
        });
    }

    // Auto-fill recipe name from menu item when one is picked & name is blank.
    useEffect(() => {
        if (showForm && menuItemId && !name.trim()) {
            const m = menuItems.find((x) => x.id === menuItemId);
            if (m) setName(m.name);
        }
    }, [menuItemId, showForm]); // eslint-disable-line react-hooks/exhaustive-deps

    if (loading) {
        return <div className="py-8 text-center text-slate-400 text-sm font-semibold">Loading recipes…</div>;
    }

    return (
        <div className="space-y-4" style={{ fontFamily: "'Nunito', sans-serif" }}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ChefHat className="w-5 h-5 text-emerald-600" />
                    <h3 className="text-base font-black text-slate-900">Shake Recipes</h3>
                </div>
                <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
                    <Plus className="w-3.5 h-3.5" /> Add Recipe
                </button>
            </div>

            {/* Existing recipes */}
            {recipes.length === 0 && !showForm && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-8 text-center">
                    <ChefHat className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-bold text-slate-400">No recipes defined yet</p>
                    <p className="text-xs text-slate-400 mt-1">Add one to link a shake on the menu with the inventory items it uses.</p>
                </div>
            )}

            {recipes.map((r) => (
                <div key={r.id} className={`bg-white border rounded-2xl p-4 ${r.isActive ? "border-emerald-200" : "border-slate-200 opacity-60"}`}>
                    <div className="flex items-center justify-between mb-2">
                        <div>
                            <p className="font-black text-slate-900 text-sm">{r.name}</p>
                            <p className="text-[10px] text-slate-400">Menu: {r.menuItemName}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button onClick={() => toggleActive(r)} className={`px-2 py-1 rounded-lg text-[10px] font-bold ${r.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                {r.isActive ? "Active" : "Inactive"}
                            </button>
                            <button onClick={() => startEdit(r)} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200">
                                <Edit2 className="w-3 h-3 text-slate-500" />
                            </button>
                        </div>
                    </div>
                    <div className="space-y-1">
                        {r.ingredients.map((ing, i) => {
                            // Old recipes carried boxYield instead of amountPerServing —
                            // surface them as "needs review" so the operator sees the
                            // ones that didn't make the cut after the wipe.
                            const isLegacy = !ing.inventoryItemId;
                            return (
                                <div key={i} className={`flex items-center justify-between text-xs rounded-lg px-3 py-1.5 ${isLegacy ? "bg-amber-50 border border-amber-200" : "bg-slate-50"}`}>
                                    <span className="font-bold text-slate-700">
                                        {isLegacy ? `⚠ ${ing.productName ?? ing.inventoryItemName ?? "Unknown"} (legacy)` : ing.inventoryItemName}
                                    </span>
                                    <span className="text-slate-500">
                                        {isLegacy
                                            ? "needs re-add"
                                            : <><strong className="text-emerald-700">{ing.amountPerServing}</strong> {ing.unit} per shake</>}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* Add/edit form */}
            {showForm && (
                <div className="bg-white border-2 border-emerald-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="font-black text-slate-900 text-sm">{editingId ? "Edit Recipe" : "New Recipe"}</p>
                        <button onClick={resetForm} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-4 h-4 text-slate-400" /></button>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Shake (from menu) *</label>
                        <select value={menuItemId} onChange={(e) => setMenuItemId(e.target.value)}
                            className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white">
                            <option value="">— Select a shake —</option>
                            {menuItems.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Recipe Name</label>
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-filled from shake"
                            className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ingredients</label>
                            <button onClick={addIngredient} className="text-[10px] font-bold text-emerald-600 hover:underline">+ Add Ingredient</button>
                        </div>
                        <div className="space-y-2">
                            {ingredients.map((ing, idx) => (
                                <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2">
                                    <select value={ing.inventoryItemId} onChange={(e) => pickInventory(idx, e.target.value)}
                                        className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold bg-white focus:outline-none">
                                        <option value="">Select inventory item…</option>
                                        {inventoryItems.map((it) => (
                                            <option key={it.id} value={it.id}>{it.name} ({it.size}{it.unit}/pkt)</option>
                                        ))}
                                    </select>
                                    <div className="flex items-center gap-1">
                                        <input type="number" min={0} step="any" value={ing.amountPerServing || ""}
                                            onChange={(e) => setAmount(idx, Number(e.target.value))}
                                            placeholder="0"
                                            className="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-bold text-center focus:outline-none" />
                                        <span className="text-[10px] text-slate-500 whitespace-nowrap min-w-[44px]">
                                            {ing.unit ? `${ing.unit} / shake` : "/ shake"}
                                        </span>
                                    </div>
                                    <button onClick={() => removeIngredient(idx)} className="p-1 rounded-lg hover:bg-red-50">
                                        <Trash2 className="w-3 h-3 text-red-400" />
                                    </button>
                                </div>
                            ))}
                            {ingredients.length === 0 && (
                                <p className="text-xs text-slate-400 text-center py-2">No ingredients added. Click "+ Add Ingredient".</p>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-2 pt-1">
                        <button onClick={resetForm} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm">Cancel</button>
                        <button onClick={handleSave}
                            disabled={!menuItemId || ingredients.filter((i) => i.inventoryItemId && i.amountPerServing > 0).length === 0 || saving}
                            className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-60">
                            <Check className="w-4 h-4 inline mr-1" />{saving ? "Saving…" : editingId ? "Update" : "Save"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
