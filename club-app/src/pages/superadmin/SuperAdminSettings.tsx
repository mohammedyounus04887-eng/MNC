import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, User, Eye, EyeOff, ShieldCheck } from "lucide-react";
import {
    reauthenticateWithCredential,
    EmailAuthProvider,
    updatePassword,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";

// ─── Validation schema ───────────────────────────────────────────────────

const changePasswordSchema = z
    .object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z
            .string()
            .min(8, "New password must be at least 8 characters"),
        confirmPassword: z.string().min(1, "Please confirm your new password"),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
    });

type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

// ─── Component ───────────────────────────────────────────────────────────

export default function SuperAdminSettings() {
    const { userProfile, firebaseUser } = useAuth();
    const { toast } = useToast();

    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [generalError, setGeneralError] = useState<string | null>(null);

    const form = useForm<ChangePasswordFormValues>({
        resolver: zodResolver(changePasswordSchema),
        defaultValues: {
            currentPassword: "",
            newPassword: "",
            confirmPassword: "",
        },
    });

    const { isSubmitting } = form.formState;

    async function onSubmit(values: ChangePasswordFormValues) {
        setGeneralError(null);

        if (!firebaseUser || !firebaseUser.email) {
            setGeneralError("No authenticated user found.");
            return;
        }

        // Step 1 — Reauthenticate
        const credential = EmailAuthProvider.credential(
            firebaseUser.email,
            values.currentPassword
        );

        try {
            await reauthenticateWithCredential(firebaseUser, credential);
        } catch {
            form.setError("currentPassword", {
                message: "Current password is incorrect",
            });
            return;
        }

        // Step 2 — Update password
        try {
            await updatePassword(firebaseUser, values.newPassword);
            toast({ title: "Password updated successfully" });
            form.reset();
        } catch (err: any) {
            setGeneralError(err?.message ?? "Failed to update password. Please try again.");
        }
    }

    return (
        <div className="space-y-8 animate-fade-in max-w-2xl">
            {/* Page header */}
            <div>
                <h1 className="text-2xl font-black text-gray-900">Settings</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Manage your Super Admin account
                </p>
            </div>

            {/* ── Section 1: Profile Info ──────────────────────────────── */}
            <div className="bg-white rounded-2xl border p-6 space-y-5">
                <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
                        <User className="w-5 h-5 text-violet-600" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Profile Info</h2>
                        <p className="text-xs text-muted-foreground">Read-only — identity is managed by the platform</p>
                    </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                            Name
                        </Label>
                        <div className="flex items-center h-10 px-3 rounded-lg bg-gray-50 border text-sm font-medium text-gray-800">
                            {userProfile?.name || "—"}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                            Email
                        </Label>
                        <div className="flex items-center h-10 px-3 rounded-lg bg-gray-50 border text-sm font-medium text-gray-800 truncate">
                            {userProfile?.email || firebaseUser?.email || "—"}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs text-emerald-600 font-medium">Super Admin</span>
                </div>
            </div>

            {/* ── Section 2: Change Password ───────────────────────────── */}
            <div className="bg-white rounded-2xl border p-6 space-y-5">
                <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
                        <KeyRound className="w-5 h-5 text-violet-600" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Change Password</h2>
                        <p className="text-xs text-muted-foreground">
                            You'll be re-authenticated before the password is updated
                        </p>
                    </div>
                </div>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        {/* Current Password */}
                        <FormField
                            control={form.control}
                            name="currentPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Current Password</FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Input
                                                type={showCurrent ? "text" : "password"}
                                                placeholder="Enter current password"
                                                autoComplete="current-password"
                                                {...field}
                                            />
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                onClick={() => setShowCurrent((v) => !v)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-gray-700"
                                            >
                                                {showCurrent ? (
                                                    <EyeOff className="w-4 h-4" />
                                                ) : (
                                                    <Eye className="w-4 h-4" />
                                                )}
                                            </button>
                                        </div>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* New Password */}
                        <FormField
                            control={form.control}
                            name="newPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>New Password</FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Input
                                                type={showNew ? "text" : "password"}
                                                placeholder="At least 8 characters"
                                                autoComplete="new-password"
                                                {...field}
                                            />
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                onClick={() => setShowNew((v) => !v)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-gray-700"
                                            >
                                                {showNew ? (
                                                    <EyeOff className="w-4 h-4" />
                                                ) : (
                                                    <Eye className="w-4 h-4" />
                                                )}
                                            </button>
                                        </div>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Confirm New Password */}
                        <FormField
                            control={form.control}
                            name="confirmPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Confirm New Password</FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Input
                                                type={showConfirm ? "text" : "password"}
                                                placeholder="Re-enter new password"
                                                autoComplete="new-password"
                                                {...field}
                                            />
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                onClick={() => setShowConfirm((v) => !v)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-gray-700"
                                            >
                                                {showConfirm ? (
                                                    <EyeOff className="w-4 h-4" />
                                                ) : (
                                                    <Eye className="w-4 h-4" />
                                                )}
                                            </button>
                                        </div>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* General error */}
                        {generalError && (
                            <p className="text-sm text-destructive">{generalError}</p>
                        )}

                        <Button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full sm:w-auto"
                        >
                            {isSubmitting ? "Updating…" : "Update Password"}
                        </Button>
                    </form>
                </Form>
            </div>
        </div>
    );
}
