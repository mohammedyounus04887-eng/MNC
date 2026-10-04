import { useQuery } from "@tanstack/react-query";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Attendance } from "@/types/firestore";

export function useMyAttendance(memberId: string | null, clubId: string | null) {
    return useQuery({
        queryKey: ["member-attendance", memberId, clubId],
        enabled: !!memberId && !!clubId,
        queryFn: async () => {
            const q = query(collection(db, `clubs/${clubId}/members/${memberId}/attendance`), orderBy("date", "desc"));
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as Attendance));
        },
    });
}

export function computeAttendanceStats(records: Attendance[]) {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const thisMonthCount = records.filter(r => r.date.startsWith(thisMonth)).length;
    const allTimeCount = records.length;

    // Streak: Sundays are rest days — skip them
    const dateSet = new Set(records.map(r => r.date));
    const toStr = (d: Date) => d.toISOString().split("T")[0];
    const isSun = (d: Date) => d.getDay() === 0;

    const checkDate = new Date(now);
    checkDate.setHours(0, 0, 0, 0);
    if (isSun(checkDate)) checkDate.setDate(checkDate.getDate() - 1);
    if (!dateSet.has(toStr(checkDate))) {
        checkDate.setDate(checkDate.getDate() - 1);
        if (isSun(checkDate)) checkDate.setDate(checkDate.getDate() - 1);
    }

    let streak = 0;
    for (let i = 0; i < 400; i++) {
        if (isSun(checkDate)) { checkDate.setDate(checkDate.getDate() - 1); continue; }
        if (dateSet.has(toStr(checkDate))) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else break;
    }

    return { thisMonthCount, allTimeCount, streak };
}
