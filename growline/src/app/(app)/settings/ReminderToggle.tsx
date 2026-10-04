"use client";

import { useEffect, useState } from "react";
import {
  currentPushState,
  disablePush,
  enablePush,
  type PushState,
} from "@/lib/push-client";

/**
 * Follow-up reminders (F5). Off until the coach asks for it — a notification
 * permission prompt on first launch gets denied, and a denial is hard to undo.
 */
export default function ReminderToggle() {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void currentPushState().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setError("");
    const result = await enablePush();
    if (result.ok) setState("on");
    else {
      setState(result.state);
      if (result.error) setError(result.error);
    }
    setBusy(false);
  };

  const turnOff = async () => {
    setBusy(true);
    setError("");
    await disablePush();
    setState("off");
    setBusy(false);
  };

  const describe = () => {
    switch (state) {
      case "on":
        return "On — you'll get one reminder each morning when people are due.";
      case "denied":
        return "Blocked in your browser settings. Allow notifications for this site, then come back.";
      case "unsupported":
        return "This browser can't show reminders. The follow-up list on Home still works.";
      case "unconfigured":
        return "Not available on this server yet.";
      default:
        return "Get one reminder each morning listing who to follow up.";
    }
  };

  return (
    <section className="rounded-2xl bg-surface p-5">
      <h2 className="font-semibold">Morning reminder</h2>
      <p className="mt-1 text-sm text-text-dim">{describe()}</p>

      {state === "off" && (
        <button
          onClick={turnOn}
          disabled={busy}
          className="mt-3 h-12 rounded-xl bg-gold px-5 font-semibold text-on-gold disabled:opacity-50"
        >
          {busy ? "Turning on…" : "Turn on reminders"}
        </button>
      )}
      {state === "on" && (
        <button
          onClick={turnOff}
          disabled={busy}
          className="mt-3 h-12 rounded-xl border border-hairline px-4 font-medium disabled:opacity-50"
        >
          {busy ? "Turning off…" : "Turn off"}
        </button>
      )}

      {error && <p className="mt-3 text-sm text-heat">{error}</p>}
    </section>
  );
}
