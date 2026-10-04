import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Eye, Printer, CheckCircle, Scale, Trophy, QrCode, X, Copy, UserPlus, RefreshCw, Pencil, Trash2, Activity, Calendar, Users } from "lucide-react";
import { Timestamp, collection, getDocs, doc, updateDoc, getDoc, setDoc, query, where, deleteDoc } from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut } from "firebase/auth";
import { db, firebaseConfig } from "@/lib/firebase";
import { generateMemberId, generatePrefixFromName } from "@/utils/generateMemberId";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMembers, useAddMember } from "@/hooks/owner/useMembers";
import { useClubContext } from "@/lib/clubDetection";
import type { User } from "@/types/firestore";
import { fetchClubAndPrint } from "@/utils/printReceipt";
import { buildMembershipReceipt } from "@/utils/receiptBuilder";
import BulkWeighIn from "@/components/owner/BulkWeighIn";
import MemberDetailModal from "@/components/owner/MemberDetailModal";

type FilterTab = "all" | "active" | "expired" | "expiring" | "visiting" | "permanent" | "pending";

// Creates a Firebase Auth account via a secondary app so the owner's session isn't disturbed.
async function createAuthUserSecondary(email: string, password: string): Promise<string> {
    const secondaryApp = initializeApp(firebaseConfig, `member-create-${Date.now()}`);
    const secondaryAuth = getAuth(secondaryApp);
    try {
        const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const uid = credential.user.uid;
        await fbSignOut(secondaryAuth);
        return uid;
    } finally {
        await deleteApp(secondaryApp);
    }
}

function getMemberStatus(m: User): "active" | "expired" | "expiring" {
    const credits = (m as any).shakeCredits ?? 0;
    const totalCredits = (m as any).shakeCreditsPlanTotal ?? 0;
    if (totalCredits <= 0) return "active";
    if (credits <= 0) return "expired";
    if (credits <= 3) return "expiring";
    return "active";
}

function fmtDate(ts: any) {
    if (!ts) return "—";
    try { const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return "—"; }
}

