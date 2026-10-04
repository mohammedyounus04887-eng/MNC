import { toDateSafe } from "@/lib/toDateSafe";
import { useState, useMemo, useEffect } from "react";
import { Megaphone, Pin, Clock, Trash2, Users, Search, Timer, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    useAnnouncements,
    useSendAnnouncement,
    useUpdateAnnouncement,
    useDeleteAnnouncement,
} from "@/hooks/owner/useAnnouncements";
import { useClubContext } from "@/lib/clubDetection";
import { useToast } from "@/hooks/use-toast";
import type { Announcement } from "@/types/firestore";
import { Timestamp } from "firebase/firestore";

type Priority = "normal" | "important" | "urgent";

const AUDIENCE_OPTIONS = [
    "All Members",
    "Visiting Members Only",
    "Bronze Members",
    "Silver Members",
    "Gold Members",
    "Platinum Members",
    "All Paid Members"
];

const DURATION_OPTIONS = [
    { label: "1 Day", value: "1d" },
    { label: "3 Days", value: "3d" },
    { label: "1 Week", value: "7d" },
    { label: "2 Weeks", value: "14d" },
    { label: "1 Month", value: "30d" },
    { label: "Forever", value: "forever" },
];

function computeExpiresAt(dur: string): Timestamp | null {
    if (dur === "forever") return null;
    const days = parseInt(dur);
    const d = new Date();
    d.setDate(d.getDate() + days);
    return Timestamp.fromDate(d);
}

function PriorityBadge({ priority }: { priority: string }) {
    const p = (priority || "normal") as Priority;
    const variants: Record<Priority, string> = {
        normal: "bg-emerald-100 text-emerald-800",
        important: "bg-yellow-100 text-yellow-800",
        urgent: "bg-red-100 text-red-800",
    };
    return (
        <Badge variant="secondary" className={variants[p]}>
            {p.charAt(0).toUpperCase() + p.slice(1)}
        </Badge>
    );
}

