import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc,
    query, where, writeBatch, Timestamp, onSnapshot, orderBy, increment,
} from "firebase/firestore";
import { normalizeTender } from "@/lib/paymentSplit";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { generateMemberId, generatePrefixFromName } from "@/utils/generateMemberId";
import { getNextOrderNumber } from "@/utils/orderNumber";
import { planCreditsOf } from "@/utils/planCredits";
import type {
    User, Wallet, WalletTransaction, TopupRequest, MembershipPlan,
    Attendance, Order, Product, Announcement, Club, Referral
} from "@/types/firestore";

// ─── helpers ────────────────────────────────────────────────────────────

function today() {
    return new Date().toISOString().slice(0, 10);
}

// ─── useClubMembers ─────────────────────────────────────────────────────

export function useClubMembers() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "members", club?.id],
        queryFn: async () => {
            const snap = await getDocs(query(collection(db, `clubs/${club!.id}/members`)));
            return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as User);
        },
        enabled: !!club,
    });
}

// ─── useClubVolunteers ──────────────────────────────────────────────────

export function useClubVolunteers() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "volunteers", club?.id],
        queryFn: async () => {
            const snap = await getDocs(query(collection(db, `clubs/${club!.id}/volunteers`)));
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as User);
        },
        enabled: !!club,
    });
}

// ─── useMemberById ──────────────────────────────────────────────────────

export function useMemberById(memberId: string) {
    return useQuery({
        queryKey: ["owner", "member", memberId],
        queryFn: async () => {
            // Try to find member across clubs - requires clubId context
            // For now query all clubs
            const clubsSnap = await getDocs(collection(db, "clubs"));
            for (const clubDoc of clubsSnap.docs) {
                const snap = await getDoc(doc(db, `clubs/${clubDoc.id}/members`, memberId));
                if (snap.exists()) return { id: snap.id, ...snap.data() } as User;
            }
            throw new Error("Member not found");
        },
        enabled: !!memberId,
    });
}

// ─── useAddMember ───────────────────────────────────────────────────────

export function useAddMember() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (input: {
            name: string; phone: string; email?: string;
            dob?: Date | null; anniversary?: Date | null;
            photo?: string; referredBy?: string | null;
            referredByMemberId?: string | null;
            memberType?: string;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const batch = writeBatch(db);
            const now = Timestamp.now();
            const memberId = "member_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

            // Generate member ID (PREFIX-LETTER-NUMBER)
            const prefix = club.memberIdPrefix || generatePrefixFromName(club.name);
            const generatedMemberId = await generateMemberId(club.id, prefix);

            // Determine treePath from referrer
            let treePath = memberId;
            let parentUserId: string | null = input.referredBy || null;
            if (parentUserId) {
                const parentSnap = await getDoc(doc(db, `clubs/${club.id}/members`, parentUserId));
                if (parentSnap.exists()) {
                    treePath = (parentSnap.data() as User).treePath + "/" + memberId;
                }
            }

            const userData: any = {
                id: memberId, name: input.name, phone: input.phone,
                email: input.email || "", photo: input.photo || "",
                role: "member", clubId: club.id,
                parentUserId, treePath,
                shakeCredits: 0, shakeCreditsPlanTotal: 0,
                status: "active",
                dob: input.dob ? Timestamp.fromDate(input.dob) : null,
                anniversary: input.anniversary ? Timestamp.fromDate(input.anniversary) : null,
                qrCode: "", isClubOwner: false, ownedClubId: null,
                originalClubId: club.id, referredBy: parentUserId,
                referredByMemberId: input.referredByMemberId || null,
                memberType: input.memberType || null,
                memberId: generatedMemberId,
                createdAt: now, updatedAt: now,
            };
            batch.set(doc(db, `clubs/${club.id}/members`, memberId), userData);

            // Create wallet
            batch.set(doc(db, `clubs/${club.id}/members/${memberId}/wallet`, "data"), {
                userId: memberId, clubId: club.id,
                currencyName: club.currencyName, balance: 0, lastUpdated: now,
            } as Wallet);

            // Create referral record & award bonus
            if (parentUserId) {
                const bonusCoins = club.referralBonusCoins ?? 50;

                const refId = "ref_" + Date.now();
                batch.set(doc(db, `clubs/${club.id}/referrals`, refId), {
                    id: refId, referrerId: parentUserId, referredId: memberId,
                    clubId: club.id, bonusCoinsAwarded: bonusCoins,
                    status: "rewarded", createdAt: now, rewardedAt: now,
                });

                // Reward referrer wallet natively inside batch
                const referrerWalletSnap = await getDoc(doc(db, `clubs/${club.id}/members/${parentUserId}/wallet`, "data"));
                if (referrerWalletSnap.exists()) {
                    const referrerWallet = referrerWalletSnap.data() as Wallet;
                    const newBalance = referrerWallet.balance + bonusCoins;
                    batch.update(doc(db, `clubs/${club.id}/members/${parentUserId}/wallet`, "data"), { balance: newBalance, lastUpdated: now });

                    const txId = "tx_" + Date.now() + "_ref";
                    batch.set(doc(db, `clubs/${club.id}/members/${parentUserId}/transactions`, txId), {
                        id: txId, userId: parentUserId, clubId: club.id,
                        type: "credit", amount: bonusCoins, reason: "referral_bonus",
                        addedBy: "system", note: `Referral bonus for ${input.name}`,
                        createdAt: now, balanceAfter: newBalance,
                    } as WalletTransaction);
                }
            }

            await batch.commit();
            return { memberId, generatedMemberId };
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "members"] }),
    });
}


