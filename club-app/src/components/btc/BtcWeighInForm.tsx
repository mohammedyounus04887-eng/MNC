/**
 * BTC weigh-in entry form — every body composition field a typical
 * smart-scale reports.
 *
 * Weight is the only required field. Everything else is optional so
 * volunteers can fill what the machine showed and leave the rest blank.
 * Arrival time is auto-fetched from the member's reception attendance
 * doc for the same date (`clubs/{clubId}/members/{memberId}/attendance`
 * where `date === session.date`). The volunteer can still override it.
 */

import { useEffect, useState } from "react";
import {
    fetchMemberCheckInTime, saveBtcWeighIn, type BtcWeighInInput,
} from "@/hooks/useBtcChallenges";
import type { BtcChallengeWeighIn, BtcWeighInSession } from "@/types/firestore";

const FONT = "'Nunito', sans-serif";

interface FieldDef {
    key: keyof BtcWeighInInput;
    label: string;
    unit?: string;
    placeholder?: string;
    primary?: boolean;            // shown in the always-visible header
}

// Ordered so the "core" fields are first and the rest collapse into a
// "more fields" section. Order matches user request.
const FIELDS: FieldDef[] = [
    { key: "weight",            label: "Weight",                unit: "kg",      placeholder: "e.g. 65.4", primary: true },
    { key: "bodyFat",           label: "Body fat",              unit: "%",       placeholder: "e.g. 24.5", primary: true },
    { key: "muscleMass",        label: "Muscle mass",           unit: "kg" },
    { key: "skeletalMuscle",    label: "Skeletal muscle",       unit: "kg" },
    { key: "bmr",               label: "BMR",                   unit: "kcal" },
    { key: "bmi",               label: "BMI" },
    { key: "visceralFat",       label: "Visceral fat" },
    { key: "waterPct",          label: "Water",                 unit: "%" },
    { key: "proteinPct",        label: "Protein",               unit: "%" },
    { key: "boneMass",          label: "Bone mass",             unit: "kg" },
    { key: "metabolicAge",      label: "Metabolic age",         unit: "yrs" },
    { key: "leanBodyMass",      label: "Lean body mass",        unit: "kg" },
    { key: "fatFreeBodyWeight", label: "Fat-free weight",       unit: "kg" },
    { key: "subcutaneousFat",   label: "Subcutaneous fat",      unit: "%" },
    { key: "bodyAge",           label: "Body age",              unit: "yrs" },
    { key: "calories",          label: "Calories (TDEE)",       unit: "kcal" },
    { key: "height",            label: "Height",                unit: "cm" },
];

