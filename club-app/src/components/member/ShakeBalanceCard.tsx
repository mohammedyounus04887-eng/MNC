interface Props {
    shakeCredits: number;
    shakeCreditsPlanTotal: number;
    perShakePrice: number;
}

export default function ShakeBalanceCard({ shakeCredits, shakeCreditsPlanTotal, perShakePrice }: Props) {
    const GRACE_LIMIT = -5;
    const used = Math.max(0, shakeCreditsPlanTotal - shakeCredits);
    const pct = shakeCreditsPlanTotal > 0 ? Math.round((Math.max(0, shakeCredits) / shakeCreditsPlanTotal) * 100) : 0;
    const rupeeValue = Math.max(0, shakeCredits) * perShakePrice;
    const isNegative = shakeCredits < 0;
    const isEmpty = shakeCredits <= GRACE_LIMIT;
    const isGrace = shakeCredits <= 0 && shakeCredits > GRACE_LIMIT;
    const isLow = !isEmpty && !isGrace && shakeCredits <= 3;
    const graceUsed = Math.abs(Math.min(0, shakeCredits));

    const barColor = isEmpty || isNegative ? '#ef4444' : isLow ? '#f59e0b' : '#059669';
    const headerBg = isNegative
        ? 'linear-gradient(135deg, #ef4444, #dc2626)'
        : 'linear-gradient(135deg, #10b981, #059669)';
    const countColor = isEmpty ? '#ef4444' : isGrace ? '#ef4444' : isLow ? '#f59e0b' : barColor;

    return (
        <div style={{ borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.08)', marginBottom: 14, fontFamily: 'Nunito, sans-serif' }}>
            {/* Gradient header */}
            <div style={{ background: headerBg, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>🥤</span>
                    <span style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>Shake Credits</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.22)', borderRadius: 100, padding: '4px 12px' }}>
                    <span style={{ color: 'white', fontWeight: 800, fontSize: 12 }}>
                        {shakeCredits}/{shakeCreditsPlanTotal} credits
                    </span>
                </div>
            </div>

            {/* White body */}
            <div style={{ background: 'white', padding: '14px 18px' }}>
                {/* Big numbers */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                            <span style={{ fontSize: 34, fontWeight: 900, color: countColor, lineHeight: 1 }}>{shakeCredits}</span>
                            <span style={{ fontSize: 15, fontWeight: 700, color: '#9ca3af' }}>/ {shakeCreditsPlanTotal}</span>
                        </div>
                        <div style={{ fontSize: 11, color: isNegative ? '#ef4444' : '#9ca3af', marginTop: 2 }}>
                            {isNegative ? 'grace credits used' : 'credits remaining'}
                        </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#1a3a2a' }}>₹{rupeeValue.toLocaleString('en-IN')}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>value remaining</div>
                    </div>
                </div>

                {/* Progress bar */}
                <div style={{ background: '#e5e7eb', borderRadius: 100, height: 8, overflow: 'hidden', marginBottom: 6 }}>
                    <div style={{
                        height: '100%',
                        width: `${Math.max(isNegative ? 0 : 2, pct)}%`,
                        background: barColor,
                        borderRadius: 100,
                        transition: 'width 0.5s',
                    }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', fontWeight: 700 }}>
                    <span>{used} used</span>
                    <span>{isNegative ? `${shakeCredits} (grace)` : `${shakeCredits} remaining`}</span>
                </div>

                {isEmpty && (
                    <div style={{ marginTop: 8, background: '#fde8e8', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#dc2626', fontWeight: 700, textAlign: 'center' }}>
                        Credits exhausted — buy a plan to recharge
                    </div>
                )}
                {isGrace && (
                    <div style={{ marginTop: 8, background: '#fef3c7', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#92400e', fontWeight: 700, textAlign: 'center' }}>
                        Grace period: {graceUsed}/5 used — please renew soon
                    </div>
                )}
                {isLow && (
                    <div style={{ marginTop: 8, background: '#fffbeb', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#92400e', fontWeight: 700, textAlign: 'center' }}>
                        Only {shakeCredits} credit{shakeCredits !== 1 ? 's' : ''} left!
                    </div>
                )}
            </div>
        </div>
    );
}
