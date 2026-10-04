import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useClubContext } from "@/lib/clubDetection";
import { useMemberAuth } from "@/hooks/member/useMemberAuth";

const GREEN = "#2d9653";

export default function MemberLogin() {
    const { club } = useClubContext();
    const { member, mustChangePassword, signIn, changePassword } = useMemberAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Change password state
    const [newPw, setNewPw] = useState("");
    const [confirmPw, setConfirmPw] = useState("");
    const [changePwError, setChangePwError] = useState<string | null>(null);
    const [changingPw, setChangingPw] = useState(false);

    // If logged in and no password change needed, go to dashboard
    if (member && !mustChangePassword) {
        const redirect = sessionStorage.getItem('mnc_redirect') || '/member/dashboard';
        sessionStorage.removeItem('mnc_redirect');
        navigate(redirect, { replace: true });
        return null;
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            await signIn(email, password);
            // After sign in, useMemberAuth will set mustChangePassword if needed
            // If not mustChangePassword, the redirect above will trigger on re-render
        } catch (err: any) {
            setError(err.message || "Login failed");
        } finally {
            setSubmitting(false);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setChangePwError(null);
        if (newPw.length < 6) { setChangePwError("Password must be at least 6 characters"); return; }
        if (newPw !== confirmPw) { setChangePwError("Passwords do not match"); return; }
        setChangingPw(true);
        try {
            await changePassword(newPw);
            // After password change, mustChangePassword becomes false → redirect triggers
        } catch (err: any) {
            setChangePwError(err.message || "Failed to change password");
        } finally {
            setChangingPw(false);
        }
    };

    // Show "Set New Password" form if mustChangePassword
    if (member && mustChangePassword) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4" style={{ fontFamily: "'Nunito', sans-serif", background: "#f8fffe" }}>
                <div className="w-full max-w-sm">
                    <div className="bg-white rounded-2xl shadow-lg border p-6 space-y-5" style={{ borderColor: "#e0f0e9" }}>
                        <div className="text-center space-y-2">
                            {club?.logo ? (
                                <img src={club.logo} alt="" className="h-14 w-14 mx-auto rounded-xl object-cover" />
                            ) : (
                                <div className="h-14 w-14 mx-auto rounded-xl flex items-center justify-center text-white text-2xl font-bold" style={{ background: GREEN }}>
                                    {(club?.name ?? "C")[0]}
                                </div>
                            )}
                            <h1 className="text-xl font-black text-gray-900">Set New Password</h1>
                            <p className="text-xs text-gray-400">You must set a new password before continuing</p>
                        </div>

                        <form onSubmit={handleChangePassword} className="space-y-4">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-gray-600">New Password</Label>
                                <Input
                                    type="password"
                                    value={newPw}
                                    onChange={(e) => setNewPw(e.target.value)}
                                    required
                                    placeholder="Min 6 characters"
                                    className="h-12"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-gray-600">Confirm Password</Label>
                                <Input
                                    type="password"
                                    value={confirmPw}
                                    onChange={(e) => setConfirmPw(e.target.value)}
                                    required
                                    placeholder="Re-enter password"
                                    className="h-12"
                                />
                            </div>

                            {changePwError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{changePwError}</p>}

                            <Button type="submit" disabled={changingPw} className="w-full h-12 text-white font-bold" style={{ background: GREEN }}>
                                {changingPw ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving...</> : "Set Password & Continue"}
                            </Button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ fontFamily: "'Nunito', sans-serif", background: "#f8fffe" }}>
            <div className="w-full max-w-sm">
                <div className="bg-white rounded-2xl shadow-lg border p-6 space-y-5" style={{ borderColor: "#e0f0e9" }}>
                    <div className="text-center space-y-2">
                        {club?.logo ? (
                            <img src={club.logo} alt="" className="h-14 w-14 mx-auto rounded-xl object-cover" />
                        ) : (
                            <div className="h-14 w-14 mx-auto rounded-xl flex items-center justify-center text-white text-2xl font-bold" style={{ background: GREEN }}>
                                {(club?.name ?? "C")[0]}
                            </div>
                        )}
                        <h1 className="text-xl font-black text-gray-900">Member Login</h1>
                        <p className="text-xs text-gray-400">{club?.name ?? "Club"}</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-gray-600">Email</Label>
                            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="your@email.com" className="h-12" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-gray-600">Password</Label>
                            <div className="relative">
                                <Input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" className="h-12 pr-10" />
                                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

                        <Button type="submit" disabled={submitting} className="w-full h-12 text-white font-bold" style={{ background: GREEN }}>
                            {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Signing in...</> : "Sign In"}
                        </Button>
                    </form>

                    <button onClick={() => navigate("/member/forgot-password")} className="text-xs font-bold w-full text-center" style={{ color: GREEN }}>
                        Forgot password?
                    </button>
                </div>
            </div>
        </div>
    );
}
