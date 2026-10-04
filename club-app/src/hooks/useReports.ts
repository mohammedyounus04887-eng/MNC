import { useQuery } from "@tanstack/react-query";
import { collection, query, where, getDocs, Timestamp, collectionGroup } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { format, startOfMonth, startOfDay, endOfDay, parseISO, eachDayOfInterval, isSameDay } from "date-fns";
import type { Order, WalletTransaction, Attendance, User } from "@/types/firestore";

// Helper for generating all dates in range
function getDatesInRange(startStr: string, endStr: string) {
    const start = parseISO(startStr);
    const end = parseISO(endStr);
    return eachDayOfInterval({ start, end });
}

export function useRevenueReport(startDate: string, endDate: string) {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["reports", "revenue", club?.id, startDate, endDate],
        queryFn: async () => {
            if (!club) throw new Error("Club not loaded");
            const startTimestamp = Timestamp.fromDate(startOfDay(parseISO(startDate)));
            const endTimestamp = Timestamp.fromDate(endOfDay(parseISO(endDate)));

            const snap = await getDocs(
                query(
                    collectionGroup(db, "transactions"),
                    where("clubId", "==", club.id),
                    where("type", "==", "debit"),
                    where("createdAt", ">=", startTimestamp),
                    where("createdAt", "<=", endTimestamp)
                )
            );

            const txs = snap.docs.map(d => d.data() as WalletTransaction);
            const dailyRevenue: Record<string, number> = {};
            const dates = getDatesInRange(startDate, endDate);

            dates.forEach(d => {
                dailyRevenue[format(d, "yyyy-MM-dd")] = 0;
            });

            txs.forEach(tx => {
                if (!tx.createdAt) return;
                const dList = format(tx.createdAt.toDate(), "yyyy-MM-dd");
                if (dailyRevenue[dList] !== undefined) {
                    dailyRevenue[dList] += tx.amount;
                }
            });

            const dailyArr = Object.entries(dailyRevenue).map(([date, amount]) => ({
                date,
                amount
            })).sort((a, b) => a.date.localeCompare(b.date));

            const totalRevenue = dailyArr.reduce((sum, d) => sum + d.amount, 0);
            const avgDaily = dailyArr.length > 0 ? totalRevenue / dailyArr.length : 0;
            const bestDayObj = dailyArr.reduce((prev, current) => (prev.amount > current.amount) ? prev : current, { date: "", amount: 0 });

            return {
                dailyRevenue: dailyArr,
                totalRevenue,
                avgDaily,
                bestDay: bestDayObj.amount > 0 ? bestDayObj.date : "-"
            };
        },
        enabled: !!club && !!startDate && !!endDate,
    });
}

export function useMemberGrowthReport(startDate: string, endDate: string) {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["reports", "memberGrowth", club?.id, startDate, endDate],
        queryFn: async () => {
            if (!club) throw new Error("Club not loaded");
            const startTimestamp = Timestamp.fromDate(startOfDay(parseISO(startDate)));
            const endTimestamp = Timestamp.fromDate(endOfDay(parseISO(endDate)));

            const snap = await getDocs(
                query(
                    collection(db, `clubs/${club.id}/members`),
                    where("createdAt", ">=", startTimestamp),
                    where("createdAt", "<=", endTimestamp)
                )
            );

            const users = snap.docs.map(d => d.data() as User);
            const dailyJoins: Record<string, number> = {};
            const dates = getDatesInRange(startDate, endDate);

            dates.forEach(d => {
                dailyJoins[format(d, "yyyy-MM-dd")] = 0;
            });

            users.forEach(u => {
                if (!u.createdAt) return;
                const dList = format(u.createdAt.toDate(), "yyyy-MM-dd");
                if (dailyJoins[dList] !== undefined) {
                    dailyJoins[dList] += 1;
                }
            });

            const dailyArr = Object.entries(dailyJoins).map(([date, count]) => ({
                date,
                count
            })).sort((a, b) => a.date.localeCompare(b.date));

            const totalNewMembers = dailyArr.reduce((sum, d) => sum + d.count, 0);

            return {
                dailyJoins: dailyArr,
                totalNewMembers
            };
        },
        enabled: !!club && !!startDate && !!endDate,
    });
}

export function useAttendanceReport(startDate: string, endDate: string) {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["reports", "attendance", club?.id, startDate, endDate],
        queryFn: async () => {
            if (!club) throw new Error("Club not loaded");

            const snap = await getDocs(
                query(
                    collectionGroup(db, "attendance"),
                    where("clubId", "==", club.id),
                    where("type", "==", "member"),
                    where("date", ">=", startDate),
                    where("date", "<=", endDate)
                )
            );

            const allMembersSnap = await getDocs(
                query(collection(db, `clubs/${club.id}/members`), where("status", "==", "active"))
            );
            const totalActiveMembers = allMembersSnap.size || 1;

            const records = snap.docs.map(d => d.data() as Attendance);
            const dailyAttendance: Record<string, number> = {};
            const dates = getDatesInRange(startDate, endDate);

            dates.forEach(d => {
                dailyAttendance[format(d, "yyyy-MM-dd")] = 0;
            });

            records.forEach(r => {
                if (dailyAttendance[r.date] !== undefined) {
                    dailyAttendance[r.date] += 1;
                }
            });

            const dailyArr = Object.entries(dailyAttendance).map(([date, count]) => ({
                date,
                count
            })).sort((a, b) => a.date.localeCompare(b.date));

            const totalAtt = dailyArr.reduce((sum, d) => sum + d.count, 0);
            const avgDaily = dailyArr.length > 0 ? totalAtt / dailyArr.length : 0;
            const bestDayObj = dailyArr.reduce((prev, current) => (prev.count > current.count) ? prev : current, { date: "", count: 0 });

            const attendanceRate = totalActiveMembers > 0 ? (avgDaily / totalActiveMembers) * 100 : 0;

            return {
                dailyAttendance: dailyArr,
                avgDaily,
                bestDay: bestDayObj.count > 0 ? bestDayObj.date : "-",
                attendanceRate,
                totalActiveMembers
            };
        },
        enabled: !!club && !!startDate && !!endDate,
    });
}

