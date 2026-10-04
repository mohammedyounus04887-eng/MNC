import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClubContext } from "@/lib/clubDetection";

export default function GrowLineIntegrationPanel() {
    const { firebaseUser } = useAuth();
    const { club } = useClubContext();
    const clubId = club?.id;
    const actorUid = firebaseUser?.uid;
    const [code, setCode] = useState("");
    const [expiresAt, setExpiresAt] = useState("");
    const [codeId, setCodeId] = useState("");
    const [now, setNow] = useState(Date.now());
    const [links, setLinks] = useState<Array<{ linkId: string; status: string; linkedAt: string | null }>>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const loadLinks = useCallback(async (next?: string) => {
        if (!clubId || !actorUid) return;
        try {
            const response = await httpsCallable<{ clubId: string; cursor?: string }, { links: typeof links; nextCursor: string | null }>(getFunctions(), "listGrowlineClubLinks")({ clubId, ...(next ? { cursor: next } : {}) });
            setLinks((values) => next ? [...values, ...response.data.links] : response.data.links);
            setCursor(response.data.nextCursor);
        } catch { setError("Could not load linked coaches. Use a verified owner or administrator account."); }
    }, [clubId, actorUid]);
    useEffect(() => { void loadLinks(); }, [loadLinks]);
    useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer); }, []);

    const revoke = async (kind: "code" | "link", targetId: string) => {
        if (!club || !firebaseUser) return;
        setBusy(true);
        setError("");
        try {
            await httpsCallable(getFunctions(), "revokeGrowlineOwnerLinkOrCode")({ clubId: club.id, kind, targetId });
            if (kind === "code") { setCode(""); setCodeId(""); }
            await loadLinks();
        } catch { setError("Could not revoke the selected code or coach. Please try again."); }
        finally { setBusy(false); }
    };

    const issueCode = async () => {
        if (!firebaseUser || !club) return;
        setBusy(true);
        setError("");
        setCode("");
        try {
            const issue = httpsCallable<{ clubId: string }, { code: string; codeId: string; expiresAt: string }>(getFunctions(), "issueGrowlineClubCode");
            const response = await issue({ clubId: club.id });
            const result = response.data;
            if (!result.code || !result.expiresAt) throw new Error("Could not issue the one-time code.");
            setCode(`GL1.${btoa(JSON.stringify({ clubId: club.id, code: result.code })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`);
            setCodeId(result.codeId);
            setExpiresAt(result.expiresAt);
        } catch (issueError) {
            setError(issueError instanceof Error ? issueError.message : "Could not issue the one-time code.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="max-w-2xl space-y-4 rounded-2xl border bg-white p-6">
            <div>
                <h3 className="font-bold text-slate-900">Link GrowLine</h3>
                <p className="mt-1 text-sm text-muted-foreground">Create a single-use pairing code for the intended GrowLine coach. A new code revokes outstanding codes. Codes expire after 15 minutes and grant no Club role or login access.</p>
            </div>
            <Button onClick={() => void issueCode()} disabled={!club || !firebaseUser || busy}>
                {busy ? "Working…" : code ? "Create new code" : "Issue one-time link code"}
            </Button>
            {code && <div className="space-y-2">
                <Label htmlFor="growline-code">Show this code once</Label>
                <Input id="growline-code" readOnly value={code} onFocus={(event) => event.currentTarget.select()} />
                <p className="text-xs text-muted-foreground">{Date.parse(expiresAt) <= now ? "Expired" : "Expires"} {new Date(expiresAt).toLocaleString()}. Share directly with the intended coach. Never put the code in a public URL.</p>
                <Button size="sm" variant="outline" disabled={busy || Date.parse(expiresAt) <= now} onClick={() => void revoke("code", codeId)}>Revoke this code</Button>
            </div>}
            <div className="space-y-3 border-t pt-4"><div className="flex items-center justify-between gap-2"><h4 className="font-semibold">Coach relationships</h4><Button size="sm" variant="ghost" disabled={busy} onClick={() => void loadLinks()}>Refresh</Button></div>
                {links.length === 0 ? <p className="text-sm text-muted-foreground">No coaches are linked yet.</p> : links.map((link, index) => <div key={link.linkId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><p className="text-sm font-medium">Coach relationship {index + 1} · {link.status === "active" ? "Linked" : "Revoked"}</p><p className="text-xs text-muted-foreground">{link.linkedAt ? `Linked ${new Date(link.linkedAt).toLocaleDateString()}` : "Link date unavailable"}</p></div>{link.status === "active" && <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm("Revoke this coach relationship? New handoffs and owner activity stop; previous successful membership remains.")) void revoke("link", link.linkId); }}>Revoke coach</Button>}</div>)}
                {cursor && <Button size="sm" variant="outline" onClick={() => void loadLinks(cursor)}>More relationships</Button>}
                <p className="text-xs text-muted-foreground">Approved coach names and counts appear on your dashboard. Revocation stops future handoffs and activity; existing members and successful handoff history are preserved.</p>
            </div>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
    );
}
