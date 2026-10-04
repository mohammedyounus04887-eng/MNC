import { useState } from "react";
import { X, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
    productName: string;
    currentStock: number;
    isLoading?: boolean;
    onSubmit: (quantity: number, note: string) => Promise<void>;
    onClose: () => void;
}

export default function StockAdjustmentForm({ productName, currentStock, isLoading, onSubmit, onClose }: Props) {
    const [addQty, setAddQty] = useState(0);
    const [note, setNote] = useState("");

    const newStock = currentStock + (addQty || 0);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (addQty <= 0) return;
        await onSubmit(addQty, note);
    };

    return (
        <div className="bg-white rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <PackagePlus className="w-5 h-5 text-violet-600" /> Restock
                </h2>
                <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
            </div>

            <p className="text-sm font-medium mb-1">Product: <span className="font-bold">{productName}</span></p>
            <p className="text-sm text-muted-foreground mb-6">Current Stock: {currentStock} units</p>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                    <Label>Quantity to Add</Label>
                    <Input type="number" min={1} value={addQty === 0 ? "" : addQty} onChange={(e) => setAddQty(parseInt(e.target.value) || 0)} required autoFocus />
                </div>

                <div className="space-y-2">
                    <Label>Note (Optional)</Label>
                    <Textarea placeholder="E.g. New shipment arrived" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                </div>

                <div className="bg-violet-50 p-3 rounded-lg border border-violet-100 flex justify-between text-sm font-bold text-violet-900">
                    <span>Final Stock:</span>
                    <span>{newStock} units</span>
                </div>

                <div className="pt-2 flex justify-end gap-3">
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="submit" disabled={isLoading || addQty <= 0}>
                        {isLoading ? "Restocking…" : "Confirm Restock"}
                    </Button>
                </div>
            </form>
        </div>
    );
}
