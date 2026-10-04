import { useState, useMemo, useEffect, useRef } from "react";
import { UtensilsCrossed, Plus, Pencil, Trash2, ImageIcon, Globe, Star, Eye, EyeOff, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    useMenuItems,
    useAddMenuItem,
    useUpdateMenuItem,
    useDeleteMenuItem,
    useToggleAvailability,
} from "@/hooks/owner/useMenu";
import {
    useGlobalMenuItems,
    useAddGlobalMenuItem,
    useUpdateGlobalMenuItem,
    useSetGlobalItemHidden,
    type CombinedMenuItem,
} from "@/hooks/useGlobalMenu";
import { useClubContext } from "@/lib/clubDetection";
import { useToast } from "@/hooks/use-toast";
import type { Product } from "@/types/firestore";
import { getDocs, collection, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { GlobalMenuDialog } from "@/components/shared/GlobalMenuDialog";

const CATEGORIES = ["shake", "tea", "drink", "supplement", "snack", "other"] as const;
const CAT_LABELS: Record<string, string> = {
    shake: "Shake", tea: "Tea", drink: "Drink",
    supplement: "Supplement", snack: "Snack", other: "Other"
};

function getCategoryEmoji(cat: string) {
    if (cat === "shake" || cat === "drink") return "🥤";
    if (cat === "tea") return "🍵";
    if (cat === "supplement") return "💊";
    if (cat === "snack") return "🍿";
    return "🍽️";
}

export default function Menu() {
    const { club } = useClubContext();
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [sourceFilter, setSourceFilter] = useState<"all" | "global" | "club">("all");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [globalDialogOpen, setGlobalDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Product | null>(null);
    const [editingGlobalItem, setEditingGlobalItem] = useState<any | null>(null);
    const { toast } = useToast();

    // Club-only items
    const { data: clubItems, isLoading: clubLoading } = useMenuItems(club?.id ?? null);
    // Global items
    const { data: globalItems = [], isLoading: globalLoading } = useGlobalMenuItems();
    // Global modifications
    const addGlobalItem = useAddGlobalMenuItem();
    const updateGlobalItem = useUpdateGlobalMenuItem();
    // Toggle global item hidden for this club
    const setHidden = useSetGlobalItemHidden();

    // Club menu preferences (hidden global items)
    const [hiddenGlobalIds, setHiddenGlobalIds] = useState<Set<string>>(new Set());
    useEffect(() => {
        if (!club?.id) return;
        getDocs(collection(db, `clubs/${club.id}/menuPreferences`)).then(snap => {
            const hidden = new Set(snap.docs.filter(d => d.data().isHidden).map(d => d.id));
            setHiddenGlobalIds(hidden);
        });
    }, [club?.id]);

    const addItem = useAddMenuItem();
    const updateItem = useUpdateMenuItem();
    const deleteItem = useDeleteMenuItem();
    const toggleAvail = useToggleAvailability();

    const isLoading = clubLoading || globalLoading;

    // Build combined list
    const combinedItems = useMemo(() => {
        const globalCombined = globalItems
            .filter(g => g.isActive)
            .map(g => ({
                ...g,
                id: `global_${g.id}`,
                _rawId: g.id,
                source: "global" as const,
                isHiddenForClub: hiddenGlobalIds.has(g.id),
                price: undefined as any,
                isAvailableToday: false,
            }));

        const clubCombined = (clubItems || []).map(c => ({
            ...c,
            source: "club" as const,
            _rawId: c.id,
            isHiddenForClub: false,
        }));

        return [...globalCombined, ...clubCombined];
    }, [globalItems, clubItems, hiddenGlobalIds]);

    const filteredItems = useMemo(() => {
        return combinedItems.filter(item => {
            const matchesCat = categoryFilter === "all" || item.category === categoryFilter;
            const matchesSrc = sourceFilter === "all" || item.source === sourceFilter;
            return matchesCat && matchesSrc;
        });
    }, [combinedItems, categoryFilter, sourceFilter]);

    const handleToggle = (itemId: string, available: boolean) => {
        toggleAvail.mutate(
            { clubId: club?.id ?? "", itemId, available },
            {
                onSuccess: () => toast({ title: available ? "Available" : "Unavailable" }),
                onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
            }
        );
    };

    const handleHideGlobal = (rawId: string, currentlyHidden: boolean) => {
        setHidden.mutate(
            { clubId: club?.id ?? "", itemId: rawId, isHidden: !currentlyHidden },
            {
                onSuccess: () => {
                    setHiddenGlobalIds(prev => {
                        const next = new Set(prev);
                        if (!currentlyHidden) next.add(rawId);
                        else next.delete(rawId);
                        return next;
                    });
                    toast({ title: currentlyHidden ? "Global item shown" : "Global item hidden for your club" });
                },
            }
        );
    };

    const handleBulkToggle = (available: boolean) => {
        const clubOnlyFiltered = filteredItems.filter(i => i.source === "club");
        clubOnlyFiltered.forEach(item => {
            if ((item as any).isAvailableToday !== available) {
                toggleAvail.mutate({ clubId: club?.id ?? "", itemId: item._rawId, available });
            }
        });
        toast({ title: available ? "All custom items set to available" : "All custom items set to unavailable" });
    };

    const handleDelete = (item: any) => {
        if (!confirm(`Delete "${item.name}"?`)) return;
        deleteItem.mutate({ clubId: club?.id ?? "", itemId: item._rawId }, {
            onSuccess: () => {
                toast({ title: "Item deleted" });
                setDialogOpen(false);
                setEditingItem(null);
            },
            onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
        });
    };

    const openAdd = () => { setEditingItem(null); setDialogOpen(true); };
    const openEdit = (item: Product) => { setEditingItem(item); setDialogOpen(true); };

    const openAddGlobal = () => { setEditingGlobalItem(null); setGlobalDialogOpen(true); };
    const openEditGlobal = (item: any) => { setEditingGlobalItem(item); setGlobalDialogOpen(true); };

    return (
        <div className="space-y-6 p-5" style={{ fontFamily: "'Nunito', sans-serif" }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: "#2d9653" }}>Menu Management</h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        <span className="font-semibold text-violet-600">{globalItems.filter(g => g.isActive).length} standard</span> Herbalife items
                        + <span className="font-semibold text-blue-600">{clubItems?.length ?? 0} custom</span> items
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button size="lg" variant="outline" className="min-h-[48px] gap-2 border-violet-200 text-violet-700 hover:bg-violet-50 font-bold" onClick={openAddGlobal}>
                        <Globe className="w-5 h-5 text-violet-500" /> Share New Product with All Clubs
                    </Button>
                    <Button size="lg" className="min-h-[48px] gap-2 font-bold" style={{ backgroundColor: "#2d9653" }} onClick={openAdd}>
                        <Star className="w-5 h-5" /> Add Private Club Item
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-[140px] min-h-[48px]"><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {CATEGORIES.map(c => <SelectItem key={c} value={c}>{CAT_LABELS[c]}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={sourceFilter} onValueChange={v => setSourceFilter(v as any)}>
                    <SelectTrigger className="w-[140px] min-h-[48px]"><SelectValue placeholder="Source" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Items</SelectItem>
                        <SelectItem value="global">🌐 Standard</SelectItem>
                        <SelectItem value="club">⭐ Custom</SelectItem>
                    </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="min-h-[48px]" onClick={() => handleBulkToggle(true)}>All Custom Available</Button>
                <Button variant="outline" size="sm" className="min-h-[48px]" onClick={() => handleBulkToggle(false)}>All Custom Unavailable</Button>
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {isLoading ? (
                    [...Array(6)].map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)
                ) : filteredItems.length > 0 ? (
                    filteredItems.map((item) => {
                        if (item.source === "global") {
                            return (
                                <GlobalMenuCard
                                    key={item.id}
                                    item={item as any}
                                    isHidden={item.isHiddenForClub}
                                    onToggleHide={() => handleHideGlobal(item._rawId, item.isHiddenForClub)}
                                    onEdit={() => openEditGlobal(item)}
                                />
                            );
                        }
                        return (
                            <ClubMenuCard
                                key={item.id}
                                item={item as any}
                                onToggle={(v) => handleToggle(item._rawId, v)}
                                onEdit={() => openEdit(item as unknown as Product)}
                                onDelete={() => handleDelete(item)}
                            />
                        );
                    })
                ) : (
                    <div className="col-span-full bg-white rounded-2xl p-12 text-center text-muted-foreground">
                        <UtensilsCrossed className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No menu items found. Add a custom item to get started.</p>
                    </div>
                )}
            </div>

            <ItemDialog
                open={dialogOpen}
                onOpenChange={v => { setDialogOpen(v); if (!v) setEditingItem(null); }}
                clubId={club?.id ?? ""}
                item={editingItem}
                addItem={addItem}
                updateItem={updateItem}
                toast={toast}
            />

            <GlobalMenuDialog
                open={globalDialogOpen}
                onOpenChange={v => { setGlobalDialogOpen(v); if (!v) setEditingGlobalItem(null); }}
                item={editingGlobalItem}
                addItem={addGlobalItem}
                updateItem={updateGlobalItem}
                toast={toast}
            />
        </div>
    );
}

