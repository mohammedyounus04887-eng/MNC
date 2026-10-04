import { useState, useEffect } from "react";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import type { User } from "@/types/firestore";

export interface TreeNode {
    user: User;
    children: TreeNode[];
    depth: number;
}

export function useMyTree() {
    const { userProfile } = useAuth();
    const [tree, setTree] = useState<TreeNode | null>(null);
    const [directReferrals, setDirectReferrals] = useState(0);
    const [totalNetworkCount, setTotalNetworkCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!userProfile) return;
        const fetchTree = async () => {
            try {
                const uid = userProfile.id;

                // 1. Fetch current user
                const rootUser = userProfile;

                // Fetch ALL users in the club and build tree in memory
                const clubUsersSnap = await getDocs(
                    query(collection(db, `clubs/${rootUser.clubId}/members`))
                );

                const allUsersInClub = clubUsersSnap.docs.map(d => ({ id: d.id, ...d.data() } as User));

                // Filter those who have `uid` in their treePath (and are not the rootUser themselves)
                let downline = allUsersInClub.filter(u => u.treePath && u.treePath.includes(uid) && u.id !== uid);

                // Build Tree structure recursively
                const buildTree = (user: User, depth: number): TreeNode => {
                    const childrenUsers = downline.filter(u => u.parentUserId === user.id);
                    const childrenNodes = childrenUsers.map(child => buildTree(child, depth + 1));
                    return {
                        user,
                        depth,
                        children: childrenNodes
                    };
                };

                const rootNode = buildTree(rootUser, 0);

                setTree(rootNode);
                setTotalNetworkCount(downline.length);
                setDirectReferrals(downline.filter(u => u.referredBy === uid || u.parentUserId === uid).length);
                setLoading(false);
            } catch (err: any) {
                setError(err.message);
                setLoading(false);
            }
        };
        fetchTree();
    }, [userProfile]);

    return { tree, directReferrals, totalNetworkCount, loading, error };
}

export function useUserBasicProfile(userId: string) {
    const [profile, setProfile] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userId) { setLoading(false); return; }
        const fetchProfile = async () => {
            try {
                // Loop through all clubs to find the profile
                const clubsSnap = await getDocs(collection(db, "clubs"));
                for (const clubDoc of clubsSnap.docs) {
                    const snap = await getDoc(doc(db, `clubs/${clubDoc.id}/members`, userId));
                    if (snap.exists()) {
                        setProfile({ id: snap.id, ...snap.data() } as User);
                        break;
                    }
                }
            } catch (e) { }
            setLoading(false);
        };
        fetchProfile();
    }, [userId]);

    return { profile, loading };
}

export function useDirectReferrals() {
    const { userProfile } = useAuth();
    const [referrals, setReferrals] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userProfile) return;
        const fetchReferrals = async () => {
            try {
                const snap = await getDocs(
                    query(collection(db, `clubs/${userProfile.clubId}/members`), where("referredBy", "==", userProfile.id))
                );
                setReferrals(snap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
            } catch (e) { }
            setLoading(false);
        };
        fetchReferrals();
    }, [userProfile]);

    return { referrals, count: referrals.length, loading, error: null };
}
