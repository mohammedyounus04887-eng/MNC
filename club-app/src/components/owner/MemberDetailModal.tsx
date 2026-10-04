import { useState, useEffect } from "react";
import {
    X, Edit3, Save, Phone, Mail, Calendar, Scale, Target, User,
    ChevronLeft, ChevronRight, Network, TrendingDown, Activity,
    CheckCircle2, BarChart2, Users, Plus, Pencil, Trash2, Download
} from "lucide-react";
import {
    collection, doc, getDocs, getDoc, updateDoc, query,
    orderBy, serverTimestamp, Timestamp, addDoc, deleteDoc, writeBatch
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { withAuthRefresh, describeFirestoreError } from "@/lib/firestoreSafe";
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts";
import type { User as MemberUser, WeighIn, Attendance } from "@/types/firestore";

// ─── Plan colour helper ──────────────────────────────────────────────────

function planColor(planName: string = ""): { bg: string; text: string; border: string; label: string } {
    const n = planName.toLowerCase();
    if (n.includes("25") || n.includes("gold")) return { bg: "#fef3c7", text: "#92400e", border: "#fcd34d", label: "Gold" };
    if (n.includes("15") || n.includes("silver")) return { bg: "#f1f5f9", text: "#475569", border: "#94a3b8", label: "Silver" };
    if (n.includes("5") || n.includes("bronze")) return { bg: "#fef2f2", text: "#7f1d1d", border: "#fca5a5", label: "Bronze" };
    return { bg: "#f0fdf4", text: "#166534", border: "#86efac", label: planName || "Plan" };
}

function fmtDate(ts: any): string {
    if (!ts) return "—";
    try { const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return "—"; }
}

function daysLeft(ts: any): number | null {
    if (!ts) return null;
    try { const d = ts?.toDate ? ts.toDate() : new Date(ts); return Math.ceil((d.getTime() - Date.now()) / 86400000); } catch { return null; }
}

// ─── Sub-hooks ───────────────────────────────────────────────────────────

function useMemberWeighIns(clubId: string, memberId: string) {
    const [weighIns, setWeighIns] = useState<WeighIn[]>([]);
    useEffect(() => {
        if (!clubId || !memberId) return;
        getDocs(query(collection(db, `clubs/${clubId}/members/${memberId}/weighIns`), orderBy("createdAt", "asc")))
            .then(snap => setWeighIns(snap.docs.map(d => ({ id: d.id, ...d.data() } as WeighIn))));
    }, [clubId, memberId]);
    return weighIns;
}

function useMemberAttendance(clubId: string, memberId: string) {
    const [records, setRecords] = useState<Attendance[]>([]);
    useEffect(() => {
        if (!clubId || !memberId) return;
        getDocs(collection(db, `clubs/${clubId}/members/${memberId}/attendance`))
            .then(snap => setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as Attendance))));
    }, [clubId, memberId]);
    return records;
}

function useMemberPlanHistory(clubId: string, memberId: string) {
    const [plans, setPlans] = useState<any[]>([]);
    useEffect(() => {
        if (!clubId || !memberId) return;
        getDocs(query(collection(db, `clubs/${clubId}/members/${memberId}/transactions`), orderBy("createdAt", "asc")))
            .then(snap => {
                const planTxns = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter((t: any) => t.reason === 'plan_purchase' || t.reason === 'membership');
                setPlans(planTxns);
            });
    }, [clubId, memberId]);
    return plans;
}

function useMemberReferrals(clubId: string, memberId: string, treePath: string) {
    const [referrals, setReferrals] = useState<any[]>([]);
    useEffect(() => {
        if (!clubId || !memberId) return;
        getDocs(collection(db, `clubs/${clubId}/members`))
            .then(snap => {
                const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                const direct = all.filter((m: any) => m.parentUserId === memberId || m.referredBy === memberId);
                setReferrals(direct);
            });
    }, [clubId, memberId]);
    return referrals;
}

// ─── Attendance Calendar ─────────────────────────────────────────────────

