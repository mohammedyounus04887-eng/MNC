import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Search, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
    useAllMembersOfClub,
    useConvertMemberToClubOwner,
    useDownlineCount,
} from "@/hooks/useSuperAdmin";
import type { User } from "@/types/firestore";

export default function ConvertToClub() {
    const { clubId } = useParams<{ clubId: string }>();
    const navigate = useNavigate();
    const { toast } = useToast();

    const { data: members, isLoading } = useAllMembersOfClub(clubId || "");
    const convertMember = useConvertMemberToClubOwner();

    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [search, setSearch] = useState("");
    const [selectedMember, setSelectedMember] = useState<User | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    // New club details
    const [clubName, setClubName] = useState("");
    const [currencyName, setCurrencyName] = useState("");
    const [domain, setDomain] = useState("");
    const [tagline, setTagline] = useState("");
    const [kitchenPin, setKitchenPin] = useState("");
    const [primaryColor, setPrimaryColor] = useState("#8B5CF6");

    const filteredMembers = members?.filter((m) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return m.name.toLowerCase().includes(q) || m.phone.includes(q);
    });

    const handleConfirm = async () => {
        if (!selectedMember || !clubId) return;

        try {
            const newClubId = await convertMember.mutateAsync({
                memberId: selectedMember.id,
                clubDetails: {
                    name: clubName,
                    currencyName,
                    domain,
                    tagline,
                    kitchenPin,
                    theme: "custom",
                    primaryColor,
                    parentClubId: clubId,
                },
                createdBy: "superadmin",
            });

            toast({
                title: "Member converted!",
                description: `${selectedMember.name} is now a Club Owner.`,
            });

            navigate(`/superadmin/clubs/${newClubId}`);
        } catch (err: any) {
            toast({
                title: "Conversion failed",
                description: err.message,
                variant: "destructive",
            });
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                        step === 1 ? navigate(`/superadmin/clubs/${clubId}`) : setStep((s) => (s - 1) as any)
                    }
                >
                    <ArrowLeft className="w-5 h-5" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Convert Member to Club Owner</h1>
                    <p className="text-sm text-muted-foreground">Step {step} of 3</p>
                </div>
            </div>

            {/* Step indicators */}
            <div className="flex items-center gap-2">
                {[1, 2, 3].map((s) => (
                    <div
                        key={s}
                        className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? "bg-violet-500" : "bg-gray-200"
                            }`}
                    />
                ))}
            </div>

            {/* Step 1: Search Member */}
            {step === 1 && (
                <div className="space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="Search member by name or phone…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9"
                        />
                    </div>

                    {isLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map((i) => (
                                <Skeleton key={i} className="h-16 rounded-xl" />
                            ))}
                        </div>
                    ) : filteredMembers && filteredMembers.length > 0 ? (
                        <div className="space-y-2">
                            {filteredMembers.map((member) => (
                                <MemberRow
                                    key={member.id}
                                    member={member}
                                    onSelect={() => {
                                        setSelectedMember(member);
                                        setStep(2);
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-sm text-muted-foreground py-8">
                            No members found.
                        </p>
                    )}
                </div>
            )}

            {/* Step 2: Club Details */}
            {step === 2 && selectedMember && (
                <div className="space-y-6">
                    {/* Selected member */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-50 border border-violet-200">
                        <Avatar className="h-10 w-10">
                            {selectedMember.photo ? <AvatarImage src={selectedMember.photo} /> : null}
                            <AvatarFallback className="bg-violet-500 text-white font-bold text-sm">
                                {selectedMember.name[0]}
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <p className="text-sm font-semibold">{selectedMember.name}</p>
                            <p className="text-xs text-muted-foreground">{selectedMember.phone}</p>
                        </div>
                        <Badge className="ml-auto">{(selectedMember as any).shakeCredits ?? 0} Credits</Badge>
                    </div>

                    {/* New club form */}
                    <div className="max-w-lg space-y-4 bg-white rounded-2xl border p-6">
                        <div className="space-y-2">
                            <Label>New Club Name *</Label>
                            <Input value={clubName} onChange={(e) => setClubName(e.target.value)} placeholder="Club Name" />
                        </div>
                        <div className="space-y-2">
                            <Label>Currency Name *</Label>
                            <Input value={currencyName} onChange={(e) => setCurrencyName(e.target.value)} placeholder="e.g. Health Coins" />
                        </div>
                        <div className="space-y-2">
                            <Label>Domain *</Label>
                            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. healthylife.com" />
                        </div>
                        <div className="space-y-2">
                            <Label>Tagline</Label>
                            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Optional tagline" />
                        </div>
                        <div className="space-y-2">
                            <Label>Kitchen PIN *</Label>
                            <Input value={kitchenPin} onChange={(e) => setKitchenPin(e.target.value.replace(/\D/g, ""))} maxLength={4} placeholder="1234" />
                        </div>

                        {/* Warning */}
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-50 border border-orange-200 text-sm">
                            <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                            <p className="text-orange-700">
                                This will move all members from {selectedMember.name}'s downline into the new club. This cannot be undone.
                            </p>
                        </div>

                        <Button
                            className="w-full"
                            disabled={!clubName || !currencyName || !domain || kitchenPin.length !== 4}
                            onClick={() => setStep(3)}
                        >
                            Review & Confirm
                            <ChevronRight className="w-4 h-4 ml-2" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Step 3: Confirm */}
            {step === 3 && selectedMember && (
                <div className="max-w-lg space-y-6">
                    <div className="bg-white rounded-2xl border p-6 space-y-4">
                        <h3 className="font-semibold">Conversion Summary</h3>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between py-2 border-b">
                                <span className="text-muted-foreground">Member</span>
                                <span className="font-medium">{selectedMember.name}</span>
                            </div>
                            <div className="flex justify-between py-2 border-b">
                                <span className="text-muted-foreground">New Role</span>
                                <Badge>Club Owner</Badge>
                            </div>
                            <div className="flex justify-between py-2 border-b">
                                <span className="text-muted-foreground">New Club</span>
                                <span className="font-medium">{clubName}</span>
                            </div>
                            <div className="flex justify-between py-2 border-b">
                                <span className="text-muted-foreground">Currency</span>
                                <span className="font-medium">{currencyName}</span>
                            </div>
                            <div className="flex justify-between py-2 border-b">
                                <span className="text-muted-foreground">Domain</span>
                                <span className="font-medium">{domain}</span>
                            </div>
                        </div>

                        <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
                            <Button className="w-full" onClick={() => setShowConfirm(true)}>
                                Confirm & Create Club
                            </Button>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Final Confirmation</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        {selectedMember.name} will become the owner of "{clubName}".
                                        All users in their downline will be moved to the new club.
                                        This action cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        onClick={handleConfirm}
                                        disabled={convertMember.isPending}
                                    >
                                        {convertMember.isPending ? "Converting…" : "Confirm"}
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Member Row Component ───────────────────────────────────────────────

function MemberRow({ member, onSelect }: { member: User; onSelect: () => void }) {
    const { data: downlineCount } = useDownlineCount(member.treePath);

    return (
        <div
            onClick={onSelect}
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-white hover:shadow-md cursor-pointer transition-all"
        >
            <Avatar className="h-10 w-10">
                {member.photo ? <AvatarImage src={member.photo} /> : null}
                <AvatarFallback className="bg-violet-100 text-violet-700 font-bold text-sm">
                    {member.name[0]}
                </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{member.name}</p>
                <p className="text-xs text-muted-foreground">{member.phone}</p>
            </div>
            <div className="text-right flex-shrink-0">
                <Badge variant="outline" className="text-xs">
                    {(member as any).shakeCredits ?? 0} credits
                </Badge>
                <p className="text-xs text-muted-foreground mt-1">
                    {downlineCount ?? 0} in downline
                </p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </div>
    );
}