export default function Announcements() {
    const { club } = useClubContext();
    const { toast } = useToast();
    const { announcements, loading } = useAnnouncements(club?.id ?? null);
    const sendAnn = useSendAnnouncement(club?.id ?? null);
    const updateAnn = useUpdateAnnouncement();
    const deleteAnn = useDeleteAnnouncement();

    // Tab state (controlled so we can switch to create on edit)
    const [activeTab, setActiveTab] = useState("create");

    // Create / Edit Form State
    const [editingAnn, setEditingAnn] = useState<Announcement | null>(null);
    const [title, setTitle] = useState("");
    const [message, setMessage] = useState("");
    const [priority, setPriority] = useState<Priority>("normal");
    const [sentTo, setSentTo] = useState("All Members");
    const [isPinned, setIsPinned] = useState(false);
    const [isScheduled, setIsScheduled] = useState(false);
    const [scheduledDate, setScheduledDate] = useState("");
    const [duration, setDuration] = useState("7d");
    const [showPreview, setShowPreview] = useState(false);

    // History Filters State
    const [filterPriority, setFilterPriority] = useState<"all" | Priority>("all");
    const [searchQuery, setSearchQuery] = useState("");

    // Auto-delete expired announcements on load
    useEffect(() => {
        if (!announcements.length || !club?.id) return;
        const now = new Date();
        announcements.forEach((a) => {
            const exp = toDateSafe(a.expiresAt);
            if (exp && exp < now) {
                deleteAnn.mutate({ clubId: club.id!, announcementId: a.id });
            }
        });
    }, [announcements]); // eslint-disable-line react-hooks/exhaustive-deps

    const resetForm = () => {
        setEditingAnn(null);
        setTitle("");
        setMessage("");
        setPriority("normal");
        setSentTo("All Members");
        setIsPinned(false);
        setIsScheduled(false);
        setScheduledDate("");
        setDuration("7d");
        setShowPreview(false);
    };

    const handleEdit = (a: Announcement) => {
        setEditingAnn(a);
        setTitle(a.title);
        setMessage(a.message);
        setPriority(a.priority as Priority);
        setSentTo(a.sentTo);
        setIsPinned(a.isPinned);
        setDuration(a.duration || "7d");
        setActiveTab("create");
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const handleSave = async () => {
        if (!club?.id || !title.trim() || !message.trim()) return;

        let scheduledForTimestamp = null;
        if (isScheduled && scheduledDate) {
            const dateObj = new Date(scheduledDate);
            if (dateObj > new Date()) {
                scheduledForTimestamp = Timestamp.fromDate(dateObj);
            }
        }

        const expiresAt = computeExpiresAt(duration);

        const payload = {
            title: title.trim(),
            message: message.trim(),
            priority,
            sentTo,
            isPinned,
            isActive: true,
            scheduledFor: scheduledForTimestamp,
            expiresAt,
            duration,
        };

        try {
            if (editingAnn) {
                await updateAnn.mutateAsync({
                    clubId: club.id,
                    announcementId: editingAnn.id,
                    data: payload,
                });
                toast({ title: "Announcement updated!" });
            } else {
                await sendAnn.mutateAsync(payload as any);
                toast({ title: "Announcement posted successfully!" });
            }
            resetForm();
        } catch (err: any) {
            console.error("[Announcements] save failed:", err);
            toast({ title: "Failed to save", description: err?.message ?? "Unknown error", variant: "destructive" });
        }
    };

    const handleDelete = async (a: Announcement) => {
        if (!window.confirm("Delete this announcement?")) return;
        try {
            await deleteAnn.mutateAsync({ clubId: club!.id, announcementId: a.id });
            toast({ title: "Deleted" });
        } catch {
            toast({ title: "Failed to delete", variant: "destructive" });
        }
    };

    const filteredHistory = useMemo(() => {
        if (!announcements) return [];
        return announcements.filter(a => {
            const matchSearch = a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                a.message.toLowerCase().includes(searchQuery.toLowerCase());
            const matchPri = filterPriority === "all" || a.priority === filterPriority;
            return matchSearch && matchPri;
        });
    }, [announcements, searchQuery, filterPriority]);

    const isPending = sendAnn.isPending || updateAnn.isPending;

    return (
        <div
            className="px-6 md:px-8 py-8 max-w-[900px] mx-auto space-y-6 pb-20"
            style={{ fontFamily: "'Nunito', sans-serif" }}
        >
            <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center">
                    <Megaphone className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-gray-900 leading-tight">Announcements</h1>
                    <p className="text-gray-500 font-medium">Communicate with your members</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 p-1 bg-gray-100 rounded-xl mb-6">
                    <TabsTrigger value="create" className="rounded-lg font-bold">
                        {editingAnn ? "Edit" : "Create"}
                    </TabsTrigger>
                    <TabsTrigger value="history" className="rounded-lg font-bold" onClick={resetForm}>History</TabsTrigger>
                </TabsList>

                <TabsContent value="create" className="space-y-6 outline-none">
                    {editingAnn && (
                        <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-4 py-2">
                            <span className="text-sm font-bold text-blue-800 flex items-center gap-2">
                                <Pencil className="w-4 h-4" /> Editing: "{editingAnn.title}"
                            </span>
                            <button onClick={resetForm} className="text-xs text-blue-600 underline">Cancel edit</button>
                        </div>
                    )}

                    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 md:p-8 space-y-6">

                        {/* Title & Message */}
                        <div className="space-y-4">
                            <div>
                                <Label className="text-gray-700 font-bold ml-1">Title *</Label>
                                <Input
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="e.g. Club closing early tomorrow"
                                    className="mt-1.5 bg-gray-50/50 border-gray-200"
                                />
                            </div>
                            <div>
                                <Label className="text-gray-700 font-bold ml-1">Message *</Label>
                                <Textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="Write your announcement details…"
                                    rows={4}
                                    className="mt-1.5 bg-gray-50/50 border-gray-200 resize-none"
                                />
                            </div>
                        </div>

                        {/* Priority Toggles */}
                        <div>
                            <Label className="text-gray-700 font-bold ml-1 mb-2 block">Priority *</Label>
                            <div className="grid grid-cols-3 gap-3">
                                <button
                                    onClick={() => setPriority("normal")}
                                    className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1 ${priority === "normal" ? "border-emerald-500 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
                                >
                                    <span className="text-xl">📢</span>
                                    <span className={`text-sm font-bold ${priority === "normal" ? "text-emerald-700" : "text-gray-600"}`}>Normal</span>
                                </button>
                                <button
                                    onClick={() => setPriority("important")}
                                    className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1 ${priority === "important" ? "border-yellow-500 bg-yellow-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
                                >
                                    <span className="text-xl">⚠️</span>
                                    <span className={`text-sm font-bold ${priority === "important" ? "text-yellow-700" : "text-gray-600"}`}>Important</span>
                                </button>
                                <button
                                    onClick={() => setPriority("urgent")}
                                    className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1 ${priority === "urgent" ? "border-red-500 bg-red-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
                                >
                                    <span className="text-xl">🚨</span>
                                    <span className={`text-sm font-bold ${priority === "urgent" ? "text-red-700" : "text-gray-600"}`}>Urgent</span>
                                </button>
                            </div>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-6">
                            {/* Send To */}
                            <div>
                                <Label className="text-gray-700 font-bold ml-1">Send To *</Label>
                                <Select value={sentTo} onValueChange={setSentTo}>
                                    <SelectTrigger className="mt-1.5 border-gray-200 bg-gray-50/50">
                                        <div className="flex items-center gap-2">
                                            <Users className="w-4 h-4 text-gray-500" />
                                            <SelectValue />
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {AUDIENCE_OPTIONS.map(opt => (
                                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Auto-delete Duration */}
                            <div>
                                <Label className="text-gray-700 font-bold ml-1 flex items-center gap-2">
                                    <Timer className="w-4 h-4 text-purple-500" /> Auto-delete after
                                </Label>
                                <Select value={duration} onValueChange={setDuration}>
                                    <SelectTrigger className="mt-1.5 border-gray-200 bg-gray-50/50">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {DURATION_OPTIONS.map(opt => (
                                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {duration !== "forever" && (
                                    <p className="text-xs text-gray-400 mt-1 ml-1">
                                        Expires {computeExpiresAt(duration)?.toDate().toLocaleDateString([], { dateStyle: "medium" })}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Toggles */}
                        <div className="grid sm:grid-cols-2 gap-6">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-gray-700 font-bold flex items-center gap-2">
                                        <Pin className="w-4 h-4 text-emerald-600" /> Pin to top
                                    </Label>
                                    <p className="text-xs text-gray-500">Always show first</p>
                                </div>
                                <Switch checked={isPinned} onCheckedChange={setIsPinned} />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-gray-700 font-bold flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-blue-600" /> Schedule
                                    </Label>
                                    <p className="text-xs text-gray-500">Send later</p>
                                </div>
                                <Switch checked={isScheduled} onCheckedChange={setIsScheduled} />
                            </div>
                        </div>

                        {/* Date Picker if scheduled */}
                        {isScheduled && (
                            <div className="p-4 rounded-2xl bg-blue-50/50 border border-blue-100 flex flex-col gap-2">
                                <Label className="text-blue-900 font-bold">Select Date & Time</Label>
                                <Input
                                    type="datetime-local"
                                    value={scheduledDate}
                                    onChange={(e) => setScheduledDate(e.target.value)}
                                    className="bg-white"
                                />
                            </div>
                        )}

                        {/* Preview Section */}
                        {showPreview && title && message && (
                            <div className="mt-6 border-t pt-6 border-gray-100">
                                <Label className="text-gray-500 font-bold mb-3 block uppercase tracking-wider text-xs">Member App Preview</Label>
                                <div className="relative overflow-hidden rounded-2xl border bg-white shadow-sm flex items-stretch">
                                    <div className={`w-1.5 flex-shrink-0 ${priority === "urgent" ? "bg-red-500" :
                                            priority === "important" ? "bg-yellow-400" : "bg-emerald-500"
                                        }`} />
                                    <div className="p-4 flex-1">
                                        <div className="flex justify-between items-start gap-2 mb-1">
                                            <div className="flex items-center gap-2">
                                                {isPinned && <Pin className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600" />}
                                                <h3 className="font-bold text-gray-900 max-w-[200px] truncate">{title}</h3>
                                            </div>
                                            <Badge variant="default" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200">New</Badge>
                                        </div>
                                        <p className="text-sm text-gray-600 line-clamp-2 leading-relaxed">{message}</p>
                                        <p className="text-xs text-gray-400 mt-2 font-medium">Just now</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4 border-t border-gray-100">
                            <Button
                                variant="outline"
                                onClick={() => setShowPreview(!showPreview)}
                                className="sm:w-32 rounded-xl text-gray-600 border-gray-200"
                            >
                                {showPreview ? "Hide Preview" : "Preview"}
                            </Button>
                            <Button
                                onClick={handleSave}
                                disabled={isPending || !title.trim() || !message.trim() || (isScheduled && !scheduledDate)}
                                className="flex-1 rounded-xl shadow-md text-white font-bold"
                                style={{ backgroundColor: "#2d9653" }}
                            >
                                {isPending
                                    ? (editingAnn ? "Updating..." : "Starting Engine...")
                                    : (editingAnn ? "Update Announcement" : "Send Announcement")}
                            </Button>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="history" className="space-y-4 outline-none">
                    {/* Filters */}
                    <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <Input
                                placeholder="Search history..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="pl-9 bg-gray-50/50 border-gray-200"
                            />
                        </div>
                        <Select value={filterPriority} onValueChange={(v) => setFilterPriority(v as any)}>
                            <SelectTrigger className="w-full sm:w-[140px] border-gray-200">
                                <SelectValue placeholder="Priority" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Priorities</SelectItem>
                                <SelectItem value="normal">Normal</SelectItem>
                                <SelectItem value="important">Important</SelectItem>
                                <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {loading ? (
                        <div className="space-y-4">
                            {[1, 2, 3].map((i) => (
                                <Skeleton key={i} className="h-32 rounded-2xl" />
                            ))}
                        </div>
                    ) : filteredHistory.length === 0 ? (
                        <div className="rounded-3xl border border-gray-100 bg-white py-16 text-center">
                            <Megaphone className="w-10 h-10 mx-auto text-gray-300 mb-3" />
                            <p className="text-gray-500 font-bold">No announcements found</p>
                        </div>
                    ) : (
                        <div className="space-y-4 pt-2">
                            {filteredHistory.map((a) => (
                                <div
                                    key={a.id}
                                    className="rounded-2xl border border-gray-100 bg-white p-5 flex gap-4 overflow-hidden relative shadow-sm hover:shadow-md transition-shadow"
                                >
                                    {/* Left accent */}
                                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${a.priority === "urgent" ? "bg-red-500" :
                                            a.priority === "important" ? "bg-yellow-400" : "bg-emerald-500"
                                        }`} />

                                    <div className="min-w-0 flex-1 pl-2">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                {a.isPinned && <Pin className="w-4 h-4 text-emerald-600 fill-emerald-600" />}
                                                <h3 className="font-bold text-gray-900 text-lg leading-tight">{a.title}</h3>
                                                <PriorityBadge priority={a.priority} />
                                            </div>
                                            <div className="hidden sm:flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 h-8 px-2"
                                                    onClick={() => handleEdit(a)}
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 px-2"
                                                    onClick={() => handleDelete(a)}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>

                                        <p className="text-sm text-gray-600 mb-4 pr-12 sm:pr-0">{a.message}</p>

                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-gray-500 bg-gray-50/80 p-2.5 rounded-xl border border-gray-100">
                                            <div className="flex items-center gap-1.5">
                                                <Users className="w-3.5 h-3.5 text-gray-400" />
                                                <span>{a.sentTo}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Clock className="w-3.5 h-3.5 text-gray-400" />
                                                <span>{a.createdAt?.toDate?.()?.toLocaleString?.([], { dateStyle: 'medium', timeStyle: 'short' }) ?? "—"}</span>
                                            </div>
                                            {a.expiresAt && (
                                                <div className="flex items-center gap-1.5 text-purple-600">
                                                    <Timer className="w-3.5 h-3.5" />
                                                    <span>Expires {toDateSafe(a.expiresAt)?.toLocaleDateString([], { dateStyle: "medium" }) ?? "—"}</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Mobile action buttons */}
                                        <div className="flex sm:hidden gap-1 mt-3">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 h-8 px-3 text-xs"
                                                onClick={() => handleEdit(a)}
                                            >
                                                <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 px-3 text-xs"
                                                onClick={() => handleDelete(a)}
                                            >
                                                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
