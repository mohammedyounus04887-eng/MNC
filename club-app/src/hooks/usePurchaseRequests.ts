import { toDateSafe } from "@/lib/toDateSafe";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection, doc, addDoc, getDoc, getDocs, onSnapshot, setDoc, updateDoc,
    query, where, orderBy, serverTimestamp, Timestamp, increment, writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import { addPaymentToBatch } from "@/lib/recordPayment";
import type { PurchaseRequest, PurchaseRequestItem } from "@/types/firestore";

// ─── Reception: real-time list of pending purchase requests ─────────────

export function usePendingPurchaseRequests(clubId: string | null) {
    const [requests, setRequests] = useState<PurchaseRequest[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) { setLoading(false); return; }
        const q = query(
            collection(db, `clubs/${clubId}/purchaseRequests`),
            where("status", "==", "pending"),
            orderBy("createdAt", "asc"),
        );
        const unsub = onSnapshot(
            q,
            (snap) => {
                setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseRequest)));
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => unsub();
    }, [clubId]);

    return { requests, count: requests.length, loading };
}

// ─── Member: my own pending purchase request (real-time, singular) ─────

export function useMyPendingPurchaseRequest() {
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();
    const [pendingRequest, setPendingRequest] = useState<PurchaseRequest | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const memberId = userProfile?.id ?? firebaseUser?.uid;
        if (!memberId || !club) return;
        const q = query(
            collection(db, `clubs/${club.id}/purchaseRequests`),
            where("memberId", "==", memberId),
            where("status", "==", "pending"),
        );
        const unsub = onSnapshot(q, (snap) => {
            setPendingRequest(
                snap.docs.length > 0
                    ? ({ id: snap.docs[0].id, ...snap.docs[0].data() } as PurchaseRequest)
                    : null,
            );
            setLoading(false);
        });
        return () => unsub();
    }, [firebaseUser, userProfile?.id, club]);

    return { pendingRequest, hasPending: !!pendingRequest, loading };
}

// ─── Member: submit a new purchase request ─────────────────────────────

export function useSubmitPurchaseRequest() {
    const qc = useQueryClient();
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();

    return useMutation({
        mutationFn: async (data: { items: PurchaseRequestItem[]; notes?: string }) => {
            if (!firebaseUser || !userProfile || !club) throw new Error("Not ready");
            if (!data.items.length) throw new Error("Select at least one item");
            const memberId = userProfile.id ?? firebaseUser.uid;

            // Block multiple pending requests
            const existing = await getDocs(
                query(
                    collection(db, `clubs/${club.id}/purchaseRequests`),
                    where("memberId", "==", memberId),
                    where("status", "==", "pending"),
                ),
            );
            if (existing.size > 0) {
                throw new Error("You already have a pending purchase request");
            }

            const totalAmount = data.items.reduce((sum, item) => {
                if (item.type === "membership") return sum + item.price;
                if (item.type === "wallet_topup") return sum + item.amount;
                if (item.type === "product") return sum + item.totalPrice;
                return sum;
            }, 0);

            const id = "preq_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
            const payload: PurchaseRequest = {
                id,
                clubId: club.id,
                memberId,
                memberName: userProfile.name,
                memberPhoto: (userProfile as any).photo || "",
                items: data.items,
                totalAmount,
                notes: data.notes || "",
                status: "pending",
                createdAt: serverTimestamp() as any,
                resolvedAt: null,
                resolvedBy: null,
            };
            await setDoc(doc(db, `clubs/${club.id}/purchaseRequests`, id), payload);

            return { requestId: id, totalAmount, memberName: userProfile.name, memberId };
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["member", "purchaseRequests"] });
        },
    });
}

// ─── Member: cancel a pending purchase request ─────────────────────────

export function useCancelPurchaseRequest() {
    const { club } = useClubContext();
    return useMutation({
        mutationFn: async (requestId: string) => {
            if (!club) throw new Error("Club not loaded");
            await updateDoc(doc(db, `clubs/${club.id}/purchaseRequests`, requestId), {
                status: "cancelled",
                resolvedAt: serverTimestamp(),
                resolvedBy: "member",
            });
        },
    });
}

// ─── Reception: reject a request ───────────────────────────────────────

export function useRejectPurchaseRequest() {
    return useMutation({
        mutationFn: async (data: { clubId: string; requestId: string; reason?: string }) => {
            await updateDoc(doc(db, `clubs/${data.clubId}/purchaseRequests`, data.requestId), {
                status: "rejected",
                rejectionReason: data.reason ?? "",
                resolvedAt: Timestamp.now(),
                resolvedBy: "reception",
            });
        },
    });
}

// ─── Reception: fulfill a request (apply all items + mark fulfilled) ──

