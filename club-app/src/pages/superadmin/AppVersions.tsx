/**
 * Super Admin — App Versions across every club.
 *
 * The same switch exists inside each club's admin, and that one matters most:
 * if a rebuilt screen misbehaves at seven in the morning, the club has to be
 * able to put it back themselves without phoning anybody. This page is the
 * other half — flipping screens for any club remotely, and seeing at a glance
 * which clubs are running what.
 *
 * Writes `appVersions.<surface>` on the club doc, exactly like the club-side
 * page, so the two can never disagree.
 */

import { useEffect, useState } from "react";
import { collection, deleteField, doc, getDoc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { SURFACES, type Surface, type Version } from "@/lib/appVersion";

const PIN_FIELDS = ["adminPin", "kitchenPin", "receptionPin", "tvPin", "btcPin", "walletPin"] as const;

/**
 * Move a club's PINs off the public club document.
 *
 * The club document has to stay publicly readable — the app works out which
 * club it is from the domain before anyone signs in — so any PIN stored on it
 * can be read by anybody who knows the club id, without logging in.
 *
 * This copies them to clubs/{id}/security/pins, which requires a session, and
 * then removes them from the public document. The app already reads the secure
 * copy first and falls back to the old field, so this is safe to run at any
 * time; the only visible effect is that the PINs stop being public.
 */
async function securePins(clubId: string): Promise<{ moved: string[]; alreadyDone: boolean }> {
    const clubRef = doc(db, "clubs", clubId);
    const snap = await getDoc(clubRef);
    if (!snap.exists()) return { moved: [], alreadyDone: true };
    const data = snap.data() as any;

    const present = PIN_FIELDS.filter(f => data?.[f] != null && data[f] !== "");
    if (present.length === 0) return { moved: [], alreadyDone: true };

    // Copy first, and only remove once the copy is safely written — otherwise a
    // failure halfway through would lock everybody out of the club.
    const payload: Record<string, any> = { migratedAt: new Date().toISOString() };
    present.forEach(f => { payload[f] = String(data[f]).trim(); });
    await setDoc(doc(db, "clubs", clubId, "security", "pins"), payload, { merge: true });

    const verify = await getDoc(doc(db, "clubs", clubId, "security", "pins"));
    const ok = present.every(f => verify.exists() && verify.data()?.[f] === payload[f]);
    if (!ok) throw new Error("Could not verify the private copy — nothing was removed.");

    const clear: Record<string, any> = {};
    present.forEach(f => { clear[f] = deleteField(); });
    await updateDoc(clubRef, clear);

    return { moved: [...present], alreadyDone: false };
}

interface ClubRow {
    id: string;
    name: string;
    versions: Partial<Record<Surface, Version>>;
    raw?: any;
}

function PinSecurity({ clubId, exposed }: { clubId: string; exposed: string[] }) {
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState("");

    if (exposed.length === 0 && !msg) {
        return (
            <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                🔒 PINs are private — not readable without signing in.
            </div>
        );
    }

    return (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
            <div className="text-xs font-black text-red-800 dark:text-red-300">
                ⚠ {exposed.length} PIN{exposed.length === 1 ? "" : "s"} readable by anyone
            </div>
            <div className="mt-1 text-xs text-red-700 dark:text-red-400">
                {exposed.join(", ")} are stored on the club record, which has to stay public so the app can
                tell which club it is. Moving them to private storage takes a second and changes nothing
                anyone will notice.
            </div>
            {msg && <div className="mt-2 text-xs font-bold text-emerald-700 dark:text-emerald-400">{msg}</div>}
            <button
                disabled={busy}
                onClick={async () => {
                    setBusy(true); setMsg("");
                    try {
                        const r = await securePins(clubId);
                        setMsg(r.alreadyDone ? "Already private." : `Moved ${r.moved.length} PIN(s) to private storage.`);
                    } catch (e: any) {
                        setMsg(e?.message || "Could not move the PINs — nothing was changed.");
                    } finally {
                        setBusy(false);
                    }
                }}
                className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
            >
                {busy ? "Moving…" : "Make PINs private"}
            </button>
        </div>
    );
}

export default function SuperAdminAppVersions() {
    const [clubs, setClubs] = useState<ClubRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [err, setErr] = useState("");

    useEffect(() => {
        const unsub = onSnapshot(
            collection(db, "clubs"),
            snap => {
                setClubs(
                    snap.docs
                        .map(d => {
                            const data = d.data() as any;
                            return {
                                id: d.id,
                                name: data?.name || d.id,
                                versions: (data?.appVersions ?? {}) as Partial<Record<Surface, Version>>,
                                raw: data,
                            };
                        })
                        .sort((a, b) => a.name.localeCompare(b.name)),
                );
                setLoading(false);
            },
            e => {
                setErr(e.message);
                setLoading(false);
            },
        );
        return unsub;
    }, []);

    const flip = async (clubId: string, surface: Surface, v: Version) => {
        setBusy(`${clubId}:${surface}`);
        setErr("");
        try {
            await updateDoc(doc(db, "clubs", clubId), { [`appVersions.${surface}`]: v });
        } catch (e: any) {
            setErr(e?.message || "Could not save.");
        } finally {
            setBusy(null);
        }
    };

    if (loading) return <div className="p-8 text-sm text-slate-500">Loading clubs…</div>;

    return (
        <div className="p-4 sm:p-6">
            <h1 className="mb-1 text-2xl font-black tracking-tight">App Versions</h1>
            <p className="mb-6 max-w-2xl text-sm text-slate-500">
                Switch any club between the existing screens and the rebuilt ones. Both read the same data,
                so switching either way loses nothing and takes a few seconds to reach every device. Each
                club can also switch itself back from its own admin.
            </p>

            {err && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                    {err}
                </div>
            )}

            <div className="grid gap-4">
                {clubs.map(club => (
                    <div key={club.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-3 flex flex-wrap items-baseline gap-2">
                            <div className="text-base font-black">{club.name}</div>
                            <div className="text-xs text-slate-400">{club.id}</div>
                            {SURFACES.some(s => club.versions[s.key] === "new") && (
                                <span className="ml-auto rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                    running new screens
                                </span>
                            )}
                        </div>

                        <PinSecurity clubId={club.id} exposed={PIN_FIELDS.filter(f => (club as any).raw?.[f])} />

                        <div className="grid gap-2 sm:grid-cols-2">
                            {SURFACES.map(s => {
                                const cur: Version = club.versions[s.key] === "new" ? "new" : "old";
                                const isBusy = busy === `${club.id}:${s.key}`;
                                return (
                                    <div
                                        key={s.key}
                                        className="flex items-center gap-3 rounded-xl border border-slate-100 p-2.5 dark:border-slate-800"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-bold">{s.label}</div>
                                            <div className="truncate text-xs text-slate-400">{s.hint}</div>
                                        </div>
                                        <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
                                            {(["old", "new"] as Version[]).map(v => (
                                                <button
                                                    key={v}
                                                    disabled={isBusy}
                                                    onClick={() => flip(club.id, s.key, v)}
                                                    className={`rounded-md px-3 py-1 text-xs font-black uppercase tracking-wide disabled:opacity-40 ${
                                                        cur === v
                                                            ? v === "new"
                                                                ? "bg-emerald-600 text-white"
                                                                : "bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900"
                                                            : "text-slate-500"
                                                    }`}
                                                >
                                                    {v}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
                {clubs.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-400">
                        No clubs yet.
                    </div>
                )}
            </div>
        </div>
    );
}
