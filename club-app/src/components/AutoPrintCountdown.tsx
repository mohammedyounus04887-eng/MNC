import { useState, useEffect } from "react";

interface AutoPrintCountdownProps {
    onPrint: () => void;
    onCancel: () => void;
}

/**
 * A floating 3-second countdown toast that automatically fires a print action.
 * Shows at the bottom-right of the screen with a cancel button.
 */
export default function AutoPrintCountdown({ onPrint, onCancel }: AutoPrintCountdownProps) {
    const [count, setCount] = useState(3);

    useEffect(() => {
        const timer = setInterval(() => {
            setCount((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    onPrint();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div
            style={{
                position: "fixed",
                bottom: 32,
                right: 32,
                background: "#1a3a2a",
                color: "white",
                borderRadius: 16,
                padding: "20px 28px",
                display: "flex",
                alignItems: "center",
                gap: 20,
                boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
                zIndex: 9999,
                minWidth: 320,
                fontFamily: "'Nunito', sans-serif",
            }}
        >
            {/* Countdown circle */}
            <div
                style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: "#2d9653",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    fontWeight: 900,
                    flexShrink: 0,
                }}
            >
                {count}
            </div>

            {/* Text */}
            <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
                    🖨️ Printing receipt...
                </div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                    Auto-prints in {count} second{count !== 1 ? "s" : ""}
                </div>
            </div>

            {/* Cancel button */}
            <button
                onClick={onCancel}
                style={{
                    background: "rgba(255,255,255,0.1)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    color: "white",
                    padding: "8px 16px",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 13,
                    fontFamily: "'Nunito', sans-serif",
                }}
            >
                Cancel
            </button>
        </div>
    );
}
