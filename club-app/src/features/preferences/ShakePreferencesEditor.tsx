import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { toast } from "sonner";
import { db } from "@/lib/firebase";
import type { User as Member, Product } from "@/types/firestore";

interface Props {
    clubId: string;
    member: Member;
    // Optional: caller can pass already-loaded menu items to avoid a
    // duplicate Firestore subscription.
    menu?: Product[];
}

// ─── ShakePreferencesEditor ───────────────────────────────────────────
// 7-day grid (Mon-Sun) where admin/receptionist picks a default shake
// per day. Voice "X has arrived" reads this. Empty = no preference,
// falls back to historical analysis.
//
// Reusable across:
//   - admin MemberProfile (as a tab)
//   - reception MemberDetailsPanel (as a collapsible section)

const DAYS: { key: keyof Exclude<Member["shakePreferences"], undefined>; label: string }[] = [
    { key: "monday",    label: "Monday" },
    { key: "tuesday",   label: "Tuesday" },
    { key: "wednesday", label: "Wednesday" },
    { key: "thursday",  label: "Thursday" },
    { key: "friday",    label: "Friday" },
    { key: "saturday",  label: "Saturday" },
    { key: "sunday",    label: "Sunday" },
];

export default function ShakePreferencesEditor({ clubId, member, menu: menuProp }: Props) {
    const [menu, setMenu] = useState<Product[]>(menuProp ?? []);
    const [prefs, setPrefs] = useState<NonNullable<Member["shakePreferences"]>>(member.shakePreferences ?? {});
    const [saving, setSaving] = useState<string | null>(null);   // day key currently saving
    const [savedFlash, setSavedFlash] = useState<string | null>(null);

    // Live menu subscription (if not passed in)
    useEffect(() => {
        if (menuProp) { setMenu(menuProp); return; }
        const unsub = onSnapshot(collection(db, `clubs/${clubId}/menu`), (snap) => {
            const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product);
            items.sort((a, b) => a.name.localeCompare(b.name));
            setMenu(items);
        });
        return () => unsub();
    }, [clubId, menuProp]);

    // Re-sync local state if the member doc changes upstream
    useEffect(() => {
        setPrefs(member.shakePreferences ?? {});
    }, [member.id, member.shakePreferences]);

    const updateDay = async (dayKey: string, productId: string) => {
        setSaving(dayKey);
        const next: NonNullable<Member["shakePreferences"]> = { ...prefs };
        if (!productId) {
            // Clear preference
            delete (next as any)[dayKey];
        } else {
            const product = menu.find((p) => p.id === productId);
            (next as any)[dayKey] = product
                ? { productId: product.id, productName: product.name }
                : null;
        }
        setPrefs(next);
        try {
            await updateDoc(doc(db, `clubs/${clubId}/members`, member.id), {
                shakePreferences: next,
            });
            setSavedFlash(dayKey);
            setTimeout(() => setSavedFlash((cur) => (cur === dayKey ? null : cur)), 1200);
        } catch (err: any) {
            toast.error(`Save failed: ${err?.message ?? "unknown"}`);
        } finally {
            setSaving(null);
        }
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: "Nunito, sans-serif" }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                Pick the shake {member.name?.split(" ")[0] || "this member"} usually wants on each day.
                Magician will auto-order it when they're checked in by voice.
                Leave blank to let history decide.
            </div>
            {DAYS.map((d) => {
                const pref = (prefs as any)[d.key] as { productId: string; productName: string } | null | undefined;
                const isSaving = saving === d.key;
                const justSaved = savedFlash === d.key;
                return (
                    <div key={d.key} style={{
                        display: "grid", gridTemplateColumns: "110px 1fr 80px", alignItems: "center", gap: 10,
                        padding: "8px 10px", borderRadius: 10,
                        background: justSaved ? "#dcfce7" : "#f9fafb",
                        transition: "background 0.3s",
                    }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#374151" }}>{d.label}</div>
                        <select
                            value={pref?.productId ?? ""}
                            onChange={(e) => updateDay(d.key, e.target.value)}
                            disabled={isSaving}
                            style={{
                                padding: "6px 8px", border: "1px solid #d1d5db",
                                borderRadius: 6, fontSize: 13, fontFamily: "inherit",
                                background: "white", minWidth: 0,
                            }}
                        >
                            <option value="">— No preference —</option>
                            {menu.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        <div style={{ fontSize: 11, fontWeight: 700, color: isSaving ? "#6b7280" : justSaved ? "#16a34a" : "transparent", textAlign: "right" }}>
                            {isSaving ? "Saving…" : justSaved ? "✓ Saved" : ""}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
