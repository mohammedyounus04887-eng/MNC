import { useState, useMemo } from "react";
import { format } from "date-fns";
import { Search, X, Check, ArrowDown, ArrowUp, Minus, Scale, ChevronDown, ChevronUp, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useClubContext } from "@/lib/clubDetection";
import { useMembers } from "@/hooks/owner/useMembers";
import { useRecordWeighIn } from "@/hooks/owner/useWeighIns";

interface BulkWeighInProps {
    open: boolean;
    onClose: () => void;
}

interface MemberForm {
    weight: string;
    bodyFat: string;
    skeletalMuscle: string;
    height: string;
    bmr: string;
    visceralFat: string;
    bodyAge: string;
    trunkSubFat: string;
}

const emptyForm = (): MemberForm => ({
    weight: "", bodyFat: "", skeletalMuscle: "", height: "",
    bmr: "", visceralFat: "", bodyAge: "", trunkSubFat: "",
});

function calcBmi(weight: string, height: string): string {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    if (!w || !h || h <= 0) return "—";
    return (w / Math.pow(h / 100, 2)).toFixed(1);
}

function bmiCategory(bmi: string): { label: string; color: string } {
    const n = parseFloat(bmi);
    if (isNaN(n)) return { label: "", color: "#6b7280" };
    if (n < 18.5) return { label: "Underweight", color: "#3b82f6" };
    if (n < 25) return { label: "Normal", color: "#16a34a" };
    if (n < 30) return { label: "Overweight", color: "#f59e0b" };
    return { label: "Obese", color: "#dc2626" };
}

