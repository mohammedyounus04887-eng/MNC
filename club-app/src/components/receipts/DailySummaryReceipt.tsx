import ReceiptBase, { LINE, formatDate } from "./ReceiptBase";

export interface TopItem {
    name: string;
    count: number;
}

export interface DailySummaryReceiptProps {
    date: Date;
    totalAttendance: number;
    totalOrders: number;
    totalRevenue: number;
    totalTopUps: number;
    topItems: TopItem[];
    clubName: string;
    clubPhone: string;
    receiptNumber: string;
}

export default function DailySummaryReceipt(props: DailySummaryReceiptProps) {
    const {
        date, totalAttendance, totalOrders, totalRevenue, totalTopUps,
        topItems, clubName, clubPhone, receiptNumber,
    } = props;

    const grandTotal = totalRevenue + totalTopUps;

    return (
        <ReceiptBase clubName={clubName} clubPhone={clubPhone} receiptNumber={receiptNumber} date={new Date()}>
            <div style={{ textAlign: "center", fontWeight: "bold" }}>DAILY SUMMARY</div>
            <div style={{ textAlign: "center" }}>{formatDate(date)}</div>
            <div>{LINE}</div>
            <div>Attendance: {String(totalAttendance)}</div>
            <div>Total Orders: {String(totalOrders)}</div>
            <div>{LINE}</div>
            <div style={{ fontWeight: "bold" }}>REVENUE</div>
            <div>Top-ups: Rs.{totalTopUps.toLocaleString()}</div>
            <div>Orders: Rs.{totalRevenue.toLocaleString()}</div>
            <div style={{ fontWeight: "bold" }}>Total: Rs.{grandTotal.toLocaleString()}</div>
            {topItems.length > 0 && (
                <>
                    <div>{LINE}</div>
                    <div style={{ fontWeight: "bold" }}>TOP ITEMS TODAY</div>
                    {topItems.slice(0, 5).map((item, i) => (
                        <div key={i}>{`${i + 1}. ${item.name.slice(0, 18).padEnd(18)} x${item.count}`}</div>
                    ))}
                </>
            )}
        </ReceiptBase>
    );
}
