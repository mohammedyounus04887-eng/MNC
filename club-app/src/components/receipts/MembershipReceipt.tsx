import ReceiptBase, { LINE, formatDate } from "./ReceiptBase";

export interface MembershipReceiptProps {
    memberName: string;
    memberId: string;
    planName: string;
    amount: number;
    paymentMethod: string;
    reference?: string;
    startDate: Date;
    endDate: Date;
    clubName: string;
    clubPhone: string;
    date: Date;
    receiptNumber: string;
}

export default function MembershipReceipt(props: MembershipReceiptProps) {
    const {
        memberName, memberId, planName, amount, paymentMethod,
        reference, startDate, endDate,
        clubName, clubPhone, date, receiptNumber,
    } = props;

    return (
        <ReceiptBase clubName={clubName} clubPhone={clubPhone} receiptNumber={receiptNumber} date={date}>
            <div style={{ textAlign: "center", fontWeight: "bold" }}>MEMBERSHIP RECEIPT</div>
            <div>{LINE}</div>
            <div>Member: {memberName.slice(0, 20)}</div>
            {memberId && <div>ID: {memberId}</div>}
            <div>{LINE}</div>
            <div style={{ fontWeight: "bold" }}>Plan: {planName.toUpperCase()}</div>
            <div>Amount: Rs.{amount.toFixed(2)}</div>
            <div>Payment: {paymentMethod}</div>
            {reference && <div>Ref: {reference.slice(0, 18)}</div>}
            <div>{LINE}</div>
            <div>Valid From: {formatDate(startDate)}</div>
            <div style={{ fontWeight: "bold" }}>Valid Until: {formatDate(endDate)}</div>
        </ReceiptBase>
    );
}
