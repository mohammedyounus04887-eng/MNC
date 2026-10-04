import { CheckCircle } from "lucide-react";
import { useClubContext } from "@/lib/clubDetection";

interface Props {
    checkInTime: Date;
}

export default function MemberCheckInCard({ checkInTime }: Props) {
    const { club } = useClubContext();

    return (
        <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 p-8 text-center space-y-4 animate-in">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
            </div>
            <div>
                <p className="text-2xl font-black text-emerald-800">Checked In!</p>
                <p className="text-sm text-emerald-600 mt-1">
                    Welcome to {club?.name || "the club"}
                </p>
            </div>
            <p className="text-3xl font-mono font-bold text-emerald-700">
                {checkInTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="text-xs text-muted-foreground">
                {checkInTime.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
        </div>
    );
}
