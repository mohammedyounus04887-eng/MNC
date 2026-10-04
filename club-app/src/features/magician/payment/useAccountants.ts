import { useEffect, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { MembershipPlan } from "@/types/firestore";
import type { UpiAccount } from "./types";

export interface AccountantVerifier {
    id: string;
    name: string;
    photo?: string;
    faceDescriptor?: number[];
    role?: string;
}

// ─── useAccountants ────────────────────────────────────────────────────
// Loads the club's accountants for the FaceVerification component.
// Same source the manual paid flows use (clubs/{cid}/accountants).
// Subscribes in realtime so newly enrolled accountants appear without
// a page reload.

export function useAccountants(clubId: string | null) {
    const [accountants, setAccountants] = useState<AccountantVerifier[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!clubId) { setAccountants([]); setLoading(false); return; }
        const unsub = onSnapshot(
            collection(db, `clubs/${clubId}/accountants`),
            (snap) => {
                setAccountants(snap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        name: data.name || "",
                        photo: data.photo || data.photoUrl || "",
                        faceDescriptor: data.faceDescriptor,
                        role: data.role,
                    };
                }));
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => unsub();
    }, [clubId]);

    return { accountants, loading };
}

// Membership plans (clubs/{cid}/memberships)
export function useMembershipPlansLive(clubId: string | null) {
    const [plans, setPlans] = useState<MembershipPlan[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId) { setPlans([]); setLoading(false); return; }
        const unsub = onSnapshot(
            collection(db, `clubs/${clubId}/memberships`),
            (snap) => {
                setPlans(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MembershipPlan));
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => unsub();
    }, [clubId]);
    return { plans, loading };
}

// Inventory products (clubs/{cid}/inventory) — live for product_sale intent
import type { InventoryProductLite } from "./types";
export function useInventoryProductsLive(clubId: string | null) {
    const [products, setProducts] = useState<InventoryProductLite[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!clubId) { setProducts([]); setLoading(false); return; }
        const unsub = onSnapshot(
            collection(db, `clubs/${clubId}/inventory`),
            (snap) => {
                setProducts(snap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        name: data.name || "",
                        unit: data.unit || "",
                        price: data.price ?? 0,
                        quantity: data.quantity ?? 0,
                        category: data.category,
                    } as InventoryProductLite;
                }));
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => unsub();
    }, [clubId]);
    return { products, loading };
}

// Inventory managers — separate role from accountants. Falls back to
// accountants if no managers are enrolled (mirrors SellProduct.tsx).
export function useInventoryManagers(clubId: string | null) {
    const [managers, setManagers] = useState<AccountantVerifier[]>([]);
    useEffect(() => {
        if (!clubId) { setManagers([]); return; }
        const unsub = onSnapshot(
            collection(db, `clubs/${clubId}/inventoryManagers`),
            (snap) => {
                setManagers(snap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        name: data.name || "",
                        photo: data.photo || data.photoUrl || "",
                        faceDescriptor: data.faceDescriptor,
                        role: data.role,
                    };
                }));
            },
        );
        return () => unsub();
    }, [clubId]);
    return managers;
}

// UPI accounts (stored as array on club doc)
export function useUpiAccounts(clubId: string | null) {
    const [accounts, setAccounts] = useState<UpiAccount[]>([]);
    useEffect(() => {
        if (!clubId) { setAccounts([]); return; }
        const unsub = onSnapshot(doc(db, "clubs", clubId), (snap) => {
            const data = snap.data() as any;
            setAccounts((data?.upiAccounts ?? []) as UpiAccount[]);
        });
        return () => unsub();
    }, [clubId]);
    return accounts;
}
