import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClubContext } from "@/lib/clubDetection";
import PinProtectedRoute from "@/components/PinProtectedRoute";
import VolunteerGrid from "@/components/attendance/VolunteerGrid";
import QRScanner from "@/components/attendance/QRScanner";
import { parseQRValue } from "@/components/attendance/QRScanner";
import { useCheckInVolunteer } from "@/hooks/useAttendance";
import { useClubVolunteers } from "@/hooks/useOwner";
import { useToast } from "@/hooks/use-toast";

export default function ReceptionDisplay() {
    return (
        <PinProtectedRoute title="Reception Display" icon="🖥️">
            <ReceptionContent />
        </PinProtectedRoute>
    );
}

function ReceptionContent() {
    const { club } = useClubContext();
    const { toast } = useToast();
    const { data: volunteers } = useClubVolunteers();
    const checkIn = useCheckInVolunteer();
    const [showScanner, setShowScanner] = useState(false);

    const handleScan = (decoded: string) => {
        const parsed = parseQRValue(decoded);
        if (!parsed || parsed.clubId !== club?.id) {
            toast({ title: "Invalid QR", description: "This QR is not for this club.", variant: "destructive" });
            return;
        }
        const vol = volunteers?.find((v) => v.id === parsed.userId);
        if (!vol) {
            toast({ title: "Unknown user", description: "User not found in volunteer list.", variant: "destructive" });
            return;
        }
        checkIn.mutate(
            { userId: vol.id, userName: vol.name, userPhoto: vol.photo || "" },
            {
                onSuccess: () => { toast({ title: `${vol.name} clocked in!` }); setShowScanner(false); },
                onError: (err: any) => toast({ title: "Check-in failed", description: err.message, variant: "destructive" }),
            }
        );
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="flex items-center justify-between p-4 bg-white border-b">
                <div>
                    <h1 className="text-xl font-black text-wellness-forest">🖥️ Reception</h1>
                    <p className="text-xs text-muted-foreground">{club?.name} • Tap a volunteer to clock in</p>
                </div>
                <div className="flex gap-2">
                    <Button variant={showScanner ? "default" : "outline"} onClick={() => setShowScanner(!showScanner)}>
                        {showScanner ? "Close Scanner" : "📷 Scan QR"}
                    </Button>
                    <Button variant="ghost" onClick={() => window.location.reload()}>
                        <Lock className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* Scanner */}
            {showScanner && (
                <div className="max-w-md mx-auto p-4">
                    <QRScanner
                        onScanSuccess={handleScan}
                        onScanError={(err) => toast({ title: "Scan Error", description: err, variant: "destructive" })}
                    />
                </div>
            )}

            {/* Volunteer Grid */}
            <VolunteerGrid />
        </div>
    );
}