// ─── useUpdateMember ────────────────────────────────────────────────────


export function useUpdateMember() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ memberId, data }: { memberId: string; data: Partial<User> }) => {
            // Need clubId to update member in nested path
            const clubsSnap = await getDocs(collection(db, "clubs"));
            for (const clubDoc of clubsSnap.docs) {
                const memberSnap = await getDoc(doc(db, `clubs/${clubDoc.id}/members`, memberId));
                if (memberSnap.exists()) {
                    await updateDoc(doc(db, `clubs/${clubDoc.id}/members`, memberId), { ...data, updatedAt: Timestamp.now() } as any);
                    return;
                }
            }
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner"] }),
    });
}

// ─── useDeactivateMember ────────────────────────────────────────────────

export function useDeactivateMember() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (memberId: string) => {
            const clubsSnap = await getDocs(collection(db, "clubs"));
            for (const clubDoc of clubsSnap.docs) {
                const memberSnap = await getDoc(doc(db, `clubs/${clubDoc.id}/members`, memberId));
                if (memberSnap.exists()) {
                    await updateDoc(doc(db, `clubs/${clubDoc.id}/members`, memberId), { status: "paused", updatedAt: Timestamp.now() });
                    return;
                }
            }
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner"] }),
    });
}

// ─── useMembershipPlans ─────────────────────────────────────────────────

