import { toDateSafe } from "@/lib/toDateSafe";
import { useState } from "react";
import { useClubContext } from "@/lib/clubDetection";
import { useActiveVolunteers, useCreateVolunteerSession, useCompleteVolunteerSession } from "@/hooks/useVolunteers";
import { useClubVolunteers } from "@/hooks/useOwner";
import { X, LogIn, LogOut, Clock, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { VolunteerSession } from "@/types/firestore";
import { format } from "date-fns";

interface Props {
    onClose: () => void;
}

function formatSince(ts: unknown): string {
    const d = toDateSafe(ts);
    return d ? format(d, "h:mm a") : "";
}

export default function VolunteerModal({ onClose }: Props) {
    const { club } = useClubContext();
    const [tab, setTab] = useState<"login" | "logout">("login");
    const { data: allVolunteers, isLoading: volunteersLoading } = useClubVolunteers();
    const { sessions, loading: sessionsLoading } = useActiveVolunteers();
    const createSession = useCreateVolunteerSession();
    const completeSession = useCompleteVolunteerSession();
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [logoutResult, setLogoutResult] = useState<{ name: string; minutes: number } | null>(null);

    // Get IDs of currently active volunteers
    const activeVolunteerIds = new Set(sessions.map((s) => s.memberId));

    const handleLogin = (vol: { id: string; name: string; photo?: string }) => {
        createSession.mutate(
            { memberId: vol.id, memberName: vol.name, memberPhoto: vol.photo || "" },
            {
                onSuccess: () => {
                    setSuccessMsg(`${vol.name} has logged in`);
                    setTimeout(() => setSuccessMsg(null), 3000);
                },
            }
        );
    };

    const handleLogout = (session: VolunteerSession) => {
        completeSession.mutate(
            { sessionId: session.id, loginTime: session.loginTime },
            {
                onSuccess: (mins) => {
                    const hours = Math.floor(mins / 60);
                    const m = mins % 60;
                    const timeStr = hours > 0 ? `${hours}h ${m}m` : `${m} minutes`;
                    setLogoutResult({ name: session.memberName, minutes: mins });
                    setTimeout(() => setLogoutResult(null), 3000);
                },
            }
        );
    };

    // Filter volunteers available for login (active status and not already logged in today)
    const availableForLogin = allVolunteers
        ?.filter((v) => (v as any).status === "active" && !activeVolunteerIds.has(v.id)) ?? [];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div
                className="bg-white rounded-3xl shadow-2xl w-full max-w-lg relative overflow-hidden"
                style={{ fontFamily: "Nunito, sans-serif", maxHeight: "90vh" }}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b">
                    <h2 className="text-xl font-black text-gray-800">🙋 Volunteer</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b">
                    {(["login", "logout"] as const).map((t) => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`flex-1 py-3 text-sm font-bold capitalize transition-colors ${tab === t
                                    ? "border-b-2 border-green-600 text-green-700"
                                    : "text-gray-500 hover:text-gray-700"
                                }`}
                        >
                            {t === "login" ? <><LogIn className="w-4 h-4 inline mr-1" />Login</> : <><LogOut className="w-4 h-4 inline mr-1" />Logout</>}
                        </button>
                    ))}
                </div>

                <div className="p-5 overflow-y-auto" style={{ maxHeight: "calc(90vh - 140px)" }}>
                    {/* Success Messages */}
                    {successMsg && (
                        <div className="mb-4 p-4 rounded-2xl bg-green-50 border-2 border-green-200 text-center animate-in fade-in">
                            <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
                            <p className="text-lg font-black text-green-800">{successMsg}</p>
                        </div>
                    )}

                    {logoutResult && (
                        <div className="mb-4 p-4 rounded-2xl bg-amber-50 border-2 border-amber-200 text-center animate-in fade-in">
                            <div className="text-4xl mb-2">👏</div>
                            <p className="text-lg font-black text-gray-800">Goodbye {logoutResult.name}!</p>
                            <p className="text-sm text-gray-500">
                                Volunteered for {logoutResult.minutes >= 60
                                    ? `${Math.floor(logoutResult.minutes / 60)}h ${logoutResult.minutes % 60}m`
                                    : `${logoutResult.minutes} minutes`}
                            </p>
                        </div>
                    )}

                    {tab === "login" ? (
                        <div className="space-y-3">
                            <h3 className="text-lg font-bold text-gray-700">Tap to Login</h3>
                            {volunteersLoading ? (
                                <p className="text-center text-gray-400 text-sm py-8">Loading...</p>
                            ) : availableForLogin.length === 0 ? (
                                <div className="text-center py-12">
                                    <p className="text-gray-400 text-sm">
                                        {sessions.length > 0
                                            ? "All volunteers are already logged in"
                                            : "No volunteers available"}
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {availableForLogin.map((vol) => (
                                        <button
                                            key={vol.id}
                                            onClick={() => handleLogin(vol)}
                                            disabled={createSession.isPending}
                                            className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-gray-100 hover:border-green-300 hover:bg-green-50 transition-all text-left"
                                        >
                                            <Avatar className="h-12 w-12">
                                                {vol.photo && <AvatarImage src={vol.photo} />}
                                                <AvatarFallback className="bg-green-100 text-green-700 font-bold text-lg">
                                                    {vol.name[0]}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-gray-800 truncate">{vol.name}</p>
                                            </div>
                                            <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-600 text-white text-xs font-bold shrink-0">
                                                <LogIn className="w-3.5 h-3.5" />
                                                Login
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Show already logged in volunteers */}
                            {sessions.length > 0 && (
                                <div className="mt-4 pt-4 border-t">
                                    <p className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Already Logged In</p>
                                    <div className="space-y-2">
                                        {sessions.map((s) => (
                                            <div key={s.id} className="flex items-center gap-3 p-3 rounded-2xl bg-green-50 border border-green-200">
                                                <Avatar className="h-10 w-10">
                                                    {s.memberPhoto && <AvatarImage src={s.memberPhoto} />}
                                                    <AvatarFallback className="bg-green-100 text-green-700 font-bold">
                                                        {s.memberName[0]}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-bold text-green-800 truncate">{s.memberName}</p>
                                                    <div className="flex items-center gap-1 text-xs text-green-600">
                                                        <Clock className="w-3 h-3" />
                                                        Since {formatSince(s.loginTime as any)}
                                                    </div>
                                                </div>
                                                <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <h3 className="text-lg font-bold text-gray-700">Tap to Logout</h3>
                            {sessionsLoading ? (
                                <p className="text-center text-gray-400 text-sm py-8">Loading...</p>
                            ) : sessions.length === 0 ? (
                                <div className="text-center py-12">
                                    <p className="text-gray-400 text-sm">No active volunteers right now</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {sessions.map((s) => (
                                        <button
                                            key={s.id}
                                            onClick={() => handleLogout(s)}
                                            disabled={completeSession.isPending}
                                            className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-gray-100 hover:border-red-300 hover:bg-red-50 transition-all text-left"
                                        >
                                            <Avatar className="h-12 w-12">
                                                {s.memberPhoto && <AvatarImage src={s.memberPhoto} />}
                                                <AvatarFallback className="bg-green-100 text-green-700 font-bold text-lg">
                                                    {s.memberName[0]}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-gray-800 truncate">{s.memberName}</p>
                                                <div className="flex items-center gap-1 text-xs text-gray-500">
                                                    <Clock className="w-3 h-3" />
                                                    Since {formatSince(s.loginTime as any)}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 text-white text-xs font-bold shrink-0">
                                                <LogOut className="w-3.5 h-3.5" />
                                                Logout
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
