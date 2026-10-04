import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
    Plus,
    Search,
    Settings,
    Power,
    Trash2,
    ExternalLink,
    Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAllClubs, useToggleClubStatus, useMemberCountByClub } from "@/hooks/useSuperAdmin";
import { usePaymentStatus, type PaymentStatus } from "@/hooks/superadmin/useClubPayments";
import type { Club } from "@/types/firestore";

// ─── Payment status badge ────────────────────────────────────────────────

function PaymentBadge({ club }: { club: Club }) {
    const status = usePaymentStatus(club);
    const map: Record<PaymentStatus, { label: string; cls: string }> = {
        paid: { label: "Paid", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
        "due-soon": { label: "Due Soon", cls: "border-yellow-200 bg-yellow-50 text-yellow-700" },
        overdue: { label: "Overdue", cls: "border-red-200 bg-red-50 text-red-700" },
    };
    const { label, cls } = map[status];
    return <Badge className={`text-xs ${cls}`}>{label}</Badge>;
}

// ─── Member count cell ───────────────────────────────────────────────────

function MemberCount({ clubId }: { clubId: string }) {
    const { data: count, isLoading } = useMemberCountByClub(clubId);
    if (isLoading) return <span className="text-muted-foreground text-xs">…</span>;
    return (
        <span className="flex items-center gap-1 text-sm">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
            {count ?? 0}
        </span>
    );
}

// ─── Firebase cost cell ──────────────────────────────────────────────────

function FbCostCell({ club }: { club: Club }) {
    // Quick estimate based on club age (simplified — full estimate in ClubDetail)
    const dueDate = club.maintenanceDueDate?.toDate?.();
    const fee = club.monthlyFee ?? 20_000;
    return (
        <span className="text-sm text-muted-foreground">
            ₹{fee.toLocaleString("en-IN")}
        </span>
    );
}

// ─── ClubsList ───────────────────────────────────────────────────────────

type PaymentFilter = "all" | "paid" | "due-soon" | "overdue";

export default function ClubsList() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { data: clubs, isLoading } = useAllClubs();
    const toggleStatus = useToggleClubStatus();
    const [search, setSearch] = useState("");
    const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");

    function getPaymentStatus(club: Club): PaymentStatus {
        const dueDate = club.maintenanceDueDate?.toDate?.();
        if (!dueDate) return "overdue";
        const diffDays = (dueDate.getTime() - Date.now()) / 86_400_000;
        if (diffDays < 0) return "overdue";
        if (diffDays <= 7) return "due-soon";
        return "paid";
    }

    const filtered = useMemo(() => {
        if (!clubs) return [];
        let list = [...clubs];

        if (paymentFilter !== "all") {
            list = list.filter((c) => getPaymentStatus(c) === paymentFilter);
        }

        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(
                (c) =>
                    c.name.toLowerCase().includes(q) ||
                    c.domain.toLowerCase().includes(q) ||
                    c.ownerName.toLowerCase().includes(q) ||
                    c.ownerEmail?.toLowerCase().includes(q)
            );
        }

        return list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    }, [clubs, search, paymentFilter]);

    async function handleToggleStatus(club: Club) {
        try {
            await toggleStatus.mutateAsync({ clubId: club.id, currentStatus: club.status });
            toast({
                title: club.status === "active" ? "Club suspended" : "Club activated",
            });
        } catch (err: unknown) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Unknown error",
                variant: "destructive",
            });
        }
    }

    function formatDate(ts: { toDate?: () => Date } | undefined) {
        if (!ts?.toDate) return "—";
        return ts.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }

    function getNextDue(club: Club): string {
        return formatDate(club.maintenanceDueDate as { toDate?: () => Date } | undefined);
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">All Clubs</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {clubs?.length ?? 0} clubs on the platform
                    </p>
                </div>
                <Button onClick={() => navigate("/superadmin/clubs/new")} className="gap-2">
                    <Plus className="w-4 h-4" />
                    New Club
                </Button>
            </div>

            {/* Search + Filter */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name, domain, or owner…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <Select value={paymentFilter} onValueChange={(v) => setPaymentFilter(v as PaymentFilter)}>
                    <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Payment status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Clubs</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="due-soon">Due Soon</SelectItem>
                        <SelectItem value="overdue">Overdue</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="space-y-2">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                    <p className="text-sm">No clubs match your search.</p>
                </div>
            ) : (
                <div className="bg-white rounded-2xl border overflow-hidden">
                    {/* Table header */}
                    <div className="hidden lg:grid lg:grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3 bg-gray-50 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <span>Club</span>
                        <span>Owner</span>
                        <span>Members</span>
                        <span>Payment</span>
                        <span>Next Due</span>
                        <span>Monthly Fee</span>
                        <span>Actions</span>
                    </div>

                    <div className="divide-y">
                        {filtered.map((club) => {
                            const initials = club.name
                                .split(" ")
                                .map((w) => w[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase();

                            return (
                                <div
                                    key={club.id}
                                    className="grid grid-cols-1 lg:grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr_auto] gap-3 lg:gap-4 items-center px-4 py-3 hover:bg-gray-50 transition-colors"
                                >
                                    {/* Club name */}
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Avatar className="h-9 w-9 rounded-xl flex-shrink-0">
                                            {club.logo ? <AvatarImage src={club.logo} /> : null}
                                            <AvatarFallback
                                                className="rounded-xl text-white text-xs font-bold"
                                                style={{ backgroundColor: club.primaryColor || "#8B5CF6" }}
                                            >
                                                {initials}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold truncate">{club.name}</p>
                                            <p className="text-xs text-muted-foreground truncate">{club.domain}</p>
                                            <div className="flex items-center gap-1.5 mt-1 lg:hidden">
                                                <Badge
                                                    variant={club.status === "active" ? "outline" : "destructive"}
                                                    className={`text-[10px] ${club.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""}`}
                                                >
                                                    {club.status}
                                                </Badge>
                                                <PaymentBadge club={club} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Owner */}
                                    <div className="hidden lg:block min-w-0">
                                        <p className="text-sm truncate">{club.ownerName}</p>
                                        <p className="text-xs text-muted-foreground truncate">{club.ownerEmail ?? "—"}</p>
                                    </div>

                                    {/* Members */}
                                    <div className="hidden lg:block">
                                        <MemberCount clubId={club.id} />
                                    </div>

                                    {/* Payment status */}
                                    <div className="hidden lg:flex items-center gap-1.5">
                                        <Badge
                                            variant={club.status === "active" ? "outline" : "destructive"}
                                            className={`text-xs ${club.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""}`}
                                        >
                                            {club.status === "active" ? "Active" : "Suspended"}
                                        </Badge>
                                        <PaymentBadge club={club} />
                                    </div>

                                    {/* Next due */}
                                    <div className="hidden lg:block">
                                        <p className="text-sm">{getNextDue(club)}</p>
                                    </div>

                                    {/* Monthly fee */}
                                    <div className="hidden lg:block">
                                        <FbCostCell club={club} />
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1">
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8"
                                            title="Manage Club"
                                            onClick={() => navigate(`/superadmin/clubs/${club.id}`)}
                                        >
                                            <Settings className="w-4 h-4" />
                                        </Button>
                                        {club.landingPageUrl && (
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8"
                                                title="View Landing Page"
                                                onClick={() => window.open(club.landingPageUrl!, "_blank")}
                                            >
                                                <ExternalLink className="w-4 h-4" />
                                            </Button>
                                        )}
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className={`h-8 w-8 ${club.status === "active" ? "text-orange-500 hover:text-orange-600" : "text-emerald-500 hover:text-emerald-600"}`}
                                                    title={club.status === "active" ? "Suspend Club" : "Activate Club"}
                                                >
                                                    <Power className="w-4 h-4" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>
                                                        {club.status === "active" ? `Suspend ${club.name}?` : `Activate ${club.name}?`}
                                                    </AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        {club.status === "active"
                                                            ? "Members will be unable to access this club until it is reactivated."
                                                            : "This will restore access for all club members and staff."}
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => handleToggleStatus(club)}
                                                        className={club.status === "active" ? "bg-orange-500 hover:bg-orange-600" : ""}
                                                    >
                                                        {club.status === "active" ? "Suspend" : "Activate"}
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