export function useMembershipPlans() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "plans", club?.id],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${club!.id}/memberships`))
            );
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MembershipPlan);
        },
        enabled: !!club,
    });
}

// ─── useCreateMembershipPlan ────────────────────────────────────────────

export function useCreateMembershipPlan() {
    const qc = useQueryClient();
    const { club } = useClubContext();
    return useMutation({
        mutationFn: async (plan: Omit<MembershipPlan, "id" | "clubId" | "createdAt">) => {
            if (!club) throw new Error("Club not loaded");
            const planId = "plan_" + Date.now();
            await setDoc(doc(db, `clubs/${club.id}/memberships`, planId), {
                ...plan, id: planId, clubId: club.id, createdAt: Timestamp.now(),
            });
            return planId;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "plans"] }),
    });
}

// ─── useUpdateMembershipPlan ────────────────────────────────────────────

export function useUpdateMembershipPlan() {
    const qc = useQueryClient();
    const { club } = useClubContext();
    return useMutation({
        mutationFn: async ({ planId, data }: { planId: string; data: Partial<MembershipPlan> }) => {
            await updateDoc(doc(db, `clubs/${club!.id}/memberships`, planId), data as any);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "plans"] }),
    });
}

// ─── useAssignMembership ────────────────────────────────────────────────

export function useAssignMembership() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ memberId, planId }: { memberId: string; planId: string }) => {
            if (!club) throw new Error("Club not loaded");
            const planSnap = await getDoc(doc(db, `clubs/${club!.id}/memberships`, planId));
            if (!planSnap.exists()) throw new Error("Plan not found");
            const plan = planSnap.data() as MembershipPlan;

            const walletSnap = await getDoc(doc(db, `clubs/${club!.id}/members/${memberId}/wallet`, "data"));
            if (!walletSnap.exists()) throw new Error("Wallet not found");
            const wallet = walletSnap.data() as Wallet;

            if (wallet.balance < plan.price) {
                throw new Error(`Insufficient balance. Need ₹${plan.price}, have ₹${wallet.balance}.`);
            }

            const batch = writeBatch(db);
            const now = Timestamp.now();
            const newBalance = wallet.balance - plan.price;
            const start = new Date();
            const end = new Date(start.getTime() + (plan.durationDays ?? 90) * 86400000);
            const visits = planCreditsOf(plan);

            // Read current shake credits — needed both for the capped denom
            // and to flag this purchase as Lucky-Dip-eligible (renewed while
            // still holding a credit, per BTC club tradition). Plan must
            // also be opted in via its `luckyDipEligible` flag.
            const memberSnap = await getDoc(doc(db, `clubs/${club!.id}/members`, memberId));
            const currentCredits = Number(memberSnap.data()?.shakeCredits) || 0;
            const newPlanTotal = currentCredits + visits;
            const wasLuckyDipEligible = currentCredits >= 1 && (plan as any).luckyDipEligible === true;

            // Deduct wallet
            batch.update(doc(db, `clubs/${club!.id}/members/${memberId}/wallet`, "data"), { balance: newBalance, lastUpdated: now });

            // Create transaction
            const txId = "tx_" + Date.now();
            batch.set(doc(db, `clubs/${club!.id}/members/${memberId}/transactions`, txId), {
                id: txId, userId: memberId, clubId: club.id,
                type: "debit", amount: plan.price, reason: "membership",
                addedBy: null, note: `${plan.name} membership (${visits} credits)`,
                createdAt: now, balanceAfter: newBalance,
                planName: plan.name,
                membershipFrom: Timestamp.fromDate(start),
                membershipTo: Timestamp.fromDate(end),
                creditsBeforeRenewal: currentCredits,
                wasLuckyDipEligible,
            } as WalletTransaction);

            // Update shake credits — denominator MATCHES the new total
            // (no longer accumulates forever)
            batch.update(doc(db, `clubs/${club!.id}/members`, memberId), {
                status: 'active',
                isActiveMember: true,
                isPermanent: true,
                shakeCredits: newPlanTotal,
                shakeCreditsPlanTotal: newPlanTotal,
                // `end` was computed above and then discarded — this granted
                // credits without ever moving the member's expiry. Both field
                // names, since the app reads expiry under two of them.
                membershipPlanId: plan.id,
                membershipPlanName: plan.name,
                membershipStartDate: Timestamp.fromDate(start),
                membershipEndDate: Timestamp.fromDate(end),
                membershipEnd: Timestamp.fromDate(end),
                updatedAt: now,
            });

            await batch.commit();
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner"] }),
    });
}

// ─── usePendingTopupRequests (real-time) ─────────────────────────────────

export function usePendingTopupRequests() {
    const { club } = useClubContext();
    const [requests, setRequests] = useState<TopupRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!club) return;
        const q = query(
            collection(db, `clubs/${club.id}/topupRequests`),
            where("status", "==", "pending")
        );
        const unsub = onSnapshot(q,
            (snap) => {
                setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TopupRequest));
                setLoading(false);
            },
            (err) => { setError(err.message); setLoading(false); }
        );
        return () => unsub();
    }, [club]);

    return { requests, loading, error };
}

// ─── useApproveTopup ────────────────────────────────────────────────────

export function useApproveTopup() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async ({ requestId, approvedAmount, resolvedBy }: {
            requestId: string; approvedAmount: number; resolvedBy: string;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const reqSnap = await getDoc(doc(db, `clubs/${club!.id}/topupRequests`, requestId));
            if (!reqSnap.exists()) throw new Error("Request not found");
            const req = reqSnap.data() as TopupRequest;

            const walletSnap = await getDoc(doc(db, `clubs/${club!.id}/members/${req.memberId}/wallet`, "data"));
            if (!walletSnap.exists()) throw new Error("Wallet not found");
            const wallet = walletSnap.data() as Wallet;

            const batch = writeBatch(db);
            const now = Timestamp.now();
            const newBalance = wallet.balance + approvedAmount;

            batch.update(doc(db, `clubs/${club!.id}/topupRequests`, requestId), {
                status: "approved", approvedAmount, resolvedAt: now, resolvedBy,
            });
            batch.update(doc(db, `clubs/${club!.id}/members/${req.memberId}/wallet`, "data"), { balance: newBalance, lastUpdated: now });

            const txId = "tx_" + Date.now();
            batch.set(doc(db, `clubs/${club!.id}/members/${req.memberId}/transactions`, txId), {
                id: txId, userId: req.memberId, clubId: club.id,
                type: "credit", amount: approvedAmount, reason: "topup",
                addedBy: resolvedBy, note: "Wallet topup", createdAt: now, balanceAfter: newBalance,
            } as WalletTransaction);

            // 🎯 Business Rule: First wallet top-up → promotes visiting members to permanent
            const memberSnap = await getDoc(doc(db, `clubs/${club!.id}/members`, req.memberId));
            if (memberSnap.exists()) {
                const memberData = memberSnap.data();
                if (memberData.isPermanent === false || memberData.memberType === "visiting") {
                    batch.update(doc(db, `clubs/${club!.id}/members`, req.memberId), {
                        isPermanent: true,
                        memberType: "permanent",
                        isActiveMember: true,
                        status: "active",
                        ...(!memberData.activatedAt && { activatedAt: now, activatedBy: "first_topup" }),
                        updatedAt: now,
                    });
                }
            }

            await batch.commit();
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner"] }),
    });
}

// ─── useRejectTopup ─────────────────────────────────────────────────────

export function useRejectTopup() {
    const qc = useQueryClient();
    const { club } = useClubContext();
    return useMutation({
        mutationFn: async ({ requestId, resolvedBy }: { requestId: string; resolvedBy: string }) => {
            await updateDoc(doc(db, `clubs/${club!.id}/topupRequests`, requestId), {
                status: "rejected", resolvedAt: Timestamp.now(), resolvedBy,
            });
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner"] }),
    });
}

// ─── useTopupHistory ────────────────────────────────────────────────────

export function useTopupHistory() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "topupHistory", club?.id],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${club!.id}/topupRequests`))
            );
            return snap.docs
                .map((d) => ({ id: d.id, ...d.data() }) as TopupRequest)
                .filter((r) => r.status !== "pending")
                .sort((a, b) => (b.resolvedAt?.toMillis?.() || 0) - (a.resolvedAt?.toMillis?.() || 0));
        },
        enabled: !!club,
    });
}

