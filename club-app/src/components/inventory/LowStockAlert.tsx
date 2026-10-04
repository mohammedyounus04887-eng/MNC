import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, X } from "lucide-react";
import type { Product } from "@/types/firestore";
import { getAdminBase } from "@/lib/adminBase";

interface Props {
    products: Product[];
}

export default function LowStockAlert({ products }: Props) {
    const [dismissed, setDismissed] = useState(false);

    if (dismissed || products.length === 0) return null;

    return (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-4">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
                <h3 className="text-sm font-bold text-amber-900">
                    {products.length} product{products.length > 1 ? "s are" : " is"} running low on stock
                </h3>
                <p className="text-xs text-amber-700 mt-1">
                    Make sure to restock soon to avoid running out.
                </p>
                <Link to={`${getAdminBase()}/inventory?filter=low`} className="text-xs font-bold text-amber-800 underline mt-2 inline-block">
                    View Inventory
                </Link>
            </div>
            <button onClick={() => setDismissed(true)} className="text-amber-500 hover:text-amber-700 p-1">
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