export default function Members() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { club } = useClubContext();

    // ── All hooks must be called before any conditional returns ──
    const { data: members, isLoading } = useMembers(club?.id ?? null);
    const addMember = useAddMember();
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<FilterTab>("all");
    const [qrOpen, setQrOpen] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [weighInOpen, setWeighInOpen] = useState(false);

    const joinUrl = `${window.location.origin}/join?clubId=${club?.id ?? ""}`;
    const [formData, setFormData] = useState({
        name: "", phone: "", email: "", address: "", dob: "",
        currentWeight: "", targetWeight: "", healthConditions: "",         password: "", confirmPassword: "",
    });
    const [formError, setFormError] = useState("");
    const [membershipSuccess, setMembershipSuccess] = useState<any | null>(null);
    const [backfilling, setBackfilling] = useState(false);

    // ── Member Detail Modal ─────────────────────────────────────────
    const [detailMember, setDetailMember] = useState<any | null>(null);

    // ── Edit Member ────────────────────────────────────────────────
    const [editingMember, setEditingMember] = useState<any | null>(null);
    const [editForm, setEditForm] = useState<any>({});
    const [editSaving, setEditSaving] = useState(false);
    const [referralSearch, setReferralSearch] = useState("");
    const [referralDropdownOpen, setReferralDropdownOpen] = useState(false);
    const [editPlans, setEditPlans] = useState<any[]>([]);
    const [generatingId, setGeneratingId] = useState(false);
    const [currentWalletBalance, setCurrentWalletBalance] = useState<number | null>(null);
    const [memberStats, setMemberStats] = useState<{
        totalAttendance: number;
        lastCheckIn: string | null;
        volunteerDays: number;
    } | null>(null);

    // ── Delete Member ───────────────────────────────────────────────
    const [deletingMember, setDeletingMember] = useState<any | null>(null);
    const [deleteConfirming, setDeleteConfirming] = useState(false);

    const deleteMember = async () => {
        if (!deletingMember || !club?.id) return;
        setDeleteConfirming(true);
        try {
            await deleteDoc(doc(db, `clubs/${club.id}/members`, deletingMember.id));
            toast({ title: "Member deleted", description: `${deletingMember.name} has been removed.` });
            setDeletingMember(null);
        } catch {
            toast({ title: "Error", description: "Failed to delete member.", variant: "destructive" });
        } finally {
            setDeleteConfirming(false);
        }
    };

    useEffect(() => {
        if (!editingMember || !club?.id) return;
        // Load membership plans
        getDocs(collection(db, `clubs/${club.id}/memberships`)).then(snap => {
            setEditPlans(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }).catch(() => {});
        // Load wallet balance
        setCurrentWalletBalance(null);
        getDoc(doc(db, `clubs/${club.id}/members/${editingMember.id}/wallet`, "data")).then(snap => {
            setCurrentWalletBalance(snap.exists() ? (snap.data().balance ?? 0) : 0);
        }).catch(() => setCurrentWalletBalance(0));
        // Load attendance + volunteer stats
        setMemberStats(null);
        Promise.all([
            getDocs(collection(db, `clubs/${club.id}/members/${editingMember.id}/attendance`)),
            getDocs(query(
                collection(db, `clubs/${club.id}/volunteerAttendance`),
                where("memberId", "==", editingMember.id)
            )),
        ]).then(([attendSnap, volSnap]) => {
            const dates = attendSnap.docs.map(d => d.id).sort();
            setMemberStats({
                totalAttendance: attendSnap.size,
                lastCheckIn: dates[dates.length - 1] ?? null,
                volunteerDays: volSnap.size,
            });
        }).catch(() => setMemberStats({ totalAttendance: 0, lastCheckIn: null, volunteerDays: 0 }));
    }, [editingMember, club?.id]);

    const openEdit = (m: any) => {
        const toDateStr = (ts: any) => {
            if (!ts) return "";
            try { const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toISOString().slice(0, 10); } catch { return ""; }
        };
        setEditForm({
            name: m.name || "",
            phone: m.phone || "",
            email: m.email || "",
            dob: toDateStr(m.dob),
            memberId: (m as any).memberId || "",
            membershipPlanId: m.membershipPlanId || "",
                        membershipStart: toDateStr(m.membershipStart),
            membershipEnd: toDateStr(m.membershipEnd),
            shakeCredits: (m as any).shakeCredits ?? "",
            shakeCreditsPlanTotal: (m as any).shakeCreditsPlanTotal ?? "",
            walletBalance: "",
            referredBy: (m as any).referredBy || "",
            autoCredits: (m as any).autoCredits ?? false,
            currentWeight: (m as any).currentWeight ?? "",
            targetWeight: (m as any).targetWeight ?? "",
            healthConditions: (m as any).healthConditions ?? "",
            address: (m as any).address ?? "",
            isCouple: (m as any).isCouple ?? false,
            husbandName: (m as any).husbandName ?? "",
            wifeName: (m as any).wifeName ?? "",
        });
        setMemberStats(null);
        setEditingMember(m);
    };

    const generateEditId = async () => {
        if (!club) return;
        setGeneratingId(true);
        try {
            const prefix = generatePrefixFromName(club.name);
            const newId = await generateMemberId(club.id, prefix);
            setEditForm((p: any) => ({ ...p, memberId: newId }));
        } catch { toast({ title: "Error generating ID", variant: "destructive" }); }
        setGeneratingId(false);
    };

    const saveEdit = async () => {
        if (!editingMember || !club?.id) return;
        setEditSaving(true);
        try {
            const payload: any = {
                name: editForm.name.trim(),
                phone: editForm.phone.trim(),
                email: editForm.email.trim() || null,
                dob: editForm.dob ? Timestamp.fromDate(new Date(editForm.dob)) : null,
                memberId: editForm.memberId.trim() || null,
                qrCode: editForm.memberId.trim() || null,
                autoCredits: editForm.autoCredits ?? false,
                isCouple: !!editForm.isCouple,
                husbandName: editForm.isCouple ? (editForm.husbandName || "").trim() : "",
                wifeName: editForm.isCouple ? (editForm.wifeName || "").trim() : "",
                updatedAt: Timestamp.now(),
            };
            if (editForm.address !== undefined) payload.address = editForm.address.trim() || null;
            if (editForm.currentWeight !== "") payload.currentWeight = Number(editForm.currentWeight);
            if (editForm.targetWeight !== "") payload.targetWeight = Number(editForm.targetWeight);
            if (editForm.healthConditions !== undefined) payload.healthConditions = editForm.healthConditions.trim() || null;

            if (editForm.membershipPlanId) {
                const plan = editPlans.find(p => p.id === editForm.membershipPlanId);
                payload.membershipPlanId = editForm.membershipPlanId;
            } else {
                payload.membershipPlanId = null;
            }
            if (editForm.membershipStart) payload.membershipStart = Timestamp.fromDate(new Date(editForm.membershipStart));
            if (editForm.membershipEnd) payload.membershipEnd = Timestamp.fromDate(new Date(editForm.membershipEnd));
            if (editForm.shakeCredits !== "") payload.shakeCredits = Number(editForm.shakeCredits);
            if (editForm.shakeCreditsPlanTotal !== "") payload.shakeCreditsPlanTotal = Number(editForm.shakeCreditsPlanTotal);
            payload.referredBy = editForm.referredBy?.trim() || null;

            await updateDoc(doc(db, `clubs/${club.id}/members`, editingMember.id), payload);

            if (editForm.walletBalance !== "" && !isNaN(Number(editForm.walletBalance))) {
                const wRef = doc(db, `clubs/${club.id}/members/${editingMember.id}/wallet`, "data");
                await setDoc(wRef, { balance: Number(editForm.walletBalance), updatedAt: Timestamp.now() }, { merge: true });
            }

            toast({ title: "Member updated" });
            setEditingMember(null);
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
        setEditSaving(false);
    };

    const missingIdCount = useMemo(
        () => (members ?? []).filter((m) => !(m as any).memberId).length,
        [members]
    );

    const handleBackfillIds = async () => {
        if (!club) return;
        setBackfilling(true);
        try {
            const prefix = generatePrefixFromName(club.name);
            const missing = (members ?? []).filter((m) => !(m as any).memberId);
            for (const m of missing) {
                const newId = await generateMemberId(club.id, prefix);
                await updateDoc(doc(db, `clubs/${club.id}/members`, m.id), {
                    memberId: newId, qrCode: newId, updatedAt: Timestamp.now(),
                });
            }
            toast({ title: `Generated IDs for ${missing.length} member${missing.length !== 1 ? "s" : ""}` });
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        } finally {
            setBackfilling(false);
        }
    };

    const filtered = useMemo(() => {
        if (!members) return [];
        let list = members;
        if (filter === "active")     list = list.filter((m) => getMemberStatus(m) === "active");
        else if (filter === "expired")   list = list.filter((m) => getMemberStatus(m) === "expired");
        else if (filter === "expiring")  list = list.filter((m) => getMemberStatus(m) === "expiring");
        else if (filter === "pending")   list = list.filter((m) => (m as any).isPermanent === false);
        else if (filter === "visiting")  list = list.filter((m) => (m as any).isPermanent !== false && (m as any).memberType === "visiting");
        else if (filter === "permanent") list = list.filter((m) => (m as any).isPermanent !== false && (m as any).memberType !== "visiting");
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter((m) => m.name?.toLowerCase().includes(q) || m.phone?.includes(q) || (m as any).memberId?.toLowerCase().includes(q));
        }
        return list;
    }, [members, search, filter]);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError("");
        if (!formData.name.trim() || !formData.phone.trim()) { setFormError("Full Name and Phone are required."); return; }
        if (!formData.email.trim()) { setFormError("Email is required."); return; }
        if (!formData.password) { setFormError("Password is required."); return; }
        if (formData.password.length < 6) { setFormError("Password must be at least 6 characters."); return; }
        if (formData.password !== formData.confirmPassword) { setFormError("Passwords do not match."); return; }
        if (!club) return;
        try {
            const uid = await createAuthUserSecondary(formData.email.trim(), formData.password);
            const now = new Date();
            const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            const result = await addMember.mutateAsync({
                clubId: club.id,
                uid,
                member: {
                    name: formData.name.trim(),
                    phone: formData.phone.trim(),
                    email: formData.email.trim() || undefined,
                    membershipStart: Timestamp.now(),
                    membershipEnd: Timestamp.fromDate(endDate),
                    dob: formData.dob ? Timestamp.fromDate(new Date(formData.dob)) : null,
                    ...(formData.address && { address: formData.address }),
                    ...(formData.currentWeight && { currentWeight: Number(formData.currentWeight) } as any),
                    ...(formData.targetWeight && { targetWeight: Number(formData.targetWeight) } as any),
                    ...(formData.healthConditions && { healthConditions: formData.healthConditions } as any),
                },
            });
            setDialogOpen(false);
            setFormData({ name: "", phone: "", email: "", address: "", dob: "", currentWeight: "", targetWeight: "", healthConditions: "", password: "", confirmPassword: "" });
            setMembershipSuccess({
                memberName: formData.name.trim(),
                memberId: (result as any)?.memberId ?? "",
                planName: "Shake Credits Plan",
                amount: 0,
                paymentMethod: "Registration",
                startDate: now,
                endDate,
                clubName: club.name,
                clubPhone: club.phone ?? club.ownerPhone ?? "",
                clubAddress: (club as any).address ?? "",
                clubGst: (club as any).gstNumber ?? "",
                date: now,
                receiptNumber: `MBR${Date.now().toString().slice(-6)}`,
            });
        } catch (err: any) {
            const msg = err.code === "auth/email-already-in-use"
                ? "This email is already registered. Use a different email."
                : (err.message || "Failed to add member.");
            setFormError(msg);
            toast({ title: "Error", description: msg, variant: "destructive" });
        }
    };

    // ── Early return after all hooks ──────────────────────────────
    if (!club?.id) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;

    const tierColor: Record<string, string> = {
        gold: "bg-amber-100 text-amber-800 border-amber-200",
        silver: "bg-muted text-foreground border-slate-200",
        bronze: "bg-orange-100 text-orange-800 border-orange-200",
    };
    const statusColor: Record<string, string> = {
        active: "bg-emerald-100 text-emerald-800 border-emerald-200",
        expired: "bg-red-100 text-red-800 border-red-200",
        expiring: "bg-yellow-100 text-yellow-800 border-yellow-200",
    };

    return (
        <div className="px-4 md:px-8 py-8 max-w-6xl mx-auto w-full space-y-6 animate-fade-in" style={{ fontFamily: "'Nunito', sans-serif" }}>
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <h1 className="text-2xl font-black" style={{ color: "#2d9653" }}>Members</h1>
                <div className="flex gap-2 flex-wrap">
                    {missingIdCount > 0 && (
                        <Button variant="outline" className="gap-2 min-h-[48px] px-4 border-red-400 text-red-600 hover:bg-red-50" onClick={handleBackfillIds} disabled={backfilling}>
                            <RefreshCw className={`w-4 h-4 ${backfilling ? "animate-spin" : ""}`} />
                            {backfilling ? "Generating…" : `Fix ${missingIdCount} Missing ID${missingIdCount !== 1 ? "s" : ""}`}
                        </Button>
                    )}
                    <Button variant="outline" className="gap-2 min-h-[48px] px-4 border-emerald-600 text-emerald-700 hover:bg-emerald-50" onClick={() => setWeighInOpen(true)}>
                        <Scale className="w-4 h-4" /> Record Weigh-Ins
                    </Button>
                    <Button className="gap-2 min-h-[48px] px-4" style={{ backgroundColor: "#2d9653" }} onClick={() => setQrOpen(true)}>
                        <QrCode className="w-4 h-4" /> Add Member
                    </Button>
                </div>
            </div>

            {/* Search + Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="Search by name, phone or MNC ID…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 min-h-[48px]" />
                </div>
                <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
                    <TabsList className="flex-wrap min-h-[48px]">
                        <TabsTrigger value="all">All ({members?.length ?? 0})</TabsTrigger>
                        <TabsTrigger value="pending">⏳ Pending</TabsTrigger>
                        <TabsTrigger value="visiting">🟡 Visiting</TabsTrigger>
                        <TabsTrigger value="permanent">🟢 Permanent</TabsTrigger>
                        <TabsTrigger value="active">Active</TabsTrigger>
                        <TabsTrigger value="expired">Expired</TabsTrigger>
                        <TabsTrigger value="expiring">Expiring Soon</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {/* Member Cards */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 rounded-2xl border bg-card">
                    <p className="text-muted-foreground mb-4">No members match your criteria.</p>
                    <Button className="min-h-[48px] px-6" style={{ backgroundColor: "#2d9653" }} onClick={() => setDialogOpen(true)}>
                        Add your first member
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map((m) => {
                        const status = getMemberStatus(m);
                        const photo = (m as any).photoUrl || (m as any).photo || (m as any).photoURL || "";
                        const memberId = (m as any).memberId;
                        const shakeCredits = (m as any).shakeCredits ?? null;
                        const creditTotal = (m as any).shakeCreditsPlanTotal ?? null;
                        return (
                            <div key={m.id} className="rounded-2xl border shadow-sm hover:shadow-md transition-shadow bg-card overflow-hidden">
                                {/* Card header with photo */}
                                <div className="flex items-center gap-4 p-4 pb-3">
                                    <Avatar className="h-16 w-16 shrink-0 ring-2 ring-offset-1"
                                        style={{ ['--ring-color' as string]: status === "active" ? "#2d9653" : status === "expired" ? "#ef4444" : "#f59e0b" }}>
                                        <AvatarImage src={photo} alt={m.name} />
                                        <AvatarFallback className="text-xl font-black" style={{ backgroundColor: "#e8f5e9", color: "#2d9653" }}>
                                            {m.name?.[0]?.toUpperCase() ?? "?"}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-black text-base truncate text-foreground">{m.name}</p>
                                        <p className="text-sm text-muted-foreground">{m.phone}</p>
                                        {memberId && (
                                            <p className="text-xs font-mono text-emerald-700 font-bold mt-0.5">{memberId}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Badges */}
                                <div className="px-4 flex flex-wrap gap-1 pb-2">
                                    {(m as any).memberType === "visiting" ? (
                                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-800 border-amber-300">🟡 Visiting</Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-800 border-emerald-300">🟢 Permanent</Badge>
                                    )}
                                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">{(m as any).shakeCredits ?? 0} credits</Badge>
                                    <Badge variant="outline" className={`text-xs ${statusColor[status] || ""}`}>
                                        {status === "expiring" ? "Expiring" : status.charAt(0).toUpperCase() + status.slice(1)}
                                    </Badge>
                                    {(m as any).autoCredits && (
                                        <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">♾️ Auto</Badge>
                                    )}
                                </div>

                                {/* Stats row */}
                                <div className="px-4 pb-3 grid grid-cols-2 gap-2">
                                    <div className="bg-muted rounded-xl px-3 py-2">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Shake Credits</p>
                                        <p className="text-sm font-black text-foreground">
                                            {shakeCredits !== null ? shakeCredits : "—"}
                                            {creditTotal !== null ? <span className="text-xs text-slate-400 font-normal"> / {creditTotal}</span> : null}
                                        </p>
                                    </div>
                                    <div className="bg-muted rounded-xl px-3 py-2">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Plan Ends</p>
                                        <p className="text-sm font-black text-foreground truncate">{fmtDate(m.membershipEnd)}</p>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="px-4 pb-4 flex gap-2">
                                    <Button size="sm" variant="outline" className="min-h-[40px] flex-1" onClick={() => setDetailMember(m)}>
                                        <Eye className="w-4 h-4 mr-1.5" /> View
                                    </Button>
                                    <Button size="sm" variant="outline" className="min-h-[40px] flex-1 border-emerald-400 text-emerald-700 hover:bg-emerald-50" onClick={() => openEdit(m)}>
                                        <Pencil className="w-4 h-4 mr-1.5" /> Edit
                                    </Button>
                                    <Button size="sm" variant="outline" className="min-h-[40px] border-red-400 text-red-600 hover:bg-red-50" onClick={() => setDeletingMember(m)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── QR Code Modal ── */}
            <Dialog open={qrOpen} onOpenChange={setQrOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><QrCode className="w-5 h-5 text-emerald-600" /> Add New Member</DialogTitle>
                        <DialogDescription>Show this QR code to the person — they fill out the enquiry form on their phone.</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col items-center gap-4 py-2">
                        <div className="bg-card p-4 rounded-2xl shadow-md border-2 border-emerald-200">
                            <QRCodeSVG value={joinUrl} size={220} level="M" />
                        </div>
                        <div className="w-full bg-muted rounded-xl border px-3 py-2 flex items-center gap-2">
                            <p className="text-xs text-muted-foreground truncate flex-1">{joinUrl}</p>
                            <button className="shrink-0 text-gray-400 hover:text-emerald-600 transition-colors"
                                onClick={() => { navigator.clipboard.writeText(joinUrl); toast({ title: "Link copied!" }); }}>
                                <Copy className="w-4 h-4" />
                            </button>
                        </div>
                        <p className="text-xs text-center text-gray-400 px-2">Member scans the QR → fills the form → appears in <strong>Enquiries</strong> tab for activation.</p>
                        <div className="w-full flex items-center gap-3">
                            <div className="h-px flex-1 bg-gray-200" /><span className="text-xs text-gray-400 font-semibold">OR</span><div className="h-px flex-1 bg-gray-200" />
                        </div>
                        <Button variant="outline" className="w-full gap-2 min-h-[44px] border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => { setQrOpen(false); setDialogOpen(true); }}>
                            <UserPlus className="w-4 h-4" /> Enter Details Manually
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ── Manual Add Member Dialog ── */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Add Member Manually</DialogTitle>
                        <DialogDescription>Enter details for the new member.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleAdd} className="space-y-4 mt-4">
                        {formError && <p className="text-sm text-red-500">{formError}</p>}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Full Name *</Label><Input value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} placeholder="John Doe" /></div>
                            <div className="space-y-2"><Label>Phone *</Label><Input value={formData.phone} onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))} placeholder="+91 9999999999" /></div>
                        </div>
                        <div className="space-y-2"><Label>Email *</Label><Input type="email" value={formData.email} onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))} placeholder="email@example.com" required /></div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Password *</Label><Input type="password" value={formData.password} onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))} placeholder="Min 6 characters" required /></div>
                            <div className="space-y-2"><Label>Confirm Password *</Label><Input type="password" value={formData.confirmPassword} onChange={(e) => setFormData((p) => ({ ...p, confirmPassword: e.target.value }))} placeholder="Re-enter password" required /></div>
                        </div>
                        <div className="space-y-2"><Label>Address</Label><Input value={formData.address} onChange={(e) => setFormData((p) => ({ ...p, address: e.target.value }))} placeholder="Address" /></div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Date of Birth</Label><Input type="date" value={formData.dob} onChange={(e) => setFormData((p) => ({ ...p, dob: e.target.value }))} /></div>
                            <div className="space-y-2">
                                <Label>Membership</Label>
                                <p className="text-sm text-muted-foreground">Shake credits plan</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Current Weight (kg)</Label><Input type="number" step="0.1" value={formData.currentWeight} onChange={(e) => setFormData((p) => ({ ...p, currentWeight: e.target.value }))} placeholder="70" /></div>
                            <div className="space-y-2"><Label>Target Weight (kg)</Label><Input type="number" step="0.1" value={formData.targetWeight} onChange={(e) => setFormData((p) => ({ ...p, targetWeight: e.target.value }))} placeholder="65" /></div>
                        </div>
                        <div className="space-y-2"><Label>Health Conditions</Label><Input value={formData.healthConditions} onChange={(e) => setFormData((p) => ({ ...p, healthConditions: e.target.value }))} placeholder="e.g. diabetes, allergies" /></div>
                        <Button type="submit" className="w-full min-h-[48px]" style={{ backgroundColor: "#2d9653" }} disabled={addMember.isPending}>
                            {addMember.isPending ? "Adding…" : "Add Member"}
                        </Button>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Member Added — Success & Print Dialog */}
            <Dialog open={!!membershipSuccess} onOpenChange={() => setMembershipSuccess(null)}>
                <DialogContent className="rounded-2xl max-w-sm">
                    <DialogHeader><DialogTitle>Member Added!</DialogTitle></DialogHeader>
                    {membershipSuccess && (
                        <div className="space-y-4 pt-2">
                            <div className="flex flex-col items-center gap-2 py-4">
                                <CheckCircle className="w-12 h-12 text-emerald-500" />
                                <p className="text-lg font-bold">{membershipSuccess.memberName}</p>
                                <p className="text-sm text-muted-foreground capitalize">{membershipSuccess.planName} Membership · 30 days</p>
                            </div>
                            <Button className="w-full rounded-xl gap-2" style={{ backgroundColor: "#2d9653" }}
                                onClick={() => {
                                    if (!membershipSuccess || !club?.id) return;
                                    fetchClubAndPrint(club.id, (freshClub) =>
                                        buildMembershipReceipt({
                                            club: freshClub,
                                            memberName: membershipSuccess.memberName,
                                            memberId:   membershipSuccess.memberId,
                                            planName:   membershipSuccess.planName,
                                            amount:     membershipSuccess.amount,
                                            paymentMethod: membershipSuccess.paymentMethod,
                                            startDate:  membershipSuccess.startDate,
                                            endDate:    membershipSuccess.endDate,
                                            timestamp:  membershipSuccess.date,
                                            receiptNumber: membershipSuccess.receiptNumber,
                                        })
                                    );
                                }}>
                                <Printer className="w-4 h-4" /> Print Membership Receipt
                            </Button>
                            <Button variant="outline" className="w-full rounded-xl" onClick={() => setMembershipSuccess(null)}>Close</Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <BulkWeighIn open={weighInOpen} onClose={() => setWeighInOpen(false)} />

            {/* ── Delete Member Dialog ── */}
            <Dialog open={!!deletingMember} onOpenChange={(o) => { if (!o) setDeletingMember(null); }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-600"><Trash2 className="w-4 h-4" /> Delete Member</DialogTitle>
                        <DialogDescription>Are you sure you want to delete <strong>{deletingMember?.name}</strong>? This cannot be undone.</DialogDescription>
                    </DialogHeader>
                    <div className="flex gap-2 pt-2">
                        <Button variant="outline" className="flex-1" onClick={() => setDeletingMember(null)}>Cancel</Button>
                        <Button variant="destructive" className="flex-1" disabled={deleteConfirming} onClick={deleteMember}>
                            {deleteConfirming ? "Deleting…" : "Delete"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ── Edit Member Dialog ── */}
            <Dialog open={!!editingMember} onOpenChange={(o) => { if (!o) setEditingMember(null); }}>
                <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="w-4 h-4 text-emerald-600" /> Edit Member
                        </DialogTitle>
                    </DialogHeader>

                    {editingMember && (
                        <div className="space-y-5 mt-1">

                            {/* ─ Profile header ─ */}
                            <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted border">
                                <Avatar className="h-20 w-20 shrink-0 ring-2 ring-offset-2 ring-emerald-400">
                                    <AvatarImage src={(editingMember as any).photoUrl || (editingMember as any).photo || (editingMember as any).photoURL || ""} />
                                    <AvatarFallback className="text-2xl font-black" style={{ backgroundColor: "#e8f5e9", color: "#2d9653" }}>
                                        {editingMember.name?.[0]?.toUpperCase() ?? "?"}
                                    </AvatarFallback>
                                </Avatar>
                                <div>
                                    <p className="text-lg font-black text-foreground">{editingMember.name}</p>
                                    <p className="text-sm text-muted-foreground">{editingMember.phone}</p>
                                    {(editingMember as any).memberId && (
                                        <p className="text-xs font-mono font-bold text-emerald-700 mt-0.5">{(editingMember as any).memberId}</p>
                                    )}
                                    <p className="text-xs text-slate-400 mt-0.5">Joined: {fmtDate((editingMember as any).createdAt)}</p>
                                </div>
                            </div>

                            {/* ─ Activity stats (read-only) ─ */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Activity</p>
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="rounded-xl border bg-blue-50 border-blue-100 p-3 text-center">
                                        <Activity className="w-4 h-4 text-blue-500 mx-auto mb-1" />
                                        <p className="text-xl font-black text-blue-900">
                                            {memberStats === null ? "…" : memberStats.totalAttendance}
                                        </p>
                                        <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Total Check-ins</p>
                                    </div>
                                    <div className="rounded-xl border bg-violet-50 border-violet-100 p-3 text-center">
                                        <Users className="w-4 h-4 text-violet-500 mx-auto mb-1" />
                                        <p className="text-xl font-black text-violet-900">
                                            {memberStats === null ? "…" : memberStats.volunteerDays}
                                        </p>
                                        <p className="text-[10px] font-bold text-violet-500 uppercase tracking-widest">Volunteer Days</p>
                                    </div>
                                    <div className="rounded-xl border bg-emerald-50 border-emerald-100 p-3 text-center">
                                        <Calendar className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
                                        <p className="text-sm font-black text-emerald-900 leading-tight">
                                            {memberStats === null ? "…" : (memberStats.lastCheckIn ?? "—")}
                                        </p>
                                        <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Last Check-in</p>
                                    </div>
                                </div>
                            </div>

                            {/* ─ Basic Info ─ */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Basic Info</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1 col-span-2">
                                        <Label>Full Name</Label>
                                        <Input value={editForm.name || ""} onChange={e => setEditForm((p: any) => ({ ...p, name: e.target.value }))} placeholder="Full Name" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Phone</Label>
                                        <Input value={editForm.phone || ""} onChange={e => setEditForm((p: any) => ({ ...p, phone: e.target.value }))} placeholder="+91 9999999999" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Email</Label>
                                        <Input value={editForm.email || ""} onChange={e => setEditForm((p: any) => ({ ...p, email: e.target.value }))} placeholder="email@example.com" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Date of Birth</Label>
                                        <Input type="date" value={editForm.dob || ""} onChange={e => setEditForm((p: any) => ({ ...p, dob: e.target.value }))} />
                                    </div>
                                    <div className="space-y-1 col-span-2">
                                        <Label>Address</Label>
                                        <Input value={editForm.address || ""} onChange={e => setEditForm((p: any) => ({ ...p, address: e.target.value }))} placeholder="Address" />
                                    </div>
                                </div>
                            </div>

                            {/* ─ MNC ID ─ */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Member ID</p>
                                <div className="flex gap-2">
                                    <Input value={editForm.memberId || ""} onChange={e => setEditForm((p: any) => ({ ...p, memberId: e.target.value }))} placeholder="e.g. MNC-A-001" className="flex-1 font-mono" />
                                    <Button type="button" variant="outline" className="whitespace-nowrap" disabled={generatingId} onClick={generateEditId}>
                                        {generatingId ? "…" : "Generate"}
                                    </Button>
                                </div>
                            </div>

                            {/* ─ Body Stats ─ */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Body Stats</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label>Current Weight (kg)</Label>
                                        <Input type="number" step="0.1" value={editForm.currentWeight ?? ""} onChange={e => setEditForm((p: any) => ({ ...p, currentWeight: e.target.value }))} placeholder="e.g. 70" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Target Weight (kg)</Label>
                                        <Input type="number" step="0.1" value={editForm.targetWeight ?? ""} onChange={e => setEditForm((p: any) => ({ ...p, targetWeight: e.target.value }))} placeholder="e.g. 65" />
                                    </div>
                                    <div className="space-y-1 col-span-2">
                                        <Label>Health Conditions</Label>
                                        <Input value={editForm.healthConditions || ""} onChange={e => setEditForm((p: any) => ({ ...p, healthConditions: e.target.value }))} placeholder="e.g. diabetes, allergies" />
                                    </div>
                                </div>
                            </div>

                            {/* ─ Plan & Membership ─ */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Plan & Membership</p>
                                <div className="space-y-3">
                                    {/* Membership tier removed — using shake credits model */}
                                    <div className="space-y-1">
                                        <Label>Membership Plan</Label>
                                        <Select value={editForm.membershipPlanId || "__none__"} onValueChange={v => {
                                            const plan = editPlans.find(p => p.id === v);
                                            const credits = plan ? (plan.visits ?? plan.totalVisits ?? null) : null;
                                            setEditForm((p: any) => ({
                                                ...p,
                                                membershipPlanId: v === "__none__" ? "" : v,
                                                ...(credits !== null ? {
                                                    shakeCreditsPlanTotal: (Number(p.shakeCreditsPlanTotal) || 0) + credits,
                                                    shakeCredits: (Number(p.shakeCredits) || 0) + credits,
                                                } : {}),
                                            }));
                                        }}>
                                            <SelectTrigger><SelectValue placeholder="Select plan…" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__none__">— No plan —</SelectItem>
                                                {editPlans.map(plan => (
                                                    <SelectItem key={plan.id} value={plan.id}>
                                                        {plan.name} · {plan.visits ? `${plan.visits} credits` : "Unlimited"} · ₹{plan.price}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label>Plan Start Date</Label>
                                            <Input type="date" value={editForm.membershipStart || ""} onChange={e => setEditForm((p: any) => ({ ...p, membershipStart: e.target.value }))} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Plan End Date</Label>
                                            <Input type="date" value={editForm.membershipEnd || ""} onChange={e => setEditForm((p: any) => ({ ...p, membershipEnd: e.target.value }))} />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ─ Shake Credits ─ */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Shake Credits</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label>Credits Remaining</Label>
                                        <Input type="number" min={0} value={editForm.shakeCredits ?? ""} onChange={e => setEditForm((p: any) => ({ ...p, shakeCredits: e.target.value }))} placeholder="e.g. 12" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Total Credits (Plan)</Label>
                                        <Input type="number" min={0} value={editForm.shakeCreditsPlanTotal ?? ""} onChange={e => setEditForm((p: any) => ({ ...p, shakeCreditsPlanTotal: e.target.value }))} placeholder="e.g. 25" />
                                    </div>
                                </div>
                                <div className="mt-3 flex items-center gap-3 p-3 rounded-xl border bg-purple-50 border-purple-100">
                                    <input
                                        type="checkbox"
                                        id="autoCredits"
                                        checked={editForm.autoCredits ?? false}
                                        onChange={e => setEditForm((p: any) => ({ ...p, autoCredits: e.target.checked }))}
                                        className="w-4 h-4 accent-purple-600"
                                    />
                                    <label htmlFor="autoCredits" className="text-sm font-bold text-purple-800 cursor-pointer">
                                        Auto-Credits (♾️ resets to 25 every month — for staff/owners)
                                    </label>
                                </div>
                            </div>

                            {/* ─ Couple Attendance ─ */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Couple Attendance</p>
                                <div className="flex items-center gap-3 p-3 rounded-xl border bg-pink-50 border-pink-100">
                                    <input
                                        type="checkbox"
                                        id="isCouple"
                                        checked={editForm.isCouple ?? false}
                                        onChange={e => setEditForm((p: any) => ({ ...p, isCouple: e.target.checked }))}
                                        className="w-4 h-4 accent-pink-600"
                                    />
                                    <label htmlFor="isCouple" className="text-sm font-bold text-pink-800 cursor-pointer">
                                        💑 Couple account (husband &amp; wife share this membership)
                                    </label>
                                </div>
                                {editForm.isCouple && (
                                    <div className="grid grid-cols-2 gap-3 mt-3">
                                        <div className="space-y-1">
                                            <Label>Husband name</Label>
                                            <Input value={editForm.husbandName || ""} onChange={e => setEditForm((p: any) => ({ ...p, husbandName: e.target.value }))} placeholder="Husband name" />
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Wife name</Label>
                                            <Input value={editForm.wifeName || ""} onChange={e => setEditForm((p: any) => ({ ...p, wifeName: e.target.value }))} placeholder="Wife name" />
                                        </div>
                                    </div>
                                )}
                                <p className="text-[10px] text-slate-400 mt-2">When on, check-in asks <b>who's present</b> — Both / Only {editForm.husbandName || "Husband"} / Only {editForm.wifeName || "Wife"}.</p>
                            </div>

                            {/* ─ Referral ─ */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Referral</p>
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => { setReferralDropdownOpen(o => !o); setReferralSearch(""); }}
                                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                    >
                                        <span className={editForm.referredBy ? "text-foreground" : "text-muted-foreground"}>
                                            {editForm.referredBy
                                                ? (() => {
                                                    const ref = (members || []).find((m: any) => m.id === editForm.referredBy);
                                                    return ref ? `${ref.name}${ref.memberId ? ` (${ref.memberId})` : ""}` : "Select referrer…";
                                                })()
                                                : "Select referrer…"}
                                        </span>
                                        <svg className="h-4 w-4 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                                    </button>
                                    {referralDropdownOpen && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={() => setReferralDropdownOpen(false)} />
                                            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-64 flex flex-col">
                                                <div className="p-2 border-b">
                                                    <input
                                                        autoFocus
                                                        type="text"
                                                        placeholder="Search members…"
                                                        value={referralSearch}
                                                        onChange={e => setReferralSearch(e.target.value)}
                                                        className="w-full h-8 px-2 text-sm rounded border border-input bg-background outline-none focus:ring-2 focus:ring-ring"
                                                    />
                                                </div>
                                                <div className="overflow-y-auto flex-1 p-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => { setEditForm((p: any) => ({ ...p, referredBy: "" })); setReferralDropdownOpen(false); }}
                                                        className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-accent ${!editForm.referredBy ? "bg-accent font-semibold" : ""}`}
                                                    >
                                                        — None —
                                                    </button>
                                                    {(members || [])
                                                        .filter((m: any) => m.id !== editingMember?.id)
                                                        .filter((m: any) => {
                                                            if (!referralSearch.trim()) return true;
                                                            const q = referralSearch.toLowerCase();
                                                            return (m.name || "").toLowerCase().includes(q) || (m.phone || "").includes(q) || ((m as any).memberId || "").toLowerCase().includes(q);
                                                        })
                                                        .map((m: any) => (
                                                            <button
                                                                key={m.id}
                                                                type="button"
                                                                onClick={() => { setEditForm((p: any) => ({ ...p, referredBy: m.id })); setReferralDropdownOpen(false); }}
                                                                className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-accent ${editForm.referredBy === m.id ? "bg-accent font-semibold" : ""}`}
                                                            >
                                                                {m.name}{(m as any).memberId ? ` (${(m as any).memberId})` : ""}
                                                            </button>
                                                        ))
                                                    }
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* ─ Wallet Balance ─ */}
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Wallet Balance</p>
                                <div className="flex items-center justify-between mb-1">
                                    <Label>Set Balance</Label>
                                    <span className="text-xs text-muted-foreground">
                                        Current: {currentWalletBalance === null ? "Loading…" : `${currentWalletBalance} coins`}
                                    </span>
                                </div>
                                <Input type="number" min={0} value={editForm.walletBalance || ""} onChange={e => setEditForm((p: any) => ({ ...p, walletBalance: e.target.value }))} placeholder="Leave blank to keep current" />
                                <p className="text-[11px] text-muted-foreground mt-1">Leave blank to keep current balance unchanged.</p>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 pt-2">
                                <Button variant="outline" className="flex-1" onClick={() => setEditingMember(null)}>Cancel</Button>
                                <Button className="flex-1 min-h-[48px]" style={{ backgroundColor: "#2d9653" }} disabled={editSaving} onClick={saveEdit}>
                                    {editSaving ? "Saving…" : "Save Changes"}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* ── Member Detail Modal ── */}
            {detailMember && club?.id && (
                <MemberDetailModal
                    member={detailMember}
                    clubId={club.id}
                    onClose={() => setDetailMember(null)}
                    onUpdated={() => {
                        setDetailMember(null);
                    }}
                />
            )}

        </div>
    );
}