export default function BulkWeighIn({ open, onClose }: BulkWeighInProps) {
    const { club } = useClubContext();
    const { data: members = [] } = useMembers(club?.id || null);
    const { toast } = useToast();
    const recordWeighIn = useRecordWeighIn();

    const today = new Date().toISOString().split("T")[0];
    const [selectedDate, setSelectedDate] = useState(today);
    const [searchTerm, setSearchTerm] = useState("");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [forms, setForms] = useState<Record<string, MemberForm>>({});
    const [submittingId, setSubmittingId] = useState<string | null>(null);
    const [results, setResults] = useState<Record<string, {
        change: number | null;
        bodyFatChange: number | null | undefined;
        skeletalMuscleChange: number | null | undefined;
        newBadges: string[];
    }>>({});

    const activeMembers = useMemo(() => {
        return members
            .filter(m => m.status === "active")
            .sort((a, b) => {
                // Not yet checked in (on selectedDate) float to top
                const aChecked = !!results[a.id];
                const bChecked = !!results[b.id];
                if (aChecked !== bChecked) return aChecked ? 1 : -1;
                // Then sort by least recently weighed in
                const dateA = a.lastWeighIn?.toDate?.()?.getTime() || 0;
                const dateB = b.lastWeighIn?.toDate?.()?.getTime() || 0;
                return dateA - dateB;
            });
    }, [members, results]);

    const filteredMembers = useMemo(() => {
        if (!searchTerm) return activeMembers;
        const low = searchTerm.toLowerCase();
        return activeMembers.filter(m =>
            m.name.toLowerCase().includes(low) ||
            m.phone.includes(low) ||
            m.memberId?.toLowerCase().includes(low)
        );
    }, [activeMembers, searchTerm]);

    const getForm = (memberId: string): MemberForm => forms[memberId] ?? emptyForm();

    const setField = (memberId: string, field: keyof MemberForm, value: string) => {
        setForms(prev => ({
            ...prev,
            [memberId]: { ...(prev[memberId] ?? emptyForm()), [field]: value },
        }));
    };

    // Pre-fill height from member profile when expanding
    const handleExpand = (member: any) => {
        if (expandedId === member.id) {
            setExpandedId(null);
            return;
        }
        setExpandedId(member.id);
        // Pre-fill height from profile if not already set
        setForms(prev => {
            const existing = prev[member.id] ?? emptyForm();
            if (!existing.height && member.height) {
                return { ...prev, [member.id]: { ...existing, height: String(member.height) } };
            }
            return prev;
        });
    };

    const handleSave = async (member: any) => {
        const form = getForm(member.id);
        const weight = parseFloat(form.weight);
        const bodyFat = parseFloat(form.bodyFat);
        const skeletalMuscle = parseFloat(form.skeletalMuscle);

        if (isNaN(weight) || weight <= 0) {
            toast({ title: "Weight is required", variant: "destructive" });
            return;
        }
        if (isNaN(bodyFat) || bodyFat <= 0) {
            toast({ title: "Body Fat % is required", variant: "destructive" });
            return;
        }
        if (isNaN(skeletalMuscle) || skeletalMuscle <= 0) {
            toast({ title: "Skeletal Muscle is required", variant: "destructive" });
            return;
        }

        setSubmittingId(member.id);
        try {
            const height = parseFloat(form.height) || member.height || undefined;
            const res = await recordWeighIn.mutateAsync({
                memberId: member.id,
                clubId: club!.id,
                weight,
                date: selectedDate,
                notes: "",
                recordedBy: "owner",
                previousWeight: member.currentWeight ?? null,
                startingWeight: member.startingWeight ?? 0,
                targetWeight: member.targetWeight ?? 0,
                existingBadges: member.badges || [],
                totalWeighIns: member.totalWeighIns || 0,
                height,
                bodyFat,
                previousBodyFat: member.currentBodyFat ?? null,
                startingBodyFat: member.startingBodyFat,
                skeletalMuscle,
                previousSkeletalMuscle: member.currentSkeletalMuscle ?? null,
                startingSkeletalMuscle: member.startingSkeletalMuscle,
                ...(form.visceralFat ? { visceralFat: parseFloat(form.visceralFat) } : {}),
                ...(form.bmr ? { bmr: parseFloat(form.bmr) } : {}),
                ...(form.bodyAge ? { bodyAge: parseFloat(form.bodyAge) } : {}),
                ...(form.trunkSubFat ? { trunkSubcutaneousFat: parseFloat(form.trunkSubFat) } : {}),
            });

            setResults(prev => ({
                ...prev,
                [member.id]: {
                    change: res.change,
                    bodyFatChange: res.bodyFatChange,
                    skeletalMuscleChange: res.skeletalMuscleChange,
                    newBadges: res.newBadges,
                },
            }));
            setExpandedId(null);

            if (res.newBadges.length > 0) {
                toast({ title: `🎉 ${member.name} earned new milestone badges!` });
            }
        } catch (err: any) {
            toast({ title: "Error saving", description: err.message, variant: "destructive" });
        } finally {
            setSubmittingId(null);
        }
    };

    if (!open) return null;

    const checkedInCount = Object.keys(results).length;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex flex-col items-end">
            <div className="w-full h-full md:w-[640px] bg-white md:h-screen md:shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-white">
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800">
                            <Scale className="w-5 h-5 text-emerald-600" />
                            Weight Check-in
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {checkedInCount} of {activeMembers.length} members checked in
                        </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-5 h-5 text-slate-500" />
                    </Button>
                </div>

                {/* Date picker */}
                <div className="px-4 py-3 border-b bg-slate-50 flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
                    <div className="flex-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Check-in Date</label>
                        <input
                            type="date"
                            max={today}
                            value={selectedDate}
                            onChange={e => { setSelectedDate(e.target.value); setResults({}); }}
                            className="block w-full text-sm font-bold text-slate-800 bg-transparent border-none outline-none mt-0.5"
                        />
                    </div>
                    {selectedDate !== today && (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                            Historical entry
                        </span>
                    )}
                </div>

                {/* Search */}
                <div className="px-4 py-3 border-b bg-white">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input
                            placeholder="Search members..."
                            className="pl-9 bg-slate-50"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* Member list */}
                <div className="flex-1 overflow-y-auto bg-slate-50/50">
                    {filteredMembers.length === 0 && (
                        <div className="text-center py-12 text-slate-500 text-sm">No members found.</div>
                    )}

                    {filteredMembers.map(m => {
                        const isExpanded = expandedId === m.id;
                        const result = results[m.id];
                        const isDone = !!result;
                        const isLoading = submittingId === m.id;
                        const form = getForm(m.id);
                        const bmi = calcBmi(form.weight, form.height || String(m.height || ""));
                        const bmiInfo = bmiCategory(bmi);

                        return (
                            <div key={m.id} className={`border-b bg-white ${isDone ? "opacity-75" : ""}`}>
                                {/* Member row */}
                                <button
                                    className="w-full text-left p-4 flex items-center gap-3 hover:bg-slate-50 transition-colors"
                                    onClick={() => !isDone && handleExpand(m)}
                                    disabled={isDone}
                                >
                                    {m.photo ? (
                                        <img src={m.photo} alt={m.name} className="w-11 h-11 rounded-full object-cover shrink-0" />
                                    ) : (
                                        <div className="w-11 h-11 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-lg shrink-0">
                                            {m.name.charAt(0).toUpperCase()}
                                        </div>
                                    )}

                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm text-slate-800 truncate">{m.name}</p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-xs text-slate-500">
                                                {m.currentWeight ? `${m.currentWeight} kg` : "No data"}
                                            </span>
                                            {m.currentBodyFat != null && (
                                                <span className="text-xs text-slate-400">· {m.currentBodyFat}% fat</span>
                                            )}
                                            <span className="text-xs text-slate-400">
                                                · {m.lastWeighIn?.toDate ? format(m.lastWeighIn.toDate(), "MMM d") : "Never"}
                                            </span>
                                        </div>
                                    </div>

                                    {isDone ? (
                                        <div className="flex items-center gap-2 shrink-0">
                                            <Check className="w-4 h-4 text-emerald-600" />
                                            <div className="text-right">
                                                {result.change !== null && (
                                                    <span className={`text-xs font-bold flex items-center gap-0.5 ${result.change > 0 ? "text-emerald-600" : result.change < 0 ? "text-red-600" : "text-slate-500"}`}>
                                                        {result.change > 0 ? <ArrowDown className="w-3 h-3" /> : result.change < 0 ? <ArrowUp className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                                                        {Math.abs(result.change)} kg
                                                    </span>
                                                )}
                                                {result.bodyFatChange != null && (
                                                    <span className={`text-[10px] font-bold ${result.bodyFatChange > 0 ? "text-emerald-600" : "text-orange-600"}`}>
                                                        {result.bodyFatChange > 0 ? "↓" : "↑"}{Math.abs(result.bodyFatChange)}% fat
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="shrink-0 text-slate-400">
                                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                        </div>
                                    )}
                                </button>

                                {/* Expanded form */}
                                {isExpanded && (
                                    <div className="px-4 pb-4 border-t border-slate-100 bg-slate-50/50">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 pt-3 pb-2">
                                            Body Composition — {format(new Date(selectedDate + "T00:00:00"), "MMM d, yyyy")}
                                        </p>

                                        {/* Mandatory row */}
                                        <div className="grid grid-cols-3 gap-2 mb-2">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                                                    Weight (kg) <span className="text-red-500">*</span>
                                                </label>
                                                <Input
                                                    type="number"
                                                    step="0.1"
                                                    placeholder="e.g. 65.0"
                                                    value={form.weight}
                                                    onChange={e => setField(m.id, "weight", e.target.value)}
                                                    className="mt-1 h-10 text-sm font-bold bg-white"
                                                    autoFocus
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                                                    Body Fat (%) <span className="text-red-500">*</span>
                                                </label>
                                                <Input
                                                    type="number"
                                                    step="0.1"
                                                    placeholder="e.g. 28.5"
                                                    value={form.bodyFat}
                                                    onChange={e => setField(m.id, "bodyFat", e.target.value)}
                                                    className="mt-1 h-10 text-sm font-bold bg-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                                                    Skel. Muscle (kg) <span className="text-red-500">*</span>
                                                </label>
                                                <Input
                                                    type="number"
                                                    step="0.1"
                                                    placeholder="e.g. 24.0"
                                                    value={form.skeletalMuscle}
                                                    onChange={e => setField(m.id, "skeletalMuscle", e.target.value)}
                                                    className="mt-1 h-10 text-sm font-bold bg-white"
                                                />
                                            </div>
                                        </div>

                                        {/* Height + BMI row */}
                                        <div className="grid grid-cols-3 gap-2 mb-2">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Height (cm)</label>
                                                <Input
                                                    type="number"
                                                    step="0.5"
                                                    placeholder={m.height ? String(m.height) : "e.g. 165"}
                                                    value={form.height}
                                                    onChange={e => setField(m.id, "height", e.target.value)}
                                                    className="mt-1 h-10 text-sm bg-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">BMI (auto)</label>
                                                <div className="mt-1 h-10 flex items-center px-3 bg-slate-100 rounded-md border border-slate-200">
                                                    <span className="text-sm font-bold" style={{ color: bmiInfo.color }}>{bmi}</span>
                                                    {bmiInfo.label && <span className="text-[10px] text-slate-500 ml-1">{bmiInfo.label}</span>}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">BMR (kcal)</label>
                                                <Input
                                                    type="number"
                                                    placeholder="e.g. 1450"
                                                    value={form.bmr}
                                                    onChange={e => setField(m.id, "bmr", e.target.value)}
                                                    className="mt-1 h-10 text-sm bg-white"
                                                />
                                            </div>
                                        </div>

                                        {/* Optional row */}
                                        <div className="grid grid-cols-3 gap-2 mb-4">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Visceral Fat (%)</label>
                                                <Input
                                                    type="number"
                                                    step="0.1"
                                                    placeholder="e.g. 8.5"
                                                    value={form.visceralFat}
                                                    onChange={e => setField(m.id, "visceralFat", e.target.value)}
                                                    className="mt-1 h-10 text-sm bg-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Body Age (yrs)</label>
                                                <Input
                                                    type="number"
                                                    placeholder="e.g. 38"
                                                    value={form.bodyAge}
                                                    onChange={e => setField(m.id, "bodyAge", e.target.value)}
                                                    className="mt-1 h-10 text-sm bg-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Trunk Sub Fat</label>
                                                <Input
                                                    type="number"
                                                    step="0.1"
                                                    placeholder="e.g. 12.4"
                                                    value={form.trunkSubFat}
                                                    onChange={e => setField(m.id, "trunkSubFat", e.target.value)}
                                                    className="mt-1 h-10 text-sm bg-white"
                                                />
                                            </div>
                                        </div>

                                        {/* Change preview */}
                                        {(m.currentWeight || m.currentBodyFat != null) && form.weight && (
                                            <div className="flex items-center gap-3 mb-3 bg-white rounded-xl p-3 border border-slate-100">
                                                {m.currentWeight && form.weight && (
                                                    <div className="text-center">
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Weight Δ</p>
                                                        <p className={`text-sm font-black ${(m.currentWeight - parseFloat(form.weight)) > 0 ? "text-emerald-600" : "text-orange-600"}`}>
                                                            {(m.currentWeight - parseFloat(form.weight)) > 0 ? "↓" : "↑"}
                                                            {Math.abs(m.currentWeight - parseFloat(form.weight || "0")).toFixed(1)} kg
                                                        </p>
                                                    </div>
                                                )}
                                                {m.currentBodyFat != null && form.bodyFat && (
                                                    <div className="text-center">
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Fat Δ</p>
                                                        <p className={`text-sm font-black ${(m.currentBodyFat - parseFloat(form.bodyFat)) > 0 ? "text-emerald-600" : "text-orange-600"}`}>
                                                            {(m.currentBodyFat - parseFloat(form.bodyFat)) > 0 ? "↓" : "↑"}
                                                            {Math.abs(m.currentBodyFat - parseFloat(form.bodyFat)).toFixed(1)}%
                                                        </p>
                                                    </div>
                                                )}
                                                {m.currentSkeletalMuscle != null && form.skeletalMuscle && (
                                                    <div className="text-center">
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Muscle Δ</p>
                                                        <p className={`text-sm font-black ${(parseFloat(form.skeletalMuscle) - m.currentSkeletalMuscle) > 0 ? "text-emerald-600" : "text-orange-600"}`}>
                                                            {(parseFloat(form.skeletalMuscle) - m.currentSkeletalMuscle) > 0 ? "↑" : "↓"}
                                                            {Math.abs(parseFloat(form.skeletalMuscle) - m.currentSkeletalMuscle).toFixed(2)} kg
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="flex gap-2">
                                            <Button
                                                variant="outline"
                                                className="flex-1 h-11"
                                                onClick={() => setExpandedId(null)}
                                                disabled={isLoading}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                                                onClick={() => handleSave(m)}
                                                disabled={isLoading || !form.weight || !form.bodyFat || !form.skeletalMuscle}
                                            >
                                                {isLoading ? "Saving..." : "Save"}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Footer summary */}
                <div className="border-t p-4 bg-white flex items-center justify-between">
                    <div>
                        <p className="text-xs font-bold text-slate-700">
                            {checkedInCount}/{activeMembers.length} checked in
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                            {format(new Date(selectedDate + "T00:00:00"), "EEEE, MMMM d, yyyy")}
                        </p>
                    </div>
                    <Button variant="outline" onClick={onClose} className="text-sm font-bold">
                        Done
                    </Button>
                </div>
            </div>
        </div>
    );
}
