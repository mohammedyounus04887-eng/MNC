import { useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useExpiredProducts, useExpiringProducts, useRestockProduct, useUpdateProduct } from "@/hooks/useInventory";
import ExpiryAlertCard from "@/components/inventory/ExpiryAlertCard";
import StockAdjustmentForm from "@/components/inventory/StockAdjustmentForm";
import type { Product } from "@/types/firestore";

export default function ExpiryManagementPage() {
    const { toast } = useToast();
    const { data: expired = [], isLoading: expiredLoading } = useExpiredProducts();
    const { data: expiring = [], isLoading: expiringLoading } = useExpiringProducts(7); // Next 7 days
    const { data: returning = [] } = useExpiringProducts(30); // Use 30 days as 'All products with expiry' substitute for view

    const restockProduct = useRestockProduct();
    const updateProduct = useUpdateProduct();

    const [restockObj, setRestockObj] = useState<Product | null>(null);

    const handleDiscard = async (p: Product) => {
        try {
            await updateProduct.mutateAsync({
                productId: p.id,
                data: { stock: 0 },
            });
            toast({ title: "Product discarded (stock set to 0)" });
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

    const handleRestock = async (qty: number, note: string) => {
        if (!restockObj) return;
        try {
            await restockProduct.mutateAsync({
                productId: restockObj.id,
                currentStock: restockObj.stock,
                addedQty: qty,
                note,
            });
            setRestockObj(null);
            toast({ title: "Stock updated" });
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

    const loading = expiredLoading || expiringLoading;

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <div>
                <h1 className="text-2xl font-black text-wellness-forest flex items-center gap-2">
                    <Clock className="w-6 h-6" /> Expiry Management
                </h1>
                <p className="text-sm text-muted-foreground mt-1">Track and manage products nearing expiration.</p>
            </div>

            {loading ? (
                <div className="flex justify-center py-20"><div className="w-8 h-8 rounded-full border-4 border-violet-600 border-t-transparent animate-spin" /></div>
            ) : (
                <div className="space-y-8">
                    {/* Section 1: Expired */}
                    {expired.length > 0 && (
                        <section className="space-y-4">
                            <h2 className="text-lg font-bold text-red-600 flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5" /> Expired — Action Required
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {expired.map((p) => (
                                    <ExpiryAlertCard key={p.id} product={p} isExpired onDiscard={() => handleDiscard(p)} />
                                ))}
                            </div>
                        </section>
                    )}

                    {expired.length > 0 && expiring.length > 0 && <Separator />}

                    {/* Section 2: Expiring Soon */}
                    {expiring.length > 0 && (
                        <section className="space-y-4">
                            <h2 className="text-lg font-bold text-orange-600 flex items-center gap-2">
                                <Clock className="w-5 h-5" /> Expiring Soon (Next 7 Days)
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {expiring.map((p) => (
                                    <ExpiryAlertCard key={p.id} product={p} onRestock={() => setRestockObj(p)} />
                                ))}
                            </div>
                        </section>
                    )}

                    {expired.length === 0 && expiring.length === 0 && (
                        <div className="text-center py-16 bg-gray-50 rounded-2xl border border-dashed">
                            <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                            <p className="font-medium text-gray-900">All Good!</p>
                            <p className="text-sm text-muted-foreground">No products are expired or expiring within 7 days.</p>
                        </div>
                    )}

                    <Separator />

                    {/* Section 3: Upcoming (Next 30 days) */}
                    <section className="space-y-4">
                        <h2 className="text-lg font-bold">Upcoming Expirations (Next 30 Days)</h2>
                        <div className="bg-white rounded-xl border overflow-hidden">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-50 text-xs text-gray-500 uppercase border-b">
                                    <tr>
                                        <th className="px-4 py-3">Product</th>
                                        <th className="px-4 py-3">Category</th>
                                        <th className="px-4 py-3 text-center">Stock</th>
                                        <th className="px-4 py-3">Expiry Date</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {returning.map((p) => (
                                        <tr key={p.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-3 font-medium">{p.name}</td>
                                            <td className="px-4 py-3 capitalize">{p.category}</td>
                                            <td className="px-4 py-3 text-center">{p.stock}</td>
                                            <td className="px-4 py-3">{p.expiryDate?.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                                        </tr>
                                    ))}
                                    {returning.length === 0 && (
                                        <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No products tracking expiry soon.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
            )}

            {/* Restock Modal */}
            <Dialog open={!!restockObj} onOpenChange={(o) => { if (!o) setRestockObj(null); }}>
                <DialogContent className="max-w-md p-0 border-none bg-transparent shadow-none"><StockAdjustmentForm productName={restockObj?.name || ""} currentStock={restockObj?.stock || 0} onSubmit={handleRestock} onClose={() => setRestockObj(null)} isLoading={restockProduct.isPending} /></DialogContent>
            </Dialog>
        </div>
    );
}