// ─── useDailyStats (real-time) ──────────────────────────────────────────
//
// Snapshots used:
//  - members          → lastVisit-based check-ins + 30-day active count
//  - orders (today)   → orders count + today's revenue (orders.totalCost)
//  - inventoryProducts→ low stock count (quantity <= lowStockThreshold)
//
// We deliberately do NOT use collectionGroup("attendance") here. That query
// requires a composite Firestore index that isn't reliably deployed and was
// silently returning empty — which is why every card was showing 0.
//
// Member check-in is sourced from `members.lastVisit === today` because
// Reception.tsx already updates that field after a successful face verify.

export function useDailyStats() {
    const { club } = useClubContext();
    const [stats, setStats] = useState({
        todayAttendance: 0,
        todayRevenue: 0,
        todayOrders: 0,
        totalActiveMembers: 0,
        lowStockCount: 0,
    });
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const td = today();

        // 30-day active threshold (YYYY-MM-DD string compare)
        const thirtyAgo = new Date();
        thirtyAgo.setDate(thirtyAgo.getDate() - 30);
        const thirtyAgoStr = thirtyAgo.toISOString().slice(0, 10);

        let membersDone = false, ordersDone = false, invDone = false;
        const checkLoaded = () => {
            if (membersDone && ordersDone && invDone) setIsLoading(false);
        };

        const unsubMembers = onSnapshot(
            collection(db, `clubs/${club.id}/members`),
            (snap) => {
                let checkedIn = 0, active = 0;
                snap.docs.forEach((d) => {
                    const m: any = d.data();
                    if (m.lastVisit === td) checkedIn++;
                    if (m.lastVisit && m.lastVisit >= thirtyAgoStr) active++;
                });
                setStats((s) => ({ ...s, todayAttendance: checkedIn, totalActiveMembers: active }));
                membersDone = true;
                checkLoaded();
            },
            () => { membersDone = true; checkLoaded(); }
        );

        const unsubOrders = onSnapshot(
            query(collection(db, `clubs/${club.id}/orders`), where("date", "==", td)),
            (snap) => {
                const revenue = snap.docs.reduce(
                    (sum, d) => sum + (((d.data() as Order).totalCost) || 0),
                    0
                );
                setStats((s) => ({ ...s, todayOrders: snap.size, todayRevenue: revenue }));
                ordersDone = true;
                checkLoaded();
            },
            () => { ordersDone = true; checkLoaded(); }
        );

        const unsubInv = onSnapshot(
            collection(db, `clubs/${club.id}/inventory`),
            (snap) => {
                const low = snap.docs.filter((d) => {
                    const p: any = d.data();
                    const qty = Number(p.quantity ?? 0);
                    const thr = Number(p.lowStockThreshold ?? 0);
                    return thr > 0 && qty <= thr;
                }).length;
                setStats((s) => ({ ...s, lowStockCount: low }));
                invDone = true;
                checkLoaded();
            },
            () => { invDone = true; checkLoaded(); }
        );

        return () => { unsubMembers(); unsubOrders(); unsubInv(); };
    }, [club]);

    return { data: stats, isLoading };
}

// ─── useDownlineClubs ───────────────────────────────────────────────────

export interface DownlineClub extends Club {
    memberCount: number;
    depth: number;
}

export function useDownlineClubs() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "downline", club?.id],
        queryFn: async () => {
            const snap = await getDocs(collection(db, "clubs"));
            const clubs = snap.docs
                .map((d) => ({ id: d.id, ...d.data() }) as Club)
                .filter((c) => c.id !== club!.id && !!c.treePath && !!club!.treePath && c.treePath.startsWith(club!.treePath + "/"));

            const enriched = await Promise.all(clubs.map(async (c) => {
                let memberCount = 0;
                try {
                    const memberSnap = await getDocs(collection(db, `clubs/${c.id}/members`));
                    memberCount = memberSnap.size;
                } catch { /* best-effort */ }
                const depth = (c.treePath?.split("/").length ?? 1) - (club!.treePath.split("/").length);
                return { ...c, memberCount, depth } as DownlineClub;
            }));

            enriched.sort((a, b) => a.treePath.localeCompare(b.treePath));
            return enriched;
        },
        enabled: !!club,
    });
}

