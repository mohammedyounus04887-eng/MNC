/**
 * App Version — switch each part of the app between the old and new screens.
 *
 * Club-wide switches write to the club doc and reach every device in a few
 * seconds. The per-device switch only affects the browser it is set on, so one
 * tablet can trial the new screens while the rest of the club carries on.
 */

import { useState } from "react";
import { useClubContext } from "@/lib/clubDetection";
import {
    SURFACES,
    setClubVersion,
    setDeviceOverride,
    getDeviceOverride,
    useAppVersion,
    type Surface,
    type Version,
} from "@/lib/appVersion";

export default function AppVersionPage() {
    const { club } = useClubContext();
    const [busy, setBusy] = useState<Surface | null>(null);
    const [err, setErr] = useState("");

    return (
        <div className="p-4 sm:p-6">
            <div className="mb-1 text-xl font-black tracking-tight text-slate-900 dark:text-slate-100">
                App Version
            </div>
            <p className="mb-6 max-w-2xl text-sm text-slate-500">
                Switch any part of the app between the old and new screens. Both use the same members,
                payments and attendance — nothing is lost either way, and you can switch back at any time.
            </p>

            {err && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                    {err}
                </div>
            )}

            <div className="grid gap-3">
                {SURFACES.map(s => (
                    <SurfaceRow
                        key={s.key}
                        surface={s.key}
                        label={s.label}
                        hint={s.hint}
                        busy={busy === s.key}
                        onClub={async (v) => {
                            if (!club?.id) return;
                            setBusy(s.key);
                            setErr("");
                            try {
                                await setClubVersion(club.id, s.key, v);
                            } catch (e: any) {
                                setErr(e?.message || "Could not save. Check your connection and try again.");
                            } finally {
                                setBusy(null);
                            }
                        }}
                    />
                ))}
            </div>

            <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                <div className="mb-1 font-black text-slate-900 dark:text-slate-100">If something goes wrong</div>
                Switch that part back to <b>Old</b> here — it takes a few seconds and needs nobody's help.
                If the whole app is unreachable, the previous version can be restored from the Firebase
                console under Hosting → Release history.
            </div>
        </div>
    );
}

function SurfaceRow({
    surface, label, hint, busy, onClub,
}: {
    surface: Surface; label: string; hint: string; busy: boolean; onClub: (v: Version) => void;
}) {
    const { version, source, clubVersion } = useAppVersion(surface, { watchClub: true });
    const [, force] = useState(0);
    const override = getDeviceOverride(surface);

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[150px] flex-1">
                    <div className="font-black tracking-tight">{label}</div>
                    <div className="text-xs text-slate-500">{hint}</div>
                </div>

                <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
                    {(["old", "new"] as Version[]).map(v => (
                        <button
                            key={v}
                            disabled={busy}
                            onClick={() => onClub(v)}
                            className={`rounded-md px-4 py-1.5 text-xs font-black uppercase tracking-wide transition disabled:opacity-40 ${
                                clubVersion === v
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

                <div className="min-w-[120px] text-right text-xs font-bold">
                    {source === "device" ? (
                        <span className="text-amber-600">This device: {version}</span>
                    ) : version === "new" ? (
                        <span className="text-emerald-600">Everyone: new</span>
                    ) : (
                        <span className="text-slate-400">Everyone: old</span>
                    )}
                </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    This device only
                </span>
                {(["old", "new"] as Version[]).map(v => (
                    <button
                        key={v}
                        onClick={() => { setDeviceOverride(surface, v); force(n => n + 1); }}
                        className={`rounded-lg border px-3 py-1 text-xs font-bold ${
                            override === v
                                ? "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950"
                                : "border-slate-200 text-slate-500 dark:border-slate-700"
                        }`}
                    >
                        Use {v}
                    </button>
                ))}
                {override && (
                    <button
                        onClick={() => { setDeviceOverride(surface, null); force(n => n + 1); }}
                        className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-bold text-slate-500 dark:border-slate-700"
                    >
                        Follow the club setting
                    </button>
                )}
            </div>
        </div>
    );
}
