import { useState, useEffect, useCallback } from "react";
import { Settings as SettingsIcon, Save, Plus, Trash2, Trash, Pencil, CheckCircle, Loader2, Send, UserCheck, Search, ImagePlus, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useClubContext } from "@/lib/clubDetection";
import { doc, getDoc, updateDoc, getDocs, addDoc, deleteDoc, collection, query, serverTimestamp, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useEarlyBird, deleteEarlyBirdPhoto } from "@/hooks/useEarlyBird";
import { useFunFriday, uploadFunFridayPhoto, deleteFunFridayPhoto } from "@/hooks/useFunFriday";
import type { MembershipPlan } from "@/types/firestore";
import { Timestamp } from "firebase/firestore";

const GREEN = "#2d9653";

export default function Settings() {
    const { toast } = useToast();
    const { club } = useClubContext();
    const clubId = club?.id ?? null;

    const [clubName, setClubName] = useState("");
    const [address, setAddress] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [gstNumber, setGstNumber] = useState("");
    const [googleReviewUrl, setGoogleReviewUrl] = useState("");
    const [lowBalanceThreshold, setLowBalanceThreshold] = useState(100);
    const [weighInDays, setWeighInDays] = useState<number[]>([]);
    const [faceVerificationEnabled, setFaceVerificationEnabled] = useState<boolean>(true);
    const [faceVerifySaving, setFaceVerifySaving] = useState(false);
    // Per-club print-token toggles. Both default ON (current behaviour);
    // owner can flip either off to suppress that slip on every shake order.
    const [printShakeToken, setPrintShakeToken] = useState<boolean>(true);
    const [printRefreshmentToken, setPrintRefreshmentToken] = useState<boolean>(true);
    const [printShakeSaving, setPrintShakeSaving] = useState(false);
    const [printRefreshmentSaving, setPrintRefreshmentSaving] = useState(false);
    const [plans, setPlans] = useState<(MembershipPlan & { id: string })[]>([]);
    const [plansLoading, setPlansLoading] = useState(true);
    const [profileLoading, setProfileLoading] = useState(true);
    const [profileSaving, setProfileSaving] = useState(false);
    const [walletSaving, setWalletSaving] = useState(false);

    // ── Club Media ──
    const { photo: earlyBirdPhoto } = useEarlyBird(clubId ?? undefined);
    const { photo: funFridayPhoto } = useFunFriday(clubId ?? undefined);
    const [ffUploading, setFfUploading] = useState(false);
    const [mediaDeleting, setMediaDeleting] = useState<'earlybird' | 'funfriday' | null>(null);

    // ── Today's Birthdays (TV Display) ──
    // Owner picks members to celebrate on the TV birthday slide. Stored at
    // clubs/{clubId}/tvBirthdays/{YYYY-MM-DD} so it auto-resets each day.
    const todayDateStr = () => new Date().toISOString().slice(0, 10);
    const [birthdaySelectedIds, setBirthdaySelectedIds] = useState<string[]>([]);
    const [birthdaySearch, setBirthdaySearch] = useState('');
    const [birthdaySaving, setBirthdaySaving] = useState(false);
    const [birthdayLoaded, setBirthdayLoaded] = useState(false);

    useEffect(() => {
        if (!clubId) {
            setBirthdayLoaded(true);
            return;
        }
        getDoc(doc(db, `clubs/${clubId}/tvBirthdays`, todayDateStr())).then(snap => {
            if (snap.exists()) {
                const d = snap.data() as any;
                setBirthdaySelectedIds(Array.isArray(d.memberIds) ? d.memberIds : []);
            }
            setBirthdayLoaded(true);
        }).catch(() => setBirthdayLoaded(true));
    }, [clubId]);

    const toggleBirthday = (id: string) => {
        setBirthdaySelectedIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const saveBirthdays = async () => {
        if (!clubId) return;
        setBirthdaySaving(true);
        try {
            const today = todayDateStr();
            const memberMap = Object.fromEntries(allMembers.map(m => [m.id, m]));
            const members = birthdaySelectedIds
                .map(id => memberMap[id])
                .filter(Boolean)
                .map((m: any) => ({
                    id: m.id,
                    name: m.name || m.fullName || '',
                    photoUrl: m.photoUrl || m.photo || null,
                }));
            await setDoc(doc(db, `clubs/${clubId}/tvBirthdays`, today), {
                memberIds: birthdaySelectedIds,
                members,
                updatedAt: serverTimestamp(),
            });
            toast({
                title: "Today's birthdays saved",
                description: `${members.length} member${members.length === 1 ? '' : 's'} on the TV until midnight.`,
            });
        } catch (e: any) {
            toast({ title: 'Error', description: e?.message || 'Failed to save', variant: 'destructive' });
        } finally {
            setBirthdaySaving(false);
        }
    };

    const clearBirthdays = async () => {
        if (!clubId) return;
        setBirthdaySaving(true);
        try {
            await deleteDoc(doc(db, `clubs/${clubId}/tvBirthdays`, todayDateStr()));
            setBirthdaySelectedIds([]);
            toast({ title: "Today's birthdays cleared" });
        } catch (e: any) {
            toast({ title: 'Error', description: e?.message || 'Failed to clear', variant: 'destructive' });
        } finally {
            setBirthdaySaving(false);
        }
    };

    const handleDeleteEarlyBird = async () => {
        if (!clubId) return;
        setMediaDeleting('earlybird');
        const result = await deleteEarlyBirdPhoto(clubId);
        if (result.success) toast({ title: "Early Bird photo deleted", description: "Members can now upload a new one." });
        else toast({ title: "Error", description: result.error, variant: "destructive" });
        setMediaDeleting(null);
    };

    const handleUploadFunFriday = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !clubId) return;
        setFfUploading(true);
        const result = await uploadFunFridayPhoto(clubId, file);
        if (result.success) toast({ title: "Fun Friday photo uploaded!", description: "Visible to all members for 7 days." });
        else toast({ title: "Error", description: result.error, variant: "destructive" });
        setFfUploading(false);
        e.target.value = "";
    };

    const handleDeleteFunFriday = async () => {
        if (!clubId) return;
        setMediaDeleting('funfriday');
        const result = await deleteFunFridayPhoto(clubId);
        if (result.success) toast({ title: "Fun Friday photo deleted." });
        else toast({ title: "Error", description: result.error, variant: "destructive" });
        setMediaDeleting(null);
    };

    // ── Accountants ──
    const [accountants, setAccountants] = useState<any[]>([]);
    const [allMembers, setAllMembers] = useState<any[]>([]);
    const [accountantSearch, setAccountantSearch] = useState('');
    const [accountantAdding, setAccountantAdding] = useState(false);

    // ── Inventory Managers ── (separate role from accountants — used for
    // inventory verification flows like product sales and stock updates)
    const [inventoryManagers, setInventoryManagers] = useState<any[]>([]);
    const [invMgrSearch, setInvMgrSearch] = useState('');
    const [invMgrAdding, setInvMgrAdding] = useState(false);

    const [planDialogOpen, setPlanDialogOpen] = useState(false);
    const [newPlanName, setNewPlanName] = useState("");
    const [newPlanDuration, setNewPlanDuration] = useState(30);
    const [newPlanPrice, setNewPlanPrice] = useState(0);
    const [newPlanBenefits, setNewPlanBenefits] = useState("");
    const [newPlanVisits, setNewPlanVisits] = useState<number | "">("");
    const [newPlanCategory, setNewPlanCategory] = useState("");
    const [planSaving, setPlanSaving] = useState(false);
    const [editingPlan, setEditingPlan] = useState<(MembershipPlan & { id: string }) | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);

    // Always fetch fresh from Firestore — never rely on potentially stale context cache
    useEffect(() => {
        if (!clubId) return;
        (async () => {
            setProfileLoading(true);
            try {
                const snap = await getDoc(doc(db, "clubs", clubId));
                if (snap.exists()) {
                    const data = snap.data();
                    setClubName(data.clubName || data.name || "");
                    setAddress(data.address || "");
                    setPhone(data.phone || data.ownerPhone || "");
                    setEmail(data.email || data.ownerEmail || "");
                    setGstNumber(data.gstNumber || "");
                    setGoogleReviewUrl(data.googleReviewUrl || "");
                    setLowBalanceThreshold(data.lowBalanceThreshold ?? 100);
                    setWeighInDays(data.weighInDays ?? []);
                    setFaceVerificationEnabled(data.faceVerificationEnabled ?? true);
                    setPrintShakeToken(data.printShakeToken !== false);
                    setPrintRefreshmentToken(data.printRefreshmentToken !== false);
                }
            } catch (err: any) {
                toast({ title: "Error loading settings", description: err.message, variant: "destructive" });
            } finally {
                setProfileLoading(false);
            }
        })();
    }, [clubId]); // re-runs if clubId changes

    useEffect(() => {
        if (!clubId) return;
        (async () => {
            setPlansLoading(true);
            try {
                const q = query(collection(db, `clubs/${clubId}/memberships`));
                const snap = await getDocs(q);
                setPlans(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MembershipPlan & { id: string })));
            } catch {
                setPlans([]);
            } finally {
                setPlansLoading(false);
            }
        })();
    }, [clubId]);

    // Load accountants + inventory managers + members for role management
    useEffect(() => {
        if (!clubId) return;
        const unsubAcc = onSnapshot(collection(db, `clubs/${clubId}/accountants`), snap => {
            setAccountants(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        const unsubInv = onSnapshot(collection(db, `clubs/${clubId}/inventoryManagers`), snap => {
            setInventoryManagers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        getDocs(collection(db, `clubs/${clubId}/members`)).then(snap => {
            setAllMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')));
        });
        return () => { unsubAcc(); unsubInv(); };
    }, [clubId]);

    const assignAccountant = async (member: any) => {
        if (!clubId) return;
        setAccountantAdding(true);
        try {
            await setDoc(doc(db, `clubs/${clubId}/accountants`, member.id), {
                memberId: member.id,
                name: member.name || member.fullName || '',
                photoUrl: member.photoUrl || member.photo || '',
                faceDescriptor: member.faceDescriptor || null,
                addedAt: serverTimestamp(),
            });
            toast({ title: `${member.name} assigned as accountant` });
            setAccountantSearch('');
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        } finally {
            setAccountantAdding(false);
        }
    };

    const removeAccountant = async (accountantId: string, name: string) => {
        if (!clubId) return;
        try {
            await deleteDoc(doc(db, `clubs/${clubId}/accountants`, accountantId));
            toast({ title: `${name} removed as accountant` });
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        }
    };

    const assignInventoryManager = async (member: any) => {
        if (!clubId) return;
        setInvMgrAdding(true);
        try {
            await setDoc(doc(db, `clubs/${clubId}/inventoryManagers`, member.id), {
                memberId: member.id,
                name: member.name || member.fullName || '',
                photoUrl: member.photoUrl || member.photo || '',
                faceDescriptor: member.faceDescriptor || null,
                addedAt: serverTimestamp(),
            });
            toast({ title: `${member.name} assigned as inventory manager` });
            setInvMgrSearch('');
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        } finally {
            setInvMgrAdding(false);
        }
    };

    const removeInventoryManager = async (mgrId: string, name: string) => {
        if (!clubId) return;
        try {
            await deleteDoc(doc(db, `clubs/${clubId}/inventoryManagers`, mgrId));
            toast({ title: `${name} removed as inventory manager` });
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        }
    };

    const handleSaveProfile = async () => {
        if (!clubId) return;
        setProfileSaving(true);
        try {
            await updateDoc(doc(db, "clubs", clubId), {
                name:       clubName,   // display name used throughout the app
                clubName:   clubName,   // explicit field for fetchClubAndPrint
                address,
                phone,                  // fetchClubAndPrint reads raw.phone first
                ownerPhone: phone,      // backward compat for other parts of app
                email,                  // fetchClubAndPrint reads raw.email first
                ownerEmail: email,      // backward compat
                gstNumber:       gstNumber.trim() || null,
                googleReviewUrl: googleReviewUrl.trim() || null,
                updatedAt:       serverTimestamp(),
            });
            toast({ title: "✅ Settings saved!", description: "Club profile updated successfully." });
        } catch (e: any) {
            toast({ title: "Save failed", description: e.message, variant: "destructive" });
        } finally {
            setProfileSaving(false);
        }
    };

    const handleSaveWallet = async () => {
        if (!clubId) return;
        setWalletSaving(true);
        try {
            await updateDoc(doc(db, "clubs", clubId), { lowBalanceThreshold, weighInDays });
            toast({ title: "Settings saved!" });
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setWalletSaving(false);
        }
    };

    // Instant-save toggle — flips the club-wide setting immediately so reception
    // staff see the change without an extra "Save" click.
    const handleToggleFaceVerification = async (next: boolean) => {
        if (!clubId) return;
        const previous = faceVerificationEnabled;
        setFaceVerificationEnabled(next); // optimistic
        setFaceVerifySaving(true);
        try {
            await updateDoc(doc(db, "clubs", clubId), { faceVerificationEnabled: next });
            toast({
                title: next ? "Face verification turned on" : "Face verification turned off",
                description: next
                    ? "Reception will scan faces before opening member profiles."
                    : "Reception will open member profiles directly without a face scan.",
            });
        } catch (e: any) {
            setFaceVerificationEnabled(previous); // rollback
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setFaceVerifySaving(false);
        }
    };

    // Instant-save toggles for the two auto-print slips. Reception's
    // onSnapshot picks the new value up immediately — no reload needed.
    const handleTogglePrintShake = async (next: boolean) => {
        if (!clubId) return;
        const previous = printShakeToken;
        setPrintShakeToken(next);
        setPrintShakeSaving(true);
        try {
            await updateDoc(doc(db, "clubs", clubId), { printShakeToken: next });
            toast({
                title: next ? "Shake token printing on" : "Shake token printing off",
                description: next
                    ? "Kitchen will receive a printed shake token for every order."
                    : "Shake-token slip will be suppressed on every order.",
            });
        } catch (e: any) {
            setPrintShakeToken(previous);
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setPrintShakeSaving(false);
        }
    };

    const handleTogglePrintRefreshment = async (next: boolean) => {
        if (!clubId) return;
        const previous = printRefreshmentToken;
        setPrintRefreshmentToken(next);
        setPrintRefreshmentSaving(true);
        try {
            await updateDoc(doc(db, "clubs", clubId), { printRefreshmentToken: next });
            toast({
                title: next ? "Refreshment token printing on" : "Refreshment token printing off",
                description: next
                    ? "Refreshment counter will receive a printed token for every order."
                    : "Refreshment-token slip will be suppressed on every order.",
            });
        } catch (e: any) {
            setPrintRefreshmentToken(previous);
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setPrintRefreshmentSaving(false);
        }
    };

    const handleAddPlan = async () => {
        if (!clubId || !newPlanName.trim()) return;
        setPlanSaving(true);
        try {
            const planData: any = {
                name: newPlanName.trim(),
                durationDays: newPlanDuration,
                price: newPlanPrice,
                benefits: newPlanBenefits.split("\n").filter(Boolean),
                color: GREEN,
                isActive: true,
                createdAt: Timestamp.now(),
            };
            if (newPlanVisits) planData.visits = Number(newPlanVisits);
            if (newPlanCategory.trim()) planData.category = newPlanCategory.trim();
            if (newPlanVisits && newPlanPrice > 0) {
                planData.perShakePrice = Math.round(newPlanPrice / Number(newPlanVisits));
            }
            await addDoc(collection(db, `clubs/${clubId}/memberships`), planData);
            toast({ title: "Plan added!" });
            setPlanDialogOpen(false);
            setNewPlanName("");
            setNewPlanDuration(30);
            setNewPlanPrice(0);
            setNewPlanBenefits("");
            setNewPlanVisits("");
            setNewPlanCategory("");
            const q = query(collection(db, `clubs/${clubId}/memberships`));
            const snap = await getDocs(q);
            setPlans(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MembershipPlan & { id: string })));
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setPlanSaving(false);
        }
    };

    const openEditDialog = (plan: MembershipPlan & { id: string }) => {
        setEditingPlan(plan);
        setNewPlanName(plan.name);
        setNewPlanDuration(plan.durationDays);
        setNewPlanPrice(plan.price);
        setNewPlanBenefits((plan.benefits || []).join("\n"));
        setNewPlanVisits(plan.visits ?? "");
        setNewPlanCategory(plan.category ?? "");
        setEditDialogOpen(true);
    };

    const handleEditPlan = async () => {
        if (!clubId || !editingPlan || !newPlanName.trim()) return;
        setPlanSaving(true);
        try {
            const updateData: any = {
                name: newPlanName.trim(),
                durationDays: newPlanDuration,
                price: newPlanPrice,
                benefits: newPlanBenefits.split("\n").filter(Boolean),
            };
            if (newPlanVisits) {
                updateData.visits = Number(newPlanVisits);
                if (newPlanPrice > 0) updateData.perShakePrice = Math.round(newPlanPrice / Number(newPlanVisits));
            }
            if (newPlanCategory.trim()) updateData.category = newPlanCategory.trim();
            await updateDoc(doc(db, `clubs/${clubId}/memberships`, editingPlan.id), updateData);
            toast({ title: "Plan updated!" });
            setEditDialogOpen(false);
            setEditingPlan(null);
            setNewPlanName("");
            setNewPlanDuration(30);
            setNewPlanPrice(0);
            setNewPlanBenefits("");
            setNewPlanVisits("");
            setNewPlanCategory("");
            const q = query(collection(db, `clubs/${clubId}/memberships`));
            const snap = await getDocs(q);
            setPlans(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MembershipPlan & { id: string })));
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setPlanSaving(false);
        }
    };

    const handleTogglePlan = async (plan: MembershipPlan & { id: string }) => {
        try {
            await updateDoc(doc(db, `clubs/${clubId}/memberships`, plan.id), { isActive: !plan.isActive });
            toast({ title: plan.isActive ? "Plan deactivated" : "Plan activated" });
            setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, isActive: !p.isActive } : p)));
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        }
    };

    const handleDeletePlan = async (planId: string) => {
        try {
            await deleteDoc(doc(db, `clubs/${clubId}/memberships`, planId));
            toast({ title: "Plan deleted" });
            setPlans((prev) => prev.filter((p) => p.id !== planId));
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        }
    };

    return (
        <div className="space-y-8 pb-12" style={{ fontFamily: "'Nunito', sans-serif" }}>
            <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: GREEN }}>
                <SettingsIcon className="w-6 h-6" /> Settings
            </h1>

            <section className="space-y-4">
                <div>
                    <h2 className="text-lg font-semibold">Club Profile</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">This information appears on all printed receipts.</p>
                </div>
                {profileLoading ? (
                    <div className="grid gap-4 max-w-md">
                        <Skeleton className="h-10 rounded-lg" />
                        <Skeleton className="h-20 rounded-lg" />
                        <div className="grid grid-cols-2 gap-3">
                            <Skeleton className="h-10 rounded-lg" />
                            <Skeleton className="h-10 rounded-lg" />
                        </div>
                        <Skeleton className="h-10 rounded-lg" />
                    </div>
                ) : null}
                <div className="grid gap-4 max-w-md" style={{ display: profileLoading ? "none" : undefined }}>
                    <div>
                        <Label>Club Name *</Label>
                        <Input value={clubName} onChange={(e) => setClubName(e.target.value)} placeholder="Magic Nutrition Club" />
                    </div>
                    <div>
                        <Label>Address</Label>
                        <textarea
                            className="w-full min-h-[80px] rounded-md border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder={`Shop No. 12, 1st Floor\nKoramangala, Bengaluru - 560034`}
                            rows={3}
                        />
                        <span className="text-xs text-muted-foreground mt-1 block">Printed on all receipts</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>Phone Number</Label>
                            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98123 90831" />
                        </div>
                        <div>
                            <Label>Email ID</Label>
                            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@club.com" />
                        </div>
                    </div>
                    <div>
                        <Label className="flex items-center gap-2">
                            GST Number
                            <span className="text-[11px] text-muted-foreground font-normal bg-gray-100 px-2 py-0.5 rounded-full">optional</span>
                        </Label>
                        <Input
                            value={gstNumber}
                            onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                            placeholder="e.g. 29ABCDE1234F1Z5"
                            maxLength={15}
                        />
                        <span className="text-xs text-muted-foreground mt-1 block">15-character GST number. Leave blank if not registered.</span>
                    </div>
                    <div>
                        <Label>Google Maps Review URL</Label>
                        <Input
                            type="url"
                            value={googleReviewUrl}
                            onChange={(e) => setGoogleReviewUrl(e.target.value)}
                            placeholder="https://www.google.com/maps/place/Your+Club+Name/..."
                        />
                        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                            Paste your full Google Maps link (e.g., https://www.google.com/maps/place/Magic+nutrition+club/@12.99,77.55...). Members will be redirected here to write a Google review. Their review text will be copied to clipboard for easy pasting.
                        </p>
                    </div>
                    <Button onClick={handleSaveProfile} disabled={profileSaving} style={{ backgroundColor: GREEN }}>
                        <Save className="w-4 h-4 mr-2" /> {profileSaving ? "Saving…" : "💾 Save Profile"}
                    </Button>
                </div>
            </section>

            <section className="space-y-4">
                <div className="flex justify-between items-center">
                    <h2 className="text-lg font-semibold">Membership Plans</h2>
                    <Button size="sm" onClick={() => setPlanDialogOpen(true)} style={{ backgroundColor: GREEN }}>
                        <Plus className="w-4 h-4 mr-1" /> Add Plan
                    </Button>
                </div>
                {plansLoading ? (
                    <p className="text-muted-foreground text-sm">Loading…</p>
                ) : plans.length > 0 ? (
                    <ul className="space-y-2">
                        {plans.map((p) => (
                            <li key={p.id} className="flex items-center justify-between p-4 rounded-xl border bg-white">
                                <div>
                                    <span className="font-medium">{p.name}</span>
                                    <span className="text-muted-foreground text-sm ml-2">
                                        {p.visits ? `${p.visits} credits • ` : `${p.durationDays} days • `}₹{p.price}
                                        {p.perShakePrice ? ` (₹${p.perShakePrice}/shake)` : ""}
                                    </span>
                                    {p.category && <Badge variant="outline" className="ml-2 text-xs">{p.category}</Badge>}
                                    {!p.isActive && <Badge variant="secondary" className="ml-2">Inactive</Badge>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button size="icon" variant="ghost" onClick={() => openEditDialog(p)}>
                                        <Pencil className="w-4 h-4" />
                                    </Button>
                                    <Switch checked={p.isActive} onCheckedChange={() => handleTogglePlan(p)} />
                                    <Button size="icon" variant="ghost" className="text-red-500" onClick={() => handleDeletePlan(p.id)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-muted-foreground text-sm">No plans yet.</p>
                )}
            </section>

            <section className="space-y-4">
                <h2 className="text-lg font-semibold">Other Settings</h2>
                <div className="grid gap-6">
                    {/* Face Verification toggle — instant save */}
                    <div className="flex items-start justify-between gap-4 max-w-xl rounded-xl border bg-white p-4">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <UserCheck className="w-4 h-4" style={{ color: GREEN }} />
                                <Label className="text-sm font-bold">Face Verification</Label>
                                <span
                                    className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                    style={{
                                        backgroundColor: faceVerificationEnabled ? "#dcfce7" : "#fef3c7",
                                        color: faceVerificationEnabled ? "#166534" : "#92400e",
                                    }}
                                >
                                    {faceVerificationEnabled ? "Required" : "Direct open"}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                When ON, reception scans the member's face before opening their profile.
                                Turn OFF for faster service when a receptionist or owner is at the counter
                                and there's a crowd.
                            </p>
                        </div>
                        <Switch
                            checked={faceVerificationEnabled}
                            onCheckedChange={handleToggleFaceVerification}
                            disabled={faceVerifySaving}
                        />
                    </div>

                    {/* ── Auto-print Token Toggles ── */}
                    <div className="rounded-xl border bg-white p-4 max-w-xl space-y-4">
                        <div>
                            <p className="font-bold text-sm" style={{ color: GREEN }}>Auto-print Tokens</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Control which slips print automatically every time a member checks in or orders a shake.
                                Turn one off if your kitchen and refreshment counter share the same paper, or if you don't need both.
                            </p>
                        </div>

                        <div className="flex items-start justify-between gap-4 border-t pt-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <Label className="text-sm font-bold">Print shake token</Label>
                                    <span
                                        className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                        style={{
                                            backgroundColor: printShakeToken ? "#dcfce7" : "#fef3c7",
                                            color: printShakeToken ? "#166534" : "#92400e",
                                        }}
                                    >
                                        {printShakeToken ? "On" : "Off"}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Kitchen-bound slip with the shake name + ice preference.
                                </p>
                            </div>
                            <Switch
                                checked={printShakeToken}
                                onCheckedChange={handleTogglePrintShake}
                                disabled={printShakeSaving}
                            />
                        </div>

                        <div className="flex items-start justify-between gap-4 border-t pt-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <Label className="text-sm font-bold">Print refreshment token</Label>
                                    <span
                                        className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                        style={{
                                            backgroundColor: printRefreshmentToken ? "#dcfce7" : "#fef3c7",
                                            color: printRefreshmentToken ? "#166534" : "#92400e",
                                        }}
                                    >
                                        {printRefreshmentToken ? "On" : "Off"}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Refreshment-counter slip ("AFRESH") with the same token number.
                                </p>
                            </div>
                            <Switch
                                checked={printRefreshmentToken}
                                onCheckedChange={handleTogglePrintRefreshment}
                                disabled={printRefreshmentSaving}
                            />
                        </div>

                        {!printShakeToken && !printRefreshmentToken && (
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                                Both toggles are off — no auto-print will happen on shake orders.
                            </p>
                        )}
                    </div>

                    <div className="flex flex-col gap-2 max-w-xs">
                        <Label>Low balance threshold (₹)</Label>
                        <Input
                            type="number"
                            value={lowBalanceThreshold}
                            onChange={(e) => setLowBalanceThreshold(Number(e.target.value) || 0)}
                            min={0}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>Weigh-in Schedule</Label>
                        <p className="text-xs text-muted-foreground mb-1">Select the days of the week when members should weigh in.</p>
                        <div className="flex flex-wrap gap-4">
                            {[
                                { label: "Sun", value: 0 },
                                { label: "Mon", value: 1 },
                                { label: "Tue", value: 2 },
                                { label: "Wed", value: 3 },
                                { label: "Thu", value: 4 },
                                { label: "Fri", value: 5 },
                                { label: "Sat", value: 6 },
                            ].map((day) => (
                                <div key={day.value} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`day-${day.value}`}
                                        checked={weighInDays.includes(day.value)}
                                        onCheckedChange={(checked) => {
                                            if (checked) {
                                                setWeighInDays([...weighInDays, day.value]);
                                            } else {
                                                setWeighInDays(weighInDays.filter(d => d !== day.value));
                                            }
                                        }}
                                    />
                                    <label
                                        htmlFor={`day-${day.value}`}
                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                    >
                                        {day.label}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <Button onClick={handleSaveWallet} disabled={walletSaving} style={{ backgroundColor: GREEN }} className="mt-4">
                    <Save className="w-4 h-4 mr-2" /> {walletSaving ? "Saving…" : "Save Settings"}
                </Button>
            </section>

            {/* ── Club Media ── */}
            <section className="rounded-2xl bg-white border shadow-sm p-6 space-y-5">
                <div className="flex items-center gap-2">
                    <Image className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-bold">Club Media</h2>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">Manage photos displayed on every member's dashboard.</p>

                {/* Early Bird */}
                <div className="rounded-xl border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🐦</span>
                            <div>
                                <p className="font-bold text-sm">Early Bird Photo</p>
                                <p className="text-xs text-muted-foreground">Resets daily. Any member can upload — delete if wrong photo was added.</p>
                            </div>
                        </div>
                    </div>
                    {earlyBirdPhoto ? (
                        <div className="space-y-2">
                            <img src={earlyBirdPhoto.photoUrl} alt="Early Bird" className="w-full rounded-lg object-cover" style={{ maxHeight: 160 }} />
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Uploaded at {(() => { try { const d = earlyBirdPhoto.uploadedAt?.toDate ? earlyBirdPhoto.uploadedAt.toDate() : new Date(earlyBirdPhoto.uploadedAt); return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); } catch { return "—"; } })()}</span>
                            </div>
                            <Button variant="destructive" size="sm" disabled={mediaDeleting === 'earlybird'} onClick={handleDeleteEarlyBird}>
                                <Trash2 className="w-4 h-4 mr-2" /> {mediaDeleting === 'earlybird' ? "Deleting…" : "Delete Photo"}
                            </Button>
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground italic">No early bird photo uploaded today.</p>
                    )}
                </div>

                {/* Fun Friday */}
                <div className="rounded-xl border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🏆</span>
                            <div>
                                <p className="font-bold text-sm">Fun Friday Winners</p>
                                <p className="text-xs text-muted-foreground">Stays visible for 7 days. Upload a new photo to replace the current one.</p>
                            </div>
                        </div>
                    </div>
                    {funFridayPhoto ? (
                        <div className="space-y-2">
                            <img src={funFridayPhoto.photoUrl} alt="Fun Friday" className="w-full rounded-lg object-cover" style={{ maxHeight: 160 }} />
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Valid until {funFridayPhoto.validUntil}</span>
                            </div>
                            <div className="flex gap-2">
                                <label className="cursor-pointer flex-1">
                                    <input type="file" accept="image/*" className="hidden" onChange={handleUploadFunFriday} disabled={ffUploading} />
                                    <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-emerald-500 text-emerald-700 text-sm font-bold hover:bg-emerald-50 cursor-pointer">
                                        <ImagePlus className="w-4 h-4" /> {ffUploading ? "Uploading…" : "Replace Photo"}
                                    </div>
                                </label>
                                <Button variant="destructive" size="sm" disabled={mediaDeleting === 'funfriday'} onClick={handleDeleteFunFriday}>
                                    <Trash2 className="w-4 h-4 mr-2" /> {mediaDeleting === 'funfriday' ? "Deleting…" : "Delete"}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-xs text-muted-foreground italic">No Fun Friday photo uploaded yet.</p>
                            <label className="cursor-pointer">
                                <input type="file" accept="image/*" className="hidden" onChange={handleUploadFunFriday} disabled={ffUploading} />
                                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white cursor-pointer" style={{ background: GREEN }}>
                                    <ImagePlus className="w-4 h-4" /> {ffUploading ? "Uploading…" : "Upload Photo"}
                                </div>
                            </label>
                        </div>
                    )}
                </div>

                {/* Today's Birthdays — TV Display */}
                <div className="rounded-xl border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🎂</span>
                            <div>
                                <p className="font-bold text-sm">Today's Birthdays — TV Display</p>
                                <p className="text-xs text-muted-foreground">Selected members appear on the TV birthday slide. Resets daily at midnight.</p>
                            </div>
                        </div>
                        <Badge variant="secondary">{birthdaySelectedIds.length} selected</Badge>
                    </div>

                    {/* Selected pill strip */}
                    {birthdaySelectedIds.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {birthdaySelectedIds.map(id => {
                                const m = allMembers.find((x: any) => x.id === id);
                                if (!m) return null;
                                const photo = m.photoUrl || m.photo;
                                return (
                                    <div key={id} className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full bg-pink-50 border border-pink-200">
                                        {photo ? (
                                            <img src={photo} className="w-6 h-6 rounded-full object-cover" alt="" />
                                        ) : (
                                            <div className="w-6 h-6 rounded-full bg-pink-300 text-white text-xs flex items-center justify-center font-bold">
                                                {(m.name || '?').charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <span className="text-xs font-semibold text-pink-900 max-w-[140px] truncate">{m.name}</span>
                                        <button
                                            onClick={() => toggleBirthday(id)}
                                            className="text-pink-700 hover:text-pink-900 text-base leading-none px-1"
                                            aria-label={`Remove ${m.name}`}
                                        >×</button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search member by name or phone…"
                            value={birthdaySearch}
                            onChange={e => setBirthdaySearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                        />
                    </div>

                    {/* Search results */}
                    {birthdaySearch.trim().length >= 1 && (
                        <div className="border rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                            {allMembers
                                .filter((m: any) => {
                                    const q = birthdaySearch.toLowerCase();
                                    return (m.name || '').toLowerCase().includes(q) || (m.phone || '').includes(q);
                                })
                                .slice(0, 20)
                                .map((m: any) => {
                                    const selected = birthdaySelectedIds.includes(m.id);
                                    const photo = m.photoUrl || m.photo;
                                    return (
                                        <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => toggleBirthday(m.id)}
                                            className={`w-full flex items-center gap-3 px-3 py-2.5 border-b last:border-0 text-left ${selected ? 'bg-pink-50' : 'hover:bg-slate-50'}`}
                                        >
                                            <Checkbox checked={selected} onCheckedChange={() => toggleBirthday(m.id)} className="flex-shrink-0" />
                                            {photo ? (
                                                <img src={photo} className="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="" />
                                            ) : (
                                                <div className="w-9 h-9 rounded-full bg-slate-400 text-white font-black text-sm flex items-center justify-center flex-shrink-0">
                                                    {(m.name || '?').charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-sm text-slate-800 truncate">{m.name}</p>
                                                <p className="text-xs text-slate-500">{m.phone || 'No phone'}</p>
                                            </div>
                                        </button>
                                    );
                                })}
                            {allMembers.filter((m: any) => {
                                const q = birthdaySearch.toLowerCase();
                                return (m.name || '').toLowerCase().includes(q) || (m.phone || '').includes(q);
                            }).length === 0 && (
                                <p className="text-sm text-slate-400 text-center py-4">No members found</p>
                            )}
                        </div>
                    )}

                    {/* Save / Clear */}
                    <div className="flex gap-2">
                        <Button
                            onClick={saveBirthdays}
                            disabled={birthdaySaving || !birthdayLoaded}
                            className="flex-1 text-white"
                            style={{ background: '#be185d' }}
                        >
                            <Save className="w-4 h-4 mr-2" /> {birthdaySaving ? 'Saving…' : 'Save to TV'}
                        </Button>
                        {birthdaySelectedIds.length > 0 && (
                            <Button variant="outline" onClick={clearBirthdays} disabled={birthdaySaving}>
                                <Trash2 className="w-4 h-4 mr-2" /> Clear
                            </Button>
                        )}
                    </div>
                </div>
            </section>

            {/* ── Accountants ── */}
            <section className="rounded-2xl bg-white border shadow-sm p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <UserCheck className="w-5 h-5" style={{ color: GREEN }} />
                    <h2 className="text-lg font-bold" style={{ color: GREEN }}>Accountants</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                    Accountants verify wallet top-ups at reception using face recognition.
                    Any member with an enrolled face can be assigned.
                </p>

                {/* Current accountants */}
                {accountants.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Active Accountants</p>
                        {accountants.map(acc => (
                            <div key={acc.id} className="flex items-center gap-3 p-3 rounded-xl border bg-green-50 border-green-200">
                                {acc.photoUrl ? (
                                    <img src={acc.photoUrl} className="w-10 h-10 rounded-full object-cover flex-shrink-0" alt="" />
                                ) : (
                                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-base flex-shrink-0" style={{ background: GREEN }}>
                                        {(acc.name || '?').charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div className="flex-1">
                                    <p className="font-bold text-sm text-slate-800">{acc.name}</p>
                                    <p className="text-xs text-slate-500">Active accountant</p>
                                </div>
                                <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50 hover:text-red-700 h-8 w-8 p-0" onClick={() => removeAccountant(acc.id, acc.name)}>
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
                {accountants.length === 0 && (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-slate-400 text-center">
                        No accountants assigned yet. Search below to add one.
                    </div>
                )}

                {/* Search + assign */}
                <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Assign New Accountant</p>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search member by name or phone…"
                            value={accountantSearch}
                            onChange={e => setAccountantSearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                    </div>
                    {accountantSearch.trim().length >= 2 && (
                        <div className="border rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                            {allMembers
                                .filter(m => {
                                    const q = accountantSearch.toLowerCase();
                                    return (
                                        (m.name || '').toLowerCase().includes(q) ||
                                        (m.phone || '').includes(q)
                                    ) && !accountants.find(a => a.id === m.id);
                                })
                                .slice(0, 10)
                                .map(m => (
                                    <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 border-b last:border-0">
                                        {m.photoUrl || m.photo ? (
                                            <img src={m.photoUrl || m.photo} className="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="" />
                                        ) : (
                                            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0 bg-slate-400">
                                                {(m.name || '?').charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-sm text-slate-800 truncate">{m.name}</p>
                                            <p className="text-xs text-slate-500">{m.phone || 'No phone'} {!m.faceDescriptor ? '· ⚠️ No face enrolled' : '· ✅ Face enrolled'}</p>
                                        </div>
                                        <Button size="sm" className="flex-shrink-0 h-8 text-xs" style={{ background: GREEN }} disabled={accountantAdding} onClick={() => assignAccountant(m)}>
                                            Assign
                                        </Button>
                                    </div>
                                ))}
                            {allMembers.filter(m => {
                                const q = accountantSearch.toLowerCase();
                                return ((m.name || '').toLowerCase().includes(q) || (m.phone || '').includes(q)) && !accountants.find(a => a.id === m.id);
                            }).length === 0 && (
                                <p className="text-sm text-slate-400 text-center py-4">No members found</p>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* ── Inventory Managers ── */}
            <section className="rounded-2xl bg-white border shadow-sm p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <UserCheck className="w-5 h-5 text-amber-600" />
                    <h2 className="text-lg font-bold text-amber-700">Inventory Managers</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                    Inventory managers verify product sales and stock adjustments using face recognition.
                    This is a separate role from accountants — a member can be either, both, or neither.
                </p>

                {/* Current inventory managers */}
                {inventoryManagers.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Active Inventory Managers</p>
                        {inventoryManagers.map(mgr => (
                            <div key={mgr.id} className="flex items-center gap-3 p-3 rounded-xl border bg-amber-50 border-amber-200">
                                {mgr.photoUrl ? (
                                    <img src={mgr.photoUrl} className="w-10 h-10 rounded-full object-cover flex-shrink-0" alt="" />
                                ) : (
                                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-base flex-shrink-0 bg-amber-600">
                                        {(mgr.name || '?').charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div className="flex-1">
                                    <p className="font-bold text-sm text-slate-800">{mgr.name}</p>
                                    <p className="text-xs text-slate-500">Active inventory manager</p>
                                </div>
                                <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50 hover:text-red-700 h-8 w-8 p-0" onClick={() => removeInventoryManager(mgr.id, mgr.name)}>
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
                {inventoryManagers.length === 0 && (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-slate-400 text-center">
                        No inventory managers assigned yet. Search below to add one.
                    </div>
                )}

                {/* Search + assign */}
                <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Assign New Inventory Manager</p>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search member by name or phone…"
                            value={invMgrSearch}
                            onChange={e => setInvMgrSearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                    </div>
                    {invMgrSearch.trim().length >= 2 && (
                        <div className="border rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                            {allMembers
                                .filter(m => {
                                    const q = invMgrSearch.toLowerCase();
                                    return (
                                        (m.name || '').toLowerCase().includes(q) ||
                                        (m.phone || '').includes(q)
                                    ) && !inventoryManagers.find(im => im.id === m.id);
                                })
                                .slice(0, 10)
                                .map(m => (
                                    <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 border-b last:border-0">
                                        {m.photoUrl || m.photo ? (
                                            <img src={m.photoUrl || m.photo} className="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="" />
                                        ) : (
                                            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0 bg-slate-400">
                                                {(m.name || '?').charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-sm text-slate-800 truncate">{m.name}</p>
                                            <p className="text-xs text-slate-500">{m.phone || 'No phone'} {!m.faceDescriptor ? '· ⚠️ No face enrolled' : '· ✅ Face enrolled'}</p>
                                        </div>
                                        <Button size="sm" className="flex-shrink-0 h-8 text-xs bg-amber-600 hover:bg-amber-700" disabled={invMgrAdding} onClick={() => assignInventoryManager(m)}>
                                            Assign
                                        </Button>
                                    </div>
                                ))}
                            {allMembers.filter(m => {
                                const q = invMgrSearch.toLowerCase();
                                return ((m.name || '').toLowerCase().includes(q) || (m.phone || '').includes(q)) && !inventoryManagers.find(im => im.id === m.id);
                            }).length === 0 && (
                                <p className="text-sm text-slate-400 text-center py-4">No members found</p>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* ── Clear Cache ── */}
            <section className="rounded-2xl bg-white border shadow-sm p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <Trash className="w-5 h-5 text-red-500" />
                    <h2 className="text-lg font-bold text-red-600">Clear Cache Memory</h2>
                </div>
                <p className="text-sm text-gray-500">
                    If the app is showing outdated data or a new update isn't reflecting, clear the cache and refresh. This removes all locally stored app files (service worker cache, browser cache) and reloads the latest version.
                </p>
                <Button
                    variant="outline"
                    className="gap-2 border-red-400 text-red-600 hover:bg-red-50"
                    onClick={async () => {
                        try {
                            // 1. Unregister all service workers
                            if ("serviceWorker" in navigator) {
                                const regs = await navigator.serviceWorker.getRegistrations();
                                await Promise.all(regs.map((r) => r.unregister()));
                            }
                            // 2. Delete every cache the browser holds
                            if ("caches" in window) {
                                const keys = await caches.keys();
                                await Promise.all(keys.map((k) => caches.delete(k)));
                            }
                            // 3. Clear localStorage (preserves PIN so owner isn't locked out)
                            const pinKeys = Object.keys(localStorage).filter((k) => k.startsWith("pin_"));
                            const pinValues: Record<string, string> = {};
                            pinKeys.forEach((k) => { pinValues[k] = localStorage.getItem(k) ?? ""; });
                            localStorage.clear();
                            pinKeys.forEach((k) => localStorage.setItem(k, pinValues[k]));
                            // 4. Hard reload — fetches everything fresh from server
                            window.location.reload();
                        } catch (err) {
                            toast({ title: "Cache clear failed", description: String(err), variant: "destructive" });
                        }
                    }}
                >
                    <Trash className="w-4 h-4" /> Clear Cache & Refresh
                </Button>
            </section>

            <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Add Plan</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <div><Label>Name</Label><Input value={newPlanName} onChange={(e) => setNewPlanName(e.target.value)} placeholder="e.g. 5 Visits" /></div>
                        <div><Label>Category</Label><Input value={newPlanCategory} onChange={(e) => setNewPlanCategory(e.target.value)} placeholder="e.g. Universal Membership, Digestive Health" /></div>
                        <div className="grid grid-cols-3 gap-3">
                            <div><Label>Duration (days)</Label><Input type="number" value={newPlanDuration} onChange={(e) => setNewPlanDuration(Number(e.target.value))} min={1} /></div>
                            <div><Label>Visits</Label><Input type="number" value={newPlanVisits} onChange={(e) => setNewPlanVisits(e.target.value ? Number(e.target.value) : "")} min={1} placeholder="Optional" /></div>
                            <div><Label>Price (₹)</Label><Input type="number" value={newPlanPrice} onChange={(e) => setNewPlanPrice(Number(e.target.value))} min={0} /></div>
                        </div>
                        {newPlanVisits && newPlanPrice > 0 && (
                            <p className="text-xs text-muted-foreground">₹{Math.round(newPlanPrice / Number(newPlanVisits))} per shake</p>
                        )}
                        <div><Label>Benefits (one per line)</Label><textarea className="w-full min-h-[80px] rounded-md border px-3 py-2 text-sm" value={newPlanBenefits} onChange={(e) => setNewPlanBenefits(e.target.value)} placeholder="One benefit per line" /></div>
                        <Button onClick={handleAddPlan} disabled={planSaving || !newPlanName.trim()} className="w-full" style={{ backgroundColor: GREEN }}>
                            <Save className="w-4 h-4 mr-2" /> {planSaving ? "Saving…" : "Add Plan"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Edit Plan</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <div><Label>Name</Label><Input value={newPlanName} onChange={(e) => setNewPlanName(e.target.value)} placeholder="e.g. 5 Visits" /></div>
                        <div><Label>Category</Label><Input value={newPlanCategory} onChange={(e) => setNewPlanCategory(e.target.value)} placeholder="e.g. Universal Membership, Digestive Health" /></div>
                        <div className="grid grid-cols-3 gap-3">
                            <div><Label>Duration (days)</Label><Input type="number" value={newPlanDuration} onChange={(e) => setNewPlanDuration(Number(e.target.value))} min={1} /></div>
                            <div><Label>Visits</Label><Input type="number" value={newPlanVisits} onChange={(e) => setNewPlanVisits(e.target.value ? Number(e.target.value) : "")} min={1} placeholder="Optional" /></div>
                            <div><Label>Price (₹)</Label><Input type="number" value={newPlanPrice} onChange={(e) => setNewPlanPrice(Number(e.target.value))} min={0} /></div>
                        </div>
                        {newPlanVisits && newPlanPrice > 0 && (
                            <p className="text-xs text-muted-foreground">₹{Math.round(newPlanPrice / Number(newPlanVisits))} per shake</p>
                        )}
                        <div><Label>Benefits (one per line)</Label><textarea className="w-full min-h-[80px] rounded-md border px-3 py-2 text-sm" value={newPlanBenefits} onChange={(e) => setNewPlanBenefits(e.target.value)} placeholder="One benefit per line" /></div>
                        <Button onClick={handleEditPlan} disabled={planSaving || !newPlanName.trim()} className="w-full" style={{ backgroundColor: GREEN }}>
                            <Save className="w-4 h-4 mr-2" /> {planSaving ? "Saving…" : "Save Changes"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