// ─── useAnnouncements ───────────────────────────────────────────────────

export function useAnnouncements() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "announcements", club?.id],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${club!.id}/announcements`), orderBy("createdAt", "desc"))
            );
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Announcement);
        },
        enabled: !!club,
    });
}

// ─── useCreateAnnouncement ──────────────────────────────────────────────

export function useCreateAnnouncement() {
    const qc = useQueryClient();
    const { club } = useClubContext();
    return useMutation({
        mutationFn: async ({ title, message, expiresAt, postedBy }: {
            title: string; message: string; expiresAt?: Date | null; postedBy: string;
        }) => {
            if (!club) throw new Error("Club not loaded");
            const id = "ann_" + Date.now();
            await setDoc(doc(db, `clubs/${club.id}/announcements`, id), {
                id, clubId: club.id, title, message, postedBy,
                createdAt: Timestamp.now(),
                expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
                isActive: true,
            } as unknown as Announcement);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "announcements"] }),
    });
}

// ─── useDeleteAnnouncement ──────────────────────────────────────────────

export function useDeleteAnnouncement() {
    const qc = useQueryClient();
    const { club } = useClubContext();
    return useMutation({
        mutationFn: async (annId: string) => {
            await updateDoc(doc(db, `clubs/${club!.id}/announcements`, annId), { isActive: false });
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "announcements"] }),
    });
}

// ─── useTodaysSpecial ───────────────────────────────────────────────────

export function useTodaysSpecial() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "todaysSpecial", club?.id],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${club!.id}/menu`), where("isAvailableToday", "==", true))
            );
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product);
        },
        enabled: !!club,
    });
}

// ─── useAllProducts ─────────────────────────────────────────────────────

