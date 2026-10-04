import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarCheck, ShoppingCart, Users, Clock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import { useTodayAttendance, useIsVolunteerCheckedIn, useCheckOutVolunteer, useManualCheckIn } from "@/hooks/useAttendance";
import { useClubMembers } from "@/hooks/useOwner";
import AttendanceLogTable from "@/components/attendance/AttendanceLogTable";

export default function StaffDashboard() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();
    const { records: todayAll, loading: todayLoading } = useTodayAttendance();
    const { isCheckedIn, attendanceRecord } = useIsVolunteerCheckedIn(firebaseUser?.uid || "");
    const checkOut = useCheckOutVolunteer();
    const { data: allMembers } = useClubMembers();
    const manualCheckIn = useManualCheckIn();

    const [manualOpen, setManualOpen] = useState(false);
    const [manualSearch, setManualSearch] = useState("");

    const handleClockOut = () => {
        if (!firebaseUser) return;
        checkOut.mutate(firebaseUser.uid, {
            onSuccess: (hours) => toast({ title: "Clocked out!", description: `Total hours: ${hours}` }),
            onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
        });
    };

    const handleManualCheckIn = (member: { id: string; name: string; photo: string }) => {
        manualCheckIn.mutate(
            { userId: member.id, userName: member.name, userPhoto: member.photo },
            {
                onSuccess: () => { toast({ title: `${member.name} checked in!` }); setManualOpen(false); },
                onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
            }
        );
    };

    const elapsedHours = isCheckedIn && attendanceRecord?.checkInTime
        ? Math.round(((Date.now() - attendanceRecord.checkInTime.toDate().getTime()) / 3600000) * 10) / 10
        : 0;

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div>
                <h1 className="text-2xl font-black text-wellness-forest">
                    Hey, {userProfile?.name || "Staff"} 👋
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    {club?.name} • {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </p>
            </div>

            {/* Clock-in Banner */}
            {isCheckedIn && (
                <div className="flex items-center justify-between p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                            <Clock className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-emerald-800">You are clocked in</p>
                            <p className="text-xs text-emerald-600">
                                Since {attendanceRecord?.checkInTime?.toDate?.().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} • {elapsedHours} hours elapsed
                            </p>
                        </div>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        className="border-emerald-300 text-emerald-700"
                        onClick={handleClockOut}
                        disabled={checkOut.isPending}
                    >
                        <LogOut className="w-4 h-4 mr-1" />
                        {checkOut.isPending ? "Clocking out…" : "Clock Out"}
                    </Button>
                </div>
            )}

            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-3">
                <button
                    onClick={() => setManualOpen(true)}
                    className="flex flex-col items-center gap-2 p-5 rounded-2xl border bg-white hover:shadow-md transition-all"
                >
                    <CalendarCheck className="w-8 h-8 text-violet-500" />
                    <span className="text-sm font-bold">Mark Attendance</span>
                    <span className="text-xs text-muted-foreground">Manual member check-in</span>
                </button>
                <button
                    onClick={() => navigate("/staff/orders")}
                    className="flex flex-col items-center gap-2 p-5 rounded-2xl border bg-white hover:shadow-md transition-all"
                >
                    <ShoppingCart className="w-8 h-8 text-emerald-500" />
                    <span className="text-sm font-bold">New Order</span>
                    <span className="text-xs text-muted-foreground">Quick order entry</span>
                </button>
            </div>

            {/* Today's Attendance */}
            <div className="space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-500" />
                    Today's Attendance
                    <Badge variant="secondary" className="text-[10px]">{todayAll.length}</Badge>
                </h3>
                {todayLoading ? (
                    <Skeleton className="h-32 rounded-xl" />
                ) : (
                    <AttendanceLogTable records={todayAll} showType />
                )}
            </div>

            {/* Manual Check-In Dialog */}
            <Dialog open={manualOpen} onOpenChange={setManualOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader><DialogTitle>Mark Attendance</DialogTitle></DialogHeader>
                    <div className="space-y-3 mt-2">
                        <Input placeholder="Search member…" value={manualSearch} onChange={(e) => setManualSearch(e.target.value)} />
                        <div className="max-h-64 overflow-y-auto space-y-1">
                            {allMembers
                                ?.filter((m) => m.status === "active" && m.name.toLowerCase().includes(manualSearch.toLowerCase()))
                                .slice(0, 20)
                                .map((m) => (
                                    <button
                                        key={m.id}
                                        onClick={() => handleManualCheckIn({ id: m.id, name: m.name, photo: m.photo || "" })}
                                        disabled={manualCheckIn.isPending}
                                        className="flex items-center gap-3 w-full p-2 rounded-lg hover:bg-gray-50 text-left"
                                    >
                                        <Avatar className="h-8 w-8">
                                            {m.photo ? <AvatarImage src={m.photo} /> : null}
                                            <AvatarFallback className="text-xs bg-violet-100 text-violet-700">{m.name[0]}</AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <p className="text-sm font-medium">{m.name}</p>
                                            <p className="text-xs text-muted-foreground">{m.phone}</p>
                                        </div>
                                    </button>
                                ))}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
