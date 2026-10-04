import { useState, useRef, useEffect } from "react";
import { ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
    useAddGlobalMenuItem,
    useUpdateGlobalMenuItem,
    type GlobalMenuItem,
} from "@/hooks/useGlobalMenu";

const CATEGORIES = ["shake", "tea", "drink", "other"] as const;
const CAT_LABELS: Record<string, string> = { shake: "Shake", tea: "Tea", drink: "Drink", other: "Other" };

// ─── Dual-mode Image Input ─────────────────────────────────────────────────

interface ImageInputProps {
    value: string;
    onChange: (url: string) => void;
    onFileChange: (file: File | null) => void;
}

function DualImageInput({ value, onChange, onFileChange }: ImageInputProps) {
    const [mode, setMode] = useState<"upload" | "url">(
        value?.startsWith("http") ? "url" : "upload"
    );
    const [urlInput, setUrlInput] = useState(value || "");
    const [preview, setPreview] = useState<string | null>(value || null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Sync preview when parent value changes (e.g. on dialog open with existing item)
    useEffect(() => {
        if (value) {
            setPreview(value);
            setUrlInput(value);
            setMode(value.startsWith("http") ? "url" : "upload");
        } else {
            setPreview(null);
            setUrlInput("");
        }
    }, [value]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const localUrl = URL.createObjectURL(file);
        setPreview(localUrl);
        onFileChange(file);
        onChange(""); // Clear any URL-based value
    };

    const handleUrlBlur = () => {
        if (urlInput.startsWith("http")) {
            setPreview(urlInput);
            onChange(urlInput);
            onFileChange(null);
        }
    };

    return (
        <div style={{ fontFamily: "'Nunito', sans-serif" }}>
            {/* Mode selector tabs */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {([
                    { key: "upload", label: "📁 Upload from device" },
                    { key: "url", label: "🔗 Paste image URL" },
                ] as const).map(({ key, label }) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setMode(key)}
                        style={{
                            flex: 1,
                            padding: "9px 10px",
                            border: `1.5px solid ${mode === key ? "#2d9653" : "#e0f0e9"}`,
                            borderRadius: 8,
                            background: mode === key ? "#f8fffe" : "white",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                            color: mode === key ? "#2d9653" : "#6b7280",
                            fontFamily: "'Nunito', sans-serif",
                            transition: "all 0.2s",
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Upload mode */}
            {mode === "upload" && (
                <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                        border: "2px dashed #d8f3dc",
                        borderRadius: 12,
                        cursor: "pointer",
                        overflow: "hidden",
                        minHeight: 120,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "border-color 0.2s",
                        background: preview ? "transparent" : "#fafafa",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#2d9653")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#d8f3dc")}
                >
                    {preview && !urlInput.startsWith("http") ? (
                        <img
                            src={preview}
                            alt="Preview"
                            style={{ width: "100%", height: 160, objectFit: "cover" }}
                        />
                    ) : (
                        <div style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 6,
                            color: "#6b7280",
                            fontSize: 13,
                            fontWeight: 600,
                            padding: 24,
                        }}>
                            <span style={{ fontSize: 32 }}>📷</span>
                            <span>Click to upload image</span>
                            <span style={{ fontSize: 11, color: "#9ca3af" }}>JPG, PNG, WEBP · Max 2MB</span>
                        </div>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={handleFileChange}
                    />
                </div>
            )}

            {/* URL mode */}
            {mode === "url" && (
                <div>
                    <input
                        type="url"
                        placeholder="https://example.com/image.jpg"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onBlur={handleUrlBlur}
                        style={{
                            width: "100%",
                            padding: "11px 14px",
                            border: "1.5px solid #e0f0e9",
                            borderRadius: 10,
                            fontSize: 13,
                            marginBottom: 10,
                            fontFamily: "'Nunito', sans-serif",
                            outline: "none",
                            boxSizing: "border-box",
                        }}
                        onFocus={(e) => (e.target.style.borderColor = "#2d9653")}
                    />
                    {preview && urlInput.startsWith("http") && (
                        <div style={{ position: "relative" }}>
                            <img
                                src={preview}
                                alt="Preview"
                                style={{
                                    width: "100%",
                                    height: 160,
                                    objectFit: "cover",
                                    borderRadius: 10,
                                    border: "2px solid #d8f3dc",
                                    display: "block",
                                }}
                                onError={() => {
                                    setPreview(null);
                                    alert("Could not load image from this URL. Please check the link.");
                                }}
                            />
                            <div style={{
                                position: "absolute",
                                top: 8,
                                right: 8,
                                background: "#2d9653",
                                color: "white",
                                padding: "3px 10px",
                                borderRadius: 100,
                                fontSize: 11,
                                fontWeight: 700,
                            }}>
                                ✓ Preview
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Main Dialog ───────────────────────────────────────────────────────────

export function GlobalMenuDialog({
    open,
    onOpenChange,
    item,
    addItem,
    updateItem,
    toast,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    item: GlobalMenuItem | null;
    addItem: ReturnType<typeof useAddGlobalMenuItem>;
    updateItem: ReturnType<typeof useUpdateGlobalMenuItem>;
    toast: ReturnType<typeof useToast>["toast"];
}) {
    const [name, setName] = useState("");
    const [category, setCategory] = useState<GlobalMenuItem["category"]>("shake");
    const [description, setDescription] = useState("");
    const [nutritionInfo, setNutritionInfo] = useState("");
    const [ingredients, setIngredients] = useState("");
    const [isVeg, setIsVeg] = useState(true);
    const [isActive, setIsActive] = useState(true);
    const [sortOrder, setSortOrder] = useState("99");
    const [price, setPrice] = useState<number | "">("");
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imageUrl, setImageUrl] = useState(""); // URL from URL-mode or after upload

    const isEdit = !!item;

    const reset = () => {
        setName(""); setCategory("shake"); setDescription(""); setNutritionInfo("");
        setIngredients(""); setIsVeg(true); setIsActive(true); setSortOrder("99");
        setPrice(""); setImageFile(null); setImageUrl("");
    };

    useEffect(() => {
        if (open) {
            if (item) {
                setName(item.name);
                setCategory(item.category);
                setDescription(item.description || "");
                setNutritionInfo(item.nutritionInfo || "");
                setIngredients(item.ingredients || "");
                setIsVeg(item.isVeg ?? true);
                setIsActive(item.isActive ?? true);
                setSortOrder(String(item.sortOrder ?? 99));
                setPrice(item.price ?? "");
                setImageFile(null);
                setImageUrl(item.imageUrl || "");
            } else reset();
        }
    }, [open, item]);

    const handleSubmit = () => {
        if (!name.trim()) {
            toast({ title: "Name required", variant: "destructive" });
            return;
        }
        const payload = {
            name: name.trim(),
            category,
            description,
            nutritionInfo,
            ingredients,
            isVeg,
            isActive,
            sortOrder: parseInt(sortOrder) || 99,
            price: price !== "" ? Number(price) : null,
            source: "global" as const,
            // If URL was pasted directly, pass it as imageUrl in payload
            ...(imageUrl && !imageFile ? { imageUrl } : {}),
        };

        if (isEdit && item) {
            updateItem.mutate({ itemId: item.id, data: payload, imageFile: imageFile ?? null }, {
                onSuccess: () => { toast({ title: "Item updated" }); onOpenChange(false); },
                onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
            });
        } else {
            addItem.mutate({ item: payload, imageFile: imageFile ?? null }, {
                onSuccess: () => { toast({ title: "Item added" }); onOpenChange(false); reset(); },
                onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit Global Item" : "Add Global Menu Item"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 max-h-[75vh] overflow-y-auto px-1 py-1">
                    {/* Dual Image Input */}
                    <div>
                        <Label className="mb-2 block">Item Image</Label>
                        <DualImageInput
                            value={imageUrl}
                            onChange={(url) => setImageUrl(url)}
                            onFileChange={(file) => { setImageFile(file); if (file) setImageUrl(""); }}
                        />
                    </div>

                    <div>
                        <Label>Item Name *</Label>
                        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Formula 1 Shake — Chocolate" className="mt-1" />
                    </div>

                    <div>
                        <Label>Category *</Label>
                        <Select value={category} onValueChange={v => setCategory(v as any)}>
                            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{CAT_LABELS[c]}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <Label>Description *</Label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Short description for this item..."
                            className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            rows={3}
                        />
                    </div>

                    <div>
                        <Label>Nutrition Info</Label>
                        <Input value={nutritionInfo} onChange={e => setNutritionInfo(e.target.value)} placeholder="220 cal | 24g protein" className="mt-1" />
                    </div>

                    <div>
                        <Label>Ingredients</Label>
                        <Input value={ingredients} onChange={e => setIngredients(e.target.value)} placeholder="Soy protein, vitamins..." className="mt-1" />
                    </div>

                    <div>
                        <Label>Price (₹) <span className="text-xs text-muted-foreground font-normal">— default for all clubs</span></Label>
                        <Input
                            type="number"
                            value={price}
                            onChange={e => setPrice(e.target.value === "" ? "" : Number(e.target.value))}
                            placeholder="e.g. 80"
                            min="0"
                            step="5"
                            className="mt-1"
                        />
                    </div>

                    <div>
                        <Label>Sort Order</Label>
                        <Input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} placeholder="1" className="mt-1" />
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <Switch checked={isVeg} onCheckedChange={setIsVeg} />
                            <Label className="cursor-pointer">Veg</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch checked={isActive} onCheckedChange={setIsActive} />
                            <Label className="cursor-pointer">Active</Label>
                        </div>
                    </div>

                    <Button
                        className="w-full"
                        style={{ backgroundColor: "#2d9653" }}
                        onClick={handleSubmit}
                        disabled={addItem.isPending || updateItem.isPending}
                    >
                        {isEdit ? "Update Item" : "Add Item"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
