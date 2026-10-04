// ─── Milestone Definitions ───────────────────────────────────────────────────

export interface MilestoneDef {
    id: string;
    label: string;
    description: string;
    emoji: string;
    check: (data: MilestoneData) => boolean;
    progressText: (data: MilestoneData) => string;
}

export interface MilestoneData {
    weighInCount: number;
    totalLost: number;       // startWeight - currentWeight  (positive = lost)
    currentWeight: number;
    targetWeight: number;
}

export const MILESTONES: MilestoneDef[] = [
    {
        id: "first_weighin",
        label: "First Weigh-in",
        description: "Started the journey!",
        emoji: "🏅",
        check: (d) => d.weighInCount >= 1,
        progressText: () => "Record your first weigh-in",
    },
    {
        id: "lost_1kg",
        label: "Lost 1 kg",
        description: "Great start!",
        emoji: "⭐",
        check: (d) => d.totalLost >= 1,
        progressText: (d) => d.totalLost < 1 ? `Lose ${(1 - d.totalLost).toFixed(1)} more kg` : "",
    },
    {
        id: "lost_3kg",
        label: "Lost 3 kg",
        description: "Fantastic progress!",
        emoji: "🌟",
        check: (d) => d.totalLost >= 3,
        progressText: (d) => d.totalLost < 3 ? `Lose ${(3 - d.totalLost).toFixed(1)} more kg` : "",
    },
    {
        id: "lost_5kg",
        label: "Lost 5 kg",
        description: "Halfway hero!",
        emoji: "💪",
        check: (d) => d.totalLost >= 5,
        progressText: (d) => d.totalLost < 5 ? `Lose ${(5 - d.totalLost).toFixed(1)} more kg` : "",
    },
    {
        id: "lost_7kg",
        label: "Lost 7 kg",
        description: "On fire!",
        emoji: "🔥",
        check: (d) => d.totalLost >= 7,
        progressText: (d) => d.totalLost < 7 ? `Lose ${(7 - d.totalLost).toFixed(1)} more kg` : "",
    },
    {
        id: "lost_10kg",
        label: "Lost 10 kg",
        description: "Champion!",
        emoji: "🏆",
        check: (d) => d.totalLost >= 10,
        progressText: (d) => d.totalLost < 10 ? `Lose ${(10 - d.totalLost).toFixed(1)} more kg` : "",
    },
    {
        id: "target_reached",
        label: "Target Reached!",
        description: "Goal achieved!",
        emoji: "🎯",
        check: (d) => d.targetWeight > 0 && d.currentWeight <= d.targetWeight,
        progressText: (d) =>
            d.targetWeight > 0 && d.currentWeight > d.targetWeight
                ? `${(d.currentWeight - d.targetWeight).toFixed(1)} kg to go`
                : "Set a target weight",
    },
    {
        id: "consistent_4weeks",
        label: "4 Weeks Consistent",
        description: "Dedicated!",
        emoji: "📅",
        check: (d) => d.weighInCount >= 4,
        progressText: (d) => d.weighInCount < 4 ? `${4 - d.weighInCount} more weigh-ins` : "",
    },
    {
        id: "consistent_8weeks",
        label: "8 Weeks Consistent",
        description: "Unstoppable!",
        emoji: "📅",
        check: (d) => d.weighInCount >= 8,
        progressText: (d) => d.weighInCount < 8 ? `${8 - d.weighInCount} more weigh-ins` : "",
    },
];

/**
 * Returns array of newly earned badge IDs (not already in existingBadges).
 */
export function checkMilestones(data: MilestoneData, existingBadges: string[]): string[] {
    const existing = new Set(existingBadges);
    const newBadges: string[] = [];

    for (const m of MILESTONES) {
        if (!existing.has(m.id) && m.check(data)) {
            newBadges.push(m.id);
        }
    }

    return newBadges;
}

/**
 * Returns milestone progress info for all milestones (earned + locked).
 */
export function getMilestoneProgress(data: MilestoneData, earnedBadges: string[]) {
    const earnedSet = new Set(earnedBadges);
    return MILESTONES.map((m) => ({
        ...m,
        earned: earnedSet.has(m.id),
        progress: m.progressText(data),
    }));
}
