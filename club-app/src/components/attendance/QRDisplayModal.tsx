import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useClubContext } from "@/lib/clubDetection";

interface Props {
    userId: string;
    userName: string;
    onClose: () => void;
    open: boolean;
}

export default function QRDisplayModal({ userId, userName, onClose, open }: Props) {
    const { club } = useClubContext();
    const [timestamp] = useState(() => Date.now());

    const qrValue = `mnc-checkin:${userId}:${club?.id || ""}:${timestamp}`;

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-w-sm p-0 overflow-hidden bg-white">
                <div className="p-6 space-y-6 text-center">
                    <div className="flex justify-between items-start">
                        <div />
                        <Button size="icon" variant="ghost" onClick={onClose} className="h-8 w-8">
                            <X className="w-4 h-4" />
                        </Button>
                    </div>

                    {/* QR Code */}
                    <div className="flex justify-center">
                        <div className="p-4 bg-white rounded-2xl border-2 border-dashed border-gray-200">
                            <QRCodeSVG
                                value={qrValue}
                                size={220}
                                level="H"
                                includeMargin
                                bgColor="#FFFFFF"
                                fgColor="#1a1a2e"
                            />
                        </div>
                    </div>

                    {/* Name */}
                    <div>
                        <p className="text-xl font-black text-wellness-forest">{userName}</p>
                        <p className="text-xs text-muted-foreground mt-1">Scan this QR code to clock in</p>
                    </div>

                    {/* Timer hint */}
                    <p className="text-[10px] text-muted-foreground">
                        QR valid for 2 minutes. Close and re-open to refresh.
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
}
