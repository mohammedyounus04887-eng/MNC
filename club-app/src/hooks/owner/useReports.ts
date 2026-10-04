import { useQuery } from "@tanstack/react-query";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order, Attendance, User } from "@/types/firestore";

export function useRevenueReport(clubId: string | null, startDate: string, endDate: string) {
    return useQuery({
        queryKey: ["owner-revenue-report", clubId, startDate, endDate],
        enabled: !!clubId && !!startDate && !!endDate,
        queryFn: async () => {
            const q = query(
                collection(db, `clubs/${clubId}/orders`),
                where("date", ">=", startDate),
                where("date", "<=", endDate),
                orderBy("date")
            );
            const snap = await getDocs(q);
            const orders = snap.docs.map(d => ({ id: d.id, ...d.data() } as Order));

            const totalRevenue = orders.reduce((sum, o) => sum + o.totalCost, 0);

            // Daily breakdown
            const dailyMap = new Map<string, number>();
            orders.forEach(o => {
                dailyMap.set(o.date, (dailyMap.get(o.date) || 0) + o.totalCost);
            });
            const dailyRevenue = Array.from(dailyMap.entries()).map(([date, revenue]) => ({ date, revenue }));

            // Top items
            const itemMap = new Map<string, { name: string; count: number; revenue: number }>();
            orders.forEach(o => {
                o.items.forEach(item => {
                    const existing = itemMap.get(item.productName) || { name: item.productName, count: 0, revenue: 0 };
                    existing.count += item.quantity;
                    existing.revenue += item.pricePerUnit * item.quantity;
                    itemMap.set(item.productName, existing);
                });
            });
            const topItems = Array.from(itemMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

            return { totalRevenue, dailyRevenue, topItems, totalOrders: orders.length };
        },
    });
}

export function useAttendanceReport(clubId: string | null, startDate: string, endDate: string) {
    return useQuery({
        queryKey: ["owner-attendance-report", clubId, startDate, endDate],
        enabled: !!clubId && !!startDate && !!endDate,
        queryFn: async () => {
            const membersQ = query(collection(db, `clubs/${clubId}/members`));
            const memberSnap = await getDocs(membersQ);

            let records: Attendance[] = [];
            for (const memberDoc of memberSnap.docs) {
                const q = query(
                    collection(db, `clubs/${clubId}/members/${memberDoc.id}/attendance`),
                    where("date", ">=", startDate),
                    where("date", "<=", endDate),
                    orderBy("date")
                );
                const aSnap = await getDocs(q);
                for (const d of aSnap.docs) {
                    records.push({ id: d.id, ...d.data() } as Attendance);
                }
            }

            // Daily counts
            const dailyMap = new Map<string, number>();
            records.forEach(r => {
                dailyMap.set(r.date, (dailyMap.get(r.date) || 0) + 1);
            });
            const dailyAttendance = Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count }));

            // Most consistent members
            const memberMap = new Map<string, { name: string; count: number }>();
            records.forEach(r => {
                const existing = memberMap.get(r.userId) || { name: r.userName, count: 0 };
                existing.count += 1;
                memberMap.set(r.userId, existing);
            });
            const topMembers = Array.from(memberMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);

            return { totalRecords: records.length, dailyAttendance, topMembers };
        },
    });
}

export function useMemberReport(clubId: string | null) {
    return useQuery({
        queryKey: ["owner-member-report", clubId],
        enabled: !!clubId,
        queryFn: async () => {
            const q = query(collection(db, `clubs/${clubId}/members`));
            const snap = await getDocs(q);
            const members = snap.docs.map(d => ({ id: d.id, ...d.data() } as User));

            const now = new Date();
            const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

            const newThisMonth = members.filter(m => m.createdAt?.toDate?.().toISOString().startsWith(thisMonth)).length;

            const lowCreditsMembers = members.filter(m => {
                const credits = (m as any).shakeCredits ?? 0;
                const total = (m as any).shakeCreditsPlanTotal ?? 0;
                return total > 0 && credits > 0 && credits <= 3;
            });

            return {
                totalMembers: members.length,
                activeMembers: members.filter(m => m.status === "active").length,
                newThisMonth,
                expiringThisMonth: lowCreditsMembers.length,
                expiredMembers: members.filter(m => m.status === "expired").length,
            };
        },
    });
}
