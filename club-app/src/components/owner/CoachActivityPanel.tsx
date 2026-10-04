import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useClubContext } from "@/lib/clubDetection";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type Counts = { logs: number; peopleMet: number; membersConverted: number };
type ActivityPage = { coaches: Array<Counts & { displayName: string }>; totals: Counts; nextCursor: string | null; from: string; to: string };
function coachActivityPeriod(days: number, now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const to = ["year", "month", "day"].map((part) => parts.find((entry) => entry.type === part)?.value).join("-");
    return { from: new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10), to };
}

export default function CoachActivityPanel() {
    const { club } = useClubContext();
    const { firebaseUser } = useAuth();
    const [days, setDays] = useState(7);
    const [cursors, setCursors] = useState<string[]>([]);
    const period = coachActivityPeriod(days);
    const cursor = cursors[cursors.length - 1];
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ["owner", "growline-activity", club?.id, period.from, period.to, cursor],
        enabled: !!club?.id && !!firebaseUser,
        retry: false,
        queryFn: async () => (await httpsCallable<{ clubId: string; from: string; to: string; cursor?: string }, ActivityPage>(getFunctions(), "getGrowlineOwnerActivity")({ clubId: club!.id, ...period, ...(cursor ? { cursor } : {}) })).data,
    });
    const forbidden = error !== null && typeof error === "object" && "code" in error && error.code === "functions/permission-denied";
    return <section className="space-y-4 rounded-2xl border bg-card p-5" aria-label="Coach activity">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-bold">Your GrowLine coaches</h2><p className="mt-1 text-sm text-muted-foreground">Approved activity counts from coaches linked to this Club.</p></div>
            <div className="flex flex-wrap gap-2" aria-label="Coach activity period">
                {[[1, "Today"], [7, "7 days"], [30, "30 days"]].map(([value, label]) => <Button key={value} size="sm" variant={days === value ? "default" : "outline"} onClick={() => { setDays(Number(value)); setCursors([]); }}>{label}</Button>)}
            </div>
        </div>
        {!firebaseUser ? <p className="text-sm text-muted-foreground">Sign in with your verified Club owner or administrator account to view coach activity.</p>
            : isLoading ? <div className="space-y-3" aria-label="Loading coach activity"><Skeleton className="h-14 w-full" /><Skeleton className="h-20 w-full" /></div>
            : error ? <div role="alert" className="space-y-2 text-sm"><p>{forbidden ? "Your account does not have permission to view this Club’s coach activity." : "Coach activity is unavailable. Club operations remain available."}</p><Button size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button></div>
            : data && <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {[["Days logged", data.totals.logs], ["People met", data.totals.peopleMet], ["Reported new members", data.totals.membersConverted]].map(([label, value]) => <div key={label} className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}
                </div>
                {data.coaches.length === 0 ? <p className="text-sm text-muted-foreground">No coaches on this page have approved activity sharing. Linked coaches can approve it in GrowLine Settings.</p>
                    : <div className="space-y-2">{data.coaches.map((coach, index) => <article key={`${coach.displayName}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"><h3 className="font-semibold">{coach.displayName}</h3><p className="text-sm text-muted-foreground">{coach.logs} days logged · {coach.peopleMet} people met · {coach.membersConverted} reported new members</p></article>)}</div>}
                <p className="text-xs text-muted-foreground">{data.from} to {data.to}, India calendar days. Counts cover this roster page. People met counts newly captured prospects; new members are coach-reported daily-log totals. Legacy activity without a workspace is excluded. Private notes, prospect details and health data are never shared here.</p>
                <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={cursors.length === 0} onClick={() => setCursors((values) => values.slice(0, -1))}>Previous coaches</Button><Button size="sm" variant="outline" disabled={!data.nextCursor} onClick={() => { if (data.nextCursor) setCursors((values) => [...values, data.nextCursor!]); }}>More coaches</Button><Button size="sm" variant="ghost" onClick={() => void refetch()}>Refresh</Button></div>
            </>}
    </section>;
}