export function useAllProducts() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "products", club?.id],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${club!.id}/menu`))
            );
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product);
        },
        enabled: !!club,
    });
}

// ─── useSetTodaysSpecial ────────────────────────────────────────────────

export function useSetTodaysSpecial() {
    const qc = useQueryClient();
    const { club } = useClubContext();
    return useMutation({
        mutationFn: async (selectedIds: string[]) => {
            if (!club) throw new Error("Club not loaded");
            const allSnap = await getDocs(
                query(collection(db, `clubs/${club.id}/menu`))
            );
            const batch = writeBatch(db);
            allSnap.docs.forEach((d) => {
                batch.update(doc(db, `clubs/${club.id}/menu`, d.id), {
                    isAvailableToday: selectedIds.includes(d.id),
                });
            });
            await batch.commit();
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner"] }),
    });
}

// ─── useMemberWallet ────────────────────────────────────────────────────

export function useMemberWallet(memberId: string) {
    return useQuery({
        queryKey: ["owner", "wallet", memberId],
        queryFn: async () => {
            // Need to find which club this member belongs to
            const clubsSnap = await getDocs(collection(db, "clubs"));
            for (const clubDoc of clubsSnap.docs) {
                const snap = await getDoc(doc(db, `clubs/${clubDoc.id}/members/${memberId}/wallet`, "data"));
                if (snap.exists()) return snap.data() as Wallet;
            }
            return null;
        },
        enabled: !!memberId,
    });
}

// ─── useMemberTransactions ──────────────────────────────────────────────

export function useMemberTransactions(memberId: string) {
    return useQuery({
        queryKey: ["owner", "transactions", memberId],
        queryFn: async () => {
            const clubsSnap = await getDocs(collection(db, "clubs"));
            for (const clubDoc of clubsSnap.docs) {
                const memberSnap = await getDoc(doc(db, `clubs/${clubDoc.id}/members`, memberId));
                if (memberSnap.exists()) {
                    const snap = await getDocs(
                        query(collection(db, `clubs/${clubDoc.id}/members/${memberId}/transactions`))
                    );
                    return snap.docs
                        .map((d) => ({ id: d.id, ...d.data() }) as WalletTransaction)
                        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
                }
            }
            return [];
        },
        enabled: !!memberId,
    });
}

// ─── useMemberOrders ────────────────────────────────────────────────────

export function useMemberOrders(memberId: string) {
    return useQuery({
        queryKey: ["owner", "orders", memberId],
        queryFn: async () => {
            const clubsSnap = await getDocs(collection(db, "clubs"));
            for (const clubDoc of clubsSnap.docs) {
                const snap = await getDocs(
                    query(collection(db, `clubs/${clubDoc.id}/orders`), where("memberId", "==", memberId))
                );
                if (!snap.empty) {
                    return snap.docs
                        .map((d) => ({ id: d.id, ...d.data() }) as Order)
                        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
                }
            }
            return [];
        },
        enabled: !!memberId,
    });
}

// ─── useMemberWeightLog ─────────────────────────────────────────────────

export function useMemberWeightLog(memberId: string) {
    return useQuery({
        queryKey: ["owner", "weightLog", memberId],
        queryFn: async () => {
            const clubsSnap = await getDocs(collection(db, "clubs"));
            for (const clubDoc of clubsSnap.docs) {
                const memberSnap = await getDoc(doc(db, `clubs/${clubDoc.id}/members`, memberId));
                if (memberSnap.exists()) {
                    const snap = await getDocs(collection(db, `clubs/${clubDoc.id}/members/${memberId}/weighIns`));
                    return snap.docs
                        .map((d) => ({ id: d.id, ...d.data() }))
                        .sort((a: any, b: any) => (a.date?.toMillis?.() || 0) - (b.date?.toMillis?.() || 0));
                }
            }
            return [];
        },
        enabled: !!memberId,
    });
}

// ─── useAddWeightEntry ──────────────────────────────────────────────────

export function useAddWeightEntry() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ memberId, weight, notes }: { memberId: string; weight: number; notes?: string }) => {
            const clubsSnap = await getDocs(collection(db, "clubs"));
            for (const clubDoc of clubsSnap.docs) {
                const memberSnap = await getDoc(doc(db, `clubs/${clubDoc.id}/members`, memberId));
                if (memberSnap.exists()) {
                    const id = "wl_" + Date.now();
                    await setDoc(doc(db, `clubs/${clubDoc.id}/members/${memberId}/weighIns`, id), {
                        id, weight, date: Timestamp.now(), notes: notes || "",
                    });
                    return;
                }
            }
        },
        onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["owner", "weightLog", vars.memberId] }),
    });
}

// ─── useTodayAttendance (real-time, dashboard variant) ─────────────────
//
// Uses members.lastVisit === today as the source of truth instead of
// collectionGroup("attendance"), which requires a deployed composite index
// that wasn't reliably available. Returns Attendance-shaped records.

export function useTodayAttendance() {
    const { club } = useClubContext();
    const [data, setData] = useState<Attendance[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!club) return;
        const td = today();
        const unsub = onSnapshot(
            collection(db, `clubs/${club.id}/members`),
            (snap) => {
                const recs: Attendance[] = snap.docs
                    .filter((d) => (d.data() as any).lastVisit === td)
                    .map((d) => {
                        const m: any = d.data();
                        return {
                            id: d.id,
                            userId: d.id,
                            userName: m.name || "",
                            userPhoto: m.photo || m.photoUrl || "",
                            clubId: club.id,
                            type: "member",
                            checkInTime: m.lastVisitAt || Timestamp.now(),
                            checkOutTime: null,
                            hoursWorked: null,
                            checkInMethod: "face_recognition" as any,
                            date: td,
                        } as Attendance;
                    });
                setData(recs);
                setIsLoading(false);
            },
            () => setIsLoading(false)
        );
        return () => unsub();
    }, [club]);

    return { data, isLoading };
}

// ─── useMemberReferrals ───────────────────────────────────────────────────

export function useMemberReferrals(memberId: string) {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "referrals", memberId],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${club!.id}/referrals`), where("referrerId", "==", memberId))
            );

            const refs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Referral));

            const detailed = [];
            for (const r of refs) {
                const uSnap = await getDoc(doc(db, `clubs/${club!.id}/members`, r.referredId || ""));
                if (uSnap.exists()) {
                    detailed.push({
                        ...r,
                        referredUser: { id: uSnap.id, ...uSnap.data() } as User
                    });
                }
            }
            return detailed;
        },
        enabled: !!memberId && !!club?.id,
    });
}

// ─── useRecentOrders ────────────────────────────────────────────────────

export function useRecentOrders() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "recentOrders", club?.id],
        queryFn: async () => {
            // Fetch all orders and sort client-side to avoid composite index requirement
            const snap = await getDocs(
                query(collection(db, `clubs/${club!.id}/orders`))
            );
            const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order);
            orders.sort((a, b) => {
                const aTime = a.createdAt?.toMillis?.() || 0;
                const bTime = b.createdAt?.toMillis?.() || 0;
                return bTime - aTime;
            });
            return orders.slice(0, 5);
        },
        enabled: !!club,
    });
}

// ─── useAddVolunteer ────────────────────────────────────────────────────

