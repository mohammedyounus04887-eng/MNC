import { Building2, Users, CheckCircle, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlatformStats } from "@/hooks/useSuperAdmin";

const statConfig = [
    { key: "totalClubs", label: "Total Clubs", icon: Building2, color: "text-violet-600", bg: "bg-violet-50" },
    { key: "activeClubs", label: "Active Clubs", icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50" },
    { key: "totalMembers", label: "Total Members", icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
    { key: "disabledClubs", label: "Disabled Clubs", icon: XCircle, color: "text-red-600", bg: "bg-red-50" },
] as const;

export default function PlatformStats() {
    const { data, isLoading } = usePlatformStats();

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {statConfig.map((stat) => {
                const Icon = stat.icon;
                const value = data?.[stat.key as keyof typeof data] ?? 0;
                const isDanger = stat.key === "disabledClubs" && (value as number) > 0;

                return (
                    <div
                        key={stat.key}
                        className={`rounded-2xl border p-5 transition-all hover:shadow-md ${isDanger ? "border-red-200 bg-red-50/50" : "border-border bg-white"
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`rounded-xl p-2.5 ${stat.bg}`}>
                                <Icon className={`w-5 h-5 ${stat.color}`} />
                            </div>
                            <div className="min-w-0">
                                {isLoading ? (
                                    <>
                                        <Skeleton className="h-7 w-12 mb-1" />
                                        <Skeleton className="h-3 w-20" />
                                    </>
                                ) : (
                                    <>
                                        <p className={`text-2xl font-bold ${isDanger ? "text-red-600" : "text-foreground"}`}>
                                            {value}
                                        </p>
                                        <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
