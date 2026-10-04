import { useState, useRef, useEffect } from "react";
import {
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider,
    signOut,
} from "firebase/auth";
import { doc, updateDoc, Timestamp } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { format } from "date-fns";
import { Pencil, LogOut, RefreshCw, CheckCircle, AlertTriangle, Wallet, GitBranch, ChevronRight, Download, Share2, Camera, Loader2, Bell, BellOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useClubContext, invalidateClubCache } from "@/lib/clubDetection";
import { auth, db, storage } from "@/lib/firebase";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useMyWallet } from "@/hooks/useMemberWallet";
import { useClubMembershipPlans, useRenewMembership } from "@/hooks/member/useMembership";
import { fetchClubAndPrint } from "@/utils/printReceipt";
import { buildMembershipReceipt } from "@/utils/receiptBuilder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { User, MembershipPlan } from "@/types/firestore";
import { setMemberPhoto } from "@/lib/memberPhoto";

const GREEN = "#2d9653";
const BG = "#f8fffe";

function formatTimestamp(ts: Timestamp | null | undefined): string {
    if (!ts?.toDate) return "—";
    return format(ts.toDate(), "dd MMM yyyy");
}

async function compressImage(file: File, maxSize = 800, quality = 0.85): Promise<Blob> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = dataUrl;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(img, 0, 0, w, h);
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Failed to compress image"))),
            "image/jpeg",
            quality,
        );
    });
}

