import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { useClubContext } from "@/lib/clubDetection";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";

const GREEN = "#2d9653";

/**
 * Forgot Password flow.
 *
 * Sends a Firebase Auth password reset email to the user's address. The user
 * clicks the link in the email and chooses their own new password — no temp
 * password is ever shown to anyone, no Cloud Function is involved, and the
 * reset link is single-use and expires automatically.
 *
 * To customize the email subject/body/sender name (e.g. "Welcome to Magic
 * Nutrition Club <name>, click below to set a new password"):
 *   Firebase Console → Authentication → Templates → Password reset
 *   You can use %DISPLAY_NAME% to insert the user's display name.
 */
export default function ForgotPasswordPage() {
    const { club } = useClubContext();
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const trimmed = email.trim();
        if (!trimmed) {
            setError("Please enter your email address.");
            return;
        }
        setSubmitting(true);
        try {
            await sendPasswordResetEmail(auth, trimmed);
            setSuccess(true);
        } catch (err: any) {
            // For privacy, we DON'T leak whether the address exists. The
            // only errors we surface are technical / network ones.
            const code = err?.code || "";
            if (code === "auth/invalid-email") {
                setError("That doesn't look like a valid email address.");
            } else if (code === "auth/network-request-failed") {
                setError("Network error. Please check your internet connection.");
            } else if (code === "auth/too-many-requests") {
                setError("Too many requests. Please wait a few minutes and try again.");
            } else if (code === "auth/user-not-found") {
                // Show the same success message anyway — privacy.
                setSuccess(true);
            } else {
                setError("Could not send reset email. Please try again.");
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ fontFamily: "'Nunito', sans-serif", background: "#f8fffe" }}>
            <div className="w-full max-w-sm">
                <div className="bg-white rounded-2xl shadow-lg border p-6 space-y-5" style={{ borderColor: "#e0f0e9" }}>
                    <button
                        onClick={() => navigate("/member/login")}
                        className="inline-flex items-center gap-1 text-xs font-bold"
                        style={{ color: GREEN }}
                    >
                        <ArrowLeft className="w-3.5 h-3.5" /> Back to Login
                    </button>

                    <div className="text-center space-y-2">
                        {club?.logo ? (
                            <img src={club.logo} alt="" className="h-14 w-14 mx-auto rounded-xl object-cover" />
                        ) : (
                            <div className="h-14 w-14 mx-auto rounded-xl flex items-center justify-center text-white text-2xl font-bold" style={{ background: GREEN }}>
                                {(club?.name ?? "C")[0]}
                            </div>
                        )}
                        <h1 className="text-xl font-black text-gray-900">Forgot Password</h1>
                        <p className="text-xs text-gray-400">
                            We'll email you a link to reset it
                        </p>
                    </div>

                    {success ? (
                        <div className="space-y-4">
                            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-5 text-center space-y-3">
                                <div className="w-12 h-12 mx-auto rounded-full flex items-center justify-center" style={{ background: "#dcfce7" }}>
                                    <Mail className="w-6 h-6 text-green-700" />
                                </div>
                                <p className="text-sm font-bold text-green-800">Check your inbox</p>
                                <p className="text-xs text-green-700 leading-relaxed">
                                    If <span className="font-mono font-bold">{email.trim()}</span> is registered with {club?.name ?? "this club"},
                                    we've sent a password reset link to it.
                                </p>
                                <p className="text-xs text-green-600">
                                    Click the link in the email to choose a new password.
                                    The link expires in 1 hour.
                                </p>
                            </div>
                            <Button
                                onClick={() => navigate("/member/login")}
                                className="w-full h-12 text-white font-bold"
                                style={{ background: GREEN }}
                            >
                                Back to Login
                            </Button>
                            <button
                                onClick={() => { setSuccess(false); setEmail(""); }}
                                className="text-xs font-bold w-full text-center text-gray-500"
                            >
                                Didn't get it? Try a different email
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-gray-600">Email Address</Label>
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    placeholder="your@email.com"
                                    className="h-12"
                                    autoComplete="email"
                                />
                            </div>

                            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

                            <Button
                                type="submit"
                                disabled={submitting}
                                className="w-full h-12 text-white font-bold"
                                style={{ background: GREEN }}
                            >
                                {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Sending...</> : "Send Reset Link"}
                            </Button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
