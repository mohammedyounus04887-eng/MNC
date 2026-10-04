import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ExternalLink, Settings, Power } from "lucide-react";
import MaintenanceBadge from "./MaintenanceBadge";
import { useToggleClubStatus, useMemberCountByClub } from "@/hooks/useSuperAdmin";
import { Skeleton } from "@/components/ui/skeleton";
import type { Club } from "@/types/firestore";

interface Props {
    club: Club;
}

export default function ClubCard({ club }: Props) {
    const navigate = useNavigate();
    const toggleStatus = useToggleClubStatus();
    const { data: memberCount, isLoading: countLoading } = useMemberCountByClub(club.id);

    const initials = club.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    return (
        <div className="rounded-2xl border border-border bg-white p-5 space-y-4 hover:shadow-lg transition-shadow">
            {/* Header */}
            <div className="flex items-start gap-3">
                <Avatar className="h-12 w-12 rounded-xl">
                    {club.logo ? <AvatarImage src={club.logo} alt={club.name} /> : null}
                    <AvatarFallback className="rounded-xl bg-gradient-to-br from-violet-500 to-emerald-500 text-white font-bold text-sm">
                        {initials}
                    </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm truncate">{club.name}</h3>
                    <p className="text-xs text-muted-foreground truncate">{club.currencyName}</p>
                </div>
                <Badge
                    variant={club.status === "active" ? "outline" : "destructive"}
                    className={
                        club.status === "active"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 text-xs"
                            : "text-xs"
                    }
                >
                    {club.status === "active" ? "Active" : "Disabled"}
                </Badge>
            </div>

            {/* Details */}
            <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Domain</span>
                    <a
                        href={`https://${club.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-violet-600 hover:underline flex items-center gap-1"
                    >
                        {club.domain} <ExternalLink className="w-3 h-3" />
                    </a>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Owner</span>
                    <span className="font-medium">{club.ownerName}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Members</span>
                    {countLoading ? (
                        <Skeleton className="h-4 w-8" />
                    ) : (
                        <span className="font-medium">{memberCount ?? 0}</span>
                    )}
                </div>
                <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Maintenance</span>
                    <MaintenanceBadge
                        maintenancePaid={club.maintenancePaid}
                        maintenanceDueDate={club.maintenanceDueDate}
                    />
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
                <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={() => navigate(`/superadmin/clubs/${club.id}`)}
                >
                    <Settings className="w-3.5 h-3.5 mr-1" />
                    Manage
                </Button>
                <Button
                    size="sm"
                    variant={club.status === "active" ? "destructive" : "default"}
                    className="text-xs"
                    disabled={toggleStatus.isPending}
                    onClick={() =>
                        toggleStatus.mutate({ clubId: club.id, currentStatus: club.status })
                    }
                >
                    <Power className="w-3.5 h-3.5 mr-1" />
                    {club.status === "active" ? "Disable" : "Enable"}
                </Button>
            </div>
        </div>
    );
}
