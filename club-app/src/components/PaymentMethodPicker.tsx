/**
 * Reusable Cash / UPI / Split payment selector.
 *
 * Controlled component — caller owns the `PaymentSelection` state and gets
 * change callbacks. The picker handles the visual UI and per-method
 * validation hints, but the parent decides what to do on save.
 *
 * Used everywhere a payment is recorded: guest entries, wallet top-ups,
 * plan renewals, audit entries, product sales, member top-up requests.
 */

import { useEffect, useMemo } from "react";

const FONT = "'Nunito', sans-serif";

export type PaymentMethod = 'cash' | 'upi' | 'split';

export interface UpiAccount {
    id: string;
    app: string;
    number: string;
    holderName: string;
}

export interface PaymentSelection {
    method: PaymentMethod;
    cashAmount: number;
    upiAmount: number;
    upiAccountId?: string;
    upiAccountName?: string;
    upiNumber?: string;
}

export const emptyPaymentSelection: PaymentSelection = {
    method: 'cash',
    cashAmount: 0,
    upiAmount: 0,
};

/**
 * Validate that a payment selection is fully specified for the given total.
 * Returns `{ ok: true }` when ready to save, otherwise a human-readable reason.
 */
export function validatePayment(
    p: PaymentSelection,
    total: number,
    opts: { requireUpiAccount?: boolean } = {},
): { ok: boolean; reason?: string } {
    const requireUpiAccount = opts.requireUpiAccount ?? true;
    if (total <= 0) return { ok: true };

    if (p.method === 'cash') {
        if (Math.abs(p.cashAmount - total) > 0.5) {
            return { ok: false, reason: 'Cash amount must equal the total' };
        }
        return { ok: true };
    }
    if (p.method === 'upi') {
        if (Math.abs(p.upiAmount - total) > 0.5) {
            return { ok: false, reason: 'UPI amount must equal the total' };
        }
        if (requireUpiAccount && !p.upiAccountId) {
            return { ok: false, reason: 'Select a UPI account' };
        }
        return { ok: true };
    }
    // split
    if (p.cashAmount <= 0 || p.upiAmount <= 0) {
        return { ok: false, reason: 'Both cash and UPI amounts must be > 0' };
    }
    if (Math.abs(p.cashAmount + p.upiAmount - total) > 0.5) {
        return { ok: false, reason: `Cash + UPI must equal ₹${total} (off by ₹${(total - p.cashAmount - p.upiAmount).toFixed(0)})` };
    }
    if (requireUpiAccount && !p.upiAccountId) {
        return { ok: false, reason: 'Select a UPI account' };
    }
    return { ok: true };
}

interface Props {
    total: number;
    upiAccounts: UpiAccount[];
    value: PaymentSelection;
    onChange: (next: PaymentSelection) => void;
    disabled?: boolean;
    /** Hide the Split option — used when a flow only supports cash or UPI. */
    hideSplit?: boolean;
}

export default function PaymentMethodPicker({
    total,
    upiAccounts,
    value,
    onChange,
    disabled,
    hideSplit,
}: Props) {
    // Auto-fill amounts when method changes so cash/upi paths don't require typing.
    useEffect(() => {
        if (value.method === 'cash' && value.cashAmount !== total) {
            onChange({ ...value, cashAmount: total, upiAmount: 0 });
        } else if (value.method === 'upi' && value.upiAmount !== total) {
            onChange({ ...value, upiAmount: total, cashAmount: 0 });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value.method, total]);

    const remaining = useMemo(
        () => Math.max(0, total - value.cashAmount - value.upiAmount),
        [total, value.cashAmount, value.upiAmount],
    );
    const overpay = useMemo(
        () => Math.max(0, value.cashAmount + value.upiAmount - total),
        [total, value.cashAmount, value.upiAmount],
    );

    const setMethod = (m: PaymentMethod) => {
        if (m === 'cash') onChange({ ...value, method: 'cash', cashAmount: total, upiAmount: 0, upiAccountId: undefined, upiAccountName: undefined, upiNumber: undefined });
        else if (m === 'upi') onChange({ ...value, method: 'upi', cashAmount: 0, upiAmount: total });
        else onChange({ ...value, method: 'split', cashAmount: 0, upiAmount: 0 });
    };

    const setUpiAccount = (acctId: string) => {
        const acct = upiAccounts.find(a => a.id === acctId);
        if (!acct) {
            onChange({ ...value, upiAccountId: undefined, upiAccountName: undefined, upiNumber: undefined });
            return;
        }
        onChange({
            ...value,
            upiAccountId: acct.id,
            upiAccountName: `${acct.app} (${acct.holderName})`,
            upiNumber: acct.number,
        });
    };

    const btnStyle = (active: boolean): React.CSSProperties => ({
        flex: 1,
        padding: "12px",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: FONT,
        border: "none",
        background: active ? "#1e293b" : "#f1f5f9",
        color: active ? "white" : "#64748b",
        opacity: disabled ? 0.6 : 1,
    });

    const inputStyle: React.CSSProperties = {
        width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb",
        borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: FONT,
        outline: "none", boxSizing: "border-box",
    };

    return (
        <div style={{ fontFamily: FONT }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 6 }}>METHOD</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button type="button" disabled={disabled} onClick={() => setMethod('cash')} style={btnStyle(value.method === 'cash')}>💵 Cash</button>
                <button type="button" disabled={disabled} onClick={() => setMethod('upi')} style={btnStyle(value.method === 'upi')}>📱 UPI</button>
                {!hideSplit && (
                    <button type="button" disabled={disabled} onClick={() => setMethod('split')} style={btnStyle(value.method === 'split')}>⚡ Split</button>
                )}
            </div>

            {/* Split mode — show both inputs */}
            {value.method === 'split' && (
                <div style={{ background: "#f8fafc", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <div style={{ marginBottom: 10 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 4 }}>💵 CASH AMOUNT (₹)</label>
                        <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            value={value.cashAmount || ""}
                            onChange={(e) => onChange({ ...value, cashAmount: parseFloat(e.target.value) || 0 })}
                            disabled={disabled}
                            style={inputStyle}
                            placeholder="0"
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 4 }}>📱 UPI AMOUNT (₹)</label>
                        <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            value={value.upiAmount || ""}
                            onChange={(e) => onChange({ ...value, upiAmount: parseFloat(e.target.value) || 0 })}
                            disabled={disabled}
                            style={inputStyle}
                            placeholder="0"
                        />
                    </div>
                    {/* Live remaining / overpay indicator */}
                    {remaining > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#d97706" }}>
                            Remaining: ₹{remaining}
                        </div>
                    )}
                    {overpay > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#dc2626" }}>
                            Over by ₹{overpay} — reduce one amount
                        </div>
                    )}
                    {remaining === 0 && overpay === 0 && total > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#16a34a" }}>
                            ✓ Cash + UPI = ₹{total}
                        </div>
                    )}
                </div>
            )}

            {/* UPI account dropdown — needed when method is upi or split */}
            {(value.method === 'upi' || value.method === 'split') && upiAccounts.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 6 }}>UPI ACCOUNT</label>
                    <select
                        value={value.upiAccountId ?? ""}
                        onChange={(e) => setUpiAccount(e.target.value)}
                        disabled={disabled}
                        style={{ ...inputStyle, padding: "10px 12px" }}
                    >
                        <option value="">— Select account —</option>
                        {upiAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.app} · {a.holderName} · {a.number}
                            </option>
                        ))}
                    </select>
                </div>
            )}
        </div>
    );
}
