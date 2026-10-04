import { useState } from "react";
import {
    Receipt, Plus, Trash2, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useClubContext } from "@/lib/clubDetection";
import { useClubMembers } from "@/hooks/useOwner";
import { useGenerateBill, useClubBills } from "@/hooks/useBilling";
import BillPreviewModal from "@/components/billing/BillPreviewModal";
import BillHistoryTable from "@/components/billing/BillHistoryTable";
import type { BillingPrint, BillItem, Club } from "@/types/firestore";

export default function BillingPage() {
    const { toast } = useToast();
    const { club } = useClubContext();
    const { data: members } = useClubMembers();
    const generateBill = useGenerateBill();
    const { bills, loadMore, hasMore, loading: billsLoading, refetch } = useClubBills();

    // Form state
    const [memberSearch, setMemberSearch] = useState("");
    const [selectedMember, setSelectedMember] = useState<{ id: string; name: string; photo?: string } | null>(null);
    const [billItems, setBillItems] = useState<{ name: string; quantity: number; price: number }[]>(
        [{ name: "", quantity: 1, price: 0 }]
    );
    const [paidFrom, setPaidFrom] = useState<"wallet" | "cash">("wallet");

    // Preview state
    const [previewBill, setPreviewBill] = useState<BillingPrint | null>(null);

    // Bill filter
    const [filterSearch, setFilterSearch] = useState("");

    const total = billItems.reduce((s, i) => s + i.quantity * i.price, 0);

    const addRow = () => setBillItems([...billItems, { name: "", quantity: 1, price: 0 }]);
    const removeRow = (idx: number) => setBillItems(billItems.filter((_, i) => i !== idx));
    const updateRow = (idx: number, field: string, value: string | number) => {
        setBillItems(billItems.map((item, i) => i === idx ? { ...item, [field]: value } : item));
    };

    const handleGenerate = async () => {
        if (!selectedMember) { toast({ title: "Select a member", variant: "destructive" }); return; }
        const validItems = billItems.filter((i) => i.name.trim() && i.price > 0);
        if (validItems.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return; }

        const items: BillItem[] = validItems.map((i) => ({
            name: i.name, quantity: i.quantity, pricePerUnit: i.price, total: i.quantity * i.price,
        }));

        try {
            const bill = await generateBill.mutateAsync({
                memberId: selectedMember.id,
                memberName: selectedMember.name,
                items,
                paidFrom,
            });
            setPreviewBill(bill);
            refetch();
            // Reset form
            setBillItems([{ name: "", quantity: 1, price: 0 }]);
            setSelectedMember(null);
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

    const filteredBills = filterSearch.trim()
        ? bills.filter((b) => b.memberName.toLowerCase().includes(filterSearch.toLowerCase()))
        : bills;

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <h1 className="text-2xl font-black text-wellness-forest flex items-center gap-2">
                <Receipt className="w-6 h-6" /> Billing
            </h1>

            {/* Quick Bill Form */}
            <div className="bg-white rounded-2xl border p-6 space-y-5">
                <h2 className="text-sm font-bold">Quick Bill</h2>

                {/* Member select */}
                {selectedMember ? (
                    <div className="flex items-center gap-3 p-3 bg-violet-50 rounded-xl">
                        <Avatar className="h-8 w-8">
                            {selectedMember.photo ? <AvatarImage src={selectedMember.photo} /> : null}
                            <AvatarFallback className="bg-violet-100 text-violet-700 text-xs font-bold">{selectedMember.name[0]}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-bold flex-1">{selectedMember.name}</span>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedMember(null)}>Change</Button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input placeholder="Search member…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} className="pl-9" />
                        </div>
                        {memberSearch.trim() && (
                            <div className="max-h-40 overflow-y-auto space-y-1 border rounded-lg p-1">
                                {members?.filter((m) => m.name.toLowerCase().includes(memberSearch.toLowerCase())).slice(0, 10).map((m) => (
                                    <button key={m.id} onClick={() => { setSelectedMember({ id: m.id, name: m.name, photo: m.photo }); setMemberSearch(""); }}
                                        className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-gray-50 text-left text-sm"
                                    >
                                        <Avatar className="h-6 w-6"><AvatarFallback className="text-[10px] bg-violet-100 text-violet-700">{m.name[0]}</AvatarFallback></Avatar>
                                        {m.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Items */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-muted-foreground">Items</label>
                        <Button size="sm" variant="ghost" onClick={addRow} className="gap-1 text-xs"><Plus className="w-3 h-3" /> Add Item</Button>
                    </div>
                    {billItems.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                            <Input placeholder="Item name" value={item.name} onChange={(e) => updateRow(idx, "name", e.target.value)} className="flex-1" />
                            <Input type="number" min={1} value={item.quantity} onChange={(e) => updateRow(idx, "quantity", parseInt(e.target.value) || 1)} className="w-16 text-center" />
                            <Input type="number" min={0} value={item.price} onChange={(e) => updateRow(idx, "price", parseFloat(e.target.value) || 0)} className="w-20" placeholder="₹" />
                            <span className="text-sm font-bold w-16 text-right">₹{item.quantity * item.price}</span>
                            {billItems.length > 1 && (
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400" onClick={() => removeRow(idx)}>
                                    <Trash2 className="w-3 h-3" />
                                </Button>
                            )}
                        </div>
                    ))}
                </div>

                {/* Payment & Total */}
                <div className="flex items-center justify-between border-t pt-4">
                    <div className="flex items-center gap-3">
                        <label className="text-xs font-bold text-muted-foreground">Paid via:</label>
                        <Select value={paidFrom} onValueChange={(v) => setPaidFrom(v as "wallet" | "cash")}>
                            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="wallet">Wallet</SelectItem>
                                <SelectItem value="cash">Cash</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="text-right">
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="text-2xl font-black">₹{total}</p>
                    </div>
                </div>

                <Button className="w-full gap-2" disabled={generateBill.isPending} onClick={handleGenerate}>
                    <Receipt className="w-4 h-4" /> {generateBill.isPending ? "Generating…" : "Generate & Print Bill"}
                </Button>
            </div>

            {/* Recent Bills */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold">Recent Bills</h2>
                    <div className="relative w-48">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input placeholder="Filter…" value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} className="pl-9 h-8 text-xs" />
                    </div>
                </div>

                {billsLoading ? (
                    <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
                ) : (
                    <>
                        <BillHistoryTable bills={filteredBills} onReprint={(bill) => setPreviewBill(bill)} />
                        {hasMore && (
                            <div className="text-center"><Button variant="outline" size="sm" onClick={loadMore}>Load More</Button></div>
                        )}
                    </>
                )}
            </div>

            {/* Preview Modal */}
            {previewBill && club && (
                <BillPreviewModal bill={previewBill} club={club} open onClose={() => setPreviewBill(null)} />
            )}
        </div>
    );
}
