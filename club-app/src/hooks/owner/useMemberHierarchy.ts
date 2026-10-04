/**
 * Member network hierarchy — robust rebuild from existing (messy) data, plus
 * "placeholder" nodes for historical people who aren't in the system.
 *
 * Real members resolve their parent via parentUserId → referredBy →
 * referredByMemberId (each matched against BOTH doc id and memberId code).
 * Placeholders (clubs/{clubId}/networkPlaceholders) store an explicit parentId
 * (a real member doc id OR another placeholder id). Both are merged into one
 * tree; cycles are broken; unparented nodes become roots.
 *
 * Edits are owner-initiated:
 *   - reparentMember / detachMember  → write a real member's parentUserId
 *   - addPlaceholder / movePlaceholder / deletePlaceholder → manage placeholders
 */

import { useEffect, useMemo, useState } from "react";
import {
    collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc,
    getDocs, query, where, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface HierMember {
    id: string;
    name: string;
    phone: string;
    photo: string;
    memberId: string;
    parentUserId?: string | null;
    referredBy?: string | null;
    referredByMemberId?: string | null;
    treePath?: string;
    isClubOwner?: boolean;
    isPlaceholder?: boolean;
}

export interface HierNode {
    member: HierMember;
    children: HierNode[];
    depth: number;
    descendantCount: number;
}

export interface MemberHierarchy {
    roots: HierNode[];
    byId: Map<string, HierMember>;
    parentIdOf: Map<string, string | null>;
    count: number;
    orphanCount: number;
    loading: boolean;
}

function resolveParentId(m: HierMember, byDocId: Map<string, HierMember>, byCode: Map<string, HierMember>): string | null {
    if (m.isPlaceholder) {
        const pid = m.parentUserId || null;
        return pid && byDocId.has(pid) && pid !== m.id ? pid : null;
    }
    const cands = [m.parentUserId, m.referredBy, m.referredByMemberId].filter(Boolean) as string[];
    for (const c of cands) {
        const p = byDocId.get(c) || byCode.get(c);
        if (p && p.id !== m.id) return p.id;
    }
    return null;
}

export function useMemberHierarchy(clubId: string | null): MemberHierarchy {
    const [rawMembers, setRawMembers] = useState<HierMember[]>([]);
    const [rawPlaceholders, setRawPlaceholders] = useState<HierMember[]>([]);
    const [loadingM, setLoadingM] = useState(true);
    const [loadingP, setLoadingP] = useState(true);

    useEffect(() => {
        if (!clubId) { setRawMembers([]); setLoadingM(false); return; }
        return onSnapshot(collection(db, `clubs/${clubId}/members`), snap => {
            setRawMembers(snap.docs.map(d => {
                const x = d.data() as any;
                return {
                    id: d.id, name: x.name || "—", phone: x.phone || "",
                    photo: x.photoUrl || x.photo || "", memberId: x.memberId || "",
                    parentUserId: x.parentUserId ?? null, referredBy: x.referredBy ?? null,
                    referredByMemberId: x.referredByMemberId ?? null, treePath: x.treePath || "",
                    isClubOwner: !!x.isClubOwner, isPlaceholder: false,
                } as HierMember;
            }));
            setLoadingM(false);
        }, () => setLoadingM(false));
    }, [clubId]);

    useEffect(() => {
        if (!clubId) { setRawPlaceholders([]); setLoadingP(false); return; }
        return onSnapshot(collection(db, `clubs/${clubId}/networkPlaceholders`), snap => {
            setRawPlaceholders(snap.docs.map(d => {
                const x = d.data() as any;
                return {
                    id: d.id, name: x.name || "—", phone: x.phone || "",
                    photo: "", memberId: x.memberCode || "",
                    parentUserId: x.parentId ?? null, isPlaceholder: true,
                } as HierMember;
            }));
            setLoadingP(false);
        }, () => setLoadingP(false));
    }, [clubId]);

    return useMemo<MemberHierarchy>(() => {
        const members = [...rawMembers, ...rawPlaceholders];
        const byDocId = new Map<string, HierMember>();
        const byCode = new Map<string, HierMember>();
        for (const m of members) { byDocId.set(m.id, m); if (m.memberId) byCode.set(m.memberId, m); }

        const parentIdOf = new Map<string, string | null>();
        for (const m of members) parentIdOf.set(m.id, resolveParentId(m, byDocId, byCode));

        // Break cycles.
        for (const m of members) {
            const seen = new Set<string>([m.id]);
            let cur = parentIdOf.get(m.id) || null;
            while (cur) {
                if (seen.has(cur)) { parentIdOf.set(m.id, null); break; }
                seen.add(cur);
                cur = parentIdOf.get(cur) || null;
            }
        }

        const childrenOf = new Map<string, HierMember[]>();
        for (const m of members) {
            const pid = parentIdOf.get(m.id);
            if (pid && byDocId.has(pid)) {
                const arr = childrenOf.get(pid) || [];
                arr.push(m);
                childrenOf.set(pid, arr);
            }
        }

        const build = (m: HierMember, depth: number): HierNode => {
            const kids = (childrenOf.get(m.id) || []).sort((a, b) => a.name.localeCompare(b.name));
            const childNodes = kids.map(k => build(k, depth + 1));
            const descendantCount = childNodes.reduce((s, n) => s + 1 + n.descendantCount, 0);
            return { member: m, children: childNodes, depth, descendantCount };
        };

        const rootMembers = members.filter(m => !parentIdOf.get(m.id));
        rootMembers.sort((a, b) => (b.isClubOwner ? 1 : 0) - (a.isClubOwner ? 1 : 0) || a.name.localeCompare(b.name));
        const roots = rootMembers.map(m => build(m, 0));
        const orphanCount = rootMembers.filter(m => !m.isClubOwner).length;

        return { roots, byId: byDocId, parentIdOf, count: members.length, orphanCount, loading: loadingM || loadingP };
    }, [rawMembers, rawPlaceholders, loadingM, loadingP]);
}

// ─── Mutations ───────────────────────────────────────────────────────────

/** Re-parent a real member (write parentUserId + best-effort treePath). */
export async function reparentMember(
    clubId: string, memberDocId: string,
    newParent: { id: string; treePath?: string; memberId?: string } | null,
) {
    if (newParent && newParent.id === memberDocId) throw new Error("A member can't be their own parent.");
    const patch: any = newParent
        ? { parentUserId: newParent.id, treePath: `${newParent.treePath || newParent.memberId || newParent.id}/${memberDocId}`, updatedAt: serverTimestamp() }
        : { parentUserId: null, updatedAt: serverTimestamp() };
    await updateDoc(doc(db, `clubs/${clubId}/members/${memberDocId}`), patch);
}

/** Detach a real member from the network (top level). Does NOT delete the account. */
export async function detachMember(clubId: string, memberDocId: string) {
    await updateDoc(doc(db, `clubs/${clubId}/members/${memberDocId}`), { parentUserId: null, updatedAt: serverTimestamp() });
}

/** Create a placeholder node (a historical person not in the system). */
export async function addPlaceholder(clubId: string, data: { name: string; phone?: string; memberCode?: string }, parentId: string | null) {
    if (!data.name.trim()) throw new Error("Name is required.");
    await addDoc(collection(db, `clubs/${clubId}/networkPlaceholders`), {
        name: data.name.trim(), phone: (data.phone || "").trim(), memberCode: (data.memberCode || "").trim(),
        parentId: parentId ?? null, createdAt: serverTimestamp(),
    });
}

/** Move a placeholder under a new parent (or null for top level). */
export async function movePlaceholder(clubId: string, placeholderId: string, parentId: string | null) {
    if (parentId === placeholderId) throw new Error("A node can't be its own parent.");
    await updateDoc(doc(db, `clubs/${clubId}/networkPlaceholders/${placeholderId}`), { parentId: parentId ?? null, updatedAt: serverTimestamp() });
}

/**
 * Delete a placeholder. Its children are re-parented to the placeholder's own
 * parent so the subtree isn't lost: real-member children get parentUserId set,
 * placeholder children get parentId set.
 */
export async function deletePlaceholder(clubId: string, placeholderId: string, grandparentId: string | null) {
    // Real-member children pointing at this placeholder
    const memChildren = await getDocs(query(collection(db, `clubs/${clubId}/members`), where("parentUserId", "==", placeholderId)));
    for (const d of memChildren.docs) {
        await updateDoc(d.ref, { parentUserId: grandparentId ?? null, updatedAt: serverTimestamp() });
    }
    // Placeholder children pointing at this placeholder
    const phChildren = await getDocs(query(collection(db, `clubs/${clubId}/networkPlaceholders`), where("parentId", "==", placeholderId)));
    for (const d of phChildren.docs) {
        await updateDoc(d.ref, { parentId: grandparentId ?? null, updatedAt: serverTimestamp() });
    }
    await deleteDoc(doc(db, `clubs/${clubId}/networkPlaceholders/${placeholderId}`));
}

/** Collect a node's descendant ids (to exclude them as move targets). */
export function descendantIds(node: HierNode): Set<string> {
    const out = new Set<string>();
    const walk = (n: HierNode) => { for (const c of n.children) { out.add(c.member.id); walk(c); } };
    walk(node);
    return out;
}
