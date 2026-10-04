import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, CalendarCheck, Clock, FileText, Package, Printer, Users } from "lucide-react";
import { getAdminBase } from "@/lib/adminBase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import DailyStatsBar from "@/components/owner/DailyStatsBar";
import DashboardAnalytics from "@/components/owner/DashboardAnalytics";
import CoachActivityPanel from "@/components/owner/CoachActivityPanel";
import TodayReportModal from "@/components/owner/TodayReportModal";
import { useClubContext } from "@/lib/clubDetection";
import {
    usePendingTopupRequests,
    useExpiringMembers,
    useLowStockProducts,
    useTodayAttendance,
} from "@/hooks/useOwner";
import { useDrasticChanges } from "@/hooks/owner/useWeighIns";
import { fetchClubAndPrint } from "@/utils/printReceipt";
import {
    buildExpiringMembersReceipt,
    buildLowStockReceipt,
} from "@/utils/receiptBuilder";

function getGreeting(): string {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return "Good morning";
    if (h >= 12 && h < 17) return "Good afternoon";
    if (h >= 17 && h < 21) return "Good evening";
    return "Good night";
}

export default function OwnerDashboard() {
    const navigate = useNavigate();
    const { club } = useClubContext();
    const base = getAdminBase();
    const [showReport, setShowReport] = useState(false);

    // All hooks must be called before any conditional return
    const { requests: pendingTopups } = usePendingTopupRequests();
    const { data: expiring, isLoading: expiringLoading } = useExpiringMembers();
    const { data: lowStock, isLoading: lowStockLoading } = useLowStockProducts();
    const { data: todayAttendance, isLoading: attendLoading } = useTodayAttendance();
    const { data: drasticChanges } = useDrasticChanges(club?.id || null);

    if (!club?.id) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;

    const greeting = getGreeting();
    const clubName = club?.name ?? "Club";

    return (
        <div className="px-6 md:px-8 py-8 space-y-8 pb-12 max-w-[1200px] mx-auto"
            style={{ fontFamily: "'Nunito', sans-serif" }}>

            {/* Welcome header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black tracking-tight"
                        style={{ color: "#1a2e1a" }}>
                        {greeting}, {clubName} 👋
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1 font-semibold">
                        {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    </p>
                </div>
                <button
                    onClick={() => setShowReport(true)}
                    className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 font-bold text-sm hover:bg-emerald-100 transition-colors shadow-sm"
                >
                    <FileText className="w-4 h-4" />
                    Today's Report
                </button>
            </div>

            {showReport && <TodayReportModal onClose={() => setShowReport(false)} />}

            {/* Stats grid — 4 col desktop, 2 tablet, 1 mobile */}
            <DailyStatsBar />

            {/* Real-data analytics — period toggle + revenue trend + pies */}
            <DashboardAnalytics clubId={club.id} />
            <CoachActivityPanel />

            {/* Pending Topups Alert */}
            {pendingTopups.length > 0 && (
                <div className="flex items-center justify-between p-4 rounded-2xl bg-amber-50 border border-amber-200 shadow-sm animate-pulse-fade">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-amber-800">
                                {pendingTopups.length} member{pendingTopups.length > 1 ? "s" : ""} waiting for wallet topup
                            </p>
                            <p className="text-xs text-amber-600">Review and approve pending requests</p>
                        </div>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        className="border-amber-300 text-amber-700 flex-shrink-0 bg-card"
                        onClick={() => navigate(`${base}/wallet`)}
                    >
                        Review Now <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                </div>
            )}

            {/* Drastic Change Alerts */}
            {drasticChanges && drasticChanges.length > 0 && (
                <div className="flex flex-col gap-2">
                    {drasticChanges.map((alert, i) => (
                        <div key={`${alert.memberId}-${i}`} className={`flex items-center justify-between p-4 rounded-2xl border shadow-sm ${alert.type === 'gained' ? 'bg-orange-50 border-orange-200' : 'bg-rose-50 border-rose-200'}`}>
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center font-bold shadow-sm ${alert.type === 'gained' ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700'}`}>
                                    !
                                </div>
                                <div>
                                    <p className={`text-sm font-bold ${alert.type === 'gained' ? 'text-orange-900' : 'text-rose-900'}`}>
                                        {alert.memberName} {alert.type === 'gained' ? 'gained weight rapidly' : 'lost weight too fast'}
                                    </p>
                                    <p className={`text-xs ${alert.type === 'gained' ? 'text-orange-700' : 'text-rose-700'}`}>
                                        Weight changed by {Math.abs(alert.change)} kg in the last 7 days.
                                    </p>
                                </div>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                className={`flex-shrink-0 bg-card ${alert.type === 'gained' ? 'border-orange-300 text-orange-700' : 'border-rose-300 text-rose-700'}`}
                                onClick={() => navigate(`${base}/members/${alert.memberId}`)}
                            >
                                View Profile
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            {/* Info grid — 2 col */}
            <div className="grid sm:grid-cols-2 gap-6">
                {/* Expiring Memberships */}
                <div className="bg-card rounded-2xl border p-5 space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold flex items-center gap-2">
                            <Clock className="w-4 h-4 text-orange-500" /> Low Shake Credits
                        </h3>
                        {expiring && expiring.length > 0 && (
                            <button
                                onClick={() => {
                                    if (!club?.id) return;
                                    fetchClubAndPrint(club.id, (club) =>
                                        buildExpiringMembersReceipt({
                                            club,
                                            date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
                                            withinDays: 7,
                                            members: expiring.map(m => ({
                                                name: m.name,
                                                tier: `${(m as any).shakeCredits ?? 0} credits`,
                                                credits: (m as any).shakeCredits ?? 0,
                                                expiresOn: '',
                                                daysLeft: (m as any).shakeCredits ?? 0,
                                            })),
                                        })
                                    );
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-100 transition-colors"
                            >
                                <Printer className="w-3.5 h-3.5" /> Print
                            </button>
                        )}
                    </div>
                    {expiringLoading ? (
                        <Skeleton className="h-20" />
                    ) : expiring && expiring.length > 0 ? (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                            {expiring.map((m) => {
                                const credits = (m as any).shakeCredits ?? 0;
                                return (
                                    <div key={m.id} className="flex items-center justify-between p-2 rounded-lg bg-orange-50 text-sm">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-semibold truncate">{m.name}</span>
                                        </div>
                                        <Badge variant="outline" className="text-xs flex-shrink-0 bg-orange-100 text-orange-700 border-orange-200">{credits} credit{credits !== 1 ? 's' : ''} left</Badge>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-xs text-gray-400 py-4 text-center font-medium">All members have sufficient credits ✅</p>
                    )}
                </div>

                {/* Low Stock */}
                <div className="bg-card rounded-2xl border p-5 space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold flex items-center gap-2">
                            <Package className="w-4 h-4 text-red-500" /> Low Stock Alert
                        </h3>
                        {lowStock && lowStock.length > 0 && (
                            <button
                                onClick={() => {
                                    if (!club?.id) return;
                                    const now = new Date();
                                    fetchClubAndPrint(club.id, (club) =>
                                        buildLowStockReceipt({
                                            club,
                                            date: now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
                                            time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                                            items: lowStock.map(p => ({
                                                name: p.name,
                                                stock: p.stock,
                                                threshold: p.lowStockThreshold,
                                            })),
                                        })
                                    );
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                            >
                                <Printer className="w-3.5 h-3.5" /> Print
                            </button>
                        )}
                    </div>
                    {lowStockLoading ? (
                        <Skeleton className="h-20" />
                    ) : lowStock && lowStock.length > 0 ? (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                            {lowStock.map((p) => (
                                <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-red-50 text-sm">
                                    <span className="font-semibold truncate">{p.name}</span>
                                    <span className="text-xs text-red-600 font-bold flex-shrink-0 ml-2">
                                        {p.stock} / {p.lowStockThreshold}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-gray-400 py-4 text-center font-medium">All stock levels healthy ✅</p>
                    )}
                </div>

                {/* Member Check-ins Today */}
                <div className="bg-card rounded-2xl border p-5 space-y-3">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                        <CalendarCheck className="w-4 h-4 text-violet-500" /> Member Check-ins
                    </h3>
                    {attendLoading ? (
                        <Skeleton className="h-20" />
                    ) : (() => {
                        const memberCheckins = todayAttendance?.filter(a => a.type === "member" || !a.type) ?? [];
                        return memberCheckins.length > 0 ? (
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                {memberCheckins.map((a) => (
                                    <div key={a.id} className="flex items-center gap-3 p-2 rounded-lg bg-violet-50/50 text-sm">
                                        <Avatar className="h-7 w-7 flex-shrink-0">
                                            {a.userPhoto ? <AvatarImage src={a.userPhoto} /> : null}
                                            <AvatarFallback className="text-[10px] bg-violet-100 text-violet-700">
                                                {a.userName?.[0]}
                                            </AvatarFallback>
                                        </Avatar>
                                        <span className="flex-1 font-semibold truncate">{a.userName}</span>
                                        <span className="text-xs text-gray-400 flex-shrink-0">
                                            {a.checkInTime?.toDate?.().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-gray-400 py-4 text-center font-medium">No member check-ins yet today</p>
                        );
                    })()}
                </div>

                {/* Volunteer Attendance Today */}
                <div className="bg-card rounded-2xl border p-5 space-y-3">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                        <Users className="w-4 h-4 text-emerald-500" /> Volunteer Attendance
                    </h3>
                    {attendLoading ? (
                        <Skeleton className="h-20" />
                    ) : (() => {
                        const volunteerCheckins = todayAttendance?.filter(a => a.type === "volunteer") ?? [];
                        return volunteerCheckins.length > 0 ? (
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                {volunteerCheckins.map((v) => (
                                    <div key={v.id} className="flex items-center gap-3 p-2 rounded-lg bg-emerald-50/50 text-sm">
                                        <Avatar className="h-7 w-7 flex-shrink-0">
                                            {v.userPhoto ? <AvatarImage src={v.userPhoto} /> : null}
                                            <AvatarFallback className="text-[10px] bg-emerald-100 text-emerald-700">
                                                {v.userName?.[0]}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 min-w-0">
                                            <span className="font-semibold truncate block">{v.userName}</span>
                                            {v.checkOutTime ? (
                                                <span className="text-[10px] text-gray-400">Out: {v.checkOutTime?.toDate?.().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                            ) : (
                                                <span className="text-[10px] text-emerald-600 font-bold">Currently In</span>
                                            )}
                                        </div>
                                        <span className="text-xs text-gray-400 flex-shrink-0">
                                            In: {v.checkInTime?.toDate?.().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-gray-400 py-4 text-center font-medium">No volunteers checked in today</p>
                        );
                    })()}
                </div>

                {/* Active Announcements */}
                <ActiveAnnouncementsWidget clubId={club?.id} />
            </div>
        </div>
    );
}

// Widget to fetch and display active announcements
import { useAnnouncements } from "@/hooks/owner/useAnnouncements";
import { Megaphone } from "lucide-react";

function ActiveAnnouncementsWidget({ clubId }: { clubId?: string }) {
    const { announcements, loading } = useAnnouncements(clubId ?? null);

    const recent = announcements?.slice(0, 5) || [];

    return (
        <div className="bg-card rounded-2xl border p-5 space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-emerald-600" /> Recent Announcements
            </h3>
            {loading ? (
                <Skeleton className="h-20" />
            ) : recent.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {recent.map((a) => (
                        <div key={a.id} className="flex flex-col p-2 rounded-lg bg-emerald-50/50 border border-emerald-100/50 text-sm gap-1">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-foreground truncate">{a.title}</span>
                                <Badge variant="outline" className={`text-[10px] h-4 px-1 rounded-sm border-0 ${a.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                                    a.priority === 'important' ? 'bg-yellow-100 text-yellow-700' : 'bg-emerald-100 text-emerald-700'
                                    }`}>
                                    {a.priority}
                                </Badge>
                            </div>
                            <div className="flex items-center justify-end text-xs text-muted-foreground font-medium">
                                <span>{a.createdAt?.toDate?.()?.toLocaleDateString?.([], { month: 'short', day: 'numeric' }) ?? ""}</span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-xs text-gray-400 py-4 text-center font-medium">No active announcements</p>
            )}
        </div>
    );
}
