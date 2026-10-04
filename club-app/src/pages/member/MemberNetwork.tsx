import { useState } from "react";
import {
    useQuery,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";
import {
    collection,
    query,
    where,
    getDocs,
    addDoc,
    Timestamp,
} from "firebase/firestore";
import { Copy, Share2, Users, Check, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useClubContext } from "@/lib/clubDetection";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@/types/firestore";

const BENEFITS = [
    "Run your own nutrition club",
    "Earn from your network",
    "Full admin dashboard",
    "Custom branding & domain",
];

export default function MemberNetwork() {
    const { userProfile } = useAuth();
    const { club } = useClubContext();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [formData, setFormData] = useState({
        proposedClubName: "",
        proposedDomain: "",
        address: "",
        reason: "",
    });

    const referralUrl = `${window.location.origin}/?ref=${userProfile?.id || ""}`;

    const { data: referrals = [], isLoading: referralsLoading } = useQuery({
        queryKey: ["referrals", userProfile?.id, club?.id],
        queryFn: async () => {
            if (!userProfile?.id || !club?.id) return [];
            const q = query(
                collection(db, `clubs/${club.id}/members`),
                where("referredBy", "==", userProfile.id)
            );
            const snapshot = await getDocs(q);
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as User[];
        },
        enabled: !!userProfile?.id && !!club?.id,
    });

    const { data: pendingUpgrade = null, isLoading: upgradeLoading } = useQuery({
        queryKey: ["upgradeRequest", userProfile?.id],
        queryFn: async () => {
            if (!userProfile?.id) return null;
            const q = query(
                collection(db, `clubs/${club!.id}/upgradeRequests`),
                where("memberId", "==", userProfile.id),
                where("status", "==", "pending")
            );
            const snapshot = await getDocs(q);
            if (snapshot.empty) return null;
            return snapshot.docs[0].data();
        },
        enabled: !!userProfile?.id,
    });

    const submitMutation = useMutation({
        mutationFn: async () => {
            if (!userProfile || !club) throw new Error("Missing user or club");
            await addDoc(collection(db, `clubs/${club.id}/upgradeRequests`), {
                memberId: userProfile.id,
                memberName: userProfile.name,
                clubId: club.id,
                parentClubId: club.id,
                proposedClubName: formData.proposedClubName,
                proposedDomain: formData.proposedDomain,
                address: formData.address,
                reason: formData.reason,
                status: "pending",
                createdAt: Timestamp.now(),
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["upgradeRequest"] });
            setDialogOpen(false);
            setFormData({ proposedClubName: "", proposedDomain: "", address: "", reason: "" });
            toast({
                title: "Request submitted!",
                description: "Super Admin will review and contact you.",
            });
        },
        onError: (err: Error) => {
            toast({ title: "Failed to submit", description: err.message, variant: "destructive" });
        },
    });

    const directCount = referrals.length;
    const activeCount = referrals.filter((r) => r.status === "active").length;

    const handleCopy = () => {
        navigator.clipboard.writeText(referralUrl);
        toast({ title: "Copied!" });
    };

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: "Join our club!",
                    text: `Join our nutrition club using my referral link: ${referralUrl}`,
                    url: referralUrl,
                });
                toast({ title: "Shared successfully!" });
            } catch (err: unknown) {
                if ((err as Error).name !== "AbortError") {
                    handleCopy();
                }
            }
        } else {
            handleCopy();
        }
    };

    const handleSubmitUpgrade = () => {
        if (!formData.proposedClubName.trim() || !formData.proposedDomain.trim()) {
            toast({ title: "Please fill required fields", variant: "destructive" });
            return;
        }
        submitMutation.mutate();
    };

    return (
        <div
            className="min-h-screen p-4 pb-24"
            style={{ fontFamily: "Nunito, sans-serif", backgroundColor: "#f8fffe" }}
        >
            <div className="mx-auto max-w-2xl space-y-6">
                <h1 className="text-xl font-bold" style={{ color: "#2d9653" }}>
                    My Network
                </h1>

                {/* Section 1 - My Referral Link */}
                <Card className="rounded-2xl border-0 bg-white shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-base font-bold" style={{ color: "#2d9653" }}>
                            My Referral Link
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="rounded-xl bg-muted/50 p-3 text-sm break-all">
                            {referralUrl}
                        </div>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                className="flex-1 rounded-xl"
                                style={{ backgroundColor: "#2d9653" }}
                                onClick={handleCopy}
                            >
                                <Copy className="mr-2 h-4 w-4" />
                                Copy
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 rounded-xl border-[#2d9653] text-[#2d9653] hover:bg-[#2d9653]/10"
                                onClick={handleShare}
                            >
                                <Share2 className="mr-2 h-4 w-4" />
                                Share
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Section 2 - My Network Stats */}
                <Card className="rounded-2xl border-0 bg-white shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-base font-bold" style={{ color: "#2d9653" }}>
                            My Network Stats
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {referralsLoading ? (
                            <div className="grid grid-cols-2 gap-3">
                                <Skeleton className="h-20 rounded-xl" />
                                <Skeleton className="h-20 rounded-xl" />
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-xl border border-[#2d9653]/20 bg-[#2d9653]/5 p-4">
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <Users className="h-4 w-4" />
                                        <span className="text-xs font-medium">Direct referrals</span>
                                    </div>
                                    <p className="mt-1 text-2xl font-bold" style={{ color: "#2d9653" }}>
                                        {directCount}
                                    </p>
                                </div>
                                <div className="rounded-xl border border-[#2d9653]/20 bg-[#2d9653]/5 p-4">
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <Check className="h-4 w-4" />
                                        <span className="text-xs font-medium">Active</span>
                                    </div>
                                    <p className="mt-1 text-2xl font-bold" style={{ color: "#2d9653" }}>
                                        {activeCount}
                                    </p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Section 3 - Referral List */}
                <Card className="rounded-2xl border-0 bg-white shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-base font-bold" style={{ color: "#2d9653" }}>
                            Referral List
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {referralsLoading ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => (
                                    <Skeleton key={i} className="h-16 rounded-xl" />
                                ))}
                            </div>
                        ) : !referrals.length ? (
                            <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 py-10 text-center">
                                <Users className="mx-auto mb-2 h-10 w-10 text-muted-foreground/50" />
                                <p className="text-sm text-muted-foreground">
                                    No referrals yet. Share your link to grow your network!
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {referrals.map((ref) => (
                                    <div
                                        key={ref.id}
                                        className="flex items-center justify-between rounded-xl border bg-muted/30 p-4"
                                    >
                                        <div>
                                            <p className="font-medium">{ref.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                Joined {ref.createdAt?.toDate?.() ? format(ref.createdAt.toDate(), "MMM d, yyyy") : "—"}
                                            </p>
                                        </div>
                                        <Badge
                                            variant={ref.status === "active" ? "default" : "destructive"}
                                            className={ref.status === "active" ? "bg-[#2d9653]" : ""}
                                        >
                                            {ref.status === "active" ? "Active" : "Expired"}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Section 4 - Upgrade to Club */}
                <Card className="rounded-2xl border-0 bg-white shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-base font-bold" style={{ color: "#2d9653" }}>
                            Ready to start your own club?
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {upgradeLoading ? (
                            <Skeleton className="h-24 rounded-xl" />
                        ) : pendingUpgrade ? (
                            <div className="rounded-xl border border-[#2d9653]/30 bg-[#2d9653]/5 p-4">
                                <p className="font-medium text-[#2d9653]">Request pending</p>
                                <p className="text-sm text-muted-foreground">
                                    Super Admin will review and contact you.
                                </p>
                            </div>
                        ) : submitMutation.isSuccess ? (
                            <div className="rounded-xl border border-[#2d9653]/30 bg-[#2d9653]/5 p-4">
                                <p className="font-medium text-[#2d9653]">Request submitted!</p>
                                <p className="text-sm text-muted-foreground">
                                    Your request has been submitted! Super Admin will review and contact you.
                                </p>
                            </div>
                        ) : (
                            <>
                                <ul className="space-y-2">
                                    {BENEFITS.map((b, i) => (
                                        <li key={i} className="flex items-center gap-2 text-sm">
                                            <Check className="h-4 w-4 shrink-0" style={{ color: "#2d9653" }} />
                                            {b}
                                        </li>
                                    ))}
                                </ul>
                                <Button
                                    className="w-full rounded-xl"
                                    style={{ backgroundColor: "#2d9653" }}
                                    onClick={() => setDialogOpen(true)}
                                >
                                    Apply to Become a Club
                                </Button>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Upgrade Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="rounded-2xl sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle style={{ color: "#2d9653" }}>
                            Apply to Become a Club
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                        <div>
                            <label className="mb-1 block text-sm font-medium">Proposed club name</label>
                            <Input
                                placeholder="e.g. Magic Nutrition Downtown"
                                value={formData.proposedClubName}
                                onChange={(e) =>
                                    setFormData((p) => ({ ...p, proposedClubName: e.target.value }))
                                }
                                className="rounded-xl"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium">Proposed domain</label>
                            <Input
                                placeholder="e.g. downtown.magicnutrition.com"
                                value={formData.proposedDomain}
                                onChange={(e) =>
                                    setFormData((p) => ({ ...p, proposedDomain: e.target.value }))
                                }
                                className="rounded-xl"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium">Address</label>
                            <Input
                                placeholder="Full address"
                                value={formData.address}
                                onChange={(e) =>
                                    setFormData((p) => ({ ...p, address: e.target.value }))
                                }
                                className="rounded-xl"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium">Reason</label>
                            <Textarea
                                placeholder="Why do you want to start your own club?"
                                value={formData.reason}
                                onChange={(e) =>
                                    setFormData((p) => ({ ...p, reason: e.target.value }))
                                }
                                className="min-h-[100px] rounded-xl"
                            />
                        </div>
                        <Button
                            className="w-full rounded-xl"
                            style={{ backgroundColor: "#2d9653" }}
                            onClick={handleSubmitUpgrade}
                            disabled={submitMutation.isPending}
                        >
                            {submitMutation.isPending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Submitting...
                                </>
                            ) : (
                                "Submit"
                            )}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
