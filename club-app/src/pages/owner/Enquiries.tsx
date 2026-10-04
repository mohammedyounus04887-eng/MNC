import { useState, useMemo, useEffect } from "react";
import {
    Search, UserCheck, Trash2, Star, ChevronDown, ChevronUp, X, CheckCheck,
} from "lucide-react";
import {
    collection, query, where, orderBy, onSnapshot,
    updateDoc, deleteDoc, doc, serverTimestamp, writeBatch,
} from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useClubContext } from "@/lib/clubDetection";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { useClubFeedback } from "@/hooks/useFeedback";

type TabType = "enquiries" | "feedback";

// ─── Pending member type (isPermanent: false) ────────────────────────────────

interface PendingMember {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    whatsapp?: string;
    address?: string;
    dob?: string;
    currentWeight?: number | null;
    targetWeight?: number | null;
    healthConditions?: string | null;
    referredBy?: string | null;
    referredByMemberId?: string | null;
    joinedAt?: any;
    status?: string;
    isPermanent: boolean;
    memberType?: string;
    clubId?: string;
}

// ─── Activate Member Modal ───────────────────────────────────────────────────

const MEMBER_TYPES = [
    { value: "permanent", label: "Member" },
];

interface ActivateModalProps {
    member: PendingMember;
    clubId: string;
    ownerUid: string;
    onClose: () => void;
}