export function useAddVolunteer() {
    const qc = useQueryClient();
    const { club } = useClubContext();
    return useMutation({
        mutationFn: async (input: { name: string; phone: string; email?: string; photo?: string }) => {
            if (!club) throw new Error("Club not loaded");
            const id = "staff_" + Date.now();
            const now = Timestamp.now();
            await setDoc(doc(db, `clubs/${club.id}/volunteers`, id), {
                id, name: input.name, phone: input.phone,
                email: input.email || "", photo: input.photo || "",
                role: "staff", clubId: club.id,
                parentUserId: null, treePath: id,
                shakeCredits: 0, shakeCreditsPlanTotal: 0,
                status: "active", dob: null, anniversary: null,
                qrCode: "", isClubOwner: false, ownedClubId: null,
                originalClubId: club.id, referredBy: null,
                createdAt: now, updatedAt: now,
            });
            return id;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "volunteers"] }),
    });
}

// ─── useUpdateClubSettings ──────────────────────────────────────────────

export function useUpdateClubSettings() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ clubId, data }: { clubId: string; data: Record<string, any> }) => {
            await updateDoc(doc(db, "clubs", clubId), data);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["owner"] }),
    });
}

// ─── useExpiringMembers ─────────────────────────────────────────────────

export function useExpiringMembers() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "expiring", club?.id],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${club!.id}/members`))
            );
            const sevenDaysFromNow = new Date(Date.now() + 7 * 86400000);
            return snap.docs
                .map((d) => ({ id: d.id, ...d.data() }) as User)
                .filter((u) => {
                    const credits = (u as any).shakeCredits ?? 0;
                    const total = (u as any).shakeCreditsPlanTotal ?? 0;
                    return total > 0 && credits > 0 && credits <= 3;
                });
        },
        enabled: !!club,
    });
}

// ─── useTodayVolunteerAttendance ────────────────────────────────────────

export function useTodayVolunteerAttendance() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "todayVolunteers", club?.id, today()],
        queryFn: async () => {
            const snap = await getDocs(
                query(
                    collection(db, `clubs/${club!.id}/volunteerAttendance`),
                    where("date", "==", today())
                )
            );
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as {
                id: string; memberId: string; memberName: string; memberPhoto: string;
                loginTime: any; logoutTime: any; date: string; status: string; clubId: string;
            }));
        },
        enabled: !!club,
    });
}

// ─── useLowStockProducts ───────────────────────────────────────────────

export function useLowStockProducts() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["owner", "lowStock", club?.id],
        queryFn: async () => {
            const snap = await getDocs(
                query(collection(db, `clubs/${club!.id}/menu`))
            );
            return snap.docs
                .map((d) => ({ id: d.id, ...d.data() }) as Product)
                .filter((p) => p.stock <= p.lowStockThreshold);
        },
        enabled: !!club,
    });
}

// ─── useManualPaymentEntry ───────────────────────────────────────────────
// Records a missed payment (plan purchase or one-day shake) via audit entry.
// Writes directly to payments + member credits — same pattern as real-time flow.

export interface ManualPaymentEntryInput {
    memberId: string;
    memberName: string;
    memberPhoto: string;
    amount: number;
    paymentMethod: "cash" | "upi" | "split";
    cashAmount?: number;
    upiAmount?: number;
    upiAccountId?: string;
    upiAccountName?: string;
    upiApp?: string;
    upiNumber?: string;
    upiHolderName?: string;
    recordedBy: string;
    // Plan purchase:
    planId?: string;
    // One-day shake:
    shakeName?: string;
    shakeItemId?: string;
}

export function useManualPaymentEntry() {
    const qc = useQueryClient();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (input: ManualPaymentEntryInput): Promise<{ tokenNumber?: string }> => {
            if (!club) throw new Error("Club not loaded");
            const now = Timestamp.now();
            const todayStr = new Date().toISOString().split('T')[0];
            const batch = writeBatch(db);
            let tokenNumber: string | undefined;

            const upiFields: Record<string, string> = {};
            if ((input.paymentMethod === 'upi' || input.paymentMethod === 'split') && input.upiAccountId) {
                upiFields.upiAccountId = input.upiAccountId;
                if (input.upiAccountName) upiFields.upiAccountName = input.upiAccountName;
                if (input.upiApp) upiFields.upiApp = input.upiApp;
                if (input.upiNumber) upiFields.upiNumber = input.upiNumber;
                if (input.upiHolderName) upiFields.upiHolderName = input.upiHolderName;
            }
            // Persist split breakdown alongside the single paymentMethod field
            // so daily-total queries always know how much landed in each tender.
            // Shared rule: the parts must equal the whole.
            const ownerTender = normalizeTender(input.amount, input.paymentMethod, input.cashAmount, input.upiAmount);
            const splitFields = {
                cashAmount: ownerTender.cashAmount,
                upiAmount: ownerTender.upiAmount,
            };
            const payDesc = input.paymentMethod === 'split'
                ? `(Split: Cash Rs.${input.cashAmount ?? 0} + UPI Rs.${input.upiAmount ?? 0}) — audit by ${input.recordedBy}`
                : input.paymentMethod === 'upi' && input.upiApp
                    ? `(UPI: ${input.upiApp} ${input.upiNumber}) — audit by ${input.recordedBy}`
                    : `(Cash) — audit by ${input.recordedBy}`;

            if (input.planId) {
                // ── Plan purchase ──
                const planSnap = await getDoc(doc(db, `clubs/${club.id}/memberships`, input.planId));
                if (!planSnap.exists()) throw new Error("Plan not found");
                const plan = planSnap.data() as MembershipPlan;
                const visits = planCreditsOf(plan);

                // Read current credits to (a) cap the denominator and (b) tag
                // the payment/transaction as Lucky-Dip-eligible if the member
                // still has ≥1 credit at renewal time AND the plan is opted
                // in via its `luckyDipEligible` flag.
                const memSnap = await getDoc(doc(db, `clubs/${club.id}/members`, input.memberId));
                const currentCredits = Number(memSnap.data()?.shakeCredits) || 0;
                const newPlanTotal = currentCredits + visits;
                const wasLuckyDipEligible = currentCredits >= 1 && (plan as any).luckyDipEligible === true;

                // Payment record
                const payRef = doc(collection(db, `clubs/${club.id}/payments`));
                batch.set(payRef, {
                    type: 'plan_purchase',
                    memberId: input.memberId,
                    memberName: input.memberName,
                    amount: plan.price || 0,
                    paymentMethod: input.paymentMethod,
                    ...splitFields,
                    ...upiFields,
                    description: `${plan.name} plan ${payDesc}`,
                    planName: plan.name,
                    source: 'audit',
                    date: todayStr,
                    creditsBeforeRenewal: currentCredits,
                    wasLuckyDipEligible,
                    createdAt: now,
                });

                // Transaction record
                const txRef = doc(collection(db, `clubs/${club.id}/members/${input.memberId}/transactions`));
                batch.set(txRef, {
                    type: 'credit',
                    amount: plan.price || 0,
                    reason: 'plan_purchase',
                    description: `${plan.name} plan ${payDesc}`,
                    creditsAdded: visits,
                    creditsBeforeRenewal: currentCredits,
                    wasLuckyDipEligible,
                    createdAt: now,
                });

                // Update member — capped denominator
                batch.update(doc(db, `clubs/${club.id}/members`, input.memberId), {
                    status: 'active',
                    isActiveMember: true,
                    isPermanent: true,
                    shakeCredits: newPlanTotal,
                    shakeCreditsPlanTotal: newPlanTotal,
                    updatedAt: now,
                });
            } else if (input.shakeName) {
                // ── One-day shake ──
                // Allocate a sequential token number so the kitchen card and
                // the printed slip share the same identifier — matches
                // proceedShakeCheckout in Reception.tsx.
                tokenNumber = await getNextOrderNumber(club.id);

                const payRef = doc(collection(db, `clubs/${club.id}/payments`));
                batch.set(payRef, {
                    type: 'oneday_shake',
                    memberId: input.memberId,
                    memberName: input.memberName,
                    amount: input.amount,
                    paymentMethod: input.paymentMethod,
                    ...splitFields,
                    ...upiFields,
                    description: `One-day shake: ${input.shakeName} ${payDesc}`,
                    shakeName: input.shakeName,
                    tokenNumber,
                    source: 'audit',
                    date: todayStr,
                    createdAt: now,
                });

                const orderRef = doc(collection(db, `clubs/${club.id}/orders`));
                batch.set(orderRef, {
                    memberId: input.memberId,
                    memberName: input.memberName,
                    memberPhoto: input.memberPhoto || '',
                    items: [{
                        productId: input.shakeItemId || '',
                        itemName: input.shakeName,
                        productName: input.shakeName,
                        qty: 1,
                        quantity: 1,
                        price: input.amount,
                        pricePerUnit: input.amount,
                        notes: '',
                    }],
                    totalAmount: input.amount,
                    totalCost: input.amount,
                    status: 'pending',
                    source: 'audit',
                    paymentMethod: `oneday_${input.paymentMethod}`,
                    verifiedBy: input.recordedBy,
                    tokenNumber,
                    date: todayStr,
                    clubId: club.id,
                    createdAt: now,
                });

                // Transaction record
                const txRef = doc(collection(db, `clubs/${club.id}/members/${input.memberId}/transactions`));
                batch.set(txRef, {
                    type: 'debit',
                    amount: input.amount,
                    reason: 'oneday_shake',
                    description: `One-day shake: ${input.shakeName} ${payDesc}`,
                    createdAt: now,
                });
            }

            await batch.commit();
            return { tokenNumber };
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["owner"] });
            qc.invalidateQueries({ queryKey: ["todayReport"] });
        },
    });
}
