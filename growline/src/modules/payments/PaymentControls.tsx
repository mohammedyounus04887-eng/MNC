"use client";

import { useState } from "react";
import { PAY_COPY, PLANS, cancelledExplainer, rupees, type PlanKey } from "./model";

/**
 * The money controls on /plans (v2 §8, Phase 9b). A TRUST ZONE (RULES G1): flat, calm,
 * no glow, no animation, plain words, and it says what happens to the coach's data every
 * time it mentions money.
 *
 * ## The checkout is Razorpay's, not ours
 *
 * The button loads Razorpay's checkout script and opens THEIR modal. The coach types
 * their UPI id into a Razorpay-owned iframe. Nothing about the mandate ever passes
 * through this component, this server, or this codebase (RULES L7). We get back three
 * ids and a signature, and even those go to the server to be re-verified against
 * Razorpay before anything changes.
 *
 * ## Cancel is two taps, and the second tap says exactly what it does
 *
 * Tap one shows the consequence in one sentence — you keep what you paid for, nothing is
 * deleted — and a second button. Tap two calls the route. No "are you sure?" modal, no
 * guilt copy, no discount offer to stay. v1 §4.7 says two taps and no dark patterns, and
 * a retention flow on the cancel button is the dark pattern.
 */

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

type State = {
  paidLeader: boolean;
  cancelled: boolean;
  accessEndsKey: string | null;
  inGrace: boolean;
  plan: PlanKey | null;
};

export default function PaymentControls({
  initial,
  configured,
}: {
  initial: State;
  /** Whether the server has Razorpay keys. Without them the buttons say so and do nothing. */
  configured: boolean;
}) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<PlanKey | "cancel" | null>(null);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const loadCheckout = () =>
    new Promise<void>((resolve, reject) => {
      if (window.Razorpay) return resolve();
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not load the payment window."));
      document.body.appendChild(s);
    });

  const subscribe = async (plan: PlanKey) => {
    if (busy) return;
    setError("");
    setBusy(plan);
    try {
      const res = await fetch("/api/payments/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        keyId?: string;
        subscriptionId?: string;
        prefill?: { name: string; contact: string };
      };
      if (!res.ok || !data.keyId || !data.subscriptionId) {
        setError(data.error ?? "Could not start. Please try again.");
        return;
      }

      await loadCheckout();
      if (!window.Razorpay) throw new Error("Payment window unavailable.");

      const rzp = new window.Razorpay({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: "Growline",
        description: `Leader — ${PLANS[plan].label}`,
        prefill: data.prefill,
        theme: { color: "#14213D" },
        // Razorpay calls this after the mandate is authenticated. We verify server-side.
        handler: async (resp: Record<string, string>) => {
          const confirm = await fetch("/api/payments/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(resp),
          });
          if (confirm.ok) {
            setState((s) => ({ ...s, paidLeader: true, cancelled: false, plan }));
          } else {
            setError("Payment went through but we could not confirm it yet. It will update shortly.");
          }
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.open();
    } catch (e) {
      setError((e as Error).message || "Could not start. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (busy) return;
    setError("");
    setBusy("cancel");
    try {
      const res = await fetch("/api/payments/cancel", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not cancel. Please try again.");
        return;
      }
      setState((s) => ({ ...s, cancelled: true }));
      setConfirmCancel(false);
    } finally {
      setBusy(null);
    }
  };

  // ---- Paying Leader: show the plan and the cancel path ---------------------------
  if (state.paidLeader) {
    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-hairline p-5">
        <div>
          <p className="font-medium">
            You are on Leader{state.plan ? ` — ${PLANS[state.plan].label}` : ""}.
          </p>
          <p className="mt-1 text-sm text-text-dim">
            {state.cancelled
              ? cancelledExplainer(state.accessEndsKey)
              : state.inGrace
                ? PAY_COPY.graceExplainer
                : PAY_COPY.mandateExplainer}
          </p>
        </div>

        {!state.cancelled &&
          (confirmCancel ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">{PAY_COPY.cancelExplainer}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={cancel}
                  disabled={busy !== null}
                  className="h-12 rounded-xl border border-hairline px-4 font-medium disabled:opacity-50"
                >
                  {busy === "cancel" ? "Cancelling…" : "Yes, cancel"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="h-12 px-4 font-medium text-text-dim"
                >
                  Keep Leader
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="h-12 self-start px-1 text-sm text-text-dim underline"
            >
              Cancel Leader
            </button>
          ))}

        {error && <p className="text-sm text-heat">{error}</p>}
      </section>
    );
  }

  // ---- Not paying: the two plans, annual first ---------------------------------
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-hairline p-5">
      <p className="font-medium">Get Leader</p>
      <p className="text-sm text-text-dim">{PAY_COPY.mandateExplainer}</p>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => subscribe("annual")}
          disabled={busy !== null || !configured}
          className="flex h-14 items-center justify-between rounded-xl bg-info/15 px-5 font-semibold disabled:opacity-50"
        >
          <span>Annual — {rupees(PLANS.annual.amountPaise)}/year</span>
          <span className="text-sm font-normal text-text-dim">2 months free</span>
        </button>
        <button
          type="button"
          onClick={() => subscribe("monthly")}
          disabled={busy !== null || !configured}
          className="flex h-14 items-center justify-between rounded-xl border border-hairline px-5 font-medium disabled:opacity-50"
        >
          <span>Monthly — {rupees(PLANS.monthly.amountPaise)}/month</span>
        </button>
      </div>

      {!configured && (
        <p className="text-sm text-text-dim">
          Payments are not switched on for this server yet. Nothing will be charged.
        </p>
      )}
      {error && <p className="text-sm text-heat">{error}</p>}
    </section>
  );
}
