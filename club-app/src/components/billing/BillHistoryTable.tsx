import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BillingPrint } from "@/types/firestore";

interface Props {
    bills: BillingPrint[];
    onReprint: (bill: BillingPrint) => void;
}

export default function BillHistoryTable({ bills, onReprint }: Props) {
    if (bills.length === 0) {
        return (
            <p className="text-sm text-muted-foreground text-center py-8">
                No bills found.
            </p>
        );
    }

    return (
        <div className="space-y-2">
            {bills.map((bill) => {
                const date = bill.printedAt?.toDate?.();
                return (
                    <div key={bill.id} className="flex items-center justify-between p-3 rounded-xl border bg-white">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold truncate">{bill.memberName}</p>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                    #{bill.id.slice(-6).toUpperCase()}
                                </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                <span>{date?.toLocaleDateString("en-IN")}</span>
                                <span>{date?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                <span>{bill.items.length} items</span>
                                <span className="font-medium text-foreground">₹{bill.total}</span>
                                <span className="capitalize">{bill.paidFrom}</span>
                            </div>
                        </div>
                        <Button size="sm" variant="outline" className="gap-1 flex-shrink-0" onClick={() => onReprint(bill)}>
                            <Printer className="w-3 h-3" /> Reprint
                        </Button>
                    </div>
                );
            })}
        </div>
    );
}