export default function MemberProfilePage() {
    const { userProfile, firebaseUser, loading, refreshProfile } = useAuth();
    const { club } = useClubContext();
    const { toast } = useToast();

    const [isEditMode, setIsEditMode] = useState(false);
    const [editName, setEditName] = useState("");
    const [editPhone, setEditPhone] = useState("");
    const [editWhatsapp, setEditWhatsapp] = useState("");
    const [editEmail, setEditEmail] = useState("");
    const [editAddress, setEditAddress] = useState("");
    const [editDob, setEditDob] = useState("");
    const [editCurrentWeight, setEditCurrentWeight] = useState("");
    const [editTargetWeight, setEditTargetWeight] = useState("");
    const [editHealthConditions, setEditHealthConditions] = useState("");
    const [saving, setSaving] = useState(false);

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [changingPassword, setChangingPassword] = useState(false);

    const [profileOverride, setProfileOverride] = useState<Partial<User> | null>(null);

    const profile = profileOverride
        ? { ...userProfile, ...profileOverride }
        : userProfile;

    const photoInputRef = useRef<HTMLInputElement>(null);
    const [photoUploading, setPhotoUploading] = useState(false);

    const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file || !profile?.id || !club?.id) return;
        if (!file.type.startsWith("image/")) {
            toast({ title: "Please pick an image file", variant: "destructive" });
            return;
        }
        setPhotoUploading(true);
        try {
            const compressed = await compressImage(file);
            const ref = storageRef(storage, `clubs/${club.id}/members/${profile.id}/profile-photo.jpg`);
            await uploadBytes(ref, compressed, { contentType: "image/jpeg" });
            const url = await getDownloadURL(ref);
            // Cache-bust so the new photo appears immediately
            const bustedUrl = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
            // Through the shared writer: this used to set only `photo`, while
            // the reception grid, kitchen, TV and reports all read `photoUrl`
            // first — so a member who had ever been enrolled at the desk saw
            // their new picture here and their old one everywhere else.
            await setMemberPhoto(club.id, profile.id, bustedUrl);
            setProfileOverride({ ...(profileOverride ?? {}), photo: bustedUrl });
            await refreshProfile();
            toast({ title: "Photo updated!" });
        } catch (err: any) {
            toast({
                title: "Upload failed",
                description: err.message || "Could not update photo",
                variant: "destructive",
            });
        } finally {
            setPhotoUploading(false);
        }
    };

    const handleEnterEdit = () => {
        if (profile) {
            setEditName(profile.name);
            setEditPhone(profile.phone);
            setEditWhatsapp((profile as any).whatsapp ?? "");
            setEditEmail(profile.email ?? "");
            setEditAddress((profile as any).address ?? "");
            const dob = profile.dob;
            if (dob?.toDate) {
                setEditDob(format(dob.toDate(), "yyyy-MM-dd"));
            } else {
                setEditDob("");
            }
            setEditCurrentWeight(String((profile as any).currentWeight ?? ""));
            setEditTargetWeight(String((profile as any).targetWeight ?? ""));
            setEditHealthConditions((profile as any).healthConditions ?? "");
            setIsEditMode(true);
        }
    };

    const handleCancelEdit = () => {
        setIsEditMode(false);
    };

    const handleSaveProfile = async () => {
        if (!profile?.id || !firebaseUser) return;
        setSaving(true);
        try {
            const userRef = doc(db, `clubs/${club!.id}/members`, profile.id);
            const updates: Record<string, any> = {
                name: editName,
                phone: editPhone,
                whatsapp: editWhatsapp,
                address: editAddress,
                currentWeight: editCurrentWeight ? parseFloat(editCurrentWeight) : null,
                targetWeight: editTargetWeight ? parseFloat(editTargetWeight) : null,
                healthConditions: editHealthConditions,
            };
            if (editDob) {
                updates.dob = Timestamp.fromDate(new Date(editDob));
            }
            await updateDoc(userRef, updates);
            setProfileOverride(updates);
            setIsEditMode(false);
            await refreshProfile();
            toast({ title: "Profile updated!" });
        } catch (err: any) {
            toast({
                title: "Error",
                description: err.message || "Failed to update profile",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleChangePassword = async () => {
        if (!firebaseUser?.email) return;
        if (newPassword !== confirmPassword) {
            toast({
                title: "Passwords don't match",
                variant: "destructive",
            });
            return;
        }
        if (newPassword.length < 6) {
            toast({
                title: "Password must be at least 6 characters",
                variant: "destructive",
            });
            return;
        }
        setChangingPassword(true);
        try {
            const credential = EmailAuthProvider.credential(
                firebaseUser.email,
                currentPassword
            );
            await reauthenticateWithCredential(firebaseUser, credential);
            await updatePassword(firebaseUser, newPassword);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            toast({ title: "Password changed successfully!" });
        } catch (err: any) {
            const msg =
                err.code === "auth/wrong-password"
                    ? "Current password is incorrect"
                    : err.message || "Failed to change password";
            toast({ title: "Error", description: msg, variant: "destructive" });
        } finally {
            setChangingPassword(false);
        }
    };

    const handleSignOut = async () => {
        try {
            await signOut(auth);
            invalidateClubCache();
        } catch (err: any) {
            toast({
                title: "Error",
                description: err.message || "Failed to sign out",
                variant: "destructive",
            });
        }
    };

    if (loading || (!userProfile && !firebaseUser)) {
        return (
            <div
                className="min-h-screen p-4 pb-24 animate-fade-in"
                style={{ fontFamily: "'Nunito', sans-serif", background: BG }}
            >
                <div className="max-w-md mx-auto space-y-6">
                    <Skeleton className="h-32 w-32 rounded-full mx-auto" />
                    <Skeleton className="h-8 w-48 mx-auto" />
                    <Skeleton className="h-24 rounded-2xl" />
                    <Skeleton className="h-32 rounded-2xl" />
                </div>
            </div>
        );
    }

    if (!profile) {
        return (
            <div
                className="min-h-screen flex items-center justify-center p-4"
                style={{ fontFamily: "'Nunito', sans-serif", background: BG }}
            >
                <p className="text-muted-foreground">Profile not found.</p>
            </div>
        );
    }

    return (
        <div
            className="min-h-screen p-4 pb-24 animate-fade-in"
            style={{ fontFamily: "'Nunito', sans-serif", background: BG }}
        >
            <div className="max-w-md mx-auto space-y-6">
                {/* Profile photo */}
                <div className="flex justify-center pt-4">
                    <button
                        type="button"
                        onClick={() => !photoUploading && photoInputRef.current?.click()}
                        disabled={photoUploading}
                        className="relative outline-none"
                        aria-label="Change profile photo"
                    >
                        <Avatar className="h-28 w-28 rounded-full border-4 border-white shadow-soft">
                            {profile.photo ? (
                                <AvatarImage src={profile.photo} />
                            ) : null}
                            <AvatarFallback
                                className="text-3xl font-black"
                                style={{ backgroundColor: "#e8f5e9", color: GREEN }}
                            >
                                {profile.name?.[0]?.toUpperCase() || "?"}
                            </AvatarFallback>
                        </Avatar>
                        {photoUploading && (
                            <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40">
                                <Loader2 className="w-7 h-7 text-white animate-spin" />
                            </div>
                        )}
                        <span
                            className="absolute bottom-0 right-0 w-9 h-9 rounded-full flex items-center justify-center shadow-md border-2 border-white"
                            style={{ backgroundColor: GREEN }}
                        >
                            <Camera className="w-4 h-4 text-white" />
                        </span>
                    </button>
                    <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/*"
                        capture="user"
                        onChange={handlePhotoChange}
                        className="hidden"
                    />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-black" style={{ color: GREEN }}>
                        My Profile
                    </h1>
                    {!isEditMode ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleEnterEdit}
                            className="rounded-full"
                            style={{ color: GREEN }}
                        >
                            <Pencil className="w-5 h-5" />
                        </Button>
                    ) : (
                        <div className="flex gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleCancelEdit}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleSaveProfile}
                                disabled={saving}
                                style={{ backgroundColor: GREEN }}
                            >
                                {saving ? "Saving…" : "Save"}
                            </Button>
                        </div>
                    )}
                </div>

                {/* Profile card */}
                <div className="member-card space-y-4">
                    {isEditMode ? (
                        <>
                            <div className="space-y-2">
                                <Label>Full name</Label>
                                <Input
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    placeholder="Your name"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Phone</Label>
                                <Input
                                    value={editPhone}
                                    onChange={(e) => setEditPhone(e.target.value)}
                                    placeholder="Phone number"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>WhatsApp</Label>
                                <Input
                                    value={editWhatsapp}
                                    onChange={(e) => setEditWhatsapp(e.target.value)}
                                    placeholder="WhatsApp number"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input
                                    value={editEmail}
                                    onChange={(e) => setEditEmail(e.target.value)}
                                    placeholder="your@email.com"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Address</Label>
                                <Input
                                    value={editAddress}
                                    onChange={(e) => setEditAddress(e.target.value)}
                                    placeholder="Your address"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Date of Birth</Label>
                                <Input
                                    type="date"
                                    value={editDob}
                                    onChange={(e) => setEditDob(e.target.value)}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Current Weight (kg)</Label>
                                    <Input
                                        type="number"
                                        step="0.1"
                                        value={editCurrentWeight}
                                        onChange={(e) => setEditCurrentWeight(e.target.value)}
                                        placeholder="e.g. 68.5"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Target Weight (kg)</Label>
                                    <Input
                                        type="number"
                                        step="0.1"
                                        value={editTargetWeight}
                                        onChange={(e) => setEditTargetWeight(e.target.value)}
                                        placeholder="e.g. 60"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Health Conditions</Label>
                                <Input
                                    value={editHealthConditions}
                                    onChange={(e) => setEditHealthConditions(e.target.value)}
                                    placeholder="Any health conditions"
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <p className="text-xs text-muted-foreground">Name</p>
                                <p className="font-bold text-base">{profile.name}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Phone</p>
                                <p className="font-bold text-base">{profile.phone}</p>
                            </div>
                            {(profile as any).whatsapp && (
                                <div>
                                    <p className="text-xs text-muted-foreground">WhatsApp</p>
                                    <p className="font-medium text-base">{(profile as any).whatsapp}</p>
                                </div>
                            )}
                            <div>
                                <p className="text-xs text-muted-foreground">Email</p>
                                <p className="font-medium text-base text-muted-foreground">
                                    {profile.email}
                                </p>
                            </div>
                            {(profile as any).address && (
                                <div>
                                    <p className="text-xs text-muted-foreground">Address</p>
                                    <p className="font-medium text-base">{(profile as any).address}</p>
                                </div>
                            )}
                            <div>
                                <p className="text-xs text-muted-foreground">Date of birth</p>
                                <p className="font-medium text-base">
                                    {formatTimestamp(profile.dob)}
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                {(profile as any).currentWeight != null && (
                                    <div>
                                        <p className="text-xs text-muted-foreground">Current Weight</p>
                                        <p className="font-medium text-base">{(profile as any).currentWeight} kg</p>
                                    </div>
                                )}
                                {(profile as any).targetWeight != null && (
                                    <div>
                                        <p className="text-xs text-muted-foreground">Target Weight</p>
                                        <p className="font-medium text-base">{(profile as any).targetWeight} kg</p>
                                    </div>
                                )}
                            </div>
                            {(profile as any).healthConditions && (
                                <div>
                                    <p className="text-xs text-muted-foreground">Health Conditions</p>
                                    <p className="font-medium text-base">{(profile as any).healthConditions}</p>
                                </div>
                            )}
                            <div className="flex flex-wrap gap-2 pt-2">
                                <Badge
                                    className="capitalize"
                                    style={{
                                        backgroundColor: "#e3f2fd",
                                        color: "#1565c0",
                                        border: "none",
                                    }}
                                >
                                    {(profile as any).shakeCredits ?? 0} credits
                                </Badge>
                                <Badge
                                    variant={
                                        profile.status === "active"
                                            ? "outline"
                                            : "destructive"
                                    }
                                >
                                    {profile.status}
                                </Badge>
                            </div>
                        </>
                    )}
                </div>

                {/* Membership Status Card */}
                <MembershipStatusCard profile={profile} club={club} toast={toast} />

                {/* Notifications toggle */}
                <NotificationsToggle profile={profile} club={club} toast={toast} />

                {/* My Network */}
                <Link
                    to="/member/network"
                    className="flex items-center justify-between p-4 bg-card border rounded-2xl shadow-sm active:scale-[0.98] transition-transform"
                    style={{ textDecoration: "none" }}
                >
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#f0fdf4" }}>
                            <GitBranch className="w-5 h-5" style={{ color: GREEN }} />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-foreground">My Network</p>
                            <p className="text-xs text-muted-foreground">View your referral tree & downline</p>
                        </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                </Link>

                {/* Change password */}
                <div className="member-card space-y-4">
                    <h2 className="text-sm font-bold" style={{ color: GREEN }}>
                        Change password
                    </h2>
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <Label>Current password</Label>
                            <Input
                                type="password"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>New password</Label>
                            <Input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Confirm new password</Label>
                            <Input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>
                        <Button
                            className="w-full"
                            onClick={handleChangePassword}
                            disabled={
                                changingPassword ||
                                !currentPassword ||
                                !newPassword ||
                                !confirmPassword
                            }
                            style={{ backgroundColor: GREEN }}
                        >
                            {changingPassword ? "Updating…" : "Save password"}
                        </Button>
                    </div>
                </div>

                {/* Download / Share App */}
                <DownloadAppButton />

                {/* Sign out */}
                <Button
                    variant="outline"
                    className="w-full border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={handleSignOut}
                >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign out
                </Button>
            </div>
        </div>
    );
}

// ─── Download App Button ────────────────────────────────────────────────────

function DownloadAppButton() {
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [installed, setInstalled] = useState(false);

    // Listen for the PWA install prompt
    useState(() => {
        const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e); };
        window.addEventListener("beforeinstallprompt", handler);
        // Check if already installed
        if (window.matchMedia("(display-mode: standalone)").matches) setInstalled(true);
        return () => window.removeEventListener("beforeinstallprompt", handler);
    });

    const handleInstall = async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === "accepted") setInstalled(true);
            setDeferredPrompt(null);
        }
    };

    const handleShare = async () => {
        const url = window.location.origin;
        if (navigator.share) {
            try {
                await navigator.share({ title: "Magic Nutrition Club", text: "Download our app!", url });
            } catch { /* user cancelled */ }
        } else {
            await navigator.clipboard.writeText(url);
        }
    };

    if (installed) {
        return (
            <div className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-bold">
                <CheckCircle className="w-4 h-4" /> App installed
            </div>
        );
    }

    return (
        <div className="flex gap-2 w-full">
            <Button
                variant="outline"
                className="flex-1 gap-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                onClick={deferredPrompt ? handleInstall : () => window.open(window.location.origin, "_blank")}
            >
                <Download className="w-4 h-4" />
                {deferredPrompt ? "Install App" : "Download App"}
            </Button>
            <Button
                variant="outline"
                className="gap-2 border-slate-300 text-muted-foreground hover:bg-muted"
                onClick={handleShare}
            >
                <Share2 className="w-4 h-4" />
                Share
            </Button>
        </div>
    );
}

