import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    collection,
    getDocs,
    updateDoc,
    addDoc,
    doc,
    Timestamp,
    orderBy,
    query,
    where,
} from "firebase/firestore";
import {
    Store,
    Check,
    X,
    Clock,
    ChevronDown,
    ChevronUp,
    Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface UpgradeRequest {
    id: string;
    memberId: string;
    memberName: string;
    clubId: string;
    parentClubId: string;
    proposedClubName: string;
    proposedDomain: string;
    address: string;
    reason: string;
    status: "pending" | "approved" | "rejected";
    rejectionReason?: string;
    createdAt: Timestamp;
}

function formatTs(ts: Timestamp | undefined | null): string {
    if (!ts?.toDate) return "—";
    return format(ts.toDate(), "dd MMM yyyy");
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
    pending: { label: "Pending", className: "bg-yellow-100 text-yellow-700" },
    approved: { label: "Approved", className: "bg-green-100 text-green-700" },
    rejected: { label: "Rejected", className: "bg-red-100 text-red-700" },
};

export default function UpgradeRequests() {
    const { userProfile } = useAuth();
    const { toast } = useToast();
    const qc = useQueryClient();
    const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
    const [expanded, setExpanded] = useState<string | null>(null);
    const [rejectId, setRejectId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState("");

    const { data: requests = [], isLoading } = useQuery({
        queryKey: ["upgrade-requests"],
        queryFn: async () => {
            const q = query(collection(db, "upgradeRequests"), orderBy("createdAt", "desc"));
            const snap = await getDocs(q);
            return snap.docs.map((d) => ({ id: d.id, ...d.data() } as UpgradeRequest));
        },
    });

    const approve = useMutation({
        mutationFn: async (req: UpgradeRequest) => {
            const clubRef = await addDoc(collection(db, "clubs"), {
                name: req.proposedClubName,
                domain: req.proposedDomain,
                domains: [req.proposedDomain],
                parentClubId: req.parentClubId,
                ownerName: req.memberName,
                ownerUserId: req.memberId,
                status: "active",
                kitchenPin: String(Math.floor(100000 + Math.random() * 900000)),
                adminPin: String(Math.floor(10000000 + Math.random() * 90000000)),
                primaryColor: "#2d9653",
                secondaryColor: "#f8fffe",
                tertiaryColor: "#e0f0e9",
                theme: "green",
                currencyName: "MNC Currency",
                logo: "",
                heroImage: "",
                tagline: "",
                address: req.address,
                treePath: "",
                maintenancePaid: false,
                maintenanceDueDate: Timestamp.now(),
                landingPageUrl: null,
                landingPageImages: [],
                createdAt: Timestamp.now(),
                createdBy: userProfile?.id || "superAdmin",
            });
            await updateDoc(doc(db, "upgradeRequests", req.id), {
                status: "approved",
                resolvedAt: Timestamp.now(),
                resolvedBy: userProfile?.id || "superAdmin",
                newClubId: clubRef.id,
            });
        },
        onSuccess: () => {
            toast({ title: "Approved", description: "New club created successfully." });
            qc.invalidateQueries({ queryKey: ["upgrade-requests"] });
        },
        onError: () => toast({ title: "Error", description: "Failed to approve request.", variant: "destructive" }),
    });

    const reject = useMutation({
        mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
            await updateDoc(doc(db, "upgradeRequests", id), {
                status: "rejected",
                rejectionReason: reason,
                resolvedAt: Timestamp.now(),
                resolvedBy: userProfile?.id || "superAdmin",
            });
        },
        onSuccess: () => {
            toast({ title: "Rejected", description: "Request has been rejected." });
            qc.invalidateQueries({ queryKey: ["upgrade-requests"] });
            setRejectId(null);
            setRejectReason("");
        },
        onError: () => toast({ title: "Error", description: "Failed to reject request.", variant: "destructive" }),
    });

    const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);
    const pendingCount = requests.filter((r) => r.status === "pending").length;

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-64" />
                {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-28 w-full rounded-xl" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <Store className="w-6 h-6 text-violet-600" />
                    <h1 className="text-xl font-bold">Club Upgrade Requests</h1>
                    {pendingCount > 0 && (
                        <Badge className="bg-yellow-100 text-yellow-700 font-bold">{pendingCount} pending</Badge>
                    )}
                </div>
                <div className="flex gap-2">
                    {(["all", "pending", "approved", "rejected"] as const).map((f) => (
                        <Button
                            key={f}
                            size="sm"
                            variant={filter === f ? "default" : "outline"}
                            onClick={() => setFilter(f)}
                            className="capitalize text-xs"
                        >
                            {f}
                        </Button>
                    ))}
                </div>
            </div>

            {filtered.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">
                    <Store className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No {filter === "all" ? "" : filter} requests</p>
                </div>
            )}

            <div className="space-y-3">
                {filtered.map((req) => {
                    const isExpanded = expanded === req.id;
                    const badge = STATUS_BADGE[req.status];
                    return (
                        <div key={req.id} className="bg-white rounded-xl border p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-bold text-sm">{req.proposedClubName}</h3>
                                        <Badge className={badge.className}>{badge.label}</Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        by {req.memberName} · {formatTs(req.createdAt)}
                                    </p>
                                    <p className="text-xs text-muted-foreground">Domain: {req.proposedDomain}</p>
                                </div>
                                <button onClick={() => setExpanded(isExpanded ? null : req.id)} className="text-muted-foreground">
                                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                </button>
                            </div>

                            {isExpanded && (
                                <div className="text-sm space-y-2 border-t pt-3">
                                    <div><span className="font-semibold">Address:</span> {req.address || "—"}</div>
                                    <div><span className="font-semibold">Reason:</span> {req.reason || "—"}</div>
                                    <div><span className="font-semibold">Member ID:</span> {req.memberId}</div>
                                    <div><span className="font-semibold">Parent Club ID:</span> {req.parentClubId}</div>
                                    {req.rejectionReason && (
                                        <div className="text-red-600"><span className="font-semibold">Rejection reason:</span> {req.rejectionReason}</div>
                                    )}
                                </div>
                            )}

                            {req.status === "pending" && (
                                <div className="flex gap-2 pt-1">
                                    <Button
                                        size="sm"
                                        className="bg-green-600 hover:bg-green-700 text-white text-xs"
                                        disabled={approve.isPending}
                                        onClick={() => approve.mutate(req)}
                                    >
                                        {approve.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                                        Approve & Create Club
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-red-600 border-red-200 text-xs"
                                        onClick={() => setRejectId(req.id)}
                                    >
                                        <X className="w-3 h-3 mr-1" />
                                        Reject
                                    </Button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <Dialog open={!!rejectId} onOpenChange={() => { setRejectId(null); setRejectReason(""); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Reject Request</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <Input
                            placeholder="Reason for rejection..."
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" onClick={() => { setRejectId(null); setRejectReason(""); }}>Cancel</Button>
                            <Button
                                className="bg-red-600 hover:bg-red-700 text-white"
                                disabled={!rejectReason.trim() || reject.isPending}
                                onClick={() => rejectId && reject.mutate({ id: rejectId, reason: rejectReason })}
                            >
                                {reject.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                                Reject
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
