/**
 * Coach-side "View Customer's Meal Photos" section.
 *
 * Folder-style: one card per customer assigned to the signed-in coach in
 * the current active challenge. Clicking a card opens the per-customer
 * drilldown (BtcCoachCustomerMeals).
 *
 * Rendering rules:
 *   - Renders NOTHING if there's no active challenge.
 *   - Renders NOTHING if the user has no customers assigned (i.e. not a
 *     coach, or a coach with no current assignees).
 *   - Otherwise renders a collapsible card identical in width/styling to
 *     the rest of BtcMemberView so it sits naturally at the bottom.
 *
 * Used in two places:
 *   1. ProgressPage — appended below BtcMemberView when the member is a
 *      BTC participant AND also a coach
 *   2. ProgressPage — rendered standalone (with its own page chrome) when
 *      the user is JUST a coach and not a BTC participant
 */

import { useMemo, useState } from "react";
import {
    useActiveBtcChallenge,
    useBtcChallengeMeals,
    useCoachAssignedCustomers,
} from "@/hooks/useBtcChallenges";
import type { BtcChallengeParticipant } from "@/types/firestore";
import BtcCoachCustomerMeals from "./BtcCoachCustomerMeals";

const FONT = "'Nunito', sans-serif";

interface Props {
    clubId: string;
    coach: { id: string; name: string };
    /** When true, expand the section by default (used when this is the only thing on the page). */
    defaultOpen?: boolean;
}

export default function BtcCoachFolderView({ clubId, coach, defaultOpen = false }: Props) {
    const { challenge, loading: chLoading } = useActiveBtcChallenge(clubId);
    const challengeId = challenge?.id || null;
    const { customers, loading: custLoading } = useCoachAssignedCustomers(clubId, challengeId, coach.id);
    const { meals } = useBtcChallengeMeals(clubId, challengeId);
    const [open, setOpen] = useState(defaultOpen);
    const [selectedCustomer, setSelectedCustomer] = useState<BtcChallengeParticipant | null>(null);

    // Per-customer meal counts (for the folder card subtitle)
    const countsByMember = useMemo(() => {
        const out: Record<string, { total: number; pending: number; latest: Date | null }> = {};
        for (const m of meals) {
            const bucket = (out[m.memberId] ||= { total: 0, pending: 0, latest: null });
            bucket.total += 1;
            if (m.status === "pending") bucket.pending += 1;
            const t = (m.uploadedAt as any)?.toDate ? (m.uploadedAt as any).toDate() : null;
            if (t && (!bucket.latest || t > bucket.latest)) bucket.latest = t;
        }
        return out;
    }, [meals]);

    // Don't render anything until we've actually checked. Avoids a flash of
    // "no customers assigned" while the snapshot is still loading.
    if (chLoading || custLoading) return null;

    // No active challenge → nothing to show
    if (!challenge || !challengeId) return null;

    // No assigned customers → coach role but no work to do, hide entirely
    if (customers.length === 0) return null;

    return (
        <>
            <div style={card}>
                <button
                    onClick={() => setOpen(v => !v)}
                    style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        width: "100%", background: "transparent", border: "none", cursor: "pointer",
                        padding: 0, fontFamily: FONT,
                    }}
                >
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>
                            👥 View Customer's Meal Photos
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginTop: 2 }}>
                            You coach {customers.length} customer{customers.length === 1 ? "" : "s"} in <b>{challenge.name}</b>
                        </div>
                    </div>
                    <div style={{ fontSize: 18, color: "#64748b" }}>{open ? "▾" : "▸"}</div>
                </button>

                {open && (
                    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                        {customers.map(c => {
                            const counts = countsByMember[c.memberId] || { total: 0, pending: 0, latest: null };
                            return (
                                <button
                                    key={c.memberId}
                                    onClick={() => setSelectedCustomer(c)}
                                    style={folderCard}
                                >
                                    <div style={{ fontSize: 32, marginBottom: 6 }}>📁</div>
                                    {c.memberPhoto
                                        ? <img src={c.memberPhoto} alt="" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", marginBottom: 6, border: "2px solid white", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }} />
                                        : <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#1e40af", marginBottom: 6, fontSize: 18 }}>
                                            {c.memberName[0]}
                                        </div>
                                    }
                                    <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a", textAlign: "center", lineHeight: 1.2 }}>
                                        {c.memberName}
                                    </div>
                                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, marginTop: 2 }}>
                                        {counts.total === 0
                                            ? "no uploads yet"
                                            : `${counts.total} meal${counts.total === 1 ? "" : "s"}`}
                                    </div>
                                    {counts.pending > 0 && (
                                        <div style={{ marginTop: 4, fontSize: 9, fontWeight: 900, color: "#d97706", background: "#fef3c7", padding: "2px 6px", borderRadius: 100, letterSpacing: 0.5 }}>
                                            {counts.pending} PENDING
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {selectedCustomer && challengeId && (
                <BtcCoachCustomerMeals
                    clubId={clubId}
                    challengeId={challengeId}
                    customer={selectedCustomer}
                    coach={coach}
                    onBack={() => setSelectedCustomer(null)}
                />
            )}
        </>
    );
}

// ─── styles ─────────────────────────────────────────────────────────
const card: React.CSSProperties = {
    background: "white",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
    border: "1.5px solid #bfdbfe",   // subtle blue accent so coaches can spot the section quickly
};
const folderCard: React.CSSProperties = {
    background: "#f8fafc",
    border: "1.5px solid #e2e8f0",
    borderRadius: 12,
    padding: 12,
    cursor: "pointer",
    fontFamily: FONT,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    transition: "transform 0.1s ease",
};