function AttendanceCalendar({ attendanceDates, planHistory, year, month }: {
    attendanceDates: Set<string>;
    planHistory: any[];
    year: number;
    month: number; // 0-indexed
}) {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date().toISOString().slice(0, 10);

    function getColorForDate(dateStr: string) {
        // Find which plan was active on this date
        for (let i = planHistory.length - 1; i >= 0; i--) {
            const p = planHistory[i];
            const from = p.membershipFrom?.toDate?.() || (p.membershipFrom ? new Date(p.membershipFrom) : null);
            const to = p.membershipTo?.toDate?.() || (p.membershipTo ? new Date(p.membershipTo) : null);
            if (from && to) {
                const d = new Date(dateStr);
                if (d >= from && d <= to) return planColor(p.planName || '');
            }
        }
        return null;
    }

    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    return (
        <div>
            <div className="grid grid-cols-7 gap-1 text-center">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                    <div key={i} style={{ fontSize: 9, fontWeight: 700, color: i === 0 ? "#f87171" : "#94a3b8", paddingBottom: 4 }}>{d}</div>
                ))}
                {cells.map((day, i) => {
                    if (!day) return <div key={i} />;
                    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const dayOfWeek = new Date(dateStr).getDay();
                    const isSun = dayOfWeek === 0;
                    const attended = attendanceDates.has(dateStr);
                    const color = attended ? getColorForDate(dateStr) : null;
                    const isToday = dateStr === today;
                    return (
                        <div
                            key={i}
                            title={isSun ? "Sunday – Rest day" : attended ? `Attended${color ? ` · ${color.label}` : ""}` : "Absent"}
                            style={{
                                background: isSun ? "#f3f4f6" : color ? color.bg : attended ? "#d1fae5" : "transparent",
                                border: `1.5px solid ${isToday && !isSun ? "#2d9653" : isSun ? "#e5e7eb" : color ? color.border : attended ? "#6ee7b7" : "#f1f5f9"}`,
                                borderRadius: 6,
                                padding: "3px 2px 2px",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 1,
                                cursor: "default",
                            }}
                        >
                            <span style={{ fontSize: 10, fontWeight: isSun ? 500 : attended ? 800 : 500, color: isSun ? "#d1d5db" : color ? color.text : attended ? "#065f46" : "#94a3b8" }}>
                                {day}
                            </span>
                            {isSun ? (
                                <span style={{ fontSize: 7, color: "#d1d5db", fontWeight: 700, lineHeight: 1 }}>Off</span>
                            ) : attended ? (
                                <span style={{ fontSize: 9, color: color ? color.text : "#059669", fontWeight: 900, lineHeight: 1 }}>✓</span>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Body chart ──────────────────────────────────────────────────────────

type ChartFilter = "weight" | "bmi" | "fat" | "muscle";

function BodyChart({ weighIns }: { weighIns: WeighIn[] }) {
    const [filter, setFilter] = useState<ChartFilter>("weight");

    const data = weighIns.map(w => ({
        date: w.date,
        weight: w.weight,
        bmi: w.bmi,
        fat: w.bodyFat,
        muscle: w.skeletalMuscle,
    })).filter(d => {
        if (filter === "weight") return d.weight != null;
        if (filter === "bmi") return d.bmi != null;
        if (filter === "fat") return d.fat != null;
        if (filter === "muscle") return d.muscle != null;
        return true;
    });

    const keyMap: Record<ChartFilter, string> = { weight: "weight", bmi: "bmi", fat: "fat", muscle: "muscle" };
    const labelMap: Record<ChartFilter, string> = { weight: "Weight (kg)", bmi: "BMI", fat: "Body Fat (%)", muscle: "Skeletal Muscle (kg)" };
    const colorMap: Record<ChartFilter, string> = { weight: "#2d9653", bmi: "#6366f1", fat: "#f59e0b", muscle: "#ec4899" };
    const filters: { key: ChartFilter; label: string }[] = [
        { key: "weight", label: "Weight" },
        { key: "bmi", label: "BMI" },
        { key: "fat", label: "Fat" },
        { key: "muscle", label: "Muscle" },
    ];

    return (
        <div>
            <div className="flex gap-2 mb-3 flex-wrap">
                {filters.map(f => (
                    <button key={f.key} onClick={() => setFilter(f.key)}
                        className="px-3 py-1 rounded-full text-xs font-bold transition-all"
                        style={{ background: filter === f.key ? colorMap[f.key] : "#f1f5f9", color: filter === f.key ? "white" : "#64748b" }}>
                        {f.label}
                    </button>
                ))}
            </div>
            {data.length < 2 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                    {data.length === 0 ? "No data for this metric" : "Need more check-ins for a chart"}
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                        <YAxis tick={{ fontSize: 10 }} width={40} />
                        <Tooltip
                            contentStyle={{ borderRadius: 10, border: "none", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
                            labelFormatter={l => l}
                        />
                        <Line
                            type="monotone"
                            dataKey={keyMap[filter]}
                            stroke={colorMap[filter]}
                            strokeWidth={2.5}
                            dot={{ fill: colorMap[filter], r: 3 }}
                            name={labelMap[filter]}
                        />
                    </LineChart>
                </ResponsiveContainer>
            )}
        </div>
    );
}

// ─── Body Tab with CRUD ─────────────────────────────────────────────────

function BodyTab({ member, weighIns: regularWeighIns, clubId, onWeighInsChanged }: {
    member: any; weighIns: WeighIn[]; clubId: string; onWeighInsChanged: () => void;
}) {
    const [showAdd, setShowAdd] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), weight: "", bodyFat: "", muscle: "", bmr: "" });
    const [saving, setSaving] = useState(false);

    // Also load BTC data for this member (match by name)
    const [btcWeighIns, setBtcWeighIns] = useState<WeighIn[]>([]);
    useEffect(() => {
        if (!clubId || !member.name) return;
        (async () => {
            try {
                const pSnap = await getDocs(collection(db, `clubs/${clubId}/btcParticipants`));
                const memberNameLower = member.name.toLowerCase().trim();
                for (const pDoc of pSnap.docs) {
                    const p = pDoc.data();
                    const pName = (p.name || "").toLowerCase().trim();
                    // Match by first name or full name
                    if (pName === memberNameLower || memberNameLower.startsWith(pName) || pName.startsWith(memberNameLower.split(" ")[0])) {
                        const mSnap = await getDocs(collection(db, `clubs/${clubId}/btcParticipants/${pDoc.id}/measurements`));
                        const entries = mSnap.docs.map(d => {
                            const data = d.data();
                            return {
                                id: `btc-${d.id}`,
                                memberId: member.id,
                                clubId,
                                weight: data.weight,
                                date: data.date,
                                bodyFat: data.bodyFat,
                                skeletalMuscle: data.muscle,
                                bmr: data.bmr,
                                recordedBy: "owner" as const,
                                previousWeight: null,
                                change: null,
                                notes: "BTC",
                                createdAt: Timestamp.now(),
                            } as WeighIn;
                        });
                        setBtcWeighIns(entries);
                        break;
                    }
                }
            } catch (e) { console.error("BTC match error", e); }
        })();
    }, [clubId, member.name]);

    // Merge regular weighIns + BTC weighIns, sorted by date, deduplicated by date
    const weighIns = (() => {
        const all = [...regularWeighIns, ...btcWeighIns];
        const seen = new Set<string>();
        return all.filter(w => {
            if (seen.has(w.date)) return false;
            seen.add(w.date);
            return true;
        }).sort((a, b) => a.date.localeCompare(b.date));
    })();

    const resetForm = () => setForm({ date: new Date().toISOString().slice(0, 10), weight: "", bodyFat: "", muscle: "", bmr: "" });

    const handleSave = async () => {
        if (!form.weight) return;
        setSaving(true);
        try {
            const data: any = {
                weight: parseFloat(form.weight),
                date: form.date,
                memberId: member.id,
                clubId,
                recordedBy: "owner",
                createdAt: serverTimestamp(),
            };
            if (form.bodyFat) data.bodyFat = parseFloat(form.bodyFat);
            if (form.muscle) data.skeletalMuscle = parseFloat(form.muscle);
            if (form.bmr) data.bmr = parseFloat(form.bmr);

            if (editId) {
                await updateDoc(doc(db, `clubs/${clubId}/members/${member.id}/weighIns`, editId), data);
            } else {
                await addDoc(collection(db, `clubs/${clubId}/members/${member.id}/weighIns`), data);
            }
            // Update member's current stats
            await updateDoc(doc(db, `clubs/${clubId}/members/${member.id}`), {
                currentWeight: parseFloat(form.weight),
                ...(form.bodyFat ? { currentBodyFat: parseFloat(form.bodyFat) } : {}),
                ...(form.muscle ? { currentSkeletalMuscle: parseFloat(form.muscle) } : {}),
            });
            setShowAdd(false);
            setEditId(null);
            resetForm();
            onWeighInsChanged();
        } catch (e) { console.error("Save weigh-in error", e); }
        setSaving(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this weigh-in?")) return;
        await deleteDoc(doc(db, `clubs/${clubId}/members/${member.id}/weighIns`, id));
        onWeighInsChanged();
    };

    const startEdit = (w: WeighIn) => {
        setEditId(w.id);
        setForm({ date: w.date || "", weight: String(w.weight || ""), bodyFat: String(w.bodyFat || ""), muscle: String(w.skeletalMuscle || ""), bmr: String(w.bmr || "") });
        setShowAdd(true);
    };

    const inputStyle = { padding: "8px 10px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontFamily: "Nunito,sans-serif", width: "100%" };

    return (
        <div className="space-y-4">
            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
                {[
                    { label: "Starting Weight", value: member.startingWeight ? `${member.startingWeight} kg` : "—", color: "bg-slate-50" },
                    { label: "Current Weight", value: member.currentWeight ? `${member.currentWeight} kg` : "—", color: "bg-emerald-50" },
                    { label: "Target Weight", value: member.targetWeight ? `${member.targetWeight} kg` : "—", color: "bg-amber-50" },
                    {
                        label: "Progress",
                        value: member.startingWeight && member.currentWeight
                            ? `${Math.abs(member.startingWeight - member.currentWeight).toFixed(1)} kg ${member.startingWeight > member.currentWeight ? "lost ↓" : "gained ↑"}`
                            : "—",
                        color: "bg-blue-50"
                    },
                ].map(s => (
                    <div key={s.label} className={`${s.color} rounded-2xl p-4 border border-slate-100`}>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{s.label}</p>
                        <p className="text-lg font-black text-slate-900 mt-1">{s.value}</p>
                    </div>
                ))}
            </div>
            {/* Chart */}
            <div className="bg-white rounded-2xl border p-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 px-1">Progress Chart</p>
                <BodyChart weighIns={weighIns} />
            </div>

            {/* Add / Edit Form */}
            {showAdd && (
                <div className="bg-emerald-50 rounded-2xl border border-emerald-200 p-4 space-y-3">
                    <p className="text-xs font-bold text-emerald-800 uppercase tracking-widest">{editId ? "Edit Weigh-In" : "Add Weigh-In"}</p>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] font-bold text-slate-500">Date</label>
                            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-500">Weight (kg) *</label>
                            <input type="number" step="0.1" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} style={inputStyle} placeholder="80.5" />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-500">Body Fat %</label>
                            <input type="number" step="0.1" value={form.bodyFat} onChange={e => setForm(f => ({ ...f, bodyFat: e.target.value }))} style={inputStyle} placeholder="25.3" />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-500">Muscle %</label>
                            <input type="number" step="0.1" value={form.muscle} onChange={e => setForm(f => ({ ...f, muscle: e.target.value }))} style={inputStyle} placeholder="30.1" />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-500">BMR (kcal)</label>
                            <input type="number" value={form.bmr} onChange={e => setForm(f => ({ ...f, bmr: e.target.value }))} style={inputStyle} placeholder="1650" />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={handleSave} disabled={saving || !form.weight} style={{ background: "#2d9653", color: "white", border: "none", borderRadius: 10, padding: "8px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "Nunito,sans-serif", opacity: saving || !form.weight ? 0.5 : 1 }}>
                            {saving ? "Saving…" : editId ? "Update" : "Save"}
                        </button>
                        <button onClick={() => { setShowAdd(false); setEditId(null); resetForm(); }} style={{ background: "#f1f5f9", color: "#475569", border: "none", borderRadius: 10, padding: "8px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "Nunito,sans-serif" }}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Weigh-In History with CRUD */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Weigh-In History ({weighIns.length})</p>
                    {!showAdd && (
                        <button onClick={() => { resetForm(); setEditId(null); setShowAdd(true); }} style={{ background: "#2d9653", color: "white", border: "none", borderRadius: 8, padding: "5px 12px", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "Nunito,sans-serif", display: "flex", alignItems: "center", gap: 4 }}>
                            <Plus style={{ width: 12, height: 12 }} /> Add
                        </button>
                    )}
                </div>
                {weighIns.length === 0 ? (
                    <div className="text-center py-8 text-sm text-slate-400 bg-slate-50 rounded-2xl border border-dashed">No weigh-ins recorded yet</div>
                ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {[...weighIns].reverse().map(w => (
                            <div key={w.id} className="flex items-center justify-between bg-white rounded-xl border border-slate-100 p-3 hover:shadow-sm transition-shadow">
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-slate-700">{w.date}</p>
                                    <div className="flex gap-3 mt-0.5 text-[11px] text-slate-500">
                                        <span className="font-bold text-slate-900">{w.weight} kg</span>
                                        {w.bodyFat != null && <span>Fat: {w.bodyFat}%</span>}
                                        {w.skeletalMuscle != null && <span>Muscle: {w.skeletalMuscle}%</span>}
                                        {w.bmr != null && <span>BMR: {w.bmr}</span>}
                                    </div>
                                </div>
                                <div className="flex gap-1 ml-2 flex-shrink-0">
                                    <button onClick={() => startEdit(w)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors"><Pencil style={{ width: 14, height: 14 }} /></button>
                                    <button onClick={() => handleDelete(w.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"><Trash2 style={{ width: 14, height: 14 }} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Main modal ──────────────────────────────────────────────────────────

type Tab = "overview" | "plans" | "body" | "network";

export interface MemberDetailModalProps {
    member: MemberUser & { id: string };
    clubId: string;
    onClose: () => void;
    onUpdated?: () => void;
}

export default function MemberDetailModal({ member: initialMember, clubId, onClose, onUpdated }: MemberDetailModalProps) {
    const [member, setMember] = useState(initialMember);
    const [downloading, setDownloading] = useState(false);

    // Everything the club holds about this member, as one Excel file.
    // Read-only -- see lib/exportMember.ts.
    const handleDownloadData = async () => {
        if (!clubId || !member?.id || downloading) return;
        setDownloading(true);
        try {
            const { downloadMemberData } = await import("@/lib/exportMember");
            await downloadMemberData(clubId, member.id, "");
        } catch (err: any) {
            console.error("[member export]", err);
            alert(err?.message || "Could not build the file. Please try again.");
        } finally {
            setDownloading(false);
        }
    };
    const [tab, setTab] = useState<Tab>("overview");
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState<any>({});
    const [saving, setSaving] = useState(false);

    // Calendar pagination
    const now = new Date();
    const [calYear, setCalYear] = useState(now.getFullYear());
    const [calMonth, setCalMonth] = useState(now.getMonth());

    const weighInsHook = useMemberWeighIns(clubId, member.id);
    const [weighInsLocal, setWeighInsLocal] = useState<WeighIn[]>([]);
    useEffect(() => { setWeighInsLocal(weighInsHook); }, [weighInsHook]);
    const weighIns = weighInsLocal.length > 0 ? weighInsLocal : weighInsHook;
    const attendanceRecords = useMemberAttendance(clubId, member.id);
    const planHistory = useMemberPlanHistory(clubId, member.id);
    const referrals = useMemberReferrals(clubId, member.id, member.treePath || "");

    const attendanceDates = new Set(attendanceRecords.map(a => a.date));
    const days = null; // credits-only model — no expiry
    const pc = { bg: "#f0f9ff", text: "#0369a1", border: "#bae6fd" };

    function startEdit() {
        setEditForm({
            name: member.name || "",
            phone: member.phone || "",
            email: member.email || "",
            currentWeight: member.currentWeight ?? "",
            targetWeight: member.targetWeight ?? "",
            height: member.height ?? "",
            dob: member.dob ? (member.dob as any).toDate?.()?.toISOString().slice(0, 10) || "" : "",
            isCouple: (member as any).isCouple ?? false,
            husbandName: (member as any).husbandName ?? "",
            wifeName: (member as any).wifeName ?? "",
            isOneDayShakeMember: (member as any).isOneDayShakeMember ?? false,
        });
        setEditing(true);
    }

    async function saveEdit() {
        setSaving(true);
        try {
            const payload: any = {
                name: editForm.name.trim(),
                phone: editForm.phone.trim(),
                email: editForm.email.trim() || null,
                updatedAt: serverTimestamp(),
            };
            if (editForm.currentWeight !== "") payload.currentWeight = Number(editForm.currentWeight);
            if (editForm.targetWeight !== "") payload.targetWeight = Number(editForm.targetWeight);
            if (editForm.height !== "") payload.height = Number(editForm.height);
            if (editForm.dob) payload.dob = Timestamp.fromDate(new Date(editForm.dob));

            // Check-in option toggles
            payload.isCouple = !!editForm.isCouple;
            payload.husbandName = editForm.isCouple ? (editForm.husbandName || "").trim() : "";
            payload.wifeName = editForm.isCouple ? (editForm.wifeName || "").trim() : "";
            payload.isOneDayShakeMember = !!editForm.isOneDayShakeMember;

            // Wrapped to auto-refresh a stale auth token + retry once before
            // surfacing a "session expired" message. Eliminates the silent
            // permission-denied failure mode the owner kept hitting after
            // leaving the page open for a while.
            await withAuthRefresh(() =>
                updateDoc(doc(db, `clubs/${clubId}/members`, member.id), payload)
            );

            setMember(prev => ({ ...prev, ...payload }));
            setEditing(false);
            onUpdated?.();
        } catch (e: any) {
            console.error("[MemberDetailModal saveEdit]", e);
            alert(describeFirestoreError(e));
        } finally {
            setSaving(false);
        }
    }

    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    const photo = (member as any).photoUrl || (member as any).photo || member.photo;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[95vh] overflow-hidden"
                style={{ fontFamily: "'Nunito', sans-serif" }}>

                {/* ── Profile header ── */}
                <div className="relative bg-gradient-to-br from-emerald-600 to-emerald-800 px-5 pt-5 pb-4">
                    {/* Header, not a tab: this pulls the member's whole record,
                        so it should not depend on which tab happens to be open. */}
                    <div className="absolute top-4 right-4 flex items-center gap-2">
                        <button onClick={handleDownloadData} disabled={downloading}
                            title="Download everything we hold about this member"
                            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/20 text-white text-xs font-bold hover:bg-white/30 transition-colors disabled:opacity-60">
                            <Download className="w-4 h-4" />
                            {downloading ? "Preparing…" : "Download"}
                        </button>
                        <button onClick={onClose}
                            className="p-2 rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="flex items-start gap-4">
                        {/* Avatar */}
                        <div className="relative flex-shrink-0">
                            {photo ? (
                                <img src={photo} alt={member.name} className="w-16 h-16 rounded-2xl object-cover border-2 border-white/40" />
                            ) : (
                                <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-white text-2xl font-black">
                                    {member.name?.charAt(0)?.toUpperCase() || "M"}
                                </div>
                            )}
                            {/* Status dot */}
                            <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${days !== null && days > 0 ? "bg-emerald-400" : "bg-red-400"}`} />
                        </div>
                        {/* Name + ID */}
                        <div className="flex-1 min-w-0">
                            <h2 className="text-xl font-black text-white leading-tight truncate">{member.name}</h2>
                            <p className="text-emerald-200 text-xs font-bold mt-0.5">{(member as any).memberId || member.id.slice(0, 8)}</p>
                            {/* Credits badge */}
                            {((member as any).shakeCredits ?? 0) > 0 && (
                                <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest"
                                    style={{ background: '#dcfce7', color: '#166534' }}>
                                    {(member as any).shakeCredits} Credits
                                </span>
                            )}
                        </div>
                    </div>
                    {/* Quick stats row */}
                    <div className="grid grid-cols-3 gap-2 mt-4">
                        {(() => {
                            const credits = (member as any).shakeCredits ?? 0;
                            const total = (member as any).shakeCreditsPlanTotal ?? 0;
                            const isNeg = credits < 0;
                            return [
                                { label: "Shake Credits", value: `${credits} / ${total}`, warn: isNeg },
                                { label: "Check-ins", value: attendanceRecords.length || "—" },
                                { label: "Weight", value: member.currentWeight ? `${member.currentWeight}kg` : "—" },
                            ].map(s => (
                                <div key={s.label} className="bg-white/15 rounded-xl p-2 text-center">
                                    <p className={`font-black text-base leading-tight ${(s as any).warn ? 'text-red-400' : 'text-white'}`}>{s.value}</p>
                                    <p className="text-emerald-200 text-[9px] font-bold uppercase tracking-widest mt-0.5">{s.label}</p>
                                </div>
                            ));
                        })()}
                    </div>
                </div>

                {/* ── Tab bar ── */}
                <div className="flex border-b bg-white sticky top-0 z-10">
                    {([
                        { key: "overview", label: "Overview", icon: <User className="w-3.5 h-3.5" /> },
                        { key: "plans", label: "Plans", icon: <Calendar className="w-3.5 h-3.5" /> },
                        { key: "body", label: "Body", icon: <Activity className="w-3.5 h-3.5" /> },
                        { key: "network", label: "Network", icon: <Network className="w-3.5 h-3.5" /> },
                    ] as { key: Tab; label: string; icon: React.ReactNode }[]).map(t => (
                        <button key={t.key} onClick={() => setTab(t.key)}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold border-b-2 transition-colors ${tab === t.key ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
                            {t.icon}{t.label}
                        </button>
                    ))}
                </div>

                {/* ── Content ── */}
                <div className="overflow-y-auto flex-1 p-5 space-y-4">

                    {/* OVERVIEW TAB */}
                    {tab === "overview" && (
                        <div className="space-y-4">
                            {/* Edit / Save bar */}
                            <div className="flex justify-end">
                                {editing ? (
                                    <div className="flex gap-2">
                                        <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold hover:bg-slate-200">Cancel</button>
                                        <button onClick={saveEdit} disabled={saving}
                                            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-1.5">
                                            <Save className="w-3.5 h-3.5" />{saving ? "Saving..." : "Save"}
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={startEdit} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold hover:bg-slate-200">
                                        <Edit3 className="w-3.5 h-3.5" /> Edit
                                    </button>
                                )}
                            </div>

                            {/* Contact info */}
                            <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact</p>
                                {[
                                    { icon: <Phone className="w-4 h-4 text-emerald-500" />, label: "Phone", key: "phone", value: member.phone },
                                    { icon: <Mail className="w-4 h-4 text-blue-500" />, label: "Email", key: "email", value: member.email || "—" },
                                    { icon: <Calendar className="w-4 h-4 text-purple-500" />, label: "Date of Birth", key: "dob", value: fmtDate(member.dob), type: "date" },
                                ].map(f => (
                                    <div key={f.label} className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {f.icon}
                                            <span className="text-xs text-slate-500 font-medium">{f.label}</span>
                                        </div>
                                        {editing && f.key !== "dob" ? (
                                            <input value={editForm[f.key] || ""} onChange={e => setEditForm((p: any) => ({ ...p, [f.key]: e.target.value }))}
                                                className="text-sm font-bold text-slate-900 text-right bg-white border border-emerald-200 rounded-lg px-2 py-1 w-40 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                                        ) : editing && f.key === "dob" ? (
                                            <input type="date" value={editForm.dob || ""} onChange={e => setEditForm((p: any) => ({ ...p, dob: e.target.value }))}
                                                className="text-sm font-bold text-slate-900 bg-white border border-emerald-200 rounded-lg px-2 py-1 w-40 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                                        ) : (
                                            <span className="text-sm font-bold text-slate-900">{f.value}</span>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Body stats */}
                            <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Body Stats</p>
                                {[
                                    { icon: <Scale className="w-4 h-4 text-emerald-500" />, label: "Current Weight", key: "currentWeight", unit: "kg" },
                                    { icon: <Target className="w-4 h-4 text-amber-500" />, label: "Target Weight", key: "targetWeight", unit: "kg" },
                                    { icon: <TrendingDown className="w-4 h-4 text-blue-500" />, label: "Starting Weight", unit: "kg", readonly: true, value: member.startingWeight ? `${member.startingWeight} kg` : "—" },
                                    { icon: <BarChart2 className="w-4 h-4 text-purple-500" />, label: "Height", key: "height", unit: "cm" },
                                ].map(f => (
                                    <div key={f.label} className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {f.icon}
                                            <span className="text-xs text-slate-500 font-medium">{f.label}</span>
                                        </div>
                                        {editing && f.key && !f.readonly ? (
                                            <div className="flex items-center gap-1">
                                                <input type="number" value={editForm[f.key] || ""} onChange={e => setEditForm((p: any) => ({ ...p, [f.key!]: e.target.value }))}
                                                    className="text-sm font-bold text-slate-900 text-right bg-white border border-emerald-200 rounded-lg px-2 py-1 w-24 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                                                <span className="text-xs text-slate-400">{f.unit}</span>
                                            </div>
                                        ) : (
                                            <span className="text-sm font-bold text-slate-900">
                                                {f.readonly ? f.value : ((member as any)[f.key!] ? `${(member as any)[f.key!]} ${f.unit}` : "—")}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Shake Credits */}
                            {(() => {
                                const credits = (member as any).shakeCredits ?? 0;
                                const total = (member as any).shakeCreditsPlanTotal ?? 0;
                                const isNeg = credits < 0;
                                const graceUsed = Math.abs(Math.min(0, credits));
                                return (
                                    <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Shake Credits</p>
                                        {[
                                            { label: "Remaining", value: `${credits}`, color: isNeg ? 'text-red-600' : undefined },
                                            { label: "Total Purchased", value: `${total}` },
                                            { label: "Used", value: `${Math.max(0, total - credits)}` },
                                        ].map(f => (
                                            <div key={f.label} className="flex items-center justify-between">
                                                <span className="text-xs text-slate-500 font-medium">{f.label}</span>
                                                <span className={`text-sm font-bold ${(f as any).color || 'text-slate-900'}`}>{f.value}</span>
                                            </div>
                                        ))}
                                        {isNeg && (
                                            <div className="bg-amber-50 rounded-lg p-2 text-center">
                                                <span className="text-xs font-bold text-amber-700">Grace period: {graceUsed}/5 used</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* ── Check-in options: single-account couple attendance + one-day shake ── */}
                            <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Check-in Options</p>

                                <label className="flex items-center justify-between gap-2">
                                    <span className="text-xs text-slate-500 font-medium">💑 Couple Attendance</span>
                                    {editing ? (
                                        <input type="checkbox" checked={!!editForm.isCouple} onChange={e => setEditForm((p: any) => ({ ...p, isCouple: e.target.checked }))} className="w-4 h-4 accent-pink-600" />
                                    ) : (
                                        <span className="text-sm font-bold text-slate-900">{(member as any).isCouple ? "On" : "Off"}</span>
                                    )}
                                </label>
                                {((editing && editForm.isCouple) || (!editing && (member as any).isCouple)) && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <span className="text-[10px] text-slate-400 font-bold">Husband</span>
                                            {editing ? (
                                                <input value={editForm.husbandName || ""} onChange={e => setEditForm((p: any) => ({ ...p, husbandName: e.target.value }))} placeholder="Husband name" className="w-full text-sm font-bold text-slate-900 bg-white border border-emerald-200 rounded-lg px-2 py-1 mt-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                                            ) : (
                                                <div className="text-sm font-bold text-slate-900">{(member as any).husbandName || "—"}</div>
                                            )}
                                        </div>
                                        <div>
                                            <span className="text-[10px] text-slate-400 font-bold">Wife</span>
                                            {editing ? (
                                                <input value={editForm.wifeName || ""} onChange={e => setEditForm((p: any) => ({ ...p, wifeName: e.target.value }))} placeholder="Wife name" className="w-full text-sm font-bold text-slate-900 bg-white border border-emerald-200 rounded-lg px-2 py-1 mt-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                                            ) : (
                                                <div className="text-sm font-bold text-slate-900">{(member as any).wifeName || "—"}</div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <label className="flex items-center justify-between gap-2">
                                    <span className="text-xs text-slate-500 font-medium">🥤 One-Day Shake Member</span>
                                    {editing ? (
                                        <input type="checkbox" checked={!!editForm.isOneDayShakeMember} onChange={e => setEditForm((p: any) => ({ ...p, isOneDayShakeMember: e.target.checked }))} className="w-4 h-4 accent-emerald-600" />
                                    ) : (
                                        <span className="text-sm font-bold text-slate-900">{(member as any).isOneDayShakeMember ? "Yes" : "No"}</span>
                                    )}
                                </label>
                                {!editing && (
                                    <p className="text-[10px] text-slate-400">Tap <b>Edit</b> to change. Couple → check-in asks who's present; One-Day Shake → check-in offers Deduct Credits / One-Day Shake.</p>
                                )}
                            </div>

                            {/* ── Couple linking — for the Couple Attendance award.
                                Pairs two members so the receptionist can mark
                                "Both / Only A / Only B" at check-in. ── */}
                            <CoupleSection member={member} clubId={clubId} onUpdated={(patch) => { setMember(prev => ({ ...prev, ...patch })); onUpdated?.(); }} />
                        </div>
                    )}

                    {/* PLANS & ATTENDANCE TAB */}
                    {tab === "plans" && (
                        <div className="space-y-4">
                            {/* Plan legend */}
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { label: "Gold (25 credits)", ...planColor("gold") },
                                    { label: "Silver (15 credits)", ...planColor("silver") },
                                    { label: "Bronze (5 credits)", ...planColor("bronze") },
                                ].map(c => (
                                    <div key={c.label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold"
                                        style={{ background: c.bg, color: c.text, border: `1.5px solid ${c.border}` }}>
                                        <div className="w-2 h-2 rounded-full" style={{ background: c.text }} />
                                        {c.label}
                                    </div>
                                ))}
                            </div>

                            {/* Calendar nav */}
                            <div className="bg-white rounded-2xl border p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <button onClick={() => { let m = calMonth - 1; let y = calYear; if (m < 0) { m = 11; y--; } setCalMonth(m); setCalYear(y); }}
                                        className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                                        <ChevronLeft className="w-4 h-4 text-slate-500" />
                                    </button>
                                    <p className="text-sm font-black text-slate-900">{monthNames[calMonth]} {calYear}</p>
                                    <button onClick={() => { let m = calMonth + 1; let y = calYear; if (m > 11) { m = 0; y++; } setCalMonth(m); setCalYear(y); }}
                                        className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                                        <ChevronRight className="w-4 h-4 text-slate-500" />
                                    </button>
                                </div>
                                <AttendanceCalendar
                                    attendanceDates={attendanceDates}
                                    planHistory={planHistory}
                                    year={calYear}
                                    month={calMonth}
                                />
                                <p className="text-[10px] text-slate-400 text-center mt-3">
                                    {attendanceDates.size} total check-ins recorded
                                </p>
                            </div>

                            {/* Plan history */}
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">Plan History</p>
                                {planHistory.length === 0 ? (
                                    <div className="text-center py-6 text-slate-400 text-sm">No plan history yet</div>
                                ) : (
                                    <div className="space-y-2">
                                        {planHistory.slice().reverse().map((p: any) => {
                                            const pc = planColor(p.planName || "");
                                            return (
                                                <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl border"
                                                    style={{ background: pc.bg, borderColor: pc.border }}>
                                                    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black" style={{ background: pc.text, color: "white" }}>
                                                        {(p.planName || "?")[0]}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-bold truncate" style={{ color: pc.text }}>{p.planName || "Plan"}</p>
                                                        <p className="text-[10px] font-medium" style={{ color: pc.text, opacity: 0.7 }}>
                                                            {fmtDate(p.membershipFrom)} → {fmtDate(p.membershipTo)}
                                                        </p>
                                                    </div>
                                                    <p className="text-sm font-black" style={{ color: pc.text }}>₹{(p.amount || 0).toLocaleString("en-IN")}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* BODY PROGRESS TAB */}
                    {tab === "body" && (
                        <BodyTab
                            member={member}
                            weighIns={weighIns}
                            clubId={clubId}
                            onWeighInsChanged={() => {
                                // Re-fetch weighIns
                                getDocs(query(collection(db, `clubs/${clubId}/members/${member.id}/weighIns`), orderBy("createdAt", "asc")))
                                    .then(snap => setWeighInsLocal(snap.docs.map(d => ({ id: d.id, ...d.data() } as WeighIn))));
                            }}
                        />
                    )}

                    {/* NETWORK TAB */}
                    {tab === "network" && (
                        <div className="space-y-4">
                            {/* Root node */}
                            <div className="flex flex-col items-center">
                                <div className="flex flex-col items-center p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl w-40 shadow-sm">
                                    {photo ? (
                                        <img src={photo} alt={member.name} className="w-12 h-12 rounded-xl object-cover mb-2" />
                                    ) : (
                                        <div className="w-12 h-12 rounded-xl bg-emerald-200 flex items-center justify-center text-xl font-black text-emerald-700 mb-2">
                                            {member.name?.charAt(0)?.toUpperCase()}
                                        </div>
                                    )}
                                    <p className="text-xs font-black text-emerald-900 text-center leading-tight">{member.name}</p>
                                    <p className="text-[9px] text-emerald-600 font-bold mt-0.5">{(member as any).memberId || "—"}</p>
                                    <span className="mt-1 text-[9px] bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full font-bold">You</span>
                                </div>
                                {/* Tree lines */}
                                {referrals.length > 0 && (
                                    <div className="w-px h-6 bg-emerald-300" />
                                )}
                            </div>

                            {/* Referrals */}
                            {referrals.length === 0 ? (
                                <div className="text-center py-4 text-slate-400 text-sm">No direct referrals yet</div>
                            ) : (
                                <>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">
                                        Direct Referrals ({referrals.length})
                                    </p>
                                    <div className={`grid gap-3 ${referrals.length > 2 ? "grid-cols-2" : "grid-cols-2"}`}>
                                        {referrals.map((r: any) => {
                                            const rPhoto = r.photoUrl || r.photo;
                                            const rd = daysLeft(r.membershipEnd);
                                            return (
                                                <div key={r.id} className="flex flex-col items-center p-3 bg-slate-50 border rounded-2xl">
                                                    {rPhoto ? (
                                                        <img src={rPhoto} alt={r.name} className="w-10 h-10 rounded-xl object-cover mb-1.5" />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-xl bg-slate-200 flex items-center justify-center text-base font-black text-slate-500 mb-1.5">
                                                            {r.name?.charAt(0)?.toUpperCase()}
                                                        </div>
                                                    )}
                                                    <p className="text-[11px] font-bold text-slate-800 text-center leading-tight">{r.name}</p>
                                                    <p className="text-[9px] text-slate-400 mt-0.5">{r.memberId || r.id.slice(0, 6)}</p>
                                                    <div className={`mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold ${rd !== null && rd > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-50 text-red-500"}`}>
                                                        {rd !== null ? (rd > 0 ? `${rd}d left` : "Expired") : "No plan"}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}

                            {/* Summary */}
                            <div className="bg-slate-50 rounded-2xl p-4 flex justify-around">
                                <div className="text-center">
                                    <p className="text-2xl font-black text-slate-900">{referrals.length}</p>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Direct</p>
                                </div>
                                <div className="w-px bg-slate-200" />
                                <div className="text-center">
                                    <p className="text-2xl font-black text-slate-900">{referrals.filter((r: any) => daysLeft(r.membershipEnd) !== null && (daysLeft(r.membershipEnd) ?? -1) > 0).length}</p>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Active</p>
                                </div>
                                <div className="w-px bg-slate-200" />
                                <div className="text-center">
                                    <p className="text-2xl font-black text-slate-900">{(member as any).shakeCredits ?? 0}</p>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Credits</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Couple section (link/unlink with gender) ───────────────────────────
function CoupleSection({ member, clubId, onUpdated }: { member: any; clubId: string; onUpdated: (patch: any) => void }) {
    const [picker, setPicker] = useState(false);
    const [search, setSearch] = useState("");
    const [candidates, setCandidates] = useState<any[]>([]);
    const [busy, setBusy] = useState(false);
    const [partner, setPartner] = useState<any | null>(null);
    const linked = !!member.couplePartnerId;

    // Load partner when linked
    useEffect(() => {
        if (!linked) { setPartner(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const snap = await getDoc(doc(db, `clubs/${clubId}/members`, member.couplePartnerId));
                if (!cancelled && snap.exists()) setPartner({ id: snap.id, ...snap.data() });
            } catch {}
        })();
        return () => { cancelled = true; };
    }, [clubId, linked, member.couplePartnerId]);

    // Load candidates when picker open
    useEffect(() => {
        if (!picker) return;
        let cancelled = false;
        (async () => {
            try {
                const snap = await getDocs(collection(db, `clubs/${clubId}/members`));
                const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                    .filter(m => m.id !== member.id && !m.couplePartnerId);
                if (!cancelled) setCandidates(all);
            } catch {}
        })();
        return () => { cancelled = true; };
    }, [clubId, member.id, picker]);

    const filtered = search
        ? candidates.filter(c => (c.name || "").toLowerCase().includes(search.toLowerCase()) || (c.phone || "").includes(search))
        : candidates.slice(0, 20);

    const linkCouple = async (partnerCandidate: any, thisGender: "male" | "female", partnerGender: "male" | "female") => {
        if (busy) return;
        setBusy(true);
        try {
            const coupleId = [member.id, partnerCandidate.id].sort().join("__");
            await withAuthRefresh(async () => {
                const batch = writeBatch(db);
                batch.update(doc(db, `clubs/${clubId}/members`, member.id), {
                    couplePartnerId: partnerCandidate.id,
                    gender: thisGender,
                    coupleId,
                    coupleLinkedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
                batch.update(doc(db, `clubs/${clubId}/members`, partnerCandidate.id), {
                    couplePartnerId: member.id,
                    gender: partnerGender,
                    coupleId,
                    coupleLinkedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
                await batch.commit();
            });
            onUpdated({ couplePartnerId: partnerCandidate.id, gender: thisGender, coupleId });
            setPicker(false);
            setSearch("");
        } catch (e: any) {
            console.error("[link couple]", e);
            alert(describeFirestoreError(e));
        } finally {
            setBusy(false);
        }
    };

    const unlinkCouple = async () => {
        if (!partner) return;
        if (!confirm(`Unlink ${member.name} and ${partner.name}?`)) return;
        setBusy(true);
        try {
            await withAuthRefresh(async () => {
                const batch = writeBatch(db);
                batch.update(doc(db, `clubs/${clubId}/members`, member.id), {
                    couplePartnerId: null, coupleId: null, updatedAt: serverTimestamp(),
                });
                batch.update(doc(db, `clubs/${clubId}/members`, partner.id), {
                    couplePartnerId: null, coupleId: null, updatedAt: serverTimestamp(),
                });
                await batch.commit();
            });
            onUpdated({ couplePartnerId: null, coupleId: null });
            setPartner(null);
        } catch (e: any) {
            console.error("[unlink couple]", e);
            alert(describeFirestoreError(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">💑 Couple</p>
            {linked && partner ? (
                <div className="flex items-center gap-3 bg-white rounded-xl px-3 py-2 border border-pink-200">
                    {(partner.photoUrl || partner.photo) ? (
                        <img src={partner.photoUrl || partner.photo} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                        <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center text-pink-700 font-black">{(partner.name || "?")[0]}</div>
                    )}
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{partner.name}</p>
                        <p className="text-[10px] text-slate-500 font-medium">
                            Linked partner · {member.gender === "male" ? "♂" : "♀"} {member.name?.split(" ")[0]} & {partner.gender === "male" ? "♂" : "♀"} {partner.name?.split(" ")[0]}
                        </p>
                    </div>
                    <button onClick={unlinkCouple} disabled={busy} className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 disabled:opacity-50">
                        Unlink
                    </button>
                </div>
            ) : (
                <button onClick={() => setPicker(true)} className="w-full py-2.5 rounded-xl bg-pink-50 border border-pink-200 text-pink-700 text-sm font-bold hover:bg-pink-100 flex items-center justify-center gap-2">
                    💑 Link as Couple
                </button>
            )}

            {picker && !linked && (
                <CouplePickerModal
                    member={member}
                    candidates={filtered}
                    search={search}
                    onSearch={setSearch}
                    onLink={linkCouple}
                    onClose={() => { setPicker(false); setSearch(""); }}
                    busy={busy}
                />
            )}
        </div>
    );
}

function CouplePickerModal({ member, candidates, search, onSearch, onLink, onClose, busy }: any) {
    const [step, setStep] = useState<"pick" | "gender">("pick");
    const [picked, setPicked] = useState<any | null>(null);
    const [thisGender, setThisGender] = useState<"male" | "female">(member.gender || "male");
    const [partnerGender, setPartnerGender] = useState<"male" | "female">(member.gender === "male" ? "female" : "male");

    return (
        <div onClick={onClose} className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
            <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto" style={{ fontFamily: "'Nunito', sans-serif" }}>
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-base font-black text-slate-900">💑 Link as Couple</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
                </div>

                {step === "pick" ? (
                    <>
                        <p className="text-xs text-slate-500 mb-3">Pick the other partner. Already-coupled members are hidden.</p>
                        <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search by name or phone…" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm mb-3" />
                        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                            {candidates.length === 0 ? (
                                <p className="text-center text-slate-400 py-8 text-sm">No matches</p>
                            ) : candidates.map((c: any) => (
                                <button
                                    key={c.id}
                                    onClick={() => { setPicked(c); setStep("gender"); }}
                                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 text-left border border-slate-100"
                                >
                                    {(c.photoUrl || c.photo) ? (
                                        <img src={c.photoUrl || c.photo} alt="" className="w-8 h-8 rounded-full object-cover" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs">{(c.name || "?")[0]}</div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-slate-900 truncate">{c.name}</p>
                                        <p className="text-[10px] text-slate-500 truncate">{c.phone || ""}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </>
                ) : (
                    <>
                        <p className="text-xs text-slate-500 mb-3">Mark which partner is male / female (used for the "Both / Only male / Only female" check-in prompt).</p>
                        <div className="space-y-3">
                            <GenderPicker name={member.name || "This member"} value={thisGender} onChange={(g) => { setThisGender(g); setPartnerGender(g === "male" ? "female" : "male"); }} />
                            <GenderPicker name={picked?.name || "Partner"} value={partnerGender} onChange={(g) => { setPartnerGender(g); setThisGender(g === "male" ? "female" : "male"); }} />
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button onClick={() => setStep("pick")} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold">← Back</button>
                            <button
                                onClick={() => onLink(picked, thisGender, partnerGender)}
                                disabled={busy}
                                className="flex-1 py-2.5 rounded-xl bg-pink-600 text-white text-sm font-bold hover:bg-pink-700 disabled:opacity-60"
                            >
                                {busy ? "Linking…" : "💑 Link"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function GenderPicker({ name, value, onChange }: { name: string; value: "male" | "female"; onChange: (g: "male" | "female") => void }) {
    return (
        <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs font-bold text-slate-600 mb-2">{name}</p>
            <div className="grid grid-cols-2 gap-2">
                {(["male", "female"] as const).map(g => (
                    <button
                        key={g}
                        onClick={() => onChange(g)}
                        className={`py-2 rounded-lg text-xs font-bold border-2 ${value === g
                            ? (g === "male" ? "bg-blue-50 border-blue-500 text-blue-700" : "bg-pink-50 border-pink-500 text-pink-700")
                            : "bg-white border-slate-200 text-slate-500"}`}
                    >
                        {g === "male" ? "♂ Male" : "♀ Female"}
                    </button>
                ))}
            </div>
        </div>
    );
}
