import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface LogEntry {
    id: string;
    timestamp?: any;
    receptionistName?: string;
    rawTranscript: string;
    parsedCount: number;
    parsed: Array<{
        memberIdSpoken?: string;
        memberMatchedId?: string | null;
        memberMatchedCode?: string | null;
        action: string;
        itemName?: string | null;
        status: string;
    }>;
    confirmedCount: number;
    skippedCount?: number;
}

// ─── MagicianLogsPage ─────────────────────────────────────────────────
// Owner-facing review of every voice session. Useful for:
//   - Spotting transcripts that failed to parse (parsedCount = 0)
//   - Sessions where the receptionist removed rows before submitting
//     (confirmedCount < parsedCount)
//   - Finding new phrasings to feed back into the rule-based parser
//
// Reads clubs/{clubId}/magicianLogs in realtime, newest first.

export default function MagicianLogsPage() {
    const { club } = useClubContext();
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!club?.id) return;
        const unsub = onSnapshot(
            query(
                collection(db, `clubs/${club.id}/magicianLogs`),
                orderBy("timestamp", "desc"),
                limit(200),
            ),
            (snap) => {
                setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LogEntry));
                setLoading(false);
            },
            () => setLoading(false),
        );
        return () => unsub();
    }, [club?.id]);

    const failures = logs.filter((l) => l.parsedCount === 0);
    const partial = logs.filter((l) => l.parsedCount > 0 && (l.confirmedCount ?? 0) < l.parsedCount);

    if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-black flex items-center gap-2">
                    🪄 Magician Voice Sessions
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Every voice command logged. Use this to find phrasings that didn't parse and feed them back to improve the rules.
                </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <StatCard label="Total sessions" value={logs.length} color="bg-violet-50 text-violet-700" />
                <StatCard label="Failed to parse" value={failures.length} color="bg-rose-50 text-rose-700" />
                <StatCard label="Partial confirms" value={partial.length} color="bg-amber-50 text-amber-700" />
            </div>

            {logs.length === 0 ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                    No voice sessions yet. The first time the receptionist uses Magician, it'll show up here.
                </Card>
            ) : (
                <div className="space-y-3">
                    {logs.map((log) => (
                        <Card key={log.id} className="p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="text-xs text-muted-foreground">
                                    {log.timestamp?.toDate?.()?.toLocaleString("en-IN") ?? "—"}
                                    {log.receptionistName && <> · {log.receptionistName}</>}
                                </div>
                                <div className="flex gap-1.5">
                                    {log.parsedCount === 0 && (
                                        <Badge className="bg-rose-100 text-rose-700 border-rose-200">parse failed</Badge>
                                    )}
                                    {log.parsedCount > 0 && (
                                        <Badge variant="outline">
                                            {log.confirmedCount}/{log.parsedCount} confirmed
                                        </Badge>
                                    )}
                                </div>
                            </div>

                            <div className="bg-slate-900 text-slate-100 px-3 py-2 rounded text-xs font-mono leading-relaxed">
                                "{log.rawTranscript || "(empty)"}"
                            </div>

                            {log.parsed && log.parsed.length > 0 && (
                                <div className="space-y-1">
                                    {log.parsed.map((p, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs">
                                            <Badge variant="outline" className={
                                                p.status === "ready" ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                                : "bg-amber-50 border-amber-200 text-amber-700"
                                            }>{p.status}</Badge>
                                            <span className="font-bold capitalize">{p.action.replace(/_/g, " ")}</span>
                                            <span className="text-slate-500">·</span>
                                            <span className="font-medium">{p.memberMatchedCode ?? p.memberIdSpoken ?? "—"}</span>
                                            {p.itemName && (
                                                <>
                                                    <span className="text-slate-500">·</span>
                                                    <span className="text-slate-600">{p.itemName}</span>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className={`rounded-2xl p-4 ${color}`}>
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
            <div className="text-3xl font-black mt-1">{value}</div>
        </div>
    );
}