export default function BtcWeighInForm({
    clubId, challengeId, memberId, session, existing,
    onSaved, expanded: initialExpanded = false,
}: {
    clubId: string;
    challengeId: string;
    memberId: string;
    session: BtcWeighInSession;
    existing?: BtcChallengeWeighIn;
    onSaved?: () => void;
    expanded?: boolean;
}) {
    const initialValues: Record<string, string> = {};
    for (const f of FIELDS) {
        const v = (existing as any)?.[f.key];
        initialValues[f.key] = (v === null || v === undefined) ? "" : String(v);
    }

    const [values, setValues] = useState<Record<string, string>>(initialValues);
    const [time, setTime] = useState<string>(existing?.recordedAtTime || "");
    const [autoTime, setAutoTime] = useState<string | null>(null);
    const [timeManuallyEdited, setTimeManuallyEdited] = useState(!!existing?.recordedAtTime);
    const [notes, setNotes] = useState(existing?.notes || "");
    const [showMore, setShowMore] = useState(initialExpanded);
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState("");

    // Auto-fetch arrival time from reception attendance for this session date.
    useEffect(() => {
        let cancel = false;
        (async () => {
            const hit = await fetchMemberCheckInTime(clubId, memberId, session.date);
            if (cancel) return;
            if (hit) {
                setAutoTime(hit.time);
                if (!timeManuallyEdited) setTime(hit.time);
            } else {
                setAutoTime(null);
            }
        })();
        return () => { cancel = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clubId, memberId, session.date]);

    const setField = (k: string, v: string) => setValues(prev => ({ ...prev, [k]: v }));

    const save = async () => {
        setErr("");
        const weight = parseFloat(values.weight);
        if (!weight || weight <= 0) { setErr("Weight is required."); return; }
        const payload: BtcWeighInInput = { weight };
        for (const f of FIELDS) {
            if (f.key === "weight") continue;
            const v = values[f.key];
            (payload as any)[f.key] = v === "" ? null : parseFloat(v);
        }
        payload.recordedAtTime = time || "";
        payload.autoFilledFromAttendance = !timeManuallyEdited && !!autoTime && time === autoTime;
        payload.notes = notes || "";

        setBusy(true);
        try {
            await saveBtcWeighIn(clubId, challengeId, memberId, session.index, payload);
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
            onSaved?.();
        } catch (e: any) {
            setErr(e?.message || "Could not save weigh-in.");
        } finally {
            setBusy(false);
        }
    };

    const primaryFields = FIELDS.filter(f => f.primary);
    const moreFields = FIELDS.filter(f => !f.primary);

    return (
        <div style={{ padding: 14, background: "#f8fafc", borderRadius: 12, border: existing ? "1.5px solid #16a34a" : "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>Session #{session.index + 1}</div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>{formatDate(session.date)} · {session.time}</div>
            </div>

            {/* Primary row — weight + body fat + arrival time */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                {primaryFields.map(f => (
                    <FieldInput key={f.key} field={f} value={values[f.key]} onChange={v => setField(f.key, v)} />
                ))}
                <div>
                    <div style={miniLabel}>
                        Arrival time
                        {autoTime && !timeManuallyEdited && (
                            <span style={{ marginLeft: 6, color: "#16a34a", fontSize: 9, fontWeight: 800 }}>· auto</span>
                        )}
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                        <input
                            type="time"
                            value={time}
                            onChange={e => { setTime(e.target.value); setTimeManuallyEdited(true); }}
                            placeholder="HH:MM"
                            style={miniInput}
                        />
                        {timeManuallyEdited && autoTime && (
                            <button
                                type="button"
                                onClick={() => { setTime(autoTime); setTimeManuallyEdited(false); }}
                                style={{ ...iconBtn, fontSize: 10, padding: "4px 6px" }}
                                title="Re-sync from reception"
                            >↺</button>
                        )}
                    </div>
                    {!autoTime && (
                        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2, fontWeight: 700 }}>No check-in found for this date</div>
                    )}
                </div>
            </div>

            {/* Show / hide more */}
            <button
                type="button"
                onClick={() => setShowMore(v => !v)}
                style={{ background: "transparent", border: "none", color: "#0f172a", fontSize: 12, fontWeight: 800, cursor: "pointer", padding: 0, fontFamily: FONT, marginBottom: showMore ? 10 : 0 }}
            >
                {showMore ? "▾ Hide extra body composition fields" : `▸ + ${moreFields.length} more body composition fields`}
            </button>

            {showMore && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 10 }}>
                    {moreFields.map(f => (
                        <FieldInput key={f.key} field={f} value={values[f.key]} onChange={v => setField(f.key, v)} />
                    ))}
                    <div style={{ gridColumn: "1 / -1" }}>
                        <div style={miniLabel}>Notes</div>
                        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" style={miniInput} />
                    </div>
                </div>
            )}

            {err && <div style={{ padding: 8, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{err}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={save} disabled={busy || !values.weight} style={{ ...primaryBtn, opacity: (!values.weight || busy) ? 0.6 : 1 }}>
                    {saved ? "✓ Saved" : busy ? "Saving…" : (existing ? "Update" : "Save")}
                </button>
            </div>
        </div>
    );
}

function FieldInput({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <div style={miniLabel}>
                {field.label}{field.unit && <span style={{ color: "#94a3b8", marginLeft: 4, fontWeight: 700 }}>({field.unit})</span>}
            </div>
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={field.placeholder || "—"}
                inputMode="decimal"
                style={miniInput}
            />
        </div>
    );
}

function formatDate(ymd: string): string {
    if (!ymd) return "—";
    try {
        const [y, m, d] = ymd.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    } catch { return ymd; }
}

const miniLabel: React.CSSProperties = { fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 4, fontFamily: FONT };
const miniInput: React.CSSProperties = { padding: 8, border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: FONT, boxSizing: "border-box", width: "100%", background: "white" };
const iconBtn: React.CSSProperties = { background: "white", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 8px", cursor: "pointer", fontWeight: 800, color: "#475569", fontFamily: FONT };
const primaryBtn: React.CSSProperties = { padding: "10px 18px", background: "linear-gradient(135deg,#16a34a,#15803d)", color: "white", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
