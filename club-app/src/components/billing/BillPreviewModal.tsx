import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import BillTemplate from "./BillTemplate";
import type { BillingPrint, Club } from "@/types/firestore";
import { printViaRawBT } from "@/utils/printReceipt";
import { buildBillReceipt } from "@/utils/receiptBuilder";

interface Props {
    bill: BillingPrint;
    club: Club;
    open: boolean;
    onClose: () => void;
}

export default function BillPreviewModal({ bill, club, open, onClose }: Props) {
    const handlePrint = () => {
        printViaRawBT(buildBillReceipt({
            club: {
                name: club.name || '',
                address: club.address ?? '',
                phone: club.phone ?? club.ownerPhone ?? '',
                email: club.ownerEmail ?? '',
                gstNumber: club.gstNumber ?? '',
            },
            memberName: bill.memberName,
            billId: bill.id,
            items: bill.items.map(item => ({
                name: item.name,
                quantity: item.quantity,
                total: item.total,
            })),
            subtotal: bill.subtotal,
            total: bill.total,
            paidFrom: bill.paidFrom,
            currencyName: club.currencyName,
            timestamp: bill.printedAt?.toDate?.() || new Date(),
        }));
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center justify-between">
                        <span>Bill Preview</span>
                        <Button size="icon" variant="ghost" onClick={onClose} className="h-8 w-8">
                            <X className="w-4 h-4" />
                        </Button>
                    </DialogTitle>
                </DialogHeader>

                {/* Preview (scaled on screen) */}
                <div className="bg-white border rounded-lg p-2 overflow-auto" style={{ maxHeight: "60vh" }}>
                    <div style={{ transform: "scale(0.85)", transformOrigin: "top left" }}>
                        <BillTemplate bill={bill} club={club} />
                    </div>
                </div>

                {/* Actions */}
                <div className="space-y-3 mt-2">
                    <Button className="w-full gap-2" onClick={handlePrint}>
                        <Printer className="w-4 h-4" /> Print Bill
                    </Button>
                    <p className="text-[10px] text-center text-muted-foreground">
                        Prints via RawBT app to your thermal printer
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
}