function ActivateModal({ member, clubId, ownerUid, onClose }: ActivateModalProps) {
    const { toast } = useToast();
    const [selectedType, setSelectedType] = useState("visiting");
    const [loading, setLoading] = useState(false);

    const handleActivate = async () => {
        setLoading(true);
        try {
            // NOTE: isActiveMember stays false until first wallet top-up
            // Activating just moves them from 'visiting/pending' to acknowledged visiting member
            await updateDoc(doc(db, "clubs", clubId, "members", member.id), {
                isPermanent: true,           // true on activation — removes from enquiries list
                status: "active",
                memberType: selectedType,    // visiting, bronze, silver, gold, platinum
                isActiveMember: false,       // only true after first wallet recharge
                activatedBy: ownerUid,
                activatedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            toast({ title: `✅ ${member.name} is now a ${selectedType} visiting member!` });
            onClose();
        } catch (err: any) {
            toast({ title: "Failed to activate", description: err.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4" style={{ fontFamily: "Nunito, sans-serif" }}>
                <div className="flex justify-between items-start">
                    <h2 className="text-xl font-black text-gray-800">Activate Member</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1">
                    <p className="font-bold text-gray-800">{member.name}</p>
                    {member.phone && <p className="text-sm text-gray-600">📞 {member.phone}</p>}
                    {member.email && <p className="text-sm text-gray-600">✉️ {member.email}</p>}
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700">Member Type</label>
                    <Select value={selectedType} onValueChange={setSelectedType}>
                        <SelectTrigger className="rounded-xl">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {MEMBER_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex gap-2 pt-2">
                    <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl">Cancel</Button>
                    <Button
                        onClick={handleActivate}
                        disabled={loading}
                        className="flex-1 rounded-xl text-white"
                        style={{ backgroundColor: "#2d9653" }}
                    >
                        <UserCheck className="w-4 h-4 mr-2" />
                        {loading ? "Activating..." : "✅ Activate"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ─── Feedback Tab ─────────────────────────────────────────────────────────────

function StarDisplay({ rating }: { rating: number }) {
    return (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => (
                <Star
                    key={s}
                    className="w-4 h-4"
                    fill={s <= rating ? "#f59e0b" : "none"}
                    stroke={s <= rating ? "#f59e0b" : "#d1d5db"}
                    strokeWidth={1.5}
                />
            ))}
        </div>
    );
}

function FeedbackTab() {
    const { data: feedbackList = [], isLoading } = useClubFeedback();
    const [ratingFilter, setRatingFilter] = useState<string>("all");
    const [categoryFilter, setCategoryFilter] = useState<string>("all");

    const filtered = useMemo(() => {
        let list = feedbackList;
        if (ratingFilter !== "all") list = list.filter((f) => f.rating === parseInt(ratingFilter));
        if (categoryFilter !== "all") list = list.filter((f) => f.category === categoryFilter);
        return list;
    }, [feedbackList, ratingFilter, categoryFilter]);

    const avgRating = feedbackList.length
        ? (feedbackList.reduce((s, f) => s + f.rating, 0) / feedbackList.length).toFixed(1)
        : null;

    if (isLoading) return (
        <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
    );

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap gap-3 items-center justify-between">
                <div className="flex items-center gap-3">
                    {avgRating && (
                        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
                            <Star className="w-5 h-5 fill-amber-400 stroke-amber-400" />
                            <span className="font-black text-lg text-amber-700">{avgRating}</span>
                            <span className="text-sm text-amber-600">avg ({feedbackList.length})</span>
                        </div>
                    )}
                </div>
                <div className="flex gap-2 flex-wrap">
                    <Select value={ratingFilter} onValueChange={setRatingFilter}>
                        <SelectTrigger className="w-[120px] rounded-xl">
                            <SelectValue placeholder="Rating" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Ratings</SelectItem>
                            {[5, 4, 3, 2, 1].map((r) => (
                                <SelectItem key={r} value={String(r)}>{r} ⭐</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger className="w-[140px] rounded-xl">
                            <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            {["Service", "Shakes", "Cleanliness", "Staff", "Timing", "Other"].map((c) => (
                                <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {filtered.length === 0 ? (
                <div className="rounded-2xl border bg-gray-50 p-12 text-center">
                    <p className="text-gray-500 font-semibold">No feedback yet</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map((f) => (
                        <div key={f.id} className="rounded-2xl border bg-white p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-gray-800">
                                            {(f as any).name || "Anonymous"}
                                        </span>
                                        {(f as any).memberId && (
                                            <Badge variant="outline" className="text-xs">{(f as any).memberId}</Badge>
                                        )}
                                        <Badge variant="secondary" className="text-xs bg-gray-100">
                                            {f.category}
                                        </Badge>
                                    </div>
                                    <StarDisplay rating={f.rating} />
                                    {f.message && (
                                        <p className="text-sm text-gray-600 mt-1">{f.message}</p>
                                    )}
                                </div>
                                <p className="text-xs text-gray-400 whitespace-nowrap">
                                    {f.createdAt?.toDate?.()?.toLocaleDateString() ?? "—"}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Main Enquiries Page ──────────────────────────────────────────────────────

export default function Enquiries() {
    const { club } = useClubContext();
    const { toast } = useToast();
    const { userProfile } = useAuth();
    const [tab, setTab] = useState<TabType>("enquiries");
    const [search, setSearch] = useState("");
    const [enquiries, setEnquiries] = useState<PendingMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [activatingMember, setActivatingMember] = useState<PendingMember | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [bulkAccepting, setBulkAccepting] = useState(false);
    const [showBulkConfirm, setShowBulkConfirm] = useState(false);

    // Live query: visiting members (isActiveMember == false means not yet wallet-activated)
    useEffect(() => {
        if (!club?.id) return;
        setLoading(true);
        // Query all members who are not yet permanent (no wallet top-up yet)
        const q = query(
            collection(db, "clubs", club.id, "members"),
            where("isPermanent", "==", false)
        );
        const unsubscribe = onSnapshot(q, (snap) => {
            const data = snap.docs
                .map((d) => ({ id: d.id, ...d.data() } as PendingMember))
                .sort((a, b) => {
                    const aTime = (a as any).createdAt?.toMillis?.() ?? 0;
                    const bTime = (b as any).createdAt?.toMillis?.() ?? 0;
                    return bTime - aTime;
                });
            setEnquiries(data);
            setLoading(false);
        }, (err) => {
            console.error("Enquiries query error:", err);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [club?.id]);

    const filtered = useMemo(() => {
        if (!search.trim()) return enquiries;
        const q = search.toLowerCase();
        return enquiries.filter(
            (e) =>
                e.name?.toLowerCase().includes(q) ||
                e.phone?.toLowerCase().includes(q) ||
                e.email?.toLowerCase().includes(q)
        );
    }, [enquiries, search]);

    const handleBulkAccept = async () => {
        if (!club?.id || enquiries.length === 0) return;
        setBulkAccepting(true);
        try {
            const batch = writeBatch(db);
            for (const e of enquiries) {
                batch.update(doc(db, "clubs", club.id, "members", e.id), {
                    isPermanent: true,
                    memberType: "permanent",
                    status: "active",
                    isActiveMember: true,
                    activatedBy: userProfile?.id ?? "",
                    activatedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
            }
            await batch.commit();
            toast({ title: `${enquiries.length} members accepted as permanent!` });
            setShowBulkConfirm(false);
        } catch (err: any) {
            toast({ title: "Bulk accept failed", description: err.message, variant: "destructive" });
        } finally {
            setBulkAccepting(false);
        }
    };

    const handleDelete = async () => {
        if (!deletingId || !club?.id) return;
        try {
            await deleteDoc(doc(db, "clubs", club.id, "members", deletingId));
            toast({ title: "Enquiry deleted" });
        } catch (err: any) {
            toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="px-4 md:px-8 py-8 max-w-3xl mx-auto w-full" style={{ fontFamily: "'Nunito', sans-serif" }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-black" style={{ color: "#1a2e1a" }}>
                        {tab === "enquiries" ? "Enquiries" : "Feedback"}
                    </h1>
                    {tab === "enquiries" && enquiries.length > 0 && (
                        <Badge className="bg-orange-500">{enquiries.length} pending</Badge>
                    )}
                </div>
                {tab === "enquiries" && enquiries.length > 0 && (
                    <Button
                        size="sm"
                        onClick={() => setShowBulkConfirm(true)}
                        className="rounded-xl text-white gap-1"
                        style={{ backgroundColor: "#2d9653" }}
                    >
                        <CheckCheck className="w-4 h-4" />
                        Accept All
                    </Button>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 bg-gray-100 rounded-2xl p-1 w-fit">
                {([{ value: "enquiries", label: "📋 Enquiries" }, { value: "feedback", label: "💬 Feedback" }] as const).map((t) => (
                    <button
                        key={t.value}
                        onClick={() => setTab(t.value)}
                        className={`px-5 py-2 rounded-xl text-sm font-bold transition-all ${tab === t.value ? "bg-white shadow text-gray-800" : "text-gray-500 hover:text-gray-700"}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === "feedback" ? (
                <FeedbackTab />
            ) : (
                <>
                    {/* Search */}
                    <div className="mb-6">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                placeholder="Search by name, phone or email"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 rounded-xl"
                            />
                        </div>
                    </div>

                    {loading ? (
                        <div className="space-y-4">
                            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="rounded-2xl border bg-gray-50 p-12 text-center">
                            <p className="text-gray-500 font-semibold">
                                {enquiries.length ? "No enquiries match your search" : "No visiting members yet"}
                            </p>
                            <p className="text-gray-400 text-sm mt-2">
                                Members registered via the landing page appear here until their first wallet recharge.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {filtered.map((e) => {
                                const isExpanded = expandedId === e.id;
                                return (
                                    <div key={e.id} className="rounded-2xl border bg-white overflow-hidden">
                                        <div
                                            className="p-4 flex items-center justify-between gap-3 cursor-pointer"
                                            onClick={() => setExpandedId(isExpanded ? null : e.id)}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-gray-900">{e.name}</span>
                                                    <Badge className="bg-orange-100 text-orange-800 border-orange-200">
                                                        PENDING
                                                    </Badge>
                                                    {e.referredByMemberId && (
                                                        <Badge variant="outline" className="text-xs text-purple-700 border-purple-300">
                                                            🔗 {e.referredByMemberId}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="text-sm text-gray-600">{e.phone}</p>
                                                <p className="text-xs text-gray-400 mt-1">
                                                    {e.joinedAt?.toDate?.()?.toLocaleDateString?.() ?? "—"}
                                                    {e.referredBy && ` • Referred by ${e.referredBy}`}
                                                </p>
                                            </div>
                                            {isExpanded ? (
                                                <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
                                            ) : (
                                                <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                                            )}
                                        </div>

                                        {isExpanded && (
                                            <div className="px-4 pb-4 pt-0 border-t space-y-4" onClick={(ev) => ev.stopPropagation()}>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm pt-4">
                                                    {e.email && <div><span className="text-gray-500">Email:</span> {e.email}</div>}
                                                    {e.phone && <div><span className="text-gray-500">Phone:</span> {e.phone}</div>}
                                                    {e.address && <div><span className="text-gray-500">Address:</span> {e.address}</div>}
                                                    {e.dob && <div><span className="text-gray-500">DOB:</span> {e.dob}</div>}
                                                    {e.currentWeight != null && e.targetWeight != null && (
                                                        <div>
                                                            <span className="text-gray-500">Weight:</span>{" "}
                                                            {e.currentWeight} kg → {e.targetWeight} kg
                                                        </div>
                                                    )}
                                                    {e.currentWeight != null && e.targetWeight == null && (
                                                        <div><span className="text-gray-500">Weight:</span> {e.currentWeight} kg</div>
                                                    )}
                                                    {e.healthConditions && (
                                                        <div className="sm:col-span-2">
                                                            <span className="text-gray-500">Health conditions:</span> {e.healthConditions}
                                                        </div>
                                                    )}
                                                    {e.referredBy && (
                                                        <div><span className="text-gray-500">Referred by:</span> {e.referredBy}</div>
                                                    )}
                                                </div>

                                                <div className="flex flex-wrap gap-2 items-center pt-1">
                                                    <Button
                                                        size="sm"
                                                        onClick={() => setActivatingMember(e)}
                                                        className="rounded-xl text-white"
                                                        style={{ backgroundColor: "#2d9653" }}
                                                    >
                                                        <UserCheck className="w-4 h-4 mr-1" />
                                                        Activate Member
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="destructive"
                                                        onClick={() => setDeletingId(e.id)}
                                                        className="rounded-xl"
                                                    >
                                                        <Trash2 className="w-4 h-4 mr-1" />
                                                        Delete
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {/* Activate Modal */}
            {activatingMember && club && (
                <ActivateModal
                    member={activatingMember}
                    clubId={club.id}
                    ownerUid={userProfile?.id ?? ""}
                    onClose={() => setActivatingMember(null)}
                />
            )}

            {/* Bulk accept confirmation */}
            <AlertDialog open={showBulkConfirm} onOpenChange={(o) => !o && setShowBulkConfirm(false)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Accept all {enquiries.length} members as permanent?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will mark all pending enquiries as permanent members with balance 0. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={bulkAccepting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleBulkAccept}
                            disabled={bulkAccepting}
                            style={{ backgroundColor: "#2d9653" }}
                        >
                            {bulkAccepting ? "Accepting..." : `Accept All ${enquiries.length}`}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Delete confirmation */}
            <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this enquiry?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the enquiry and their member account. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
