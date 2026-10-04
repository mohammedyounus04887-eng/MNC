import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Attendance } from "@/types/firestore";

interface Props {
    records: Attendance[];
    showType?: boolean;
}

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

export default function AttendanceLogTable({ records, showType }: Props) {
    if (records.length === 0) {
        return (
            <p className="text-sm text-muted-foreground text-center py-8">
                No attendance records found.
            </p>
        );
    }

    const today = todayStr();

    return (
        <div className="space-y-2">
            {records.map((rec) => {
                const isVol = rec.type === "volunteer";
                const checkIn = rec.checkInTime?.toDate?.();
                const checkOut = rec.checkOutTime?.toDate?.();

                // Volunteer status: active (today, no checkout) = green, forgot logout (past, no checkout) = red, completed = default
                const isActiveNow = isVol && !checkOut && rec.date === today;
                const forgotLogout = isVol && !checkOut && rec.date !== today;

                const rowBg = forgotLogout
                    ? "bg-red-50 border-red-200"
                    : isActiveNow
                    ? "bg-emerald-50 border-emerald-200"
                    : "bg-white";

                return (
                    <div key={rec.id} className={`flex items-center gap-3 p-3 rounded-xl border ${rowBg}`}>
                        <Avatar className="h-9 w-9">
                            {rec.userPhoto ? <AvatarImage src={rec.userPhoto} /> : null}
                            <AvatarFallback className="text-xs font-bold bg-violet-100 text-violet-700">
                                {rec.userName?.[0]}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{rec.userName}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{checkIn?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                {isVol && (
                                    <>
                                        <span>→</span>
                                        {forgotLogout ? (
                                            <span className="text-red-600 font-bold">Did not log out</span>
                                        ) : checkOut ? (
                                            <span>{checkOut.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                        ) : (
                                            <span className="text-emerald-600 font-semibold">Still working</span>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {showType && (
                                <Badge variant="outline" className={`text-[10px] ${isVol ? "border-blue-200 text-blue-700" : "border-emerald-200 text-emerald-700"}`}>
                                    {isVol ? "Volunteer" : "Member"}
                                </Badge>
                            )}
                            <Badge variant="outline" className="text-[10px]">{rec.checkInMethod}</Badge>
                            {isVol && checkOut && rec.hoursWorked !== null && (
                                <span className="text-xs font-bold text-violet-600">{rec.hoursWorked}h</span>
                            )}
                            {forgotLogout && (
                                <Badge variant="outline" className="text-[10px] border-red-300 text-red-600 bg-red-50">
                                    No Logout
                                </Badge>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