export function useFulfillPurchaseRequest() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (data: {
            request: PurchaseRequest;
            paymentMethod: "cash" | "upi" | "card";
            accountantVerifiedBy: string;
            accountantVerifiedById: string;
        }) => {
            const { request, paymentMethod, accountantVerifiedBy, accountantVerifiedById } = data;
            const { clubId, memberId, items } = request;
            const now = Timestamp.now();
            const today = new Date().toISOString().slice(0, 10);

            const receiptNumber = `PRQ-${Date.now().toString(36).toUpperCase()}`;

            // Read wallet snapshot to log accurate before/after balances
            const walletRef = doc(db, `clubs/${clubId}/members/${memberId}/wallet`, "data");
            const walletSnap = await getDoc(walletRef);
            const startBalance: number = walletSnap.exists() ? (walletSnap.data().balance ?? 0) : 0;

            // Read member doc to compute membership extension start date
            const memberRef = doc(db, `clubs/${clubId}/members`, memberId);
            const memberSnap = await getDoc(memberRef);
            const memberData = memberSnap.exists() ? memberSnap.data() : {};
            const currentMembershipEnd: Timestamp | null = (memberData as any).membershipEnd ?? null;

            // Wallet running balance during this batch — wallet_topup items
            // increase balance, but membership/product items in a purchase
            // request are paid in cash/UPI directly, NOT from wallet.
            let walletBalance = startBalance;

            const batch = writeBatch(db);

            // Process wallet_topup first so membership/product txns log accurate balances
            for (const item of items) {
                if (item.type !== "wallet_topup") continue;
                const before = walletBalance;
                walletBalance += item.amount;
                batch.set(doc(collection(db, `clubs/${clubId}/members/${memberId}/transactions`)), {
                    userId: memberId,
                    clubId,
                    type: "credit",
                    amount: item.amount,
                    reason: "topup",
                    description: "Wallet Top-up via Purchase Request",
                    paymentMethod,
                    addedBy: "reception",
                    balanceBefore: before,
                    balanceAfter: walletBalance,
                    purchaseRequestId: request.id,
                    createdAt: now,
                });
            }

            // Membership items
            let creditsAdded = 0;
            let membershipExtension: { startDate: Date; endDate: Date; planName: string } | null = null;
            for (const item of items) {
                if (item.type !== "membership") continue;
                creditsAdded += item.visits;

                const nowDate = new Date();
                let startDate: Date;
                if (membershipExtension) {
                    startDate = membershipExtension.endDate;
                } else if (toDateSafe(currentMembershipEnd)) {
                    // Same field, same reason as useMembership: two names, several
                    // writers, so it is the one most likely not to be a Timestamp.
                    const end = toDateSafe(currentMembershipEnd)!;
                    startDate = end > nowDate ? end : nowDate;
                } else {
                    startDate = nowDate;
                }
                const endDate = new Date(startDate.getTime() + item.durationDays * 24 * 60 * 60 * 1000);
                membershipExtension = { startDate, endDate, planName: item.planName };

                batch.set(doc(collection(db, `clubs/${clubId}/members/${memberId}/transactions`)), {
                    userId: memberId,
                    clubId,
                    type: "debit",
                    amount: item.price,
                    reason: "membership",
                    description: `${item.planName} Membership`,
                    planName: item.planName,
                    membershipFrom: Timestamp.fromDate(startDate),
                    membershipTo: Timestamp.fromDate(endDate),
                    paymentMethod,
                    addedBy: "reception",
                    purchaseRequestId: request.id,
                    createdAt: now,
                });
            }
            if (creditsAdded > 0) {
                // Capped denominator: shakeCreditsPlanTotal matches new total
                const currentCredits = Number((memberData as any).shakeCredits) || 0;
                const newPlanTotal = currentCredits + creditsAdded;
                // Lucky-Dip eligibility: member must hold ≥1 credit AND at least
                // one purchased plan in this request must be opted in via the
                // plan's `luckyDipEligible` flag.
                let anyEligiblePlan = false;
                for (const it of items) {
                    if (it.type !== "membership") continue;
                    try {
                        const ps = await getDoc(doc(db, `clubs/${clubId}/memberships`, (it as any).planId));
                        if (ps.exists() && (ps.data() as any).luckyDipEligible === true) {
                            anyEligiblePlan = true;
                            break;
                        }
                    } catch { /* ignore — treat as not eligible */ }
                }
                const wasLuckyDipEligible = currentCredits >= 1 && anyEligiblePlan;
                batch.update(memberRef, {
                    shakeCredits: newPlanTotal,
                    shakeCreditsPlanTotal: newPlanTotal,
                    updatedAt: now,
                    // Both expiry field names — see lib/membership.ts. Written
                    // under one name only, this renewal was invisible to the
                    // reception member panel.
                    ...(membershipExtension ? {
                        membershipEnd: Timestamp.fromDate(membershipExtension.endDate),
                        membershipEndDate: Timestamp.fromDate(membershipExtension.endDate),
                    } : {}),
                });
                // Tag the purchase request itself so the Awards page can find
                // it later without re-reading the member doc.
                batch.update(doc(db, `clubs/${clubId}/purchaseRequests`, request.id), {
                    creditsBeforeRenewal: currentCredits,
                    wasLuckyDipEligible,
                });
            }

            // Product items — deduct inventory + log productSale + transaction
            for (const item of items) {
                if (item.type !== "product") continue;

                const saleId = "ps_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
                batch.set(doc(db, `clubs/${clubId}/productSales`, saleId), {
                    id: saleId,
                    clubId,
                    productId: item.productId,
                    productName: item.productName,
                    quantity: item.quantity,
                    unit: item.unit,
                    price: item.unitPrice,
                    totalAmount: item.totalPrice,
                    buyerId: memberId,
                    buyerName: request.memberName,
                    isGift: false,
                    paymentMethod,
                    cashAmount: paymentMethod === "cash" ? item.totalPrice : 0,
                    upiAmount: paymentMethod === "upi" ? item.totalPrice : 0,
                    accountantVerifiedBy,
                    accountantVerifiedById,
                    inventoryVerifiedBy: accountantVerifiedBy,
                    inventoryVerifiedById: accountantVerifiedById,
                    purchaseRequestId: request.id,
                    date: today,
                    createdAt: now,
                });

                // Deduct inventory (we read product fresh per-item)
                const prodRef = doc(db, `clubs/${clubId}/inventory`, item.productId);
                const prodSnap = await getDoc(prodRef);
                if (prodSnap.exists()) {
                    const current = prodSnap.data().quantity ?? 0;
                    const newQty = Math.max(0, current - item.quantity);
                    batch.update(prodRef, { quantity: newQty, updatedAt: now });

                    const logId = "log_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
                    batch.set(doc(db, `clubs/${clubId}/inventoryLogs`, logId), {
                        id: logId,
                        clubId,
                        type: "product_sale",
                        productId: item.productId,
                        productName: item.productName,
                        quantityChange: -item.quantity,
                        quantityBefore: current,
                        quantityAfter: newQty,
                        referenceId: saleId,
                        performedBy: accountantVerifiedBy,
                        date: today,
                        createdAt: now,
                    });
                }

                batch.set(doc(collection(db, `clubs/${clubId}/members/${memberId}/transactions`)), {
                    userId: memberId,
                    clubId,
                    type: "debit",
                    amount: item.totalPrice,
                    reason: "product",
                    description: `Purchased: ${item.productName} x${item.quantity}`,
                    productSaleId: saleId,
                    productName: item.productName,
                    paymentMethod,
                    addedBy: "reception",
                    purchaseRequestId: request.id,
                    createdAt: now,
                });
            }

            // Update wallet doc once if topup happened
            if (walletBalance !== startBalance) {
                batch.update(walletRef, {
                    balance: walletBalance,
                    lastUpdated: serverTimestamp(),
                });
            }

            // ── Record the money ────────────────────────────────────────────
            // This flow used to write credits, membership dates, wallet and
            // productSales but NO payments doc, so a member buying a plan
            // through the app and paying cash at the desk showed up as zero
            // revenue in Today's Report and in Reports, while their credits
            // and expiry updated correctly. One payment per item, in the same
            // batch, so the money can never commit apart from what it bought.
            const payMethod: "cash" | "upi" = paymentMethod === "upi" ? "upi" : "cash";
            for (const item of items) {
                const amt =
                    item.type === "product" ? (item as any).totalPrice
                    : item.type === "membership" ? (item as any).price
                    : (item as any).amount;
                if (!amt || amt <= 0) continue;
                addPaymentToBatch(batch, {
                    clubId,
                    type:
                        item.type === "membership" ? "plan_purchase"
                        : item.type === "product" ? "product_sale"
                        : "wallet_topup",
                    amount: Number(amt),
                    method: payMethod,
                    memberId,
                    memberName: request.memberName,
                    ...(item.type === "membership"
                        ? {
                              planId: (item as any).planId,
                              planName: (item as any).planName,
                              creditsAdded: Number((item as any).visits) || 0,
                              description: `${(item as any).planName} membership`,
                          }
                        : item.type === "product"
                        ? { description: `${(item as any).productName} x${(item as any).quantity}` }
                        : { description: "Wallet top-up" }),
                    source: "member_app_request",
                    referenceId: request.id,
                });
            }

            // Mark request fulfilled
            batch.update(doc(db, `clubs/${clubId}/purchaseRequests`, request.id), {
                status: "fulfilled",
                paymentMethod,
                accountantVerifiedBy,
                accountantVerifiedById,
                receiptNumber,
                resolvedAt: now,
                resolvedBy: "reception",
            });

            await batch.commit();

            return {
                receiptNumber,
                creditsAdded,
                membershipExtension,
                walletBalanceAfter: walletBalance,
            };
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ["owner-wallet", vars.request.memberId] });
            qc.invalidateQueries({ queryKey: ["member-transactions"] });
            qc.invalidateQueries({ queryKey: ["inventory-products"] });
        },
    });
}
