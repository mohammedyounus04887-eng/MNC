import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, QrCode, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import { useCheckInMember } from "@/hooks/useAttendance";
import { useToast } from "@/hooks/use-toast";
import MemberCheckInCard from "@/components/attendance/MemberCheckInCard";

export default function CheckInPage() {
    const { firebaseUser, userProfile } = useAuth();
    const { club } = useClubContext();
    const { toast } = useToast();
    const checkIn = useCheckInMember();
    const [checkInResult, setCheckInResult] = useState<{ time: Date; already: boolean } | null>(null);
    const [qrTimestamp] = useState(() => Date.now());

    const qrValue = `mnc-checkin:${firebaseUser?.uid || ""}:${club?.id || ""}:${qrTimestamp}`;

    const handleMobileCheckIn = () => {
        if (!firebaseUser || !userProfile) return;
        checkIn.mutate(
            {
                userId: firebaseUser.uid,
                userName: userProfile.name,
                userPhoto: userProfile.photo || "",
                method: "mobile",
            },
            {
                onSuccess: (result) => {
                    const time = result.checkInTime?.toDate?.() || new Date();
                    setCheckInResult({ time, already: result.alreadyCheckedIn });
                    if (result.alreadyCheckedIn) {
                        toast({ title: "Already checked in", description: `You checked in at ${time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` });
                    } else {
                        toast({ title: "Checked in! ✅" });
                    }
                },
                onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
            }
        );
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <Link to="/member/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-primary">
                <ArrowLeft className="w-4 h-4" /> Back to Dashboard
            </Link>

            <div className="text-center">
                <h1 className="text-2xl font-black text-wellness-forest">Check In</h1>
                <p className="text-sm text-muted-foreground mt-1">{club?.name}</p>
            </div>

            {checkInResult ? (
                <MemberCheckInCard checkInTime={checkInResult.time} />
            ) : (
                <Tabs defaultValue="mobile" className="max-w-md mx-auto">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="mobile"><MapPin className="w-4 h-4 mr-1" /> Mobile</TabsTrigger>
                        <TabsTrigger value="qr"><QrCode className="w-4 h-4 mr-1" /> Show QR</TabsTrigger>
                    </TabsList>

                    {/* Mobile Check-In */}
                    <TabsContent value="mobile" className="mt-6">
                        <div className="text-center space-y-6">
                            <div className="w-20 h-20 mx-auto rounded-2xl bg-violet-100 flex items-center justify-center">
                                <MapPin className="w-10 h-10 text-violet-600" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">
                                    Tap the button below to mark your attendance
                                </p>
                            </div>
                            <Button
                                size="lg"
                                className="w-full text-lg py-6"
                                disabled={checkIn.isPending}
                                onClick={handleMobileCheckIn}
                            >
                                {checkIn.isPending ? "Checking in…" : "✅ Check In Now"}
                            </Button>
                        </div>
                    </TabsContent>

                    {/* QR Code */}
                    <TabsContent value="qr" className="mt-6">
                        <div className="text-center space-y-4">
                            <div className="inline-block p-4 bg-white rounded-2xl border-2 border-dashed border-gray-200">
                                <QRCodeSVG value={qrValue} size={200} level="H" includeMargin />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Show this QR code at reception to check in
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                                QR valid for 2 minutes
                            </p>
                        </div>
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
}
