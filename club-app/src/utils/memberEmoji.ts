/**
 * Member status emoji utility.
 * Calculates a status indicator based on membership visits remaining.
 */

export interface MemberStatus {
    emoji: string;      // Unicode emoji for UI display
    label: string;      // Text label
    color: string;      // Hex color for UI
    textEmoji: string;  // ASCII fallback for thermal printer
    level: 'good' | 'warning' | 'danger' | 'expired' | 'none';
}

const STATUS_GOOD: MemberStatus = {
    emoji: '\u{1F4AA}', label: 'All Good', color: '#22c55e', textEmoji: '[OK]', level: 'good',
};
const STATUS_WARNING: MemberStatus = {
    emoji: '\u{26A1}', label: 'Getting Low', color: '#f59e0b', textEmoji: '[!]', level: 'warning',
};
const STATUS_DANGER: MemberStatus = {
    emoji: '\u{1F620}', label: 'Renew Soon', color: '#ef4444', textEmoji: '[!!]', level: 'danger',
};
const STATUS_EXPIRED: MemberStatus = {
    emoji: '\u{274C}', label: 'Expired', color: '#dc2626', textEmoji: '[X]', level: 'expired',
};
const STATUS_NONE: MemberStatus = {
    emoji: '\u{1F195}', label: 'No Plan', color: '#6b7280', textEmoji: '[-]', level: 'none',
};

/**
 * Returns the status emoji/indicator for a member based on their visit counts.
 *
 * @param visitsTotal  - Total visits included in the membership (undefined = no plan)
 * @param visitsRemaining - Visits still remaining (undefined = no plan)
 */
export function getMemberStatusEmoji(
    visitsTotal: number | undefined,
    visitsRemaining: number | undefined,
): MemberStatus {
    // No membership at all
    if (visitsTotal === undefined || visitsTotal === null || visitsTotal <= 0) {
        return STATUS_NONE;
    }

    const remaining = visitsRemaining ?? 0;

    // 0 visits remaining (had membership) -> Expired
    if (remaining <= 0) {
        return STATUS_EXPIRED;
    }

    const pct = (remaining / visitsTotal) * 100;

    if (pct > 50) return STATUS_GOOD;
    if (pct >= 20) return STATUS_WARNING;
    // 1-20% remaining
    return STATUS_DANGER;
}
