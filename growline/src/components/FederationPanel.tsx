"use client";
import { useEffect, useRef, useState } from "react";
import { EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, signInWithCustomToken, signOut, type Auth } from "firebase/auth";

type Result = Record<string, unknown>;
type Props = { destinationClubId?: string; app: "club" | "growline"; getAuth: () => Auth; endpoint: string; onSignedIn: (idToken: string) => Promise<void> };
const object = (raw: unknown): Result => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Unexpected response. Please restart sign-in.");
  return raw as Result;
};
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
const digest = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Existing accounts only. Tokens/passwords never go to the other project's browser or URLs. */
export default function FederationPanel({ app, getAuth, endpoint, onSignedIn, destinationClubId }: Props) {
  const [uid, setUid] = useState<string | null>(null), [status, setStatus] = useState<Result>({}), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [password, setPassword] = useState(""), [confirmed, setConfirmed] = useState(false), [linkId, setLinkId] = useState("");
  const [requestId, setRequestId] = useState(""), [proposalId, setProposalId] = useState("");
  const [proposalReview, setProposalReview] = useState<Result>({});
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestId(params.get("request") ?? ""); setProposalId(params.get("proposal") ?? "");
    const unsubscribe = onAuthStateChanged(getAuth(), user => { setUid(user?.uid ?? null); setStatus({}); setProposalReview({}); setConfirmed(false); });
    return () => { unsubscribe(); cleanup.current?.(); };
  }, [getAuth]);
  async function api(operation: string, payload: Result = {}) {
    const user = getAuth().currentUser;
    const token = user ? await user.getIdToken() : null;
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ operation, payload }), redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(response.status === 404 ? "One login is not enabled in this environment." : "Could not complete this request. Check fresh sign-in, Club membership and account pairing.");
    return object(await response.json());
  }
  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed. Please retry."); }
    finally { setBusy(false); }
  }
  async function refresh() { setStatus(await api("status")); }
  const links = Array.isArray(status.links) ? status.links.map(object) : [];
  async function begin() {
    // Open synchronously on the user gesture; browsers may block a popup after an awaited request.
    const popup = window.open("about:blank", "federation-source", "popup,width=620,height=740");
    if (!popup) throw new Error("Allow the sign-in popup and try again.");
    cleanup.current?.();
    const state = random(), verifier = random();
    try {
      const request = await api("begin", { stateHash: await digest(state), codeChallenge: await digest(verifier), ...(app === "club" ? { clubId: destinationClubId } : {}) });
      if (typeof request.sourceUrl !== "string" || typeof request.sourceOrigin !== "string" || typeof request.requestId !== "string" || new URL(request.sourceUrl).origin !== request.sourceOrigin) throw new Error("Invalid sign-in destination.");
      const expectedOrigin = request.sourceOrigin, expectedRequest = request.requestId;
      let consuming = false;
      const listener = (event: MessageEvent<unknown>) => {
        if (event.origin !== expectedOrigin || event.source !== popup || consuming) return;
        const data = event.data;
        if (!data || typeof data !== "object" || !("requestId" in data) || data.requestId !== expectedRequest || !("assertion" in data) || typeof data.assertion !== "string") return;
        consuming = true;
        cleanup.current?.();
        void run(async () => {
          const result = await api("finish", { requestId: expectedRequest, assertion: data.assertion, state, verifier });
          if (typeof result.customToken !== "string") throw new Error("Sign-in could not be completed.");
          // Only the DESTINATION project consumes its own freshly minted custom token.
          const credential = await signInWithCustomToken(getAuth(), result.customToken);
          await onSignedIn(await credential.user.getIdToken());
          popup.close(); setMessage("Signed in to this app with your paired account.");
        });
      };
      window.addEventListener("message", listener);
      const timer = window.setTimeout(() => { cleanup.current?.(); setMessage("Sign-in request expired. Please start again."); }, 300_000);
      cleanup.current = () => { window.removeEventListener("message", listener); window.clearTimeout(timer); cleanup.current = null; };
      popup.location.href = request.sourceUrl;
      setMessage("Confirm sign-in in the other app's popup.");
    } catch (error) { popup.close(); throw error; }
  }
  return <main className="mx-auto max-w-xl space-y-4 p-6">
    <h1 className="text-2xl font-bold">One login for Club and GrowLine</h1>
    <p>Connect your existing accounts after signing in freshly to each app. Your permissions stay separate.</p>
    <p role="status">{message}</p>
    <button disabled={busy || (app === "club" && !destinationClubId)} onClick={() => void run(begin)}>Sign in using my paired account</button>
    {uid ? <>
      <p>Signed in to {app === "club" ? "Club" : "GrowLine"} as {getAuth().currentUser?.email ?? getAuth().currentUser?.phoneNumber ?? uid}. Account ID: {uid}.</p>
      <button disabled={busy} onClick={() => void run(refresh)}>Check paired account</button>
      <p>{status.paired === true ? "Accounts paired." : "Check your pairing status before continuing."}{status.pending === true ? " Cross-app logout delivery is pending." : ""}</p>
      <label className="block">Re-enter this app's password for fresh verification
        <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
      </label>
      <button disabled={busy || !password} onClick={() => void run(async () => {
        const user = getAuth().currentUser;
        if (!user?.email) throw new Error("Use this app's phone sign-in screen, then return here.");
        const value = password; setPassword("");
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, value));
        setMessage("Fresh sign-in verified in this app.");
      })}>Verify this account</button>
      <p>Phone accounts: use this app's normal phone sign-in screen and return here within five minutes.</p>
      <label className="block"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I explicitly agree to pair these existing accounts for sign-in. This grants no additional permissions.</label>
      {app === "growline" && !requestId && <>
        <label>Club relationship<select value={linkId} onChange={event => setLinkId(event.target.value)}><option value="">Choose an active Club</option>{links.map(link => <option key={String(link.linkId)} value={String(link.linkId)}>{String(link.name)}</option>)}</select></label>
        <button disabled={busy || !confirmed || !linkId} onClick={() => void run(async () => {
          const proposal = await api("propose", { linkId, confirm: true });
          if (typeof proposal.destination !== "string") throw new Error("Pairing could not start.");
          window.location.assign(proposal.destination);
        })}>Continue pairing in Club</button>
      </>}
      {app === "club" && proposalId && <>
      <button disabled={busy} onClick={() => void run(async () => { setProposalReview(await api("reviewProposal", { proposalId })); setConfirmed(false); })}>Review the GrowLine account to pair</button>
      {typeof proposalReview.sourceUid === "string" && <p>Pair with {String(proposalReview.sourceLabel)}. GrowLine account ID: {proposalReview.sourceUid}. Club: {String(proposalReview.clubId)}. Confirm only if you control this GrowLine account.</p>}
      <button disabled={busy || !confirmed || typeof proposalReview.confirmationDigest !== "string"} onClick={() => void run(async () => {
        const result = await api("confirm", { proposalId, confirm: true, confirmationDigest: proposalReview.confirmationDigest });
        setStatus(result); setMessage("Both accounts are paired. Return to GrowLine and check pairing status.");
      })}>Confirm pairing with my verified Club member account</button></>}
      {requestId && <button disabled={busy} onClick={() => void run(async () => {
        const current = await api("status");
        if (current.paired !== true || typeof current.pairId !== "string") throw new Error("Pair both accounts first.");
        const result = await api("issue", { pairId: current.pairId, requestId });
        if (!window.opener || typeof result.destinationOrigin !== "string") throw new Error("Return to the destination app and restart sign-in.");
        window.opener.postMessage({ requestId: result.requestId, assertion: result.assertion }, result.destinationOrigin);
        setMessage("Sign-in confirmation sent to the destination app.");
      })}>Confirm sign-in to the other app</button>}
      <button disabled={busy || !confirmed} onClick={() => void run(async () => {
        const result = await api("unlink");
        await signOut(getAuth());
        setMessage(result.propagated === true ? "Accounts unlinked. Historical audit is preserved." : "This account is unlinked; delivery to the other app is pending. Sign in freshly to retry delivery.");
      })}>Unlink accounts</button>
      <button disabled={busy} onClick={() => void run(async () => {
        const result = await api("retryLogout"); setMessage(result.propagated === true ? "Cross-app logout delivered." : "Delivery is still pending. Future federation is blocked.");
      })}>Retry pending logout delivery</button>
    </> : <p>Sign in to this app normally to pair accounts, or use your existing pairing above.</p>}
  </main>;
}
