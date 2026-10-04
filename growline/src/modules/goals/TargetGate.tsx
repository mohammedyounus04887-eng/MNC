"use client";

import { useEffect, useState } from "react";
import { MAX_TARGET_POINTS } from "@/lib/targets";
import {
  BLOCKERS,
  DEFAULT_INVITES_PER_MEMBER,
  DEFAULT_VOLUME_PER_MEMBER,
  DEFAULT_WORKING_DAYS,
  pathFitsHours,
  suggestActivityPath,
  type BlockerKey,
  type HoursPerDay,
} from "./model";

/**
 * What an upline goes through before a number reaches their downline (A3).
 *
 * ## Why this is a gate and not a panel beside the input
 *
 * A3 says an upline cannot open target-setting without seeing the goal sheet. A card
 * next to the number field satisfies that literally and not at all in practice — the eye
 * goes to the input. So the sheet is the FIRST pane and the number field does not exist
 * until the upline has moved past it. One deliberate tap between reading somebody's reason
 * for being here and deciding what to ask of them.
 *
 * The gate never blocks. A downline who has not filled their sheet must not cost their
 * upline the ability to set a target — that punishes the wrong person — so an empty sheet
 * shows what is missing and the flow continues.
 *
 * ## Three panes, because of RULES S2
 *
 *   sheet   → read. No inputs.
 *   number  → the target, plus three assumptions behind "Adjust". Four fields at most.
 *   actions → one line per blocker the coach ticked. Six at most, by construction.
 *
 * The free-text blocker note appears in the actions pane as CONTEXT rather than a seventh
 * input row. That keeps the pane under the limit and is the better design anyway: an
 * upline answering "my husband thinks this is a waste of time" with a checkbox item is
 * missing the point of having read it.
 */

type SheetView = {
  why: string;
  hoursPerDay: HoursPerDay | null;
  shortTermGoal: string;
  longTermGoal: string;
  blockers: BlockerKey[];
  blockerNote: string;
  needs: string;
};

type GateData = {
  sheet: SheetView;
  sawPrivate: boolean;
  activity: { loggedDays: number; ofDays: number; invitesPerDay: number | null };
  talkingPoints: string[];
};

const blockerLabel = (key: BlockerKey) =>
  BLOCKERS.find((b) => b.key === key)?.label ?? key;