// ─── Membership Status Card ─────────────────────────────────────────────────

function MembershipStatusCard({ profile, club, toast }: { profile: User; club: any; toast: any }) {
    const { wallet } = useMyWallet();
    const { refreshProfile } = useAuth();
    const { plans, loading: plansLoading } = useClubMembershipPlans(club?.id ?? null);
    const renew = useRenewMembership();
    const [renewOpen, setRenewOpen] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null);
    const [step, setStep] = useState<"select" | "confirm" | "success">("select");
    const [renewResult, setRenewResult] = useState<{ endDate: Date; startDate: Date; plan: MembershipPlan } | null>(null);
    const receiptRef = useRef<HTMLDivElement>(null);

    const credits = (profile as any)?.shakeCredits ?? 0;
    const creditsPlanTotal = (profile as any)?.shakeCreditsPlanTotal ?? 0;

    const statusColor =
        creditsPlanTotal <= 0 ? "#6b7280" :
            credits <= 0 ? "#dc2626" :
                credits <= 3 ? "#d97706" : GREEN;

    const statusLabel =
        creditsPlanTotal <= 0 ? "No plan" :
            credits <= 0 ? "No credits" :
                credits <= 3 ? "Low credits" : "Active";

    const walletBalance = wallet?.balance ?? 0;
    const walletDocId = wallet ? (profile.id || "") : "";

    const handleRenew = async () => {
        if (!selectedPlan || !wallet) return;
        try {
            const result = await renew.mutateAsync({
                plan: selectedPlan,
                walletDocId: walletDocId,
                currentBalance: walletBalance,
                currentMembershipEnd: null,
            });
            setRenewResult(result);
            setStep("success");
            toast({ title: "Shake credits added!", description: `${result.plan.name} — ${result.plan.visits ?? 0} credits added` });
            // Refresh auth profile so membership status updates immediately
            await refreshProfile();
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    };

    const openRenewModal = () => {
        setSelectedPlan(null);
        setStep("select");
        setRenewOpen(true);
    };

    return (
        <>
            <div className="rounded-2xl bg-card border border-border shadow-soft p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold" style={{ color: GREEN }}>Membership</h2>
                    <Badge style={{ backgroundColor: `${statusColor}15`, color: statusColor, border: `1px solid ${statusColor}30` }}>
                        {statusLabel}
                    </Badge>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs text-muted-foreground">Shake Credits</p>
                            <p className="font-bold text-base">{credits} / {creditsPlanTotal}</p>
                        </div>
                        {creditsPlanTotal > 0 && (
                            <div className="text-right">
                                <p className="text-3xl font-black" style={{ color: statusColor }}>
                                    {credits}
                                </p>
                                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                                    credits left
                                </p>
                            </div>
                        )}
                    </div>

                    {profile.referredBy && (
                        <div>
                            <p className="text-xs text-muted-foreground">Referred by</p>
                            <p className="text-sm font-medium">{profile.referredBy}</p>
                        </div>
                    )}
                </div>

                <Button className="w-full gap-2 rounded-xl" style={{ backgroundColor: GREEN }} onClick={openRenewModal}>
                    <RefreshCw className="w-4 h-4" /> Renew Membership
                </Button>
            </div>

            {/* Renew Modal */}
            <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
                <DialogContent className="max-w-sm rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>
                            {step === "success" ? "Renewal Successful!" : "Renew Membership"}
                        </DialogTitle>
                    </DialogHeader>

                    {step === "select" && (
                        <div className="space-y-3 pt-2 max-h-[60vh] overflow-y-auto">
                            <p className="text-sm text-muted-foreground">Choose a plan:</p>
                            {plansLoading ? (
                                <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
                            ) : (
                                <div className="space-y-4">
                                    {(() => {
                                        // Group plans by category
                                        const grouped: Record<string, typeof plans> = {};
                                        plans.forEach((p) => {
                                            const cat = (p as any).category || "Plans";
                                            if (!grouped[cat]) grouped[cat] = [];
                                            grouped[cat].push(p);
                                        });
                                        return Object.entries(grouped).map(([category, categoryPlans]) => (
                                            <div key={category} className="space-y-2">
                                                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{category}</p>
                                                {categoryPlans.map((p) => {
                                                    const active = selectedPlan?.id === p.id;
                                                    const canAfford = walletBalance >= p.price;
                                                    return (
                                                        <button
                                                            key={p.id}
                                                            onClick={() => setSelectedPlan(p)}
                                                            className="w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all"
                                                            style={{
                                                                borderColor: active ? GREEN : "#e5e7eb",
                                                                backgroundColor: active ? "#f0fdf4" : "white",
                                                            }}
                                                        >
                                                            <div className="w-10 h-10 rounded-lg flex items-center justify-center font-black text-sm text-white"
                                                                style={{ backgroundColor: p.color || GREEN }}>
                                                                {(p as any).visits || p.name[0]}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-bold text-sm">{p.name}</p>
                                                                <p className="text-xs text-muted-foreground">
                                                                    {(p as any).visits ? `${(p as any).visits} credits` : `${p.durationDays} days`}
                                                                    {(p as any).perShakePrice ? ` • ₹${(p as any).perShakePrice}/shake` : ""}
                                                                </p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="font-bold" style={{ color: canAfford ? GREEN : "#dc2626" }}>₹{p.price}</p>
                                                                {!canAfford && <p className="text-[10px] text-red-500">Low balance</p>}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ));
                                    })()}
                                </div>
                            )}
                            <div className="pt-2 flex items-center gap-2 text-sm bg-muted rounded-lg p-3">
                                <Wallet className="w-4 h-4 text-muted-foreground" />
                                <span className="text-muted-foreground">Wallet balance:</span>
                                <span className="font-bold ml-auto">₹{walletBalance.toLocaleString()}</span>
                            </div>
                            <Button
                                className="w-full rounded-xl"
                                style={{ backgroundColor: GREEN }}
                                disabled={!selectedPlan || walletBalance < (selectedPlan?.price ?? Infinity)}
                                onClick={() => setStep("confirm")}
                            >
                                {!selectedPlan ? "Select a plan" :
                                    walletBalance < selectedPlan.price ? "Insufficient balance" : "Continue"}
                            </Button>
                        </div>
                    )}

                    {step === "confirm" && selectedPlan && (
                        <div className="space-y-4 pt-2">
                            <div className="rounded-xl bg-muted p-4 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Plan</span>
                                    <span className="font-bold">{selectedPlan.name}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Duration</span>
                                    <span className="font-semibold">
                                        {(selectedPlan as any).visits
                                            ? `${(selectedPlan as any).visits} credits (${selectedPlan.durationDays} days validity)`
                                            : `${selectedPlan.durationDays} days`}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Amount</span>
                                    <span className="font-bold text-red-600">−₹{selectedPlan.price}</span>
                                </div>
                                <div className="border-t pt-2 mt-2 flex justify-between text-sm">
                                    <span className="text-muted-foreground">New balance</span>
                                    <span className="font-bold" style={{ color: GREEN }}>
                                        ₹{(walletBalance - selectedPlan.price).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                            {walletBalance < selectedPlan.price && (
                                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
                                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                                    <p className="text-xs text-red-700">
                                        You need ₹{(selectedPlan.price - walletBalance).toLocaleString()} more. Top up your wallet first.
                                    </p>
                                </div>
                            )}
                            <div className="flex gap-2">
                                <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setStep("select")}>
                                    Back
                                </Button>
                                <Button
                                    className="flex-1 rounded-xl"
                                    style={{ backgroundColor: GREEN }}
                                    disabled={renew.isPending || walletBalance < selectedPlan.price}
                                    onClick={handleRenew}
                                >
                                    {renew.isPending ? "Processing…" : "Confirm Renewal"}
                                </Button>
                            </div>
                        </div>
                    )}

                    {step === "success" && (
                        <div className="space-y-4 pt-2 text-center">
                            <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto" />
                            <p className="font-bold text-lg text-emerald-700">Membership Renewed!</p>
                            <p className="text-sm text-muted-foreground">Your {selectedPlan?.name} plan is now active.</p>
                            {renewResult && (
                                <p className="text-xs text-muted-foreground">Valid until {format(renewResult.endDate, "dd MMM yyyy")}</p>
                            )}
                            <div className="flex gap-2">
                                <Button variant="outline" className="flex-1 rounded-xl gap-1" onClick={() => {
                                    if (!renewResult || !selectedPlan || !club?.id) return;
                                    fetchClubAndPrint(club.id, (freshClub) =>
                                        buildMembershipReceipt({
                                            club: freshClub,
                                            memberName: profile.name,
                                            memberId: (profile as any).memberId || profile.id,
                                            planName: selectedPlan.name,
                                            amount: selectedPlan.price,
                                            paymentMethod: "Wallet",
                                            startDate: renewResult.startDate,
                                            endDate: renewResult.endDate,
                                            timestamp: new Date(),
                                            receiptNumber: `RNW-${Date.now().toString(36).toUpperCase()}`,
                                        })
                                    );
                                }}>
                                    🖨️ Print Receipt
                                </Button>
                                <Button className="flex-1 rounded-xl" style={{ backgroundColor: GREEN }} onClick={() => setRenewOpen(false)}>
                                    Done
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>


        </>
    );
}

// ─── Notifications Toggle ───────────────────────────────────────────────

function NotificationsToggle({ profile, club, toast }: { profile: User; club: any; toast: any }) {
    const [supported, setSupported] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(false);
    const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
        typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
    );
    const enabled = !!(profile as any).notificationsEnabled && permission === "granted";

    useEffect(() => {
        let alive = true;
        import("@/lib/messaging").then(({ isPushSupported }) => {
            isPushSupported().then((s) => alive && setSupported(s));
        });
        return () => { alive = false; };
    }, []);

    const handleEnable = async () => {
        if (!club?.id) return;
        setLoading(true);
        try {
            const { enablePushForMember } = await import("@/lib/messaging");
            await enablePushForMember({ clubId: club.id, memberId: profile.id });
            setPermission(Notification.permission);
            toast({ title: "Notifications on", description: "You'll get alerts for orders, top-ups and announcements." });
        } catch (err: any) {
            toast({ title: "Could not enable", description: err.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const handleDisable = async () => {
        if (!club?.id) return;
        setLoading(true);
        try {
            const { disablePushForMember } = await import("@/lib/messaging");
            await disablePushForMember({ clubId: club.id, memberId: profile.id });
            toast({ title: "Notifications off" });
        } catch (err: any) {
            toast({ title: "Could not disable", description: err.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    if (supported === false) {
        return (
            <div className="rounded-2xl bg-card border border-border shadow-soft p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                    <BellOff className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex-1">
                    <p className="text-sm font-bold text-foreground">Notifications</p>
                    <p className="text-xs text-muted-foreground">
                        Not supported on this device. Try opening from the home-screen icon (PWA).
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-2xl bg-card border border-border shadow-soft p-4 flex items-center gap-3">
            <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: enabled ? `${GREEN}15` : "#f3f4f6", color: enabled ? GREEN : "#94a3b8" }}
            >
                {enabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">Push Notifications</p>
                <p className="text-xs text-muted-foreground">
                    {enabled
                        ? "On — order, top-up, and announcement alerts."
                        : permission === "denied"
                            ? "Blocked in browser. Enable in browser settings."
                            : "Off — tap to enable."}
                </p>
            </div>
            <Button
                size="sm"
                disabled={loading || permission === "denied" || supported === null}
                onClick={enabled ? handleDisable : handleEnable}
                style={{ backgroundColor: enabled ? "#fee2e2" : GREEN, color: enabled ? "#b91c1c" : "white" }}
                className="rounded-full px-3"
            >
                {loading ? "…" : enabled ? "Turn off" : "Turn on"}
            </Button>
        </div>
    );
}
