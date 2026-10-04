import { useState, useMemo } from "react";
import {
    CalendarCheck,
    List,
    ChevronLeft,
    ChevronRight,
    Scale,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { collection, query, getDocs, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import type { Attendance } from "@/types/firestore";
import { getNextWeighIn } from "@/utils/getNextWeighIn";
import {
    addMonths,
    subMonths,
    startOfMonth,
    endOfMonth,
    eachDayOfInterval,
    format,
    isSameDay,
    parseISO,
} from "date-fns";

const GREEN = "#2d9653";
const BG = "#f8fffe";

function isSunday(date: Date): boolean {
    return date.getDay() === 0;
}

function computeStreak(records: Attendance[]): number {
    const dateSet = new Set(records.map((r) => r.date));
    const toStr = (d: Date) => d.toISOString().split("T")[0];

    const checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);

    // Start from Saturday if today is Sunday
    if (isSunday(checkDate)) checkDate.setDate(checkDate.getDate() - 1);

    // If that day has no attendance, step back one more (skip another Sunday if needed)
    if (!dateSet.has(toStr(checkDate))) {
        checkDate.setDate(checkDate.getDate() - 1);
        if (isSunday(checkDate)) checkDate.setDate(checkDate.getDate() - 1);
    }

    let streak = 0;
    for (let i = 0; i < 400; i++) {
        if (isSunday(checkDate)) { checkDate.setDate(checkDate.getDate() - 1); continue; }
        if (dateSet.has(toStr(checkDate))) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else break;
    }
    return streak;
}

export default function MemberAttendancePage() {
    const { userProfile } = useAuth();
    const { club } = useClubContext();
    const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
    const [displayMonth, setDisplayMonth] = useState(() => new Date());

    const { data: attendance = [], isLoading } = useQuery({
        queryKey: ["member-attendance", userProfile?.id, club?.id],
        enabled: !!userProfile?.id && !!club?.id,
        queryFn: async () => {
            const q = query(
                collection(db, `clubs/${club!.id}/members/${userProfile!.id}/attendance`),
                orderBy("date", "desc")
            );
            const snap = await getDocs(q);
            return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Attendance));
        },
    });

    const attendanceByDate = new Set(attendance.map((a) => a.date));
    const now = new Date();
    const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const thisMonthCount = attendance.filter((r) => r.date.startsWith(thisMonthStr)).length;
    const streak = useMemo(() => computeStreak(attendance), [attendance]);
    const allTimeCount = attendance.length;

    const monthStart = startOfMonth(displayMonth);
    const monthEnd = endOfMonth(displayMonth);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const firstDayOfWeek = monthStart.getDay();
    const paddingDays = Array(firstDayOfWeek).fill(null);
    const today = new Date();

    if (!userProfile || !club) {
        return (
            <div className="min-h-screen p-4" style={{ backgroundColor: BG }}>
                <div className="max-w-lg mx-auto text-center py-12">
                    <p className="text-muted-foreground">Loading your profile...</p>
                </div>
            </div>
        );
    }

    const nextWeighIn = (club as any)?.weighInDays ? getNextWeighIn((club as any).weighInDays) : null;

    return (
        <div
            className="min-h-screen p-4 pb-20"
            style={{ backgroundColor: BG, fontFamily: "Nunito, sans-serif" }}
        >
            <div className="max-w-lg mx-auto space-y-6">

                {/* Next Weigh-in Banner */}
                {nextWeighIn && (
                    <div className="w-full bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-2">
                            <Scale className="w-4 h-4 text-emerald-600" />
                            <span className="text-sm font-semibold">Next Weigh-in:</span>
                        </div>
                        <span className="text-sm font-bold">
                            {nextWeighIn.daysUntil === 0
                                ? "Today"
                                : nextWeighIn.daysUntil === 1
                                ? "Tomorrow"
                                : `${nextWeighIn.dayName}, ${format(nextWeighIn.date, "MMM d")}`}
                        </span>
                    </div>
                )}

                {/* Streak Hero */}
                {!isLoading && streak > 0 && (
                    <div
                        className="rounded-2xl p-5 flex items-center gap-4"
                        style={{ background: `linear-gradient(135deg, ${GREEN}, #1e6b3a)` }}
                    >
                        <div className="text-5xl">🔥</div>
                        <div>
                            <p className="text-white/80 text-sm font-semibold">Current Streak</p>
                            <p className="text-white text-3xl font-black">
                                {streak} day{streak !== 1 ? "s" : ""}
                            </p>
                            <p className="text-white/60 text-xs mt-0.5">
                                Keep it going! Sundays are rest days 💤
                            </p>
                        </div>
                    </div>
                )}

                {/* Stats Row */}
                <div className="grid grid-cols-3 gap-3">
                    <Card className="member-card overflow-hidden !p-0 border-0">
                        <CardHeader className="pb-1 pt-4 px-4">
                            <CardDescription className="text-xs font-medium text-muted-foreground">
                                This Month
                            </CardDescription>
                            {isLoading ? (
                                <Skeleton className="h-8 w-12 mt-1" />
                            ) : (
                                <CardTitle className="text-xl font-bold" style={{ color: GREEN }}>
                                    {thisMonthCount} days
                                </CardTitle>
                            )}
                        </CardHeader>
                    </Card>
                    <Card className="member-card overflow-hidden !p-0 border-0">
                        <CardHeader className="pb-1 pt-4 px-4">
                            <CardDescription className="text-xs font-medium text-muted-foreground">
                                Streak 🔥
                            </CardDescription>
                            {isLoading ? (
                                <Skeleton className="h-8 w-12 mt-1" />
                            ) : (
                                <CardTitle className="text-xl font-bold" style={{ color: GREEN }}>
                                    {streak} days
                                </CardTitle>
                            )}
                        </CardHeader>
                    </Card>
                    <Card className="member-card overflow-hidden !p-0 border-0">
                        <CardHeader className="pb-1 pt-4 px-4">
                            <CardDescription className="text-xs font-medium text-muted-foreground">
                                All Time
                            </CardDescription>
                            {isLoading ? (
                                <Skeleton className="h-8 w-12 mt-1" />
                            ) : (
                                <CardTitle className="text-xl font-bold" style={{ color: GREEN }}>
                                    {allTimeCount} days
                                </CardTitle>
                            )}
                        </CardHeader>
                    </Card>
                </div>

                {/* Calendar / List Toggle */}
                <Card className="rounded-2xl border-gray-100 shadow-sm overflow-hidden">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">Attendance History</CardTitle>
                            <div className="flex gap-1">
                                <Button
                                    variant={viewMode === "calendar" ? "default" : "ghost"}
                                    size="sm"
                                    className="rounded-full h-8"
                                    style={viewMode === "calendar" ? { backgroundColor: GREEN } : undefined}
                                    onClick={() => setViewMode("calendar")}
                                >
                                    <CalendarCheck className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant={viewMode === "list" ? "default" : "ghost"}
                                    size="sm"
                                    className="rounded-full h-8"
                                    style={viewMode === "list" ? { backgroundColor: GREEN } : undefined}
                                    onClick={() => setViewMode("list")}
                                >
                                    <List className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {viewMode === "calendar" ? (
                            <>
                                {/* Month navigation */}
                                <div className="flex items-center justify-between mb-4">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="rounded-full h-9 w-9"
                                        onClick={() => setDisplayMonth((m) => subMonths(m, 1))}
                                    >
                                        <ChevronLeft className="w-5 h-5" />
                                    </Button>
                                    <span className="font-semibold text-base">
                                        {format(displayMonth, "MMMM yyyy")}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="rounded-full h-9 w-9"
                                        onClick={() => setDisplayMonth((m) => addMonths(m, 1))}
                                    >
                                        <ChevronRight className="w-5 h-5" />
                                    </Button>
                                </div>

                                {/* Day headers */}
                                <div className="grid grid-cols-7 gap-1 mb-2">
                                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                                        <div
                                            key={d}
                                            className={`text-center text-xs font-medium py-1 ${
                                                d === "Sun" ? "text-red-400" : "text-muted-foreground"
                                            }`}
                                        >
                                            {d}
                                        </div>
                                    ))}
                                </div>

                                {/* Calendar grid */}
                                <div className="grid grid-cols-7 gap-1">
                                    {paddingDays.map((_, i) => (
                                        <div key={`pad-${i}`} className="aspect-square" />
                                    ))}
                                    {days.map((day) => {
                                        const dateStr = format(day, "yyyy-MM-dd");
                                        const hasAttendance = attendanceByDate.has(dateStr);
                                        const isToday = isSameDay(day, today);
                                        const isSun = isSunday(day);

                                        return (
                                            <div
                                                key={dateStr}
                                                className="aspect-square rounded-xl flex flex-col items-center justify-center"
                                                style={{
                                                    backgroundColor: isSun
                                                        ? "#fef2f2"
                                                        : hasAttendance
                                                        ? `${GREEN}20`
                                                        : "#f1f5f9",
                                                    ...(isToday && !isSun && {
                                                        boxShadow: `inset 0 0 0 2px ${GREEN}`,
                                                    }),
                                                }}
                                            >
                                                <span
                                                    className={`text-sm font-medium ${
                                                        isSun ? "text-red-300" : "text-foreground"
                                                    }`}
                                                >
                                                    {format(day, "d")}
                                                </span>
                                                {isSun ? (
                                                    <span className="text-[7px] text-red-300 font-bold leading-none">
                                                        Off
                                                    </span>
                                                ) : hasAttendance ? (
                                                    <span
                                                        className="text-[10px] font-black leading-none"
                                                        style={{ color: GREEN }}
                                                    >
                                                        ✓
                                                    </span>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Legend */}
                                <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: `${GREEN}20` }} />
                                        <span>Present</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-3 h-3 rounded-sm bg-red-50 border border-red-100" />
                                        <span>Sunday (Rest)</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-3 h-3 rounded-sm bg-muted" />
                                        <span>Absent</span>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                {isLoading ? (
                                    Array.from({ length: 5 }).map((_, i) => (
                                        <Skeleton key={i} className="h-14 w-full rounded-xl" />
                                    ))
                                ) : attendance.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-8">
                                        No attendance records yet
                                    </p>
                                ) : (
                                    attendance.map((a) => (
                                        <div
                                            key={a.id}
                                            className="flex items-center gap-3 p-3 rounded-xl bg-muted border border-gray-100"
                                        >
                                            <div
                                                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                                                style={{ backgroundColor: GREEN }}
                                            >
                                                ✓
                                            </div>
                                            <div>
                                                <p className="font-semibold text-sm">
                                                    {format(parseISO(a.date), "EEE, MMM d, yyyy")}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {a.checkInTime?.toDate?.()
                                                        ? format(a.checkInTime.toDate(), "h:mm a")
                                                        : "Present"}
                                                </p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