export default function TargetGate({
  coachId,
  coachName,
  month,
  initialPoints,
  onCancel,
  onSaved,
}: {
  coachId: string;
  coachName: string;
  month: string;
  initialPoints: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<GateData | null>(null);
  /**
   * Learned from the save response, never built here.
   *
   * The id is derived from (coach, month) by `targetDocId`, which lives beside the
   * database driver and cannot be imported into a client component (E2). Reconstructing
   * it in the browser would mean copying the separator, and a copy of a format is a copy
   * that drifts. The PUT already returns the authoritative id — so use that.
   */
  const [targetId, setTargetId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [pane, setPane] = useState<"sheet" | "number" | "actions">("sheet");

  const [points, setPoints] = useState(initialPoints);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [volumePerMember, setVolumePerMember] = useState(DEFAULT_VOLUME_PER_MEMBER);
  const [invitesPerMember, setInvitesPerMember] = useState(DEFAULT_INVITES_PER_MEMBER);
  const [workingDays, setWorkingDays] = useState(DEFAULT_WORKING_DAYS);

  const [actions, setActions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The sheet is fetched when the gate opens, which is what makes "cannot set a target
  // without seeing it" true rather than aspirational — there is no pane to skip to until
  // this resolves.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/goals/${coachId}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!live) return;
        if (!res.ok) {
          setLoadError("Could not open their sheet. Please try again.");
          return;
        }
        setData((await res.json()) as GateData);
      } catch {
        if (live) setLoadError("No connection. Check your network and try again.");
      }
    })();
    return () => {
      live = false;
    };
  }, [coachId]);

  const firstName = coachName.split(" ")[0];

  const path = suggestActivityPath({
    volumeTarget: points,
    volumePerMember,
    invitesPerMember,
    workingDays,
  });
  const fits = path ? pathFitsHours(path, data?.sheet.hoursPerDay ?? null) : true;

  const saveTarget = async () => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coachId, month, targetPoints: points }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save. Please try again.");
        return;
      }
      setTargetId(typeof body.id === "string" ? body.id : "");
      setPane("actions");
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  const sendProposal = async () => {
    if (busy) return;
    // The target itself is already saved. If the id somehow did not come back, the target
    // still stands and simply has no conversation — which reads as "proposed", the same
    // as every target set before this feature existed. Nothing is lost by closing.
    if (!targetId) {
      onSaved();
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/goals/conversations/${targetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "propose",
          coachId,
          month,
          proposedPoints: points,
          actions: Object.entries(actions)
            .filter(([, v]) => v.trim())
            .map(([blocker, action]) => ({ blocker, action, done: false })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Target saved, but could not send it. Please try again.");
        return;
      }
      onSaved();
    } catch {
      setError("Target saved, but could not send it. Check your network.");
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-elevated p-4">
        <p className="text-sm text-heat">{loadError}</p>
        <button
          onClick={onCancel}
          className="h-12 rounded-xl border border-hairline px-4 font-medium"
        >
          Close
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-text-dim">
        Opening {firstName}&apos;s sheet…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-elevated p-4">
      {pane === "sheet" && (
        <>
          <h3 className="font-semibold">Before you set a number</h3>

          {data.sheet.why.trim() ? (
            <blockquote className="border-l-2 border-hairline pl-3 text-sm text-text/80">
              {data.sheet.why}
            </blockquote>
          ) : (
            <p className="text-sm text-text-dim">
              {firstName} hasn&apos;t written their reason yet. Worth asking before you
              agree a number.
            </p>
          )}

          <ul className="flex flex-col gap-1.5 text-sm text-text/80">
            {data.talkingPoints.map((p) => (
              <li key={p} className="flex gap-2">
                <span aria-hidden="true" className="text-text-dim">
                  •
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>

          {/* Shown only when the coach themselves turned sharing on (A2). No amount is
              displayed here even then — RULES L4 governs what may sit beside a target. */}
          {data.sawPrivate && data.sheet.needs.trim() && (
            <p className="rounded-xl border border-hairline p-3 text-sm text-text/80">
              <span className="block text-xs uppercase tracking-wide text-text-dim">
                They chose to share this
              </span>
              {data.sheet.needs}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setPane("number")}
              className="h-12 neopop metal-gold px-5 font-semibold text-on-gold"
            >
              Set the number
            </button>
            <button
              onClick={onCancel}
              className="h-12 rounded-xl border border-hairline px-4 font-medium"
            >
              Not now
            </button>
          </div>
        </>
      )}

      {pane === "number" && (
        <>
          <label className="text-sm font-medium" htmlFor={`gate-points-${coachId}`}>
            Target points for {firstName}
          </label>
          <input
            id={`gate-points-${coachId}`}
            value={points}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
              setPoints(digits === "" ? 0 : Math.min(MAX_TARGET_POINTS, Number(digits)));
            }}
            inputMode="numeric"
            className="h-12 w-full rounded-xl border border-hairline bg-surface px-4 text-xl font-bold tabular-nums outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
          />

          {/* The reverse-math. Volume in, activity out — no money anywhere in the
              arithmetic, which is why this can sit next to a target at all. */}
          {path && (
            <div className="flex flex-col gap-2 rounded-xl bg-surface p-3">
              <p className="text-sm text-text/80">
                That&apos;s about{" "}
                <strong className="tabular-nums">{path.membersNeeded}</strong> new members,{" "}
                <strong className="tabular-nums">{path.invitesNeeded}</strong> invites —{" "}
                <strong className="tabular-nums">{path.invitesPerDay}</strong> a day over{" "}
                {path.workingDays} days.
              </p>
              {!fits && (
                <p className="text-sm text-heat">
                  {firstName} said they have {data.sheet.hoursPerDay}h a day. That&apos;s
                  more than fits. Lower the number, or solve the time problem first.
                </p>
              )}
              <button
                type="button"
                onClick={() => setShowAssumptions((v) => !v)}
                aria-expanded={showAssumptions}
                className="self-start text-sm text-text-dim underline"
              >
                {showAssumptions ? "Hide" : "Adjust"} the assumptions
              </button>
              {showAssumptions && (
                <div className="flex flex-col gap-2">
                  {/* Your line's real numbers, not ours. The defaults are a starting
                      point to argue with — A3 is explicit that humans decide. */}
                  <Assumption
                    id={`vpm-${coachId}`}
                    label="Volume per member"
                    value={volumePerMember}
                    onChange={setVolumePerMember}
                  />
                  <Assumption
                    id={`ipm-${coachId}`}
                    label="Invites per member"
                    value={invitesPerMember}
                    onChange={setInvitesPerMember}
                  />
                  <Assumption
                    id={`wd-${coachId}`}
                    label="Working days"
                    value={workingDays}
                    onChange={setWorkingDays}
                  />
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-heat">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={saveTarget}
              disabled={busy || points < 1}
              className="h-12 neopop metal-gold px-5 font-semibold text-on-gold disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save and continue"}
            </button>
            <button
              onClick={() => setPane("sheet")}
              className="h-12 rounded-xl border border-hairline px-4 font-medium"
            >
              Back
            </button>
          </div>
        </>
      )}

      {pane === "actions" && (
        <>
          <h3 className="font-semibold">What will you do about the blockers?</h3>

          {data.sheet.blockers.length === 0 && !data.sheet.blockerNote.trim() ? (
            <p className="text-sm text-text-dim">
              {firstName} hasn&apos;t named anything in the way. Send the target across.
            </p>
          ) : (
            <>
              <p className="text-sm text-text-dim">
                One line each. {firstName} sees these with the target and can tick them off.
              </p>
              {data.sheet.blockers.map((key) => (
                <label key={key} className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{blockerLabel(key)}</span>
                  <input
                    value={actions[key] ?? ""}
                    onChange={(e) =>
                      setActions((a) => ({ ...a, [key]: e.target.value }))
                    }
                    maxLength={200}
                    placeholder="What you'll do"
                    className="h-12 w-full rounded-xl border border-hairline bg-surface px-4 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
                  />
                </label>
              ))}
              {data.sheet.blockerNote.trim() && (
                <p className="rounded-xl border border-hairline p-3 text-sm text-text/80">
                  <span className="block text-xs uppercase tracking-wide text-text-dim">
                    They also wrote
                  </span>
                  {data.sheet.blockerNote}
                </p>
              )}
            </>
          )}

          {error && <p className="text-sm text-heat">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={sendProposal}
              disabled={busy}
              className="h-12 neopop metal-gold px-5 font-semibold text-on-gold disabled:opacity-50"
            >
              {busy ? "Sending…" : `Send to ${firstName}`}
            </button>
            <button
              onClick={onSaved}
              className="h-12 rounded-xl border border-hairline px-4 font-medium"
            >
              Skip
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Assumption({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3" htmlFor={id}>
      <span className="text-sm">{label}</span>
      <input
        id={id}
        value={value}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
          onChange(digits === "" ? 0 : Number(digits));
        }}
        inputMode="numeric"
        className="h-11 w-20 rounded-xl border border-hairline bg-elevated px-3 text-center tabular-nums outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
      />
    </label>
  );
}
