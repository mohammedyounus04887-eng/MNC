import type { BillingPrint, Club } from "@/types/firestore";

interface Props {
    bill: BillingPrint;
    club: Club;
}

export default function BillTemplate({ bill, club }: Props) {
    const date = bill.printedAt?.toDate?.() || new Date();

    return (
        <>
            <div className="bill-print-root" style={{
                width: "80mm",
                fontFamily: "'Courier New', monospace",
                fontSize: "12px",
                color: "#000",
                background: "#fff",
                padding: "2mm",
                lineHeight: 1.5,
            }}>
                {/* Header */}
                <div style={{ textAlign: "center", marginBottom: "8px" }}>
                    {club.logo && (
                        <img src={club.logo} alt="" style={{ width: "40px", height: "40px", margin: "0 auto 4px", display: "block" }} />
                    )}
                    <div style={{ fontSize: "13px", fontWeight: "bold", whiteSpace: "nowrap" }}>Usha Prasad Enterprises</div>
                    {club.tagline && <div style={{ fontSize: "10px" }}>{club.tagline}</div>}
                    {club.ownerPhone && <div style={{ fontSize: "10px" }}>Tel: {club.ownerPhone}</div>}
                </div>

                <Divider />

                {/* Bill info */}
                <div>
                    <InlineRow label="Bill #:" value={bill.id.slice(-6).toUpperCase()} />
                    <InlineRow label="Date:" value={`${date.toLocaleDateString("en-IN")} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`} />
                    <InlineRow label="Member:" value={bill.memberName} />
                </div>

                <Divider />

                {/* Column header */}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "11px" }}>
                    <span style={{ flex: 1 }}>Item</span>
                    <span style={{ width: "30px", textAlign: "center" }}>Qty</span>
                    <span style={{ width: "60px", textAlign: "right" }}>Amt</span>
                </div>

                <Divider />

                {/* Items */}
                {bill.items.map((item, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                        <span style={{ width: "30px", textAlign: "center" }}>x{item.quantity}</span>
                        <span style={{ width: "60px", textAlign: "right" }}>₹{item.total}</span>
                    </div>
                ))}

                <Divider />

                {/* Totals */}
                <InlineRow label="Subtotal:" value={`₹${bill.subtotal}`} />
                <Divider />
                <div style={{ fontWeight: "bold", fontSize: "14px" }}>TOTAL: ₹{bill.total}</div>
                <Divider />

                {/* Payment */}
                <InlineRow label="Paid via:" value={bill.paidFrom === "wallet" ? "Wallet" : "Cash"} />
                {bill.paidFrom === "wallet" && <InlineRow label={`${club.currencyName} used:`} value={String(bill.total)} />}

                <Divider />

                {/* Footer */}
                <div style={{ textAlign: "center", fontSize: "10px", marginTop: "8px" }}>
                    <div>Thank you for visiting!</div>
                    {club.tagline && <div style={{ marginTop: "2px" }}>{club.tagline}</div>}
                </div>

                <Divider />
            </div>
        </>
    );
}

function Divider() {
    return <div style={{ borderBottom: "1px dashed #000", margin: "4px 0" }} />;
}

function InlineRow({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ fontSize: "11px" }}>
            {label} {value}
        </div>
    );
}
