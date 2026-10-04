import { useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, ArrowLeft, TrendingDown, Dumbbell } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useClubContext } from "@/lib/clubDetection";
import { useLeaderboard } from "@/hooks/owner/useWeighIns";

export default function Leaderboard() {
    const { club } = useClubContext();
    const [tab, setTab] = useState<"week" | "alltime">("week");
    const { data: leaderboard, isLoading } = useLeaderboard(club?.id || null, tab);

    return (
        <div className="space-y-6 animate-fade-in" style={{ fontFamily: "'Nunito', sans-serif" }}>
            <div className="flex items-center gap-4">
                <Link to="/owner" className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <div>
                    <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: "#2d9653" }}>
                        <Trophy className="w-6 h-6 text-amber-500" /> Leaderboard
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Top performers ranked by fat loss.</p>
                </div>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
                <TabsList className="grid w-full grid-cols-2 bg-slate-100 p-1 rounded-xl">
                    <TabsTrigger value="week" className="rounded-lg font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm">This Week</TabsTrigger>
                    <TabsTrigger value="alltime" className="rounded-lg font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm">All Time</TabsTrigger>
                </TabsList>

                <TabsContent value="week" className="mt-6">
                    <LeaderboardList data={leaderboard || []} isLoading={isLoading} />
                </TabsContent>

                <TabsContent value="alltime" className="mt-6">
                    <LeaderboardList data={leaderboard || []} isLoading={isLoading} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function LeaderboardList({ data, isLoading }: { data: any[]; isLoading: boolean }) {
    if (isLoading) {
        return (
            <div className="space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="text-center py-16 bg-white border border-dashed rounded-3xl">
                <Trophy className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                <h3 className="font-bold text-slate-900">No Data Yet</h3>
                <p className="text-sm text-slate-500 mt-1">Record weigh-ins to see the leaderboard.</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-3xl border shadow-sm overflow-hidden">
            <div className="divide-y">
                {data.map((member, index) => {
                    const isTop3 = index < 3;
                    return (
                        <div key={member.memberId} className={`p-4 sm:p-5 flex items-center justify-between transition-colors hover:bg-slate-50 ${isTop3 ? "bg-amber-50/30" : ""}`}>
                            <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-lg ${index === 0 ? "bg-amber-100 text-amber-600 border border-amber-200" :
                                    index === 1 ? "bg-slate-200 text-slate-600 border border-slate-300" :
                                        index === 2 ? "bg-orange-100 text-orange-700 border border-orange-200" :
                                            "bg-slate-50 text-slate-400 font-bold"
                                    }`}>
                                    {index + 1}
                                </div>
                                <div className="flex items-center gap-3">
                                    {member.photo ? (
                                        <img src={member.photo} alt={member.name} className="w-10 h-10 rounded-full object-cover shadow-sm bg-slate-100" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold shadow-sm">
                                            {member.name.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <div>
                                        <p className="font-bold text-slate-900">{member.memberName ?? member.name}</p>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {member.fatLost != null && (
                                                <p className="text-xs text-slate-500 flex items-center gap-1">
                                                    <TrendingDown className="w-3 h-3 text-emerald-600" />
                                                    {member.fatLost}% fat lost
                                                </p>
                                            )}
                                            {member.muscleGained != null && member.muscleGained > 0 && (
                                                <p className="text-xs text-slate-400 flex items-center gap-1">
                                                    <Dumbbell className="w-3 h-3 text-purple-400" />
                                                    +{member.muscleGained} kg
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                {member.fatLost != null ? (
                                    <p className="font-black text-lg text-emerald-700">-{member.fatLost}%</p>
                                ) : (
                                    <p className="font-black text-lg text-emerald-700">-{(member.weightLost ?? 0).toFixed(1)} kg</p>
                                )}
                                {member.weightLost > 0 && member.fatLost != null && (
                                    <p className="text-xs text-slate-400">-{member.weightLost} kg</p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
