import { ArrowLeft, Trophy, TrendingDown, Medal, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useClubContext } from "@/lib/clubDetection";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useState } from "react";

const GREEN = "#2d9653";

function formatNamePrivacy(name: string) {
    if (!name) return "Unknown";
    const parts = name.trim().split(" ");
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

type BtcEntry = {
    id: string;
    name: string;
    gender: "female" | "male";
    score: number;       // % weight lost relative to first
    weightLost: number;  // kg
    firstWeight: number;
    lastWeight: number;
};

function useBtcLeaderboard(clubId: string | null, gender: "female" | "male") {
    return useQuery({
        queryKey: ["btc-leaderboard", clubId, gender],
        enabled: !!clubId,
        staleTime: 5 * 60 * 1000,
        queryFn: async () => {
            const participantsSnap = await getDocs(
                collection(db, `clubs/${clubId}/btcParticipants`)
            );

            const entries: BtcEntry[] = [];

            for (const pDoc of participantsSnap.docs) {
                const pData = pDoc.data();
                if (pData.gender !== gender) continue;

                const measSnap = await getDocs(
                    collection(db, `clubs/${clubId}/btcParticipants/${pDoc.id}/measurements`)
                );

                if (measSnap.empty) continue;

                const measurements = measSnap.docs
                    .map((d) => d.data() as { date: string; weight: number })
                    .sort((a, b) => a.date.localeCompare(b.date));

                if (measurements.length < 2) continue;

                const first = measurements[0];
                const last = measurements[measurements.length - 1];
                const score = ((first.weight - last.weight) / first.weight) * 100;
                if (score <= 0) continue;

                entries.push({
                    id: pDoc.id,
                    name: pData.name,
                    gender: pData.gender,
                    score: +score.toFixed(2),
                    weightLost: +(first.weight - last.weight).toFixed(1),
                    firstWeight: first.weight,
                    lastWeight: last.weight,
                });
            }

            return entries.sort((a, b) => b.score - a.score);
        },
    });
}

export default function MemberLeaderboard() {
    const { club } = useClubContext();
    const { userProfile } = useAuth();
    const [gender, setGender] = useState<"female" | "male">("female");

    const { data: leaderboard = [], isLoading } = useBtcLeaderboard(club?.id || null, gender);

    return (
        <div
            className="space-y-6 pb-20 pt-4 px-4 md:px-6"
            style={{ fontFamily: "'Nunito', sans-serif" }}
        >
            <div className="flex items-center gap-3 mb-2">
                <Link
                    to="/member/dashboard"
                    className="p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <div>
                    <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: GREEN }}>
                        <Trophy className="w-6 h-6 text-amber-500" /> BTC Leaderboard
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Body Transformation Challenge · ranked by % weight lost
                    </p>
                </div>
            </div>

            <Tabs value={gender} onValueChange={(v) => setGender(v as any)}>
                <TabsList className="grid w-full grid-cols-2 bg-slate-100 p-1 rounded-xl">
                    <TabsTrigger
                        value="female"
                        className="rounded-lg font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm"
                    >
                        <Users className="w-4 h-4 mr-1" /> Females
                    </TabsTrigger>
                    <TabsTrigger
                        value="male"
                        className="rounded-lg font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm"
                    >
                        <Users className="w-4 h-4 mr-1" /> Males
                    </TabsTrigger>
                </TabsList>

                {(["female", "male"] as const).map((g) => (
                    <TabsContent key={g} value={g} className="mt-6">
                        <LeaderboardList
                            data={leaderboard}
                            isLoading={isLoading}
                            currentUserName={userProfile?.name}
                        />
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}

function LeaderboardList({
    data,
    isLoading,
    currentUserName,
}: {
    data: BtcEntry[];
    isLoading: boolean;
    currentUserName?: string;
}) {
    if (isLoading) {
        return (
            <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-3xl" />
                ))}
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="text-center py-16 bg-white border border-dashed rounded-3xl">
                <Trophy className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                <h3 className="font-bold text-slate-900">No Data Yet</h3>
                <p className="text-sm text-slate-500 mt-1">
                    BTC leaderboard will appear once data is loaded.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {data.map((entry, index) => {
                const isMe =
                    !!currentUserName &&
                    entry.name.toLowerCase().includes(currentUserName.split(" ")[0].toLowerCase());
                const isTop3 = index < 3;

                return (
                    <div
                        key={entry.id}
                        className={`p-4 sm:p-5 flex items-center justify-between rounded-3xl border shadow-sm ${
                            isMe
                                ? "bg-emerald-50 border-emerald-200 ring-2 ring-emerald-100"
                                : isTop3
                                ? "bg-white border-amber-100 ring-1 ring-amber-50"
                                : "bg-white"
                        }`}
                    >
                        <div className="flex items-center gap-4">
                            <div
                                className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl shadow-sm ${
                                    index === 0
                                        ? "bg-gradient-to-br from-amber-300 to-amber-500 text-white border border-amber-400"
                                        : index === 1
                                        ? "bg-gradient-to-br from-slate-300 to-slate-400 text-white border border-slate-300"
                                        : index === 2
                                        ? "bg-gradient-to-br from-orange-300 to-orange-400 text-white border border-orange-300"
                                        : "bg-slate-100 text-slate-400 font-bold border border-slate-200"
                                }`}
                            >
                                {isTop3 ? <Medal className="w-5 h-5 text-white/90" /> : index + 1}
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <p
                                        className={`font-bold text-lg ${
                                            isMe ? "text-emerald-900" : "text-slate-900"
                                        }`}
                                    >
                                        {isMe ? "You" : formatNamePrivacy(entry.name)}
                                    </p>
                                    {isMe && (
                                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-widest">
                                            Me
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500 flex items-center gap-1 font-medium mt-0.5">
                                    <TrendingDown className="w-3 h-3 text-emerald-500" />
                                    {entry.firstWeight} kg → {entry.lastWeight} kg
                                </p>
                            </div>
                        </div>
                        <div className="text-right ml-3">
                            <p className="font-black text-2xl text-emerald-700">
                                -{entry.score}
                                <span className="text-sm opacity-50">%</span>
                            </p>
                            <p className="text-xs text-slate-400 font-medium">-{entry.weightLost} kg</p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
