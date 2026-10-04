import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth, getDashboardPath } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClubContext } from "@/lib/clubDetection";

export default function Login() {
    const { firebaseUser, role, signIn, loading: authLoading } = useAuth();
    const { club } = useClubContext();
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Already logged in → redirect to dashboard
    if (!authLoading && firebaseUser && role) {
        return <Navigate to={getDashboardPath(role)} replace />;
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        try {
            const profile = await signIn(email, password);
            const dashboardPath = getDashboardPath(profile.role);
            navigate(dashboardPath, { replace: true });
        } catch (err: any) {
            setError(err.message || "Login failed. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-emerald-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4">
            <div className="w-full max-w-md">
                <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-8 space-y-6">
                    {/* Header */}
                    <div className="text-center space-y-2">
                        {club?.logo ? (
                            <img
                                src={club.logo}
                                alt={club.name}
                                className="h-14 mx-auto rounded-xl"
                            />
                        ) : (
                            <div className="h-14 w-14 mx-auto rounded-xl bg-gradient-to-br from-violet-500 to-emerald-500 flex items-center justify-center">
                                <span className="text-white font-bold text-xl">M</span>
                            </div>
                        )}
                        <h1 className="text-2xl font-bold tracking-tight">
                            {club?.name || "Magic Nutrition Club"}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Sign in to your account
                        </p>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                            />
                        </div>

                        {error && (
                            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                                {error}
                            </div>
                        )}

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={submitting || authLoading}
                        >
                            {submitting ? "Signing in…" : "Sign In"}
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    );
}
