import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { Search, X, UserPlus, UserMinus, Check } from "lucide-react";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { useToast } from "@/hooks/use-toast";
import {
    useVolunteerMembers,
    useSetMemberVolunteerStatus,
    backfillVolunteerSessionsFromAttendance,
} from "@/hooks/useVolunteerRoles";
import { todayLocal } from "@/lib/clubDay";
import type { User } from "@/types/firestore";

const GREEN = "#2d9653";

interface Props {
    open: boolean;
    onClose: () => void;
}

export default function AddVolunteerModal({ open, onClose }: Props) {
    const { club } = useClubContext();
    const { toast } = useToast();
    const { members: volunteers, loading: volLoading } = useVolunteerMembers();
    const setStatus = useSetMemberVolunteerStatus();

    const [allMembers, setAllMembers] = useState<User[]>([]);
    const [search, setSearch] = useState("");
    const [tab, setTab] = useState<"add" | "current">("add");

    useEffect(() => {
        if (!club?.id || !open) return;
        const unsub = onSnapshot(collection(db, "clubs", club.id, "members"), (snap) => {
            setAllMembers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as User)));
        });
        return () => unsub();
    }, [club?.id, open]);

    const volunteerIds = useMemo(() => new Set(volunteers.map((v) => v.id)), [volunteers]);

    const candidates = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return allMembers
            .filter((m) => !volunteerIds.has(m.id))
            .filter((m) => {
                if (!needle) return true;
                return (
                    m.name?.toLowerCase().includes(needle) ||
                    m.phone?.toLowerCase().includes(needle) ||
                    (m as any).memberId?.toLowerCase().includes(needle)
                );
            })
            .slice(0, 50);
    }, [allMembers, volunteerIds, search]);

    const handleMark = async (memberId: string, isVolunteer: boolean) => {
        try {
            await setStatus.mutateAsync({ memberId, isVolunteer });

            // Marking somebody only changes what happens next time they check
            // in, so a volunteer added mid-month showed no times for the days
            // they had already worked. Their attendance record holds the time
            // they arrived on each of those days; this copies it across.
            let backfilled = 0;
            if (isVolunteer && club?.id) {
                const m = allMembers.find((x) => x.id === memberId);
                const now = new Date();
                try {
                    const res = await backfillVolunteerSessionsFromAttendance({
                        clubId: club.id,
                        memberId,
                        memberName: m?.name ?? "",
                        memberPhoto: (m as any)?.photo ?? "",
                        from: todayLocal(new Date(now.getFullYear(), now.getMonth(), 1)),
                        to: todayLocal(now),
                    });
                    backfilled = res.created;
                } catch (e) {
                    // The member IS a volunteer now — that write succeeded. Say
                    // so rather than failing the whole action over the history.
                    console.warn("[volunteers] backfill failed", e);
                }
            }

            toast({
                title: isVolunteer ? "Marked as volunteer" : "Removed from volunteers",
                description: isVolunteer
                    ? backfilled > 0
                        ? `Added ${backfilled} day${backfilled === 1 ? "" : "s"} already attended this month, using their member check-in time.`
                        : "They'll auto-check-in as volunteer when they check in as a member."
                    : "Member check-ins will no longer auto-create a volunteer session.",
            });
        } catch (err: any) {
            toast({
                title: "Could not update",
                description: err.message,
                variant: "destructive",
            });
        }
    };

    if (!open) return null;

    return (
        <div
            onClick={onClose}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
                style={{ fontFamily: "Nunito, sans-serif", maxHeight: "90vh" }}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b">
                    <h2 className="text-xl font-black text-gray-800">🙋 Manage Volunteers</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b">
                    {(["add", "current"] as const).map((t) => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`flex-1 py-3 text-sm font-bold transition-colors ${
                                tab === t
                                    ? "border-b-2 border-green-600 text-green-700"
                                    : "text-gray-500 hover:text-gray-700"
                            }`}
                        >
                            {t === "add" ? (
                                <>
                                    <UserPlus className="w-4 h-4 inline mr-1.5" />
                                    Add Volunteer
                                </>
                            ) : (
                                <>
                                    Current ({volunteers.length})
                                </>
                            )}
                        </button>
                    ))}
                </div>

                <div
                    className="p-5 overflow-y-auto"
                    style={{ maxHeight: "calc(90vh - 160px)" }}
                >
                    {tab === "add" && (
                        <>
                            <div className="relative mb-3">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search member by name, phone, or ID"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border-2 border-gray-100 focus:border-green-500 outline-none text-sm"
                                />
                            </div>

                            {candidates.length === 0 ? (
                                <p className="text-center text-gray-400 text-sm py-8">
                                    {search
                                        ? "No matching members"
                                        : "All members are already volunteers"}
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {candidates.map((m) => (
                                        <button
                                            key={m.id}
                                            onClick={() => handleMark(m.id, true)}
                                            disabled={setStatus.isPending}
                                            className="w-full flex items-center gap-3 p-3 rounded-2xl border-2 border-gray-100 hover:border-green-300 hover:bg-green-50 transition-all text-left disabled:opacity-50"
                                        >
                                            {m.photo ? (
                                                <img
                                                    src={m.photo}
                                                    alt=""
                                                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                                />
                                            ) : (
                                                <div
                                                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-black text-white"
                                                    style={{ backgroundColor: GREEN }}
                                                >
                                                    {m.name?.[0]?.toUpperCase() || "?"}
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-sm truncate">
                                                    {m.name}
                                                </p>
                                                <p className="text-xs text-gray-500 truncate">
                                                    {m.phone}{(m as any).memberId ? ` · ${(m as any).memberId}` : ""}
                                                </p>
                                            </div>
                                            <div
                                                className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 flex-shrink-0"
                                                style={{ backgroundColor: GREEN, color: "white" }}
                                            >
                                                <Check className="w-3 h-3" />
                                                Mark
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {tab === "current" && (
                        <>
                            <p className="text-xs text-gray-500 mb-3">
                                These members auto-check-in as volunteers when they check in.
                                Removing only stops future auto-check-ins; past sessions are kept.
                            </p>
                            {volLoading ? (
                                <p className="text-center text-gray-400 text-sm py-8">Loading…</p>
                            ) : volunteers.length === 0 ? (
                                <p className="text-center text-gray-400 text-sm py-8">
                                    No volunteers yet. Add some from the other tab.
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {volunteers.map((m) => (
                                        <div
                                            key={m.id}
                                            className="flex items-center gap-3 p-3 rounded-2xl border-2 border-green-100 bg-green-50"
                                        >
                                            {m.photo ? (
                                                <img
                                                    src={m.photo}
                                                    alt=""
                                                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                                />
                                            ) : (
                                                <div
                                                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-black text-white"
                                                    style={{ backgroundColor: GREEN }}
                                                >
                                                    {m.name?.[0]?.toUpperCase() || "?"}
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-sm truncate">
                                                    {m.name}
                                                </p>
                                                <p className="text-xs text-gray-500 truncate">
                                                    {m.phone}{(m as any).memberId ? ` · ${(m as any).memberId}` : ""}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleMark(m.id, false)}
                                                disabled={setStatus.isPending}
                                                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50 flex items-center gap-1 flex-shrink-0"
                                            >
                                                <UserMinus className="w-3 h-3" />
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
