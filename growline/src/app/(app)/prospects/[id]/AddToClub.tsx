"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { handoffMessage } from "@/lib/integration/experience";

type LinkChoice = { linkId: string; clubId: string; clubName: string };
type SavedHandoff = { status: string; linkId?: string; clubId?: string; idempotencyKey?: string; canRetry: boolean };
type IntegrationOptions = { active: boolean; consentText: string; consentVersion: string; clubs: LinkChoice[]; current: SavedHandoff | null; memberEligible: boolean; clubUrl?: string | null };
async function fetchOptions(prospectId: string): Promise<IntegrationOptions> {
  const response = await fetch(`/api/integration/handoffs?prospectId=${encodeURIComponent(prospectId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("HANDOFF_UNAVAILABLE");
  return response.json();
}

export default function AddToClub({ prospectId }: { prospectId: string }) {
  const [options, setOptions] = useState<IntegrationOptions | null>(null);
  const [linkId, setLinkId] = useState("");
  const [consent, setConsent] = useState(false);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const result = await fetchOptions(prospectId);
    setOptions(result);
    if (result.current?.linkId) setLinkId(result.current.linkId);
    if (result.current?.idempotencyKey) setKey(result.current.idempotencyKey);
    return result;
  }

  useEffect(() => {
    let alive = true;
    void fetchOptions(prospectId).then((result) => {
      if (!alive) return;
      setOptions(result); setLinkId(result.current?.linkId ?? ""); setKey(result.current?.idempotencyKey ?? "");
    }).catch(() => { if (alive) setMessage("Club transfer status is unavailable. Refresh when your connection returns."); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [prospectId]);

  async function submit() {
    const current = options?.current;
    const selected = options?.clubs.find((club) => club.linkId === linkId) ?? (current?.linkId && current.clubId ? { linkId: current.linkId, clubId: current.clubId } : null);
    if (!selected || !options?.active || busy || (current ? !current.canRetry : !consent || !options.memberEligible)) return;
    setBusy(true); setMessage("");
    const idempotencyKey = current?.idempotencyKey || key || localStorage.getItem(`growline-club-handoff:${prospectId}:${selected.linkId}`) || crypto.randomUUID();
    setKey(idempotencyKey);
    localStorage.setItem(`growline-club-handoff:${prospectId}:${selected.linkId}`, idempotencyKey);
    try {
      const response = await fetch("/api/integration/handoffs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prospectId, clubId: selected.clubId, linkId: selected.linkId, consentGiven: true, consentVersion: options.consentVersion, idempotencyKey }),
      });
      const result = await response.json() as { status?: string; error?: string };
      setMessage(handoffMessage(result.status, result.error));
      if (result.status === "SUCCEEDED") localStorage.removeItem(`growline-club-handoff:${prospectId}:${selected.linkId}`);
      await refresh();
    } catch { setMessage("Waiting for the Club to confirm. Refresh or retry safely to check the same transfer."); }
    finally { setBusy(false); }
  }

  const current = options?.current;
  return <section className="rounded-2xl bg-surface p-5">
    <h2 className="font-semibold">Add to Club</h2>
    {!loaded ? <p className="mt-2 text-sm text-text-dim">Checking transfer status…</p> : <>
      {current && <p className="mt-3 text-sm" role="status">{handoffMessage(current.status)}</p>}
      {current?.status === "SUCCEEDED" && options?.clubUrl && <a className="mt-3 inline-block text-sm underline" href={options.clubUrl} target="_blank" rel="noopener noreferrer">Open Club</a>}
      {!current && !options?.active && <p className="mt-2 text-sm text-text-dim">Club transfer is currently unavailable.</p>}
      {!current && options?.active && !options.memberEligible && <p className="mt-2 text-sm text-text-dim">Move this person to Member before adding them to Club.</p>}
      {!current && options?.active && options.memberEligible && (options.clubs.length === 0 ? <p className="mt-2 text-sm text-text-dim"><Link href="/settings" className="underline">Link a Club in Settings</Link> to continue.</p> : <>
        <label className="mt-3 block text-sm">Club<select className="mt-1 w-full rounded-lg border border-line bg-background p-3" value={linkId} disabled={busy} onChange={(event) => { const value = event.target.value; setLinkId(value); setConsent(false); setKey(value ? localStorage.getItem(`growline-club-handoff:${prospectId}:${value}`) ?? "" : ""); }}><option value="">Choose a linked Club</option>{options.clubs.map((club) => <option key={club.linkId} value={club.linkId}>{club.clubName}</option>)}</select></label>
        <label className="mt-4 flex items-start gap-3 text-sm leading-snug"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} /><span>{options.consentText}</span></label>
        <button className="mt-4 rounded-lg bg-gold-ink px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={!linkId || !consent || busy} onClick={() => void submit()}>{busy ? "Sending…" : "Add to Club"}</button>
      </>)}
      {current?.status === "PENDING" && <div className="mt-3 flex flex-wrap gap-3"><button className="rounded-lg border border-line px-4 py-3 disabled:opacity-50" disabled={busy} onClick={() => void refresh().catch(() => setMessage("Transfer status is unavailable. Try again when connected."))}>Refresh status</button>{options?.active && current.canRetry && <button className="rounded-lg bg-gold-ink px-4 py-3 text-white disabled:opacity-50" disabled={busy} onClick={() => void submit()}>{busy ? "Checking…" : "Retry safely"}</button>}{!current.canRetry && <p className="text-sm text-text-dim">The retry limit has been reached. Ask the Club administrator to reconcile this transfer.</p>}</div>}
    </>}
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
  </section>;
}
