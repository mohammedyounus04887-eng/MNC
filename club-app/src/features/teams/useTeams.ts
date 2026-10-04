import { useEffect, useState } from "react";
import {
    addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { User as Member } from "@/types/firestore";

// ─── Team type ────────────────────────────────────────────────────────
// Stored at clubs/{clubId}/teams/{teamId}. Voice resolves a team by
// name match (fuzzy, case-insensitive), then expands memberIds into
// individual review-card rows with each member's shake preference.

export interface Team {
    id: string;
    clubId: string;
    name: string;
    memberIds: string[];
    createdAt?: any;
    updatedAt?: any;
    // Synthesized teams (e.g. couples) get a marker so they're rendered
    // differently in the admin UI and can't be deleted.
    synthesized?: boolean;
    synthesizedKind?: "couple";
}

// ─── useTeams (live + couple auto-synthesis) ──────────────────────────
// Subscribes to the teams collection, then layers on synthetic teams
// for every linked couple (so receptionist gets "Ramesh & Latha" as a
// team for free, no manual setup). Synthetic teams sort first.

export function useTeams(clubId: string | null, members: Member[]) {
    const [storedTeams, setStoredTeams] = useState<Team[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) { setStoredTeams([]); setLoading(false); return; }
        const unsub = onSnapshot(
            collection(db, `clubs/${clubId}/teams`),
            (snap) => {
                const teams = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Team);
                teams.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
                setStoredTeams(teams);
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => unsub();
    }, [clubId]);

    // Synthesize couple teams. Each linked pair becomes one team named
    // "First1 & First2" (e.g. "Ramesh & Latha"). Dedupe by coupleId.
    const synthetic: Team[] = [];
    if (clubId) {
        const seen = new Set<string>();
        for (const m of members) {
            if (!m.couplePartnerId) continue;
            const partnerId = m.couplePartnerId;
            const key = m.coupleId || [m.id, partnerId].sort().join("_");
            if (seen.has(key)) continue;
            seen.add(key);
            const partner = members.find((p) => p.id === partnerId);
            if (!partner) continue;
            const first1 = (m.name || "?").split(" ")[0];
            const first2 = (partner.name || "?").split(" ")[0];
            synthetic.push({
                id: `couple_${key}`,
                clubId,
                name: `${first1} & ${first2}`,
                memberIds: [m.id, partner.id],
                synthesized: true,
                synthesizedKind: "couple",
            });
        }
        synthetic.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    const teams = [...synthetic, ...storedTeams];
    return { teams, storedTeams, syntheticTeams: synthetic, loading };
}

// ─── mutations ─────────────────────────────────────────────────────────

export async function saveTeam(clubId: string, team: { id?: string; name: string; memberIds: string[] }): Promise<void> {
    const payload = {
        name: team.name.trim(),
        memberIds: team.memberIds,
        updatedAt: serverTimestamp(),
    };
    if (team.id) {
        await updateDoc(doc(db, `clubs/${clubId}/teams`, team.id), payload);
    } else {
        await addDoc(collection(db, `clubs/${clubId}/teams`), {
            ...payload, createdAt: serverTimestamp(),
        });
    }
}

export async function deleteTeam(clubId: string, teamId: string): Promise<void> {
    await deleteDoc(doc(db, `clubs/${clubId}/teams`, teamId));
}
