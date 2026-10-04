import React from "react";

export interface ReceiptBaseProps {
    clubName?: string;       // legacy prop — ignored; header is hardcoded
    clubPhone: string;
    receiptNumber: string;
    date: Date;
    children: React.ReactNode;
}

// 80mm thermal paper = 48 chars per line (Font A, 12×24)
const COLS = 48;
const LINE = "-".repeat(COLS);

function pad(left: string, right: string, width = COLS): string {
    const spaces = width - left.length - right.length;
    return left + " ".repeat(Math.max(1, spaces)) + right;
}

function center(text: string, width = COLS): string {
    const spaces = Math.max(0, Math.floor((width - text.length) / 2));
    return " ".repeat(spaces) + text;
}

function formatDate(d: Date): string {
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatTime(d: Date): string {
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${m} ${period}`;
}

export default function ReceiptBase({ clubPhone, receiptNumber, date, children }: ReceiptBaseProps) {
    const receiptStyle: React.CSSProperties = {
        display: "none",         // hidden on screen; print.css makes it visible during print
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#000",
        backgroundColor: "#fff",
        width: "80mm",
        padding: "4px 0",
        lineHeight: "1.5",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
    };

    return (
        <div style={receiptStyle}>
            {/* Header */}
            <div style={{ textAlign: "center", fontWeight: "bold" }}>
                <div>Usha Prasad Enterprises</div>
                <div>{clubPhone}</div>
            </div>
            <div>{LINE}</div>
            <div style={{ textAlign: "center" }}>** RECEIPT **</div>
            <div>Date: {formatDate(date)}</div>
            <div>Time: {formatTime(date)}</div>
            <div>Receipt #: {receiptNumber}</div>
            <div>{LINE}</div>

            {/* Body (injected by specific receipt type) */}
            {children}

            {/* Footer */}
            <div>{LINE}</div>
            <div style={{ textAlign: "center" }}>Thank you for</div>
            <div style={{ textAlign: "center" }}>visiting us!</div>
            <div style={{ textAlign: "center" }}>Powered by MNC</div>
            <div>{LINE}</div>
            {/* 8 blank lines for paper feed */}
            {Array.from({ length: 8 }).map((_, i) => (
                <div key={i}>&nbsp;</div>
            ))}
        </div>
    );
}

// Re-export helpers for receipt body components
export { pad, center, LINE, formatDate };
