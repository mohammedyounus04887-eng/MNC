import { useMemo, useState } from "react";
import {
    GitBranch, Users, Globe, Search, Phone, Mail, MapPin,
    CheckCircle2, AlertTriangle, Ban, ExternalLink, Calendar,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDownlineClubs, type DownlineClub } from "@/hooks/useOwner";
import { useClubContext } from "@/lib/clubDetection";

const ACCENT = "#2d9653";

type StatusFilter = "all" | "active" | "suspended" | "disabled";

export default function DownlineClubs() {
    const { club } = useClubContext();
    const { data: downline, isLoading } = useDownlineClubs();
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

    const clubs = downline ?? [];

    const stats = useMemo(() => {
        const active = clubs.filter((c) => c.status === "active").length;
        const suspended = clubs.filter((c) => c.status === "suspended").length;
        const disabled = clubs.filter((c) => c.status === "disabled").length;
        const totalMembers = clubs.reduce((sum, c) => sum + (c.memberCount ?? 0), 0);
        const maintenanceDue = clubs.filter((c) => !c.maintenancePaid).length;
        return { total: clubs.length, active, suspended, disabled, totalMembers, maintenanceDue };
    }, [clubs]);

    const filtered = useMemo(() => {
        return clubs.filter((c) => {
            if (statusFilter !== "all" && c.status !== statusFilter) return false;
            if (!search.trim()) return true;
            const q = search.toLowerCase();
            return (
                c.name?.toLowerCase().includes(q) ||
                c.domain?.toLowerCase().includes(q) ||
                c.ownerName?.toLowerCase().includes(q) ||
                c.ownerPhone?.includes(q)
            );
        });
    }, [clubs, search, statusFilter]);

    return (
        <div className="space-y-5 animate-fade-in" style={{ fontFamily: "'Nunito', sans-serif" }}>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: "#1a3a2a" }}>
                        <GitBranch className="w-6 h-6" style={{ color: ACCENT }} /> Club Network
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Clubs under <span className="font-bold">{club?.name}</span> — {stats.total} downline
                    </p>
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total Clubs" value={stats.total} icon={<GitBranch className="w-4 h-4" />} tint="emerald" />
                <StatCard label="Active" value={stats.active} icon={<CheckCircle2 className="w-4 h-4" />} tint="green" />
                <StatCard label="Total Members" value={stats.totalMembers} icon={<Users className="w-4 h-4" />} tint="blue" />
                <StatCard label="Maintenance Due" value={stats.maintenanceDue} icon={<AlertTriangle className="w-4 h-4" />} tint="amber" />
            </div>

            {/* Search + filter */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by club, domain, owner, or phone..."
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold focus:outline-none focus:ring-2"
                        style={{ outlineColor: ACCENT }}
                    />
                </div>
                <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
                    {(["all", "active", "suspended", "disabled"] as const).map((s) => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors"
                            style={{
                                background: statusFilter === s ? "#fff" : "transparent",
                                color: statusFilter === s ? ACCENT : "#64748b",
                                boxShadow: statusFilter === s ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                            }}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* List */}
            {isLoading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState hasClubs={clubs.length > 0} />
            ) : (
                <div className="space-y-3">
                    {filtered.map((c) => <ClubCard key={c.id} club={c} />)}
                </div>
            )}
        </div>
    );
}

// ── Sub-components ──────────────────────────────────────────────────────

