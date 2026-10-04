import { useState } from "react";
import { Minus, Plus, Coffee, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Product } from "@/types/firestore";

interface Props {
    product: Product;
    currencyName: string;
    onSelect?: (product: Product, quantity: number) => void;
    isSelected: boolean;
    currentQty?: number;
}

export default function ProductCard({ product, currencyName, onSelect, isSelected, currentQty = 0 }: Props) {
    const [qty, setQty] = useState(currentQty || 1);
    const lowStock = product.stock <= product.lowStockThreshold;

    const handleQtyChange = (delta: number) => {
        const newQty = Math.max(1, Math.min(10, qty + delta));
        setQty(newQty);
        if (isSelected) onSelect?.(product, newQty);
    };

    return (
        <div
            className={`rounded-2xl border-2 overflow-hidden transition-all hover:shadow-md ${isSelected ? "border-violet-400 bg-violet-50 shadow-md" : "border-gray-200 bg-white"
                }`}
        >
            {/* Image */}
            <div className="h-32 bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center relative">
                {product.photo ? (
                    <img src={product.photo} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                    <Coffee className="w-12 h-12 text-amber-300" />
                )}
                {lowStock && (
                    <div className="absolute top-2 right-2">
                        <Badge variant="destructive" className="text-[10px] gap-1">
                            <AlertTriangle className="w-3 h-3" /> Low Stock
                        </Badge>
                    </div>
                )}
                <Badge variant="outline" className="absolute bottom-2 left-2 text-[10px] bg-white/80 backdrop-blur">
                    {product.category}
                </Badge>
            </div>

            {/* Details */}
            <div className="p-3 space-y-2">
                <p className="text-sm font-bold truncate">{product.name}</p>
                <p className="text-lg font-black text-violet-600">
                    {product.price} <span className="text-xs font-medium text-muted-foreground">{currencyName}</span>
                </p>

                {/* Quantity + Select */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center border rounded-lg">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleQtyChange(-1)}>
                            <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-6 text-center text-sm font-bold">{qty}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleQtyChange(1)}>
                            <Plus className="w-3 h-3" />
                        </Button>
                    </div>
                    <Button
                        size="sm"
                        className="flex-1 text-xs"
                        variant={isSelected ? "outline" : "default"}
                        onClick={() => onSelect?.(product, isSelected ? 0 : qty)}
                    >
                        {isSelected ? "Remove" : "Add"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
