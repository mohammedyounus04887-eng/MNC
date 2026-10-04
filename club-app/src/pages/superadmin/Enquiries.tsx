import { useState, useMemo } from "react";
import {
    Search,
    ChevronDown,
    ChevronUp,
    MessageSquare,
    CheckCircle,
    Reply,
    Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
    useClubFeedback,
    useUpdateClubFeedbackStatus,
    exportClubFeedbackToCSV,
} from "@/hooks/superadmin/useEnquiries";
import { useAllClubs } from "@/hooks/useSuperAdmin";
import type { ClubFeedback } from "@/types/firestore";

// ─── Status badge colors ──────────────────────────────────────────────────

const statusColors: Record<ClubFeedback["status"], string> = {
    new: "border-blue-200 bg-blue-50 text-blue-700",
    read: "border-yellow-200 bg-yellow-50 text-yellow-700",
    resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const categoryLabels: Record<ClubFeedback["category"], string> = {
    general: "💬 General",
    bug_report: "🐛 Bug Report",
    feature_request: "💡 Feature Request",
    billing: "💳 Billing",
    support: "🆘 Support",
    other: "📝 Other",
};

function formatDate(ts: { toDate?: () => Date } | null | undefined) {
    if (!ts?.toDate) return "—";
    return ts.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Club Feedback Page (Super Admin) ─────────────────────────────────────

export default function Enquiries() {
    const { toast } = useToast();
    const { data: feedbackList, isLoading } = useClubFeedback();
    const { data: clubs } = useAllClubs();
    const updateStatus = useUpdateClubFeedbackStatus();

    const [search, setSearch] = useState("");
    const [filterClub, setFilterClub] = useState("all");
    const [filterStatus, setFilterStatus] = useState<ClubFeedback["status"] | "all">("all");
    const [filterCategory, setFilterCategory] = useState<ClubFeedback["category"] | "all">("all");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [replyingId, setReplyingId] = useState<string | null>(null);
    const [replyText, setReplyText] = useState("");

    const clubMap = useMemo(() => {
        const m: Record<string, string> = {};
        clubs?.forEach((c) => { m[c.id] = c.name; });
        return m;
    }, [clubs]);

    const filtered = useMemo(() => {
        if (!feedbackList) return [];
        let list = [...feedbackList];

        if (filterClub !== "all") list = list.filter((e) => e.clubId === filterClub);
        if (filterStatus !== "all") list = list.filter((e) => e.status === filterStatus);
        if (filterCategory !== "all") list = list.filter((e) => e.category === filterCategory);
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(
                (e) =>
                    e.subject.toLowerCase().includes(q) ||
                    e.message.toLowerCase().includes(q) ||
                    e.senderName.toLowerCase().includes(q) ||
                    e.clubName.toLowerCase().includes(q)
            );
        }

        return list;
    }, [feedbackList, filterClub, filterStatus, filterCategory, search]);

    const handleReply = async (clubId: string, feedbackId: string) => {
        if (!replyText.trim()) return;
        try {
            await updateStatus.mutateAsync({
                clubId,
                feedbackId,
                status: "resolved",
                reply: replyText.trim(),
            });
            toast({ title: "Reply sent & marked as resolved ✅" });
            setReplyingId(null);
            setReplyText("");
        } catch {
            toast({ title: "Error sending reply", variant: "destructive" });
        }
    };

    const handleMarkRead = async (clubId: string, feedbackId: string) => {
        try {
            await updateStatus.mutateAsync({ clubId, feedbackId, status: "read" });
            toast({ title: "Marked as read" });
        } catch {
            toast({ title: "Error", variant: "destructive" });
        }
    };


    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Club Feedback</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Messages and requests from club owners
                        {feedbackList && ` · ${filtered.length} of ${feedbackList.length}`}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => exportClubFeedbackToCSV(filtered, "club-feedback.csv")}
                        disabled={!filtered.length}
                    >
                        Export CSV
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-2xl border p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="relative sm:col-span-2 lg:col-span-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="Search subject, message, sender…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                    <Select value={filterClub} onValueChange={setFilterClub}>
                        <SelectTrigger>
                            <SelectValue placeholder="All Clubs" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Clubs</SelectItem>
                            {clubs?.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as ClubFeedback["status"] | "all")}>
                        <SelectTrigger>
                            <SelectValue placeholder="All Statuses" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            <SelectItem value="new">🔵 New</SelectItem>
                            <SelectItem value="read">🟡 Read</SelectItem>
                            <SelectItem value="resolved">🟢 Resolved</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v as ClubFeedback["category"] | "all")}>
                        <SelectTrigger>
                            <SelectValue placeholder="All Categories" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            <SelectItem value="general">💬 General</SelectItem>
                            <SelectItem value="bug_report">🐛 Bug Report</SelectItem>
                            <SelectItem value="feature_request">💡 Feature Request</SelectItem>
                            <SelectItem value="billing">💳 Billing</SelectItem>
                            <SelectItem value="support">🆘 Support</SelectItem>
                            <SelectItem value="other">📝 Other</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {(search || filterClub !== "all" || filterStatus !== "all" || filterCategory !== "all") && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setSearch(""); setFilterClub("all"); setFilterStatus("all"); setFilterCategory("all");
                        }}
                    >
                        Clear Filters
                    </Button>
                )}
            </div>

            {/* Feedback List */}
            {isLoading ? (
                <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">
                        {feedbackList?.length === 0
                            ? "No club feedback yet. Club owners can send messages from their dashboard."
                            : "No feedback matches your filters."}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map((fb) => (
                        <div key={fb.id} className={`bg-white rounded-2xl border overflow-hidden transition-all ${fb.status === "new" ? "border-blue-200 shadow-sm" : ""}`}>
                            {/* Header row */}
                            <div
                                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
                                onClick={() => setExpandedId(expandedId === fb.id ? null : fb.id)}
                            >
                                {/* Status indicator */}
                                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${fb.status === "new" ? "bg-blue-500" : fb.status === "read" ? "bg-yellow-400" : "bg-emerald-500"}`} />

                                {/* Main info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="text-sm font-semibold truncate">{fb.subject}</p>
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                            {categoryLabels[fb.category] ?? fb.category}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {fb.clubName} · {fb.senderName} · {formatDate(fb.createdAt as { toDate?: () => Date })}
                                    </p>
                                </div>

                                {/* Status badge */}
                                <Badge className={`text-[10px] capitalize ${statusColors[fb.status]}`}>
                                    {fb.status}
                                </Badge>

                                {/* Expand chevron */}
                                {expandedId === fb.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                            </div>

                            {/* Expanded details */}
                            {expandedId === fb.id && (
                                <div className="px-4 pb-4 border-t bg-gray-50/50 space-y-4">
                                    {/* Message */}
                                    <div className="pt-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Message</p>
                                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{fb.message}</p>
                                    </div>

                                    {/* Contact info */}
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        {[
                                            ["Club", fb.clubName],
                                            ["Sender", fb.senderName],
                                            ["Email", fb.senderEmail],
                                            ["Category", categoryLabels[fb.category]],
                                            ["Status", fb.status.charAt(0).toUpperCase() + fb.status.slice(1)],
                                            ["Sent", formatDate(fb.createdAt as { toDate?: () => Date })],
                                        ].map(([label, value]) => (
                                            <div key={String(label)}>
                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                                                <p className="text-sm mt-0.5">{String(value)}</p>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Existing reply */}
                                    {fb.reply && (
                                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                                            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 mb-1">
                                                ✅ Reply{fb.repliedAt ? ` · ${formatDate(fb.repliedAt as { toDate?: () => Date })}` : ""}
                                            </p>
                                            <p className="text-sm text-emerald-800 whitespace-pre-wrap">{fb.reply}</p>
                                        </div>
                                    )}

                                    {/* Reply form */}
                                    {replyingId === fb.id ? (
                                        <div className="space-y-2">
                                            <Textarea
                                                placeholder="Type your reply to the club owner..."
                                                value={replyText}
                                                onChange={(e) => setReplyText(e.target.value)}
                                                className="min-h-[80px]"
                                            />
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                                                    onClick={() => handleReply(fb.clubId!, fb.id)}
                                                    disabled={!replyText.trim() || updateStatus.isPending}
                                                >
                                                    <CheckCircle className="w-3.5 h-3.5" />
                                                    Send Reply & Resolve
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => { setReplyingId(null); setReplyText(""); }}
                                                >
                                                    Cancel
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2 pt-1">
                                            {fb.status === "new" && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="gap-1.5 text-xs"
                                                    onClick={() => handleMarkRead(fb.clubId!, fb.id)}
                                                    disabled={updateStatus.isPending}
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                    Mark as Read
                                                </Button>
                                            )}
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="gap-1.5 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                                onClick={() => { setReplyingId(fb.id); setReplyText(fb.reply ?? ""); }}
                                            >
                                                <Reply className="w-3.5 h-3.5" />
                                                {fb.reply ? "Edit Reply" : "Reply"}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
