import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    doc,
    getDoc,
    getDocs,
    collection,
    query,
    where,
    updateDoc,
    increment,
    setDoc,
    Timestamp,
} from "firebase/firestore";
import { ref, listAll, getMetadata } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type { UsageStats } from "@/types/firestore";

// ─── Cost constants (INR, no free tier) ─────────────────────────────────

const USD_TO_INR = 84;
// Firestore reads: $0.06 per 100k = ₹0.0000504 per read
const READ_COST_INR = 0.06 / 100_000 * USD_TO_INR;
// Firestore writes: $0.18 per 100k = ₹0.0001512 per write
const WRITE_COST_INR = 0.18 / 100_000 * USD_TO_INR;
// Storage: $0.108 per GB/month = ₹9.072 per GB/month
const STORAGE_COST_GB_INR = 0.108 * USD_TO_INR;

// Legacy USD constants (kept for backward compat in explainer UI)
const STORAGE_COST_PER_GB = 0.108;
const READS_COST_PER_100K = 0.06;
const WRITES_COST_PER_100K = 0.18;

// ─── useClubStorageUsage ─────────────────────────────────────────────────

export function useClubStorageUsage(clubId: string) {
    return useQuery({
        queryKey: ["superadmin", "storage", clubId],
        queryFn: async () => {
            const rootRef = ref(storage, `clubs/${clubId}`);
            const allFiles: { name: string; size: number; path: string }[] = [];

            async function listRecursive(folderRef: ReturnType<typeof ref>) {
                const result = await listAll(folderRef);
                await Promise.all(
                    result.items.map(async (itemRef) => {
                        const meta = await getMetadata(itemRef);
                        allFiles.push({
                            name: itemRef.name,
                            size: meta.size ?? 0,
                            path: itemRef.fullPath,
                        });
                    })
                );
                await Promise.all(
                    result.prefixes.map((prefix) => listRecursive(prefix))
                );
            }

            try {
                await listRecursive(rootRef);
            } catch {
                // Storage path might not exist yet — return empty
            }

            const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0);
            const totalMB = totalBytes / (1024 * 1024);

            return { files: allFiles, totalMB, totalBytes };
        },
        enabled: !!clubId,
    });
}

// ─── useClubCostEstimate ─────────────────────────────────────────────────
// Estimates monthly Firebase cost from actual collection sizes.
// No free-tier offset — full cost as if everything is paid.

export function useClubCostEstimate(clubId: string) {
    const storageQuery = useClubStorageUsage(clubId);

    const estimateQuery = useQuery({
        queryKey: ["superadmin", "usageEstimate", clubId],
        queryFn: async () => {
            const monthStart = Timestamp.fromDate(
                new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            );

            const [membersSnap, ordersSnap, announcementsSnap, topupSnap] = await Promise.all([
                getDocs(collection(db, "clubs", clubId, "members")),
                getDocs(query(
                    collection(db, "clubs", clubId, "orders"),
                    where("createdAt", ">=", monthStart)
                )),
                getDocs(collection(db, "clubs", clubId, "announcements")),
                getDocs(collection(db, "clubs", clubId, "topupRequests")),
            ]);

            const memberCount   = membersSnap.size;
            const orderCount    = ordersSnap.size;
            const announcCount  = announcementsSnap.size;

            // Monthly read estimate
            const memberAppReads  = memberCount * 2 * 5 * 30; // 2 sessions/day × 5 reads × 30 days
            const ownerReads      = 10 * 8 * 30;              // owner 10x/day × 8 reads
            const kitchenReads    = 50 * 30;                  // kitchen live orders
            const receptionReads  = 20 * 30;                  // reception check-ins
            const announcReads    = memberCount * announcCount * 2;
            const totalMonthlyReads = memberAppReads + ownerReads + kitchenReads + receptionReads + announcReads;

            // Monthly write estimate
            const orderWrites       = orderCount * 3;         // order + wallet + transaction
            const attendanceWrites  = memberCount * 0.7 * 30; // 70% attendance rate
            const topupWrites       = topupSnap.size * 3;
            const miscWrites        = memberCount * 5;
            const totalMonthlyWrites = orderWrites + attendanceWrites + topupWrites + miscWrites;

            // Storage estimate from doc sizes (KB → GB)
            const estimatedStorageGB = (
                (memberCount * 2) + (orderCount * 1) + (memberCount * orderCount * 0.5)
            ) / (1024 * 1024);

            return { memberCount, orderCount, totalMonthlyReads, totalMonthlyWrites, estimatedStorageGB };
        },
        enabled: !!clubId,
    });

    const est = estimateQuery.data;
    const realStorageMB = storageQuery.data?.totalMB ?? 0;
    const realStorageGB = realStorageMB / 1024;
    // Use real storage if available, else fall back to estimate
    const storageGB = realStorageGB > 0 ? realStorageGB : (est?.estimatedStorageGB ?? 0);

    const readCostINR    = (est?.totalMonthlyReads ?? 0) * READ_COST_INR;
    const writeCostINR   = (est?.totalMonthlyWrites ?? 0) * WRITE_COST_INR;
    const storageCostINR = storageGB * STORAGE_COST_GB_INR;
    const totalCostINR   = readCostINR + writeCostINR + storageCostINR;

    return {
        memberCount:         est?.memberCount ?? 0,
        orderCount:          est?.orderCount ?? 0,
        totalMonthlyReads:   Math.round(est?.totalMonthlyReads ?? 0),
        totalMonthlyWrites:  Math.round(est?.totalMonthlyWrites ?? 0),
        storageMB:           parseFloat(realStorageMB.toFixed(2)),
        storageGB:           parseFloat(storageGB.toFixed(4)),
        readCostINR:         parseFloat(readCostINR.toFixed(2)),
        writeCostINR:        parseFloat(writeCostINR.toFixed(2)),
        storageCostINR:      parseFloat(storageCostINR.toFixed(2)),
        totalCostINR:        parseFloat(totalCostINR.toFixed(2)),
        isLoading:           storageQuery.isLoading || estimateQuery.isLoading,
        constants: { USD_TO_INR, STORAGE_COST_PER_GB, READS_COST_PER_100K, WRITES_COST_PER_100K },
    };
}

// ─── incrementUsage ──────────────────────────────────────────────────────

export async function incrementUsage(clubId: string, type: "read" | "write") {
    const statsRef = doc(db, "clubs", clubId, "usageStats", "counters");
    try {
        await updateDoc(statsRef, {
            [type === "read" ? "reads" : "writes"]: increment(1),
            lastUpdated: Timestamp.now(),
        });
    } catch {
        // Doc might not exist yet — create it
        await setDoc(
            statsRef,
            {
                reads: type === "read" ? 1 : 0,
                writes: type === "write" ? 1 : 0,
                lastUpdated: Timestamp.now(),
            },
            { merge: true }
        );
    }
}
