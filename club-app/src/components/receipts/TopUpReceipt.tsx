import ReceiptBase, { LINE } from "./ReceiptBase";

export interface TopUpReceiptProps {
    memberName: string;
    memberId: string;
    amount: number;
    paymentMethod: string;
    reference?: string;
    balanceBefore: number;
    balanceAfter: number;
    clubName: string;
    clubPhone: string;
    date: Date;
    receiptNumber: string;
}

export default function TopUpReceipt(props: TopUpReceiptProps) {
    const {
        memberName, memberId, amount, paymentMethod,
        reference, balanceBefore, balanceAfter,
        clubName, clubPhone, date, receiptNumber,
    } = props;

    return (
        <ReceiptBase clubName={clubName} clubPhone={clubPhone} receiptNumber={receiptNumber} date={date}>
            <div style={{ textAlign: "center", fontWeight: "bold" }}>WALLET TOP-UP</div>
            <div>{LINE}</div>
            <div>Member: {memberName.slice(0, 20)}</div>
            {memberId && <div>ID: {memberId}</div>}
            <div>{LINE}</div>
            <div style={{ fontWeight: "bold" }}>Amount Added: + Rs.{amount.toFixed(2)}</div>
            <div>Payment: {paymentMethod}</div>
            {reference && <div>Ref: {reference.slice(0, 18)}</div>}
            <div>{LINE}</div>
            <div>Prev Balance: Rs.{balanceBefore.toFixed(2)}</div>
            <div style={{ fontWeight: "bold" }}>New Balance: Rs.{balanceAfter.toFixed(2)}</div>
        </ReceiptBase>
    );
}