// ─── Global Item Card (read-only, hide toggle) ────────────────────────────

function GlobalMenuCard({ item, isHidden, onToggleHide, onEdit }: {
    item: any;
    isHidden?: boolean;
    onToggleHide: () => void;
    onEdit: () => void;
}) {
    const initials = item.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();

    return (
        <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${isHidden ? "opacity-50 border-dashed" : ""}`}>
            {/* Image or placeholder */}
            <div className="relative">
                {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-full h-28 object-cover" />
                ) : (
                    <div
                        className="w-full h-28 flex flex-col items-center justify-center gap-1"
                        style={{ background: "linear-gradient(135deg, #d8f3dc, #b7e4c7)" }}
                    >
                        <span style={{ fontSize: 26 }}>{getCategoryEmoji(item.category)}</span>
                        <span className="text-[10px] font-bold text-emerald-700">{initials}</span>
                    </div>
                )}
                <span className="absolute top-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-full bg-white/90 border border-violet-200 text-violet-700">
                    🌐 Standard
                </span>
            </div>

            <div className="p-4 space-y-2">
                <p className="font-bold text-sm text-gray-900 leading-tight">{item.name}</p>
                <Badge variant="secondary" className="text-xs">{CAT_LABELS[item.category] ?? item.category}</Badge>
                {item.nutritionInfo && (
                    <p className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-1 rounded-lg">{item.nutritionInfo}</p>
                )}
            </div>
            {/* Actions */}
            <div className="p-4 pt-0 mt-auto flex items-center justify-between gap-2 border-t border-gray-100 bg-gray-50/50">
                <Button size="sm" variant={isHidden ? "default" : "secondary"} className={`gap-1.5 h-8 font-bold ${isHidden ? 'bg-violet-600 hover:bg-violet-700 text-white' : 'text-gray-600'}`} onClick={onToggleHide}>
                    {isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 opacity-60 ml-0.5" />}
                    {isHidden ? "Show in my Club" : "Hide from my Club"}
                </Button>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0 border-violet-200 text-violet-700" onClick={onEdit}>
                    <Pencil className="w-3.5 h-3.5" />
                </Button>
            </div>
        </div>
    );
}

// ─── Club Item Card (editable) ────────────────────────────────────────────

function ClubMenuCard({
    item, onToggle, onEdit, onDelete,
}: {
    item: Product;
    onToggle: (v: boolean) => void;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const initial = item.name.charAt(0).toUpperCase();
    return (
        <div className="bg-white rounded-2xl p-5 border shadow-sm">
            <div className="flex gap-4">
                <div
                    className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl shrink-0 overflow-hidden"
                    style={{ backgroundColor: "#e8f5e9", color: "#2d9653" }}
                >
                    {item.photo ? <img src={item.photo} alt="" className="w-full h-full object-cover" /> : getCategoryEmoji(item.category)}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <p className="font-bold truncate">{item.name}</p>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-600 flex-shrink-0">⭐ Custom</span>
                    </div>
                    <Badge variant="secondary" className="mt-0.5 text-xs">{CAT_LABELS[item.category] ?? item.category}</Badge>
                    <p className="text-sm font-semibold mt-2">₹{item.price}</p>
                    <div className="flex items-center gap-2 mt-2">
                        <Switch checked={item.isAvailableToday} onCheckedChange={onToggle} />
                        <span className="text-xs">{item.isAvailableToday ? "Available" : "Unavailable"}</span>
                    </div>
                    <div className="flex gap-2 mt-3">
                        <Button size="sm" variant="outline" className="min-h-[40px]" onClick={onEdit}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="outline" className="min-h-[40px] text-destructive" onClick={onDelete}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Add/Edit Dialog for Club Items ──────────────────────────────────────

function ItemDialog({
    open, onOpenChange, clubId, item, addItem, updateItem, toast,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    clubId: string;
    item: Product | null;
    addItem: ReturnType<typeof useAddMenuItem>;
    updateItem: ReturnType<typeof useUpdateMenuItem>;
    toast: ReturnType<typeof useToast>["toast"];
}) {
    const [name, setName] = useState("");
    const [category, setCategory] = useState<Product["category"]>("other");
    const [price, setPrice] = useState("");
    const [description, setDescription] = useState("");
    const [available, setAvailable] = useState(true);
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string>("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isEdit = !!item;

    const reset = () => {
        setName(""); setCategory("other"); setPrice(""); setDescription("");
        setAvailable(true); setPhotoFile(null); setPhotoPreview("");
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    useEffect(() => {
        if (open) {
            if (item) {
                setName(item.name);
                setCategory(item.category);
                setPrice(String(item.price));
                setDescription(item.description || "");
                setAvailable(item.isAvailableToday ?? true);
                setPhotoFile(null);
                setPhotoPreview(item.photo || "");
            } else reset();
        }
    }, [open, item]);

    const handleSubmit = () => {
        const p = parseFloat(price);
        if (!name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
        if (isNaN(p) || p < 0) { toast({ title: "Valid price required", variant: "destructive" }); return; }

        if (isEdit && item) {
            updateItem.mutate(
                { clubId, itemId: item.id, data: { name: name.trim(), category, price: p, description, isAvailableToday: available }, photoFile },
                {
                    onSuccess: () => { toast({ title: "Item updated" }); onOpenChange(false); },
                    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
                }
            );
        } else {
            addItem.mutate(
                { clubId, item: { name: name.trim(), category, price: p, description, isAvailableToday: available }, photoFile },
                {
                    onSuccess: () => { toast({ title: "Item added" }); onOpenChange(false); reset(); },
                    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
                }
            );
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit Custom Item" : "Add Custom Item"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 max-h-[70vh] overflow-y-auto px-1 py-1">
                    <div className="flex flex-col items-center gap-3">
                        <div
                            className="w-24 h-24 rounded-2xl border-2 border-dashed flex items-center justify-center overflow-hidden cursor-pointer relative bg-slate-50 hover:bg-slate-100 transition-colors"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            {photoPreview ? (
                                <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-center"><ImageIcon className="w-8 h-8 mx-auto text-slate-300" /></div>
                            )}
                        </div>
                        <input type="file" accept="image/*" ref={fileInputRef} className="hidden"
                            onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) { setPhotoFile(file); setPhotoPreview(URL.createObjectURL(file)); }
                            }}
                        />
                        <p className="text-xs text-muted-foreground">Tap to upload photo</p>
                    </div>

                    <div>
                        <Label>Name *</Label>
                        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Item name" className="min-h-[48px] mt-1" />
                    </div>
                    <div>
                        <Label>Category</Label>
                        <Select value={category} onValueChange={v => setCategory(v as Product["category"])}>
                            <SelectTrigger className="min-h-[48px] mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{CAT_LABELS[c]}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label>Price (₹) *</Label>
                        <Input type="number" min={0} step={0.01} value={price} onChange={e => setPrice(e.target.value)} placeholder="0" className="min-h-[48px] mt-1" />
                    </div>
                    <div>
                        <Label>Description</Label>
                        <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" className="min-h-[48px] mt-1" />
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch checked={available} onCheckedChange={setAvailable} />
                        <Label>Available Today</Label>
                    </div>
                    <Button className="w-full min-h-[48px]" style={{ backgroundColor: "#2d9653" }} onClick={handleSubmit} disabled={addItem.isPending || updateItem.isPending}>
                        {isEdit ? "Update" : "Add"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
