import { useState } from "react";
import { Download, Share2, CreditCard } from "lucide-react";
import html2canvas from "html2canvas";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import { useMyWallet } from "@/hooks/useMemberWallet";
import DigitalMemberCard from "@/components/member/DigitalMemberCard";

export default function MemberCardPage() {
    const { toast } = useToast();
    const { firebaseUser, userProfile: member } = useAuth();
    const { club } = useClubContext();
    const { wallet } = useMyWallet();

    const [isFlipped, setIsFlipped] = useState(false);
    const [downloading, setDownloading] = useState(false);

    if (!member || !club) return null;

    const handleDownload = async () => {
        const cardEl = document.getElementById("digital-member-card");
        if (!cardEl) return;

        // Temporarily ensure it's on front before capturing
        const wasFlipped = isFlipped;
        if (wasFlipped) setIsFlipped(false);

        try {
            setDownloading(true);
            // Wait for flip anim to settle if needed
            await new Promise(r => setTimeout(r, wasFlipped ? 800 : 100));

            const canvas = await html2canvas(cardEl, { scale: 3, backgroundColor: null });
            const imgData = canvas.toDataURL("image/png");
            const link = document.createElement("a");
            link.download = `MNC-MemberCard-${member.name.replace(/\s/g, "")}.png`;
            link.href = imgData;
            link.click();
        } catch (e) {
            toast({ title: "Error downloading card", variant: "destructive" });
        } finally {
            if (wasFlipped) setIsFlipped(true);
            setDownloading(false);
        }
    };

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `${club.name} Member Card`,
                    text: `Here is my ${club.name} member card!`,
                    url: window.location.href, // Sharing the link to the webapp essentially or whatever
                });
            } catch (err) {
                console.error(err);
            }
        } else {
            toast({ title: "Sharing not supported on this browser" });
        }
    };

    return (
        <div className="space-y-8 animate-fade-in px-4 md:px-6 pb-20 pt-4 max-w-lg mx-auto">

            <div className="text-center space-y-2 mb-8">
                <h1 className="text-2xl font-black text-slate-900 flex items-center justify-center gap-2">
                    <CreditCard className="w-6 h-6 text-violet-600" /> My Member Card
                </h1>
                <p className="text-sm text-slate-500">Tap the card to flip and view details.</p>
            </div>

            <div className="py-4">
                <DigitalMemberCard
                    member={member}
                    wallet={wallet || null}
                    club={club}
                    isFlipped={isFlipped}
                    onFlip={() => setIsFlipped(!isFlipped)}
                />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-6">
                <Button
                    variant="outline"
                    className="w-full gap-2 border-slate-300 h-12 rounded-xl"
                    onClick={handleShare}
                >
                    <Share2 className="w-4 h-4" /> Share
                </Button>
                <Button
                    className="w-full gap-2 h-12 rounded-xl bg-violet-600 hover:bg-violet-700"
                    onClick={handleDownload}
                    disabled={downloading}
                >
                    <Download className="w-4 h-4" /> {downloading ? "Saving..." : "Save Image"}
                </Button>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl mt-8">
                <h3 className="font-bold text-sm mb-1 text-slate-900">Add to Home Screen</h3>
                <p className="text-xs text-slate-500">
                    Open browser menu and select <strong>"Add to Home Screen"</strong> to access your card instantly like an app.
                </p>
            </div>
        </div>
    );
}
