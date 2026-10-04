import { AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Product } from "@/types/firestore";

interface Props {
    product: Product;
    onRestock?: () => void;
    onDiscard?: () => void;
    isExpired?: boolean;
}

export default function ExpiryAlertCard({ product, onRestock, onDiscard, isExpired }: Props) {
    const date = product.expiryDate?.toDate?.() || new Date();

    return (
        <div className={`p-4 rounded-xl border flex flex-col justify-between ${isExpired ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-200"
            }`}>
            <div className="flex items-start gap-3 mb-4">
                <div className={`p-2 rounded-lg ${isExpired ? "bg-red-100 text-red-600" : "bg-orange-100 text-orange-600"}`}>
                    {isExpired ? <AlertTriangle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                </div>
                <div>
                    <h4 className="font-bold text-sm truncate max-w-[150px]">{product.name}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">Stock: {product.stock}</p>
                    <p className={`text-xs font-medium mt-1 ${isExpired ? "text-red-700" : "text-orange-700"}`}>
                        {isExpired ? "Expired " : "Expires "}
                        {date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                </div>
            </div>

            <div className="flex gap-2">
                {isExpired ? (
                    <Button size="sm" variant="destructive" className="w-full text-xs" onClick={onDiscard}>
                        Mark Discarded
                    </Button>
                ) : (
                    <Button size="sm" variant="outline" className="w-full text-xs border-orange-300 text-orange-700 hover:bg-orange-100" onClick={onRestock}>
                        Restock
                    </Button>
                )}
            </div>
        </div>
    );
}
