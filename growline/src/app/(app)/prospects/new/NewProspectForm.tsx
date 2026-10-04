"use client";

import SuccessTick, { DRAW_MS } from "@/components/SuccessTick";
import { haptic, HAPTIC } from "@/lib/haptic";
import { useState } from "react";
import { useRouter } from "next/navigation";
import CaptureFields, { emptyCapture, type CaptureValues } from "@/components/CaptureFields";
import { newClientId, queueProspect, isQueueSupported } from "@/lib/offline-queue";
import { QUEUE_CHANGED } from "@/components/OfflineSync";

function toPayload(v: CaptureValues) {
  return {
    name: v.name.trim(),
    phone: v.phone,
    age: v.age === "" ? null : Number(v.age),
    gender: v.gender === "" ? null : v.gender,
    heightCm: v.heightCm === "" ? null : Number(v.heightCm),
    weightKg: v.weightKg === "" ? null : Number(v.weightKg),
  };
}

export default function NewProspectForm() {
  const router = useRouter();
  const [values, setValues] = useState<CaptureValues>(emptyCapture);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [queuedCount, setQueuedCount] = useState(0);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSave =
    values.name.trim().length >= 2 && values.phone.length === 10 && consent;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || busy) return;
    setError("");
    setBusy(true);

    const clientId = newClientId();
    // `canSave` already required the tick, so this is always true here — sent explicitly
    // rather than implied, because the server refuses a capture that does not carry it
    // and a silent default is exactly what that check exists to catch.
    const payload = { clientId, consentGiven: true, ...toPayload(values) };

    // Keep the capture on the phone and sync later. The coach must never lose a
    // person they just met. Confirmation happens in place: navigating away would
    // need an RSC fetch that cannot succeed offline.
    const saveLocally = async () => {
      if (!isQueueSupported()) {
        setError("No connection. Please try again when you have network.");
        return;
      }
      try {
        await queueProspect({ ...payload, savedAt: Date.now() });
        setValues(emptyCapture);
        // A fresh tick for the next person. Carrying it over would mean the coach
        // consents once and the app assumes it for everybody they meet after.
        setConsent(false);
        setQueuedCount((n) => n + 1);
        window.dispatchEvent(new Event(QUEUE_CHANGED));
        // The roadside save with no signal: the buzz and the tick are the only
        // confirmation that exists, because no server is going to answer and the
        // form simply empties — which on its own is indistinguishable from a
        // failure.
        haptic(HAPTIC.confirm);
        setTicked(true);
        window.setTimeout(() => setTicked(false), DRAW_MS + 260);
      } catch {
        setError("Could not save on this phone. Please try again.");
      }
    };

    // Known-offline: don't wait on a request that cannot land.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await saveLocally();
      setBusy(false);
      return;
    }

    try {
      const res = await fetch("/api/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        // A weak signal can leave a request hanging far past the 30-second rule.
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        haptic(HAPTIC.confirm);
        setTicked(true);
        // Navigation waits for the stroke. Half a second of deliberate latency on
        // the app's most important action, bought in exchange for a coach never
        // wondering whether it saved — the 30-second rule has room for it, and a
        // capture the coach re-enters "just in case" costs far more than 520ms.
        window.setTimeout(() => router.push("/prospects?saved=1"), DRAW_MS);
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save. Please try again.");
    } catch {
      // Timed out or the network died mid-request.
      await saveLocally();
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <SuccessTick show={ticked} label="Saved" />
      {queuedCount > 0 && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-gold-ink">
          Saved on this phone{queuedCount > 1 ? ` · ${queuedCount} so far` : ""}. It will
          upload by itself when you have network — keep going.
        </p>
      )}

      <CaptureFields values={values} onChange={setValues} />

      {/*
        The Mode A consent gate (v2 §5.2, RULES P6).

        Placed with the Save button rather than among the inputs, deliberately. RULES S2
        caps a screen at six input fields and CaptureFields already uses all six — but
        this is not a seventh field: nothing is entered, nothing is stored from it beyond
        a timestamp, and it gates the ACTION rather than collecting data. Splitting the
        capture across two screens to make room would break the 30-second rule (S1) for a
        control that costs one tap.

        Calm register: no gold, nothing animated. This is the one moment in the flow that
        belongs to somebody who is not holding the phone, and the app should not be
        cheerful about it.
      */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline p-4">
        <input
          type="checkbox"
          data-testid="capture-consent"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-6 w-6 shrink-0 accent-gold"
        />
        <span className="text-sm">
          This person knows I am saving their details and agrees.
          <span className="mt-1 block text-text-dim">
            Ask them before you save. They can ask you to remove their details at any
            time.
          </span>
        </span>
      </label>

      {error && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
      )}

      <button
        type="submit"
        disabled={!canSave || busy}
        className="h-14 neopop metal-gold text-lg font-semibold text-on-gold disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save person"}
      </button>
      <p className="text-center text-sm text-text-dim">
        Only name and number are needed now — you can add the rest later.
      </p>
    </form>
  );
}