export function useProductUsageReport(startDate: string, endDate: string) {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["reports", "products", club?.id, startDate, endDate],
        queryFn: async () => {
            if (!club) throw new Error("Club not loaded");

            const snap = await getDocs(
                query(
                    collection(db, `clubs/${club.id}/orders`),
                    where("date", ">=", startDate),
                    where("date", "<=", endDate)
                )
            );

            const orders = snap.docs.map(d => d.data() as Order);
            const productsMap: Record<string, { totalQuantity: number, totalRevenue: number }> = {};

            orders.forEach(o => {
                o.items.forEach(item => {
                    if (!productsMap[item.productName]) {
                        productsMap[item.productName] = { totalQuantity: 0, totalRevenue: 0 };
                    }
                    productsMap[item.productName].totalQuantity += item.quantity;
                    productsMap[item.productName].totalRevenue += (item.pricePerUnit * item.quantity);
                });
            });

            const productUsage = Object.entries(productsMap).map(([productName, data]) => ({
                productName,
                totalQuantity: data.totalQuantity,
                totalRevenue: data.totalRevenue
            }));

            return { productUsage };
        },
        enabled: !!club && !!startDate && !!endDate,
    });
}

export function useVolunteerHoursReport(monthStr: string) { // monthStr format: "yyyy-MM"
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["reports", "volunteerHours", club?.id, monthStr],
        queryFn: async () => {
            if (!club) throw new Error("Club not loaded");

            const startDate = `${monthStr}-01`;
            const endDate = `${monthStr}-31`;

            const snap = await getDocs(
                query(
                    collection(db, `clubs/${club.id}/volunteers`),
                )
            );

            const allVols = snap.docs.map(d => ({ id: d.id, ...d.data() } as User));

            const attendanceSnap = await getDocs(
                query(
                    collectionGroup(db, "attendance"),
                    where("clubId", "==", club.id),
                    where("type", "==", "volunteer"),
                    where("date", ">=", startDate),
                    where("date", "<=", endDate)
                )
            );

            const records = attendanceSnap.docs.map(d => d.data() as Attendance);
            const volunteerMap: Record<string, { name: string, totalHours: number, daysWorked: number }> = {};

            records.forEach(r => {
                if (!r.checkInTime || !r.checkOutTime) return;
                const hours = (r.checkOutTime.toMillis() - r.checkInTime.toMillis()) / (1000 * 60 * 60);

                if (!volunteerMap[r.userId]) {
                    volunteerMap[r.userId] = {
                        name: r.userName || "Unknown",
                        totalHours: 0,
                        daysWorked: 0
                    };
                }

                volunteerMap[r.userId].totalHours += hours;
                volunteerMap[r.userId].daysWorked += 1;
            });

            const volunteerHours = Object.entries(volunteerMap).map(([id, data]) => ({
                volunteerId: id,
                ...data,
                totalHours: Math.round(data.totalHours * 10) / 10
            })).sort((a, b) => b.totalHours - a.totalHours);

            return { volunteerHours };
        },
        enabled: !!club && !!monthStr,
    });
}

export function useOverallSummary() {
    const { club } = useClubContext();
    return useQuery({
        queryKey: ["reports", "overallSummary", club?.id],
        queryFn: async () => {
            if (!club) throw new Error("Club not loaded");

            const startOfCurrMonth = startOfMonth(new Date());
            const startTimestamp = Timestamp.fromDate(startOfCurrMonth);
            const startMonthStr = format(startOfCurrMonth, "yyyy-MM-dd");

            const [membersSnap, activeMembersSnap, ordersSnap, revenueSnap, attendanceSnap] = await Promise.all([
                getDocs(query(collection(db, `clubs/${club.id}/members`))),
                getDocs(query(collection(db, `clubs/${club.id}/members`), where("status", "==", "active"))),
                getDocs(query(collection(db, `clubs/${club.id}/orders`), where("date", ">=", startMonthStr))),
                getDocs(query(collectionGroup(db, "transactions"), where("clubId", "==", club.id), where("type", "==", "debit"), where("createdAt", ">=", startTimestamp))),
                getDocs(query(collectionGroup(db, "attendance"), where("clubId", "==", club.id), where("type", "==", "member"), where("date", ">=", startMonthStr)))
            ]);

            const totalRevenueThisMonth = revenueSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);

            const totalMembers = membersSnap.size;
            const activeMembers = activeMembersSnap.size;
            const totalOrders = ordersSnap.size;

            // Avg daily attendance this month
            const attRecords = attendanceSnap.docs.map(d => d.data());
            const daysInMonthToDate = new Date().getDate(); // approximate days passed in this month
            const avgDailyAttendance = attRecords.length / daysInMonthToDate;

            return {
                totalMembers,
                activeMembers,
                totalRevenueThisMonth,
                totalOrdersThisMonth: totalOrders,
                avgDailyAttendanceThisMonth: avgDailyAttendance
            };
        },
        enabled: !!club,
        staleTime: 5 * 60 * 1000,
    });
}
