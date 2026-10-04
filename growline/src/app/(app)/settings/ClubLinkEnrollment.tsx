"use client";

import { useEffect, useState } from "react";
import { parseClubEnrollment } from "@/lib/integration/experience";

type LinkedClub = { linkId: string; clubName: string; status: string; activitySharingEnabled: boolean };
type LinkedClubs = { links?: LinkedClub[]; active?: boolean; clubUrl?: string | null };
async function fetchLinks(): Promise<LinkedClubs> {
  const response = await fetch("/api/integration/links/redeem", { cache: "no-store" });
  if (!response.ok) throw new Error("LINKS_UNAVAILABLE");
  return response.json();
}

export default function ClubLinkEnrollment() {
  const [legacyClubId, setLegacyClubId] = useState("");
  const [code, setCode] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [linkedClubs, setLinkedClubs] = useState<LinkedClub[]>([]);
  const [available, setAvailable] = useState(false);
  const [clubUrl, setClubUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refreshLinks() {
    const result = await fetchLinks();
    setLinkedClubs(result.links ?? []);
    setAvailable(result.active === true);
    setClubUrl(result.clubUrl ?? null);
  }

  useEffect(() => {
    let alive = true;
    void fetchLinks().then((result) => {
      if (!alive) return;
      setLinkedClubs(result.links ?? []); setAvailable(result.active === true); setClubUrl(result.clubUrl ?? null);
    }).catch(() => { if (alive) setMessage("Linked Clubs are unavailable. Check your connection and refresh."); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  async function redeem() {
    const enrollment = parseClubEnrollment(code, legacyClubId);
    if (!enrollment || busy) return;
    setBusy(true); setMessage("");
    const idempotencyKey = key || crypto.randomUUID();
    setKey(idempotencyKey);
    try {
      const response = await fetch("/api/integration/links/redeem", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...enrollment, idempotencyKey }),
      });
      const result = await response.json() as { status?: string };
      if (result.status === "active") {
        setMessage("Club linked. Move a prospect to Member, then use Add to Club.");
        setCode(""); setKey(""); await refreshLinks();
      } else setMessage(response.status === 202 ? "Waiting for the Club. Retry with the same code." : "This code could not be redeemed. Ask the Club owner for a new code if it has expired or been used.");
    } catch { setMessage("Waiting for the Club. Retry with the same code."); }
    finally { setBusy(false); }
  }

  async function revoke(linkId: string) {
    if (busy || !window.confirm("Unlink this Club? New transfers and owner activity sharing will stop. Existing Club memberships remain.")) return;
    setBusy(true); setMessage("");
    const storageKey = `growline-club-revoke:${linkId}`;
    const idempotencyKey = localStorage.getItem(storageKey) ?? crypto.randomUUID();
    localStorage.setItem(storageKey, idempotencyKey);
    try {
      const response = await fetch("/api/integration/links/revoke", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkId, idempotencyKey }),
      });
      const result = await response.json() as { status?: string };
      setMessage(result.status === "revoked" ? "Club unlinked. Existing Club memberships remain." : "Unlinking is pending. Retry when the connection is available.");
      if (result.status === "revoked") localStorage.removeItem(storageKey);
      await refreshLinks();
    } catch { setMessage("Unlinking is pending. The link is paused while the Club confirms it."); }
    finally { setBusy(false); }
  }

  async function share(club: LinkedClub, enabled: boolean) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/integration/club-activity", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkId: club.linkId, activitySharingEnabled: enabled }),
      });
      if (!response.ok) throw new Error("SHARING_UNAVAILABLE");
      await refreshLinks();
      setMessage(enabled ? "Your profile name and aggregate activity are approved for this Club owner." : "Activity sharing withdrawn.");
    } catch { setMessage("Activity sharing could not be updated. Check the link and try again."); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl bg-surface p-5">
    <h2 className="font-semibold">Linked Clubs</h2>
    <p className="mt-1 text-sm text-text-dim">Paste the one-time code from your Club owner. Linking does not transfer prospects or grant access to Club administration.</p>
    {linkedClubs.map((club) => <div key={club.linkId} className="mt-3 rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{club.clubName} · {club.status === "revoking" ? "unlinking" : club.status === "revoked" ? "unlinked" : "linked"}</span>
        {club.status !== "revoked" && <button disabled={busy} className="text-sm font-medium text-heat disabled:opacity-50" onClick={() => void revoke(club.linkId)}>{club.status === "revoking" ? "Retry unlink" : "Unlink"}</button>}
      </div>
      {club.status === "active" && <label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" disabled={busy} checked={club.activitySharingEnabled} onChange={(event) => void share(club, event.target.checked)} /><span>Allow this Club owner to see my profile name and counts of days logged, people met and reported new members. Prospect names, contacts, notes, reports and health data stay private.</span></label>}
    </div>)}
    {!loaded ? <p className="mt-3 text-sm text-text-dim">Checking linked Clubs…</p> : !available && <p className="mt-3 text-sm text-text-dim">New Club linking is currently unavailable.</p>}
    <label className="mt-3 block text-sm">One-time Club code<input className="mt-1 h-12 w-full rounded-xl border border-hairline bg-elevated px-4" value={code} onChange={(event) => { setCode(event.target.value); setKey(""); }} autoComplete="off" maxLength={2048} /></label>
    {code.trim() && !code.trim().startsWith("GL1.") && <label className="mt-3 block text-sm">Club ID for an older code<input className="mt-1 h-12 w-full rounded-xl border border-hairline bg-elevated px-4" value={legacyClubId} onChange={(event) => { setLegacyClubId(event.target.value); setKey(""); }} maxLength={128} /></label>}
    <button className="mt-4 h-12 rounded-xl border border-hairline px-4 font-semibold disabled:opacity-50" disabled={busy || !available || !parseClubEnrollment(code, legacyClubId)} onClick={() => void redeem()}>{busy ? "Please wait…" : "Link Club"}</button>
    {clubUrl && <a className="ml-4 text-sm underline" href={clubUrl} target="_blank" rel="noopener noreferrer">Open Club</a>}
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
  </section>;
}
