import { Clock, Calendar, TrendingUp } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useVolunteerHours } from "@/hooks/useAttendance";

interface Props {
    volunteerId: string;
    volunteerName: string;
    volunteerPhoto: string;
    month: string; // "2026-02"
    onClick?: () => void;
}

export default function VolunteerHoursCard({ volunteerId, volunteerName, volunteerPhoto, month, onClick }: Props) {
    const { records, totalHours, loading } = useVolunteerHours(volunteerId, month);

    if (loading) return <Skeleton className="h-28 rounded-2xl" />;

    const daysWorked = new Set(records.map((r) => r.date)).size;
    const avgHours = daysWorked > 0 ? Math.round((totalHours / daysWorked) * 10) / 10 : 0;
    const lastDate = records.length > 0 ? records[records.length - 1].date : "—";

    return (
        <button
            onClick={onClick}
            className="w-full text-left bg-white rounded-2xl border p-4 hover:shadow-md transition-all"
        >
            <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                    {volunteerPhoto ? <AvatarImage src={volunteerPhoto} /> : null}
                    <AvatarFallback className="bg-violet-100 text-violet-700 font-bold text-sm">
                        {volunteerName[0]}
                    </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{volunteerName}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {daysWorked} days</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {totalHours.toFixed(1)}h total</span>
                        <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {avgHours}h/day avg</span>
                    </div>
                </div>
                <div className="text-right flex-shrink-0">
                    <p className="text-2xl font-black text-violet-600">{totalHours.toFixed(1)}</p>
                    <p className="text-[10px] text-muted-foreground">hours</p>
                </div>
            </div>
        </button>
    );
}
