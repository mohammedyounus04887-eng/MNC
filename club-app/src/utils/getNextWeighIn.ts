const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export interface NextWeighInResult {
    date: Date;
    dayName: string;
    daysUntil: number;
}

/**
 * Given an array of lowercase day names (e.g. ["monday", "wednesday", "friday"]),
 * returns the next upcoming weigh-in date (including today if today is a weigh-in day).
 */
export function getNextWeighIn(weighInDays: string[]): NextWeighInResult | null {
    if (!weighInDays.length) return null;

    const now = new Date();
    const todayIndex = now.getDay(); // 0 = Sunday

    // Build set of target day indices for fast lookup
    const targetIndices = new Set<number>();
    for (const day of weighInDays) {
        const idx = DAY_NAMES.indexOf(day.toLowerCase() as typeof DAY_NAMES[number]);
        if (idx !== -1) targetIndices.add(idx);
    }

    if (targetIndices.size === 0) return null;

    // Check today first, then next 6 days
    for (let offset = 0; offset < 7; offset++) {
        const dayIdx = (todayIndex + offset) % 7;
        if (targetIndices.has(dayIdx)) {
            const date = new Date(now);
            date.setDate(date.getDate() + offset);
            date.setHours(0, 0, 0, 0);
            return {
                date,
                dayName: DAY_NAMES[dayIdx].charAt(0).toUpperCase() + DAY_NAMES[dayIdx].slice(1),
                daysUntil: offset,
            };
        }
    }

    return null;
}
