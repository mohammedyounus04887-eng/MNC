import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield } from "lucide-react";

export default function SuperAdminLogin() {
    const { firebaseUser, role, signIn, loading: authLoading } = useAuth();
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Already logged in as super admin → go straight to dashboard
    if (!authLoading && firebaseUser && role === "superAdmin") {
        return <Navigate to="/superadmin/dashboard" replace />;
    }

    // Logged in as another role — HomeRedirect will sign them out; just show the form
    // (don't create a redirect loop back to this same page)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        try {
            const profile = await signIn(email, password);
            if (profile.role !== "superAdmin") {
                setError("This login is for Super Admins only.");
                return;
            }
            navigate("/superadmin/dashboard", { replace: true });
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Login failed. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-gray-950 to-emerald-950 p-4">
            <div className="w-full max-w-md">
                <div className="bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-700/50 p-8 space-y-6">
                    {/* Header */}
                    <div className="text-center space-y-3">
                        <div className="h-14 w-14 mx-auto rounded-xl bg-gradient-to-br from-violet-500 to-emerald-500 flex items-center justify-center shadow-lg">
                            <Shield className="w-7 h-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-white">
                                Super Admin
                            </h1>
                            <p className="text-sm text-gray-400 mt-1">
                                MNC Platform — Restricted Access
                            </p>
                        </div>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="sa-email" className="text-gray-300">Email</Label>
                            <Input
                                id="sa-email"
                                type="email"
                                placeholder="admin@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                                className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-500 focus:border-violet-500"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="sa-password" className="text-gray-300">Password</Label>
                            <Input
                                id="sa-password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                                className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-500 focus:border-violet-500"
                            />
                        </div>

                        {error && (
                            <div className="text-sm text-red-400 bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2">
                                {error}
                            </div>
                        )}

                        <Button
                            type="submit"
                            className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11"
                            disabled={submitting || authLoading}
                        >
                            {submitting ? "Signing in…" : "Sign In to Admin Panel"}
                        </Button>
                    </form>

                    <p className="text-center text-[11px] text-gray-600">
                        This page is for platform administrators only.
                    </p>
                </div>
            </div>
        </div>
    );
}
