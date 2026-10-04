import { useState, useRef, useEffect } from "react";
import {
    UtensilsCrossed, Plus, Pencil, Trash2, ImageIcon,
    Globe, Eye, EyeOff, Leaf, Coffee, Droplets, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
    useGlobalMenuItems,
    useAddGlobalMenuItem,
    useUpdateGlobalMenuItem,
    useDeleteGlobalMenuItem,
    type GlobalMenuItem,
} from "@/hooks/useGlobalMenu";
import { addDoc, collection, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { GlobalMenuDialog } from "@/components/shared/GlobalMenuDialog";

const CATEGORIES = ["shake", "tea", "drink", "other"] as const;
const CAT_LABELS: Record<string, string> = { shake: "Shake", tea: "Tea", drink: "Drink", other: "Other" };
const CAT_COLORS: Record<string, string> = {
    shake: "bg-emerald-100 text-emerald-700",
    tea: "bg-amber-100 text-amber-700",
    drink: "bg-blue-100 text-blue-700",
    other: "bg-slate-100 text-slate-600",
};

function getCategoryIcon(cat: string) {
    if (cat === "shake") return "🥤";
    if (cat === "tea") return "🍵";
    if (cat === "drink") return "🥤";
    return "🍽️";
}

const HERBALIFE_ITEMS = [
    { name: "Formula 1 Shake — Chocolate", category: "shake", description: "Herbalife's most popular shake. Rich chocolate flavour, high protein, 21 essential vitamins and minerals. Low calorie meal replacement.", nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals", ingredients: "Soy protein, cocoa powder, vitamins, minerals", isVeg: true, isActive: true, imageUrl: null, sortOrder: 1 },
    { name: "Formula 1 Shake — Vanilla", category: "shake", description: "Smooth and creamy vanilla shake. Classic flavour loved by all members. Perfect meal replacement for weight loss.", nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals", isVeg: true, isActive: true, imageUrl: null, sortOrder: 2 },
    { name: "Formula 1 Shake — Strawberry", category: "shake", description: "Fresh and fruity strawberry shake. Light, refreshing and delicious. Great for members who prefer fruity flavours.", nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals", isVeg: true, isActive: true, imageUrl: null, sortOrder: 3 },
    { name: "Formula 1 Shake — Mango", category: "shake", description: "Tropical mango flavour shake. A favourite among Indian members. Naturally sweet and filling.", nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals", isVeg: true, isActive: true, imageUrl: null, sortOrder: 4 },
    { name: "Formula 1 Shake — Coffee", category: "shake", description: "Rich coffee flavour with a caffeine boost. Perfect for morning energy and weight management.", nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals", isVeg: true, isActive: true, imageUrl: null, sortOrder: 5 },
    { name: "Formula 1 Shake — Banana", category: "shake", description: "Creamy banana shake — naturally sweet, potassium-rich, and very filling. A great post-workout option.", nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals", isVeg: true, isActive: true, imageUrl: null, sortOrder: 6 },
    { name: "Formula 1 Shake — Mixed Berry", category: "shake", description: "Blend of strawberry, blueberry and raspberry. Antioxidant-rich and refreshing. Members love the colour!", nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals", isVeg: true, isActive: true, imageUrl: null, sortOrder: 7 },
    { name: "Herbalife Tea — Lemon", category: "tea", description: "Instant Herbal Beverage. Lemon flavoured energising tea. Boosts metabolism and energy levels. Only 6 calories per serving.", nutritionInfo: "6 cal | 85mg caffeine | green tea extract", isVeg: true, isActive: true, imageUrl: null, sortOrder: 8 },
    { name: "Herbalife Tea — Peach", category: "tea", description: "Instant Herbal Beverage. Sweet peach flavour energising tea. Thermogenic — helps burn calories. A club favourite add-on.", nutritionInfo: "6 cal | 85mg caffeine | green tea extract", isVeg: true, isActive: true, imageUrl: null, sortOrder: 9 },
    { name: "Herbalife Tea — Raspberry", category: "tea", description: "Instant Herbal Beverage. Tangy raspberry flavour. Perfect hot or cold. Great metabolism booster.", nutritionInfo: "6 cal | 85mg caffeine | green tea extract", isVeg: true, isActive: true, imageUrl: null, sortOrder: 10 },
    { name: "Protein Shake — Extra Protein", category: "shake", description: "High protein shake for members with muscle building goals. Made with Formula 1 + Protein Powder. Extra filling and nutritious.", nutritionInfo: "280 cal | 40g protein | 21 vitamins & minerals", isVeg: true, isActive: true, imageUrl: null, sortOrder: 11 },
    { name: "Aloe Vera Drink — Original", category: "drink", description: "Herbalife Aloe concentrate drink. Supports digestion and gut health. Refreshing, light and calming. Often served alongside the shake.", nutritionInfo: "15 cal | aloe vera extract", isVeg: true, isActive: true, imageUrl: null, sortOrder: 12 },
];

export default function GlobalMenu() {
    const { data: items = [], isLoading } = useGlobalMenuItems();
    const addItem = useAddGlobalMenuItem();
    const updateItem = useUpdateGlobalMenuItem();
    const deleteItem = useDeleteGlobalMenuItem();
    const { toast } = useToast();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<GlobalMenuItem | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [catFilter, setCatFilter] = useState("all");
    const [seeding, setSeeding] = useState(false);

    const filteredItems = items.filter(item => {
        const matchesCat = catFilter === "all" || item.category === catFilter;
        const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCat && matchesSearch;
    });

    const handleSeed = async () => {
        if (!confirm(`This will add ${HERBALIFE_ITEMS.length} standard Herbalife items. Continue?`)) return;
        setSeeding(true);
        const now = Timestamp.now();
        let count = 0;
        for (const item of HERBALIFE_ITEMS) {
            await addDoc(collection(db, "globalMenu"), { ...item, source: "global", createdAt: now, updatedAt: now });
            count++;
        }
        setSeeding(false);
        toast({ title: `✅ Seeded ${count} items successfully!` });
    };

    const handleDelete = (item: GlobalMenuItem) => {
        if (!confirm(`Delete "${item.name}"? This will hide it from all clubs.`)) return;
        deleteItem.mutate(item.id, {
            onSuccess: () => toast({ title: "Item deleted" }),
            onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
        });
    };

    const handleToggleActive = (item: GlobalMenuItem) => {
        updateItem.mutate(
            { itemId: item.id, data: { isActive: !item.isActive } },
            { onSuccess: () => toast({ title: item.isActive ? "Item deactivated" : "Item activated" }) }
        );
    };

    return (
        <div className="space-y-6" style={{ fontFamily: "'Nunito', sans-serif" }}>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Globe className="w-5 h-5 text-violet-600" />
                        <h1 className="text-2xl font-bold text-gray-900">Global Menu</h1>
                    </div>
                    <p className="text-sm text-gray-500">
                        Standard Herbalife products visible to all clubs. {items.length} items total.
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {items.length === 0 && (
                        <Button
                            variant="outline"
                            disabled={seeding}
                            onClick={handleSeed}
                            className="text-violet-700 border-violet-200 hover:bg-violet-50"
                        >
                            {seeding ? "Seeding..." : "🌱 Seed 12 Herbalife Items"}
                        </Button>
                    )}
                    <Button
                        onClick={() => { setEditingItem(null); setDialogOpen(true); }}
                        style={{ backgroundColor: "#2d9653" }}
                        className="gap-2"
                    >
                        <Plus className="w-4 h-4" /> Add Item
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                        placeholder="Search items..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <Select value={catFilter} onValueChange={setCatFilter}>
                    <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {CATEGORIES.map(c => (
                            <SelectItem key={c} value={c}>{CAT_LABELS[c]}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <span className="text-sm text-gray-500 font-medium">{filteredItems.length} items</span>
            </div>

            {/* Grid */}
            {isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
                </div>
            ) : filteredItems.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-16 text-center">
                    <UtensilsCrossed className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                    <h3 className="font-bold text-gray-700 mb-1">No items found</h3>
                    <p className="text-sm text-gray-400 mb-4">
                        {items.length === 0
                            ? "Click 'Seed 12 Herbalife Items' to get started, or add items manually."
                            : "Try adjusting your search or filter."}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredItems.map(item => (
                        <GlobalMenuCard
                            key={item.id}
                            item={item}
                            onEdit={() => { setEditingItem(item); setDialogOpen(true); }}
                            onDelete={() => handleDelete(item)}
                            onToggleActive={() => handleToggleActive(item)}
                        />
                    ))}
                </div>
            )}

            <GlobalMenuDialog
                open={dialogOpen}
                onOpenChange={v => { setDialogOpen(v); if (!v) setEditingItem(null); }}
                item={editingItem}
                addItem={addItem}
                updateItem={updateItem}
                toast={toast}
            />
        </div>
    );
}

// ─── Card ─────────────────────────────────────────────────────────────────

function GlobalMenuCard({
    item,
    onEdit,
    onDelete,
    onToggleActive,
}: {
    item: GlobalMenuItem;
    onEdit: () => void;
    onDelete: () => void;
    onToggleActive: () => void;
}) {
    const initials = item.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
    const catColor = CAT_COLORS[item.category] || CAT_COLORS.other;

    return (
        <div className={`bg-white rounded-2xl border shadow-sm flex flex-col overflow-hidden transition-all hover:shadow-md ${!item.isActive ? "opacity-60" : ""}`}>
            {/* Image / Placeholder */}
            <div className="relative">
                {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-full h-36 object-cover" />
                ) : (
                    <div
                        className="w-full h-36 flex flex-col items-center justify-center gap-2"
                        style={{ background: "linear-gradient(135deg, #d8f3dc, #b7e4c7)" }}
                    >
                        <span style={{ fontSize: 32 }}>{getCategoryIcon(item.category)}</span>
                        <span className="text-xs font-bold text-emerald-700">{initials}</span>
                    </div>
                )}
                {/* Global badge */}
                <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/90 text-violet-700 border border-violet-200 backdrop-blur-sm">
                    🌐 Standard
                </span>
                {!item.isActive && (
                    <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-900/80 text-white">
                        Inactive
                    </span>
                )}
            </div>

            {/* Content */}
            <div className="p-4 flex flex-col flex-1 gap-3">
                <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="font-bold text-gray-900 text-sm leading-tight">{item.name}</p>
                        {item.isVeg && <Leaf className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />}
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge className={`text-[10px] font-bold ${catColor} border-0`}>
                            {getCategoryIcon(item.category)} {CAT_LABELS[item.category] || item.category}
                        </Badge>
                        {item.price != null && (
                            <span className="text-sm font-extrabold text-emerald-600">₹{item.price}</span>
                        )}
                    </div>
                </div>

                {item.description && (
                    <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{item.description}</p>
                )}

                {item.nutritionInfo && (
                    <p className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-1 rounded-lg">
                        {item.nutritionInfo}
                    </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 mt-auto pt-1">
                    <Switch
                        checked={item.isActive}
                        onCheckedChange={onToggleActive}
                        className="scale-90"
                    />
                    <span className="text-[11px] text-gray-500 flex-1">{item.isActive ? "Active" : "Inactive"}</span>
                    <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={onEdit}>
                        <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:border-red-200" onClick={onDelete}>
                        <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

// Removed inline GlobalMenuDialog in favor of shared component
