import { useState, useEffect } from "react";
import { AlertTriangle, Save, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import type { PlatformSettings as PlatformSettingsType } from "@/types/firestore";

// ─── Platform Settings Page ───────────────────────────────────────────────

export default function PlatformSettings() {
    const { userProfile } = useAuth();

    return (
        <div className="space-y-8 max-w-2xl">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Platform Settings</h1>
                <p className="text-sm text-muted-foreground mt-1">Manage platform-wide configuration and your admin profile.</p>
            </div>

            <PlatformConfigSection />
            <AdminProfileSection />
            <ChangePasswordSection />
            <DangerZoneSection />
        </div>
    );
}

// ─── Platform Config ──────────────────────────────────────────────────────

function PlatformConfigSection() {
    const { toast } = useToast();
    const { userProfile } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        platformName: "",
        logoUrl: "",
        supportEmail: "",
        supportPhone: "",
        defaultMonthlyFee: "20000",
        receptionEditEnabled: true,
    });

    useEffect(() => {
        async function load() {
            try {
                const snap = await getDoc(doc(db, "platform", "settings"));
                if (snap.exists()) {
                    const data = snap.data() as PlatformSettingsType;
                    setForm({
                        platformName: data.platformName ?? "",
                        logoUrl: data.logoUrl ?? "",
                        supportEmail: data.supportEmail ?? "",
                        supportPhone: data.supportPhone ?? "",
                        defaultMonthlyFee: String(data.defaultMonthlyFee ?? 20000),
                        receptionEditEnabled: data.receptionEditEnabled !== false,
                    });
                }
            } catch {
                // doc might not exist yet
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []);

    async function handleSave() {
        setSaving(true);
        try {
            await setDoc(
                doc(db, "platform", "settings"),
                {
                    platformName: form.platformName,
                    logoUrl: form.logoUrl,
                    supportEmail: form.supportEmail,
                    supportPhone: form.supportPhone,
                    defaultMonthlyFee: Number(form.defaultMonthlyFee),
                    receptionEditEnabled: form.receptionEditEnabled,
                    updatedAt: Timestamp.now(),
                    updatedBy: userProfile?.name ?? "Super Admin",
                },
                { merge: true }
            );
            toast({ title: "Platform settings saved!" });
        } catch (err: unknown) {
            toast({
                title: "Save failed",
                description: err instanceof Error ? err.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="bg-white rounded-2xl border p-6 space-y-4">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl border p-6 space-y-5">
            <h2 className="font-semibold">Platform Configuration</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <Label>Platform Name</Label>
                    <Input
                        value={form.platformName}
                        onChange={(e) => setForm((p) => ({ ...p, platformName: e.target.value }))}
                        placeholder="e.g. Magic Nutrition Club"
                    />
                </div>
                <div className="space-y-1.5">
                    <Label>Logo URL</Label>
                    <Input
                        value={form.logoUrl}
                        onChange={(e) => setForm((p) => ({ ...p, logoUrl: e.target.value }))}
                        placeholder="https://…"
                    />
                </div>
                <div className="space-y-1.5">
                    <Label>Support Email</Label>
                    <Input
                        type="email"
                        value={form.supportEmail}
                        onChange={(e) => setForm((p) => ({ ...p, supportEmail: e.target.value }))}
                        placeholder="support@example.com"
                    />
                </div>
                <div className="space-y-1.5">
                    <Label>Support Phone</Label>
                    <Input
                        value={form.supportPhone}
                        onChange={(e) => setForm((p) => ({ ...p, supportPhone: e.target.value }))}
                        placeholder="+91 …"
                    />
                </div>
                <div className="space-y-1.5">
                    <Label>Default Monthly Fee (₹)</Label>
                    <Input
                        type="number"
                        value={form.defaultMonthlyFee}
                        onChange={(e) => setForm((p) => ({ ...p, defaultMonthlyFee: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">Applied to new clubs. Existing clubs can override this.</p>
                </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border p-4 mt-4">
                <div>
                    <Label className="text-sm font-semibold">Reception Edit Features</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Allow reception staff to assign referrals and edit member details.
                    </p>
                </div>
                <Switch
                    checked={form.receptionEditEnabled}
                    onCheckedChange={(checked) => setForm((p) => ({ ...p, receptionEditEnabled: checked }))}
                />
            </div>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
                <Save className="w-4 h-4" />
                {saving ? "Saving…" : "Save Settings"}
            </Button>
        </div>
    );
}

// ─── Admin Profile ────────────────────────────────────────────────────────

function AdminProfileSection() {
    const { userProfile } = useAuth();

    return (
        <div className="bg-white rounded-2xl border p-6 space-y-5">
            <h2 className="font-semibold">Super Admin Profile</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <Label>Display Name</Label>
                    <Input value={userProfile?.name ?? ""} readOnly className="bg-gray-50 text-muted-foreground" />
                </div>
                <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input value={userProfile?.email ?? ""} readOnly className="bg-gray-50 text-muted-foreground" />
                </div>
                <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Input value="Super Admin" readOnly className="bg-gray-50 text-muted-foreground" />
                </div>
                <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input value={userProfile?.phone ?? "—"} readOnly className="bg-gray-50 text-muted-foreground" />
                </div>
            </div>
            <p className="text-xs text-muted-foreground">
                Profile details are read-only. To update your name or phone, edit your user document in Firebase Console.
            </p>
        </div>
    );
}

// ─── Change Password ──────────────────────────────────────────────────────

function ChangePasswordSection() {
    const { toast } = useToast();
    const [form, setForm] = useState({ current: "", newPw: "", confirm: "" });
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<Partial<typeof form>>({});

    function validate() {
        const e: Partial<typeof form> = {};
        if (!form.current) e.current = "Required";
        if (form.newPw.length < 8) e.newPw = "Minimum 8 characters";
        if (form.newPw !== form.confirm) e.confirm = "Passwords do not match";
        return e;
    }

    async function handleSubmit() {
        const errs = validate();
        setErrors(errs);
        if (Object.keys(errs).length > 0) return;

        const currentUser = auth.currentUser;
        if (!currentUser?.email) {
            toast({ title: "No authenticated user found.", variant: "destructive" });
            return;
        }

        setLoading(true);
        try {
            const credential = EmailAuthProvider.credential(currentUser.email, form.current);
            await reauthenticateWithCredential(currentUser, credential);
            await updatePassword(currentUser, form.newPw);
            setForm({ current: "", newPw: "", confirm: "" });
            toast({ title: "Password updated successfully!" });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            if (msg.includes("wrong-password") || msg.includes("invalid-credential")) {
                setErrors({ current: "Incorrect current password" });
            } else {
                toast({ title: "Failed to update password", description: msg, variant: "destructive" });
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="bg-white rounded-2xl border p-6 space-y-5">
            <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-violet-500" />
                <h2 className="font-semibold">Change Password</h2>
            </div>
            <div className="space-y-4">
                <div className="space-y-1.5">
                    <Label>Current Password</Label>
                    <Input
                        type="password"
                        value={form.current}
                        onChange={(e) => setForm((p) => ({ ...p, current: e.target.value }))}
                        placeholder="Enter current password"
                    />
                    {errors.current && <p className="text-xs text-red-500">{errors.current}</p>}
                </div>
                <div className="space-y-1.5">
                    <Label>New Password</Label>
                    <Input
                        type="password"
                        value={form.newPw}
                        onChange={(e) => setForm((p) => ({ ...p, newPw: e.target.value }))}
                        placeholder="Minimum 8 characters"
                    />
                    {errors.newPw && <p className="text-xs text-red-500">{errors.newPw}</p>}
                </div>
                <div className="space-y-1.5">
                    <Label>Confirm New Password</Label>
                    <Input
                        type="password"
                        value={form.confirm}
                        onChange={(e) => setForm((p) => ({ ...p, confirm: e.target.value }))}
                        placeholder="Repeat new password"
                    />
                    {errors.confirm && <p className="text-xs text-red-500">{errors.confirm}</p>}
                </div>
            </div>
            <Button onClick={handleSubmit} disabled={loading} className="gap-2">
                <KeyRound className="w-4 h-4" />
                {loading ? "Updating…" : "Update Password"}
            </Button>
        </div>
    );
}

// ─── Danger Zone ──────────────────────────────────────────────────────────

function DangerZoneSection() {
    return (
        <div className="bg-white rounded-2xl border border-red-200 p-6 space-y-4">
            <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="w-5 h-5" />
                <h2 className="font-semibold">Danger Zone</h2>
            </div>
            <p className="text-sm text-muted-foreground">
                The following operations must be performed directly in the Firebase Console to prevent accidental data loss:
            </p>
            <ul className="space-y-3 text-sm">
                <DangerItem
                    title="Delete a club permanently"
                    description="Go to Firestore → clubs collection → select club document → Delete. Also delete the corresponding user and wallet documents."
                />
                <DangerItem
                    title="Delete a member account"
                    description="Go to Firebase Authentication → find the user by email → Delete user. Then delete the Firestore document in users/{userId}."
                />
                <DangerItem
                    title="Reset all usage stats"
                    description="Go to Firestore → clubs/{clubId}/usageStats/counters → Delete the document."
                />
                <DangerItem
                    title="Clear landing page history"
                    description="Go to Firestore → clubs/{clubId} → edit the landingPageHistory field → set to empty array."
                />
                <DangerItem
                    title="Manage Firebase Storage"
                    description="Go to Firebase Console → Storage → browse clubs/{clubId}/ to manage uploaded files."
                />
            </ul>
            <a
                href="https://console.firebase.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-violet-600 hover:underline font-medium"
            >
                Open Firebase Console →
            </a>
        </div>
    );
}

function DangerItem({ title, description }: { title: string; description: string }) {
    return (
        <li className="p-3 rounded-xl bg-red-50 border border-red-100">
            <p className="font-medium text-sm text-red-700">{title}</p>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </li>
    );
}