function StatCard({ label, value, icon, tint }: {
    label: string; value: number; icon: React.ReactNode;
    tint: "emerald" | "green" | "blue" | "amber";
}) {
    const palette = {
        emerald: { bg: "#ecfdf5", text: "#047857", border: "#a7f3d0" },
        green: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
        blue: { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
        amber: { bg: "#fffbeb", text: "#b45309", border: "#fde68a" },
    }[tint];
    return (
        <div
            className="rounded-2xl border p-4 bg-white"
            style={{ borderColor: palette.border }}
        >
            <div className="flex items-center gap-2 mb-1" style={{ color: palette.text }}>
                {icon}
                <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
            </div>
            <p className="text-2xl font-black" style={{ color: palette.text }}>{value}</p>
        </div>
    );
}

function ClubCard({ club }: { club: DownlineClub }) {
    const initials = (club.name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const dueDate = club.maintenanceDueDate?.toDate ? club.maintenanceDueDate.toDate() : null;
    const dueStr = dueDate ? dueDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;
    const maintenanceLate = !club.maintenancePaid && dueDate && dueDate.getTime() < Date.now();

    return (
        <div
            className="rounded-2xl border bg-white p-4 hover:shadow-md transition-shadow"
            style={{
                borderColor: "#e0f0e9",
                marginLeft: `${Math.min(club.depth - 1, 4) * 20}px`,
            }}
        >
            <div className="flex items-start gap-4">
                {/* Logo */}
                {club.logo ? (
                    <img
                        src={club.logo}
                        alt={club.name}
                        className="w-14 h-14 rounded-2xl object-cover flex-shrink-0 border-2"
                        style={{ borderColor: club.primaryColor || ACCENT }}
                    />
                ) : (
                    <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 text-white font-black text-lg"
                        style={{ backgroundColor: club.primaryColor || ACCENT }}
                    >
                        {initials}
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-black text-base truncate" style={{ color: "#1a3a2a" }}>{club.name}</h3>
                                <StatusBadge status={club.status} />
                                {club.depth > 1 && (
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                        Level {club.depth}
                                    </span>
                                )}
                            </div>
                            {club.tagline && (
                                <p className="text-xs text-slate-500 mt-0.5 truncate">{club.tagline}</p>
                            )}
                        </div>
                        <div className="text-right flex-shrink-0">
                            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Members</p>
                            <p className="text-xl font-black" style={{ color: ACCENT }}>{club.memberCount}</p>
                        </div>
                    </div>

                    {/* Info grid */}
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        <InfoRow icon={<Globe className="w-3.5 h-3.5" />} label="Domain">
                            {club.domain ? (
                                <a
                                    href={`https://${club.domain}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-bold hover:underline inline-flex items-center gap-1"
                                    style={{ color: ACCENT }}
                                >
                                    {club.domain}
                                    <ExternalLink className="w-3 h-3" />
                                </a>
                            ) : "—"}
                        </InfoRow>
                        <InfoRow icon={<Users className="w-3.5 h-3.5" />} label="Owner">
                            <span className="font-bold text-slate-700">{club.ownerName || "—"}</span>
                        </InfoRow>
                        {club.ownerPhone && (
                            <InfoRow icon={<Phone className="w-3.5 h-3.5" />} label="Phone">
                                <a href={`tel:${club.ownerPhone}`} className="font-bold text-slate-700 hover:underline">
                                    {club.ownerPhone}
                                </a>
                            </InfoRow>
                        )}
                        {club.ownerEmail && (
                            <InfoRow icon={<Mail className="w-3.5 h-3.5" />} label="Email">
                                <a href={`mailto:${club.ownerEmail}`} className="font-bold text-slate-700 hover:underline truncate">
                                    {club.ownerEmail}
                                </a>
                            </InfoRow>
                        )}
                        {club.address && (
                            <InfoRow icon={<MapPin className="w-3.5 h-3.5" />} label="Location">
                                <span className="font-bold text-slate-700 truncate">{club.address}</span>
                            </InfoRow>
                        )}
                        <InfoRow icon={<Calendar className="w-3.5 h-3.5" />} label="Maintenance">
                            <MaintenanceTag paid={club.maintenancePaid} dueStr={dueStr} late={!!maintenanceLate} />
                        </InfoRow>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { bg: string; text: string; icon: React.ReactNode; label: string }> = {
        active: { bg: "#ecfdf5", text: "#047857", icon: <CheckCircle2 className="w-3 h-3" />, label: "Active" },
        suspended: { bg: "#fffbeb", text: "#b45309", icon: <AlertTriangle className="w-3 h-3" />, label: "Suspended" },
        disabled: { bg: "#fef2f2", text: "#b91c1c", icon: <Ban className="w-3 h-3" />, label: "Disabled" },
    };
    const cfg = map[status] ?? map.disabled;
    return (
        <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider"
            style={{ background: cfg.bg, color: cfg.text }}
        >
            {cfg.icon} {cfg.label}
        </span>
    );
}

function InfoRow({ icon, label, children }: {
    icon: React.ReactNode; label: string; children: React.ReactNode;
}) {
    return (
        <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 flex-shrink-0">{icon}</span>
            <span className="text-slate-400 font-semibold">{label}:</span>
            <span className="truncate">{children}</span>
        </div>
    );
}

function MaintenanceTag({ paid, dueStr, late }: { paid: boolean; dueStr: string | null; late: boolean }) {
    if (paid) {
        return (
            <span className="font-bold text-emerald-700">
                Paid {dueStr ? `· next ${dueStr}` : ""}
            </span>
        );
    }
    return (
        <span className="font-bold" style={{ color: late ? "#b91c1c" : "#b45309" }}>
            {late ? "Overdue" : "Due"} {dueStr ? `· ${dueStr}` : ""}
        </span>
    );
}

function EmptyState({ hasClubs }: { hasClubs: boolean }) {
    return (
        <div className="text-center py-16 border-2 border-dashed rounded-2xl bg-white" style={{ borderColor: "#e0f0e9" }}>
            <GitBranch className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500 font-bold text-sm">
                {hasClubs ? "No clubs match your filters" : "No clubs in your downline yet"}
            </p>
            {!hasClubs && (
                <p className="text-xs text-slate-400 mt-1">
                    Clubs referred by you will appear here once they're created.
                </p>
            )}
        </div>
    );
}
