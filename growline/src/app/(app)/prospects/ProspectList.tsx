"use client";

import CountUp from "@/components/CountUp";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ProspectsIcon } from "@/components/icons";
import { listQueued, isQueueSupported, type PendingProspect } from "@/lib/offline-queue";
import { QUEUE_CHANGED } from "@/components/OfflineSync";
import { prospectPhoneDigits } from "@/lib/prospect";
import { STAGES, STAGE_LABELS, toStage } from "@/lib/pipeline";
import type { FollowupBucket } from "@/lib/followup";

export type ProspectRow = {
  id: string;
  name: string;
  phone: string;
  age: number | null;
  gender: string | null;
  heightCm: number | null;
  weightKg: number | null;
  stage: string;
  source: string;
  createdAt: string;
  nextFollowupAt: string | null;
  followupBucket: FollowupBucket;
  followupLabel: string | null;
};

function detailLine(p: {
  phone: string;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
}) {
  const bits = [prospectPhoneDigits(p.phone)];
  if (p.age !== null) bits.push(`${p.age} yrs`);
  if (p.heightCm !== null) bits.push(`${p.heightCm} cm`);
  if (p.weightKg !== null) bits.push(`${p.weightKg} kg`);
  return bits.join(" · ");
}

/** Digits-only compare so "98765 43210" and "+919876543210" both match a search. */
const digitsOnly = (s: string) => s.replace(/\D/g, "");

function Row({ p }: { p: ProspectRow }) {
  const overdue = p.followupBucket === "overdue";
  return (
    <li>
      <Link
        href={`/prospects/${p.id}`}
        className={`flex min-h-16 items-center gap-3 rounded-xl p-3 ${
          overdue ? "animate-pulse-soft border border-heat bg-elevated/50" : "bg-surface"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{p.name}</p>
          <p className="truncate text-sm text-text-dim">{detailLine(p)}</p>
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-full bg-hairline px-2.5 py-1 text-xs font-semibold text-text">
            {STAGE_LABELS[toStage(p.stage)]}
          </span>
          {p.followupLabel && (
            <span
              className={`text-xs ${
                overdue ? "font-semibold text-gold-ink" : "text-text-dim"
              }`}
            >
              {p.followupLabel}
            </span>
          )}
          {!p.followupLabel && p.source === "qr" && (
            <span className="text-xs text-text-dim">Filled by them</span>
          )}
        </span>
      </Link>
    </li>
  );
}

export default function ProspectList({
  prospects,
  referralCode,
}: {
  prospects: ProspectRow[];
  referralCode: string;
}) {
  const params = useSearchParams();
  const justSaved = params.get("saved") === "1";
  // Deep link from the morning reminder.
  const dueOnly = params.get("due") === "1";

  const [pending, setPending] = useState<PendingProspect[]>([]);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [showDueOnly, setShowDueOnly] = useState(dueOnly);

  // Display only — OfflineSync in the app layout does the uploading.
  useEffect(() => {
    if (!isQueueSupported()) return;
    let cancelled = false;
    /**
     * Three things trigger a re-read — mount, QUEUE_CHANGED and "online" — and they
     * fire within milliseconds of each other when the signal returns. IndexedDB
     * reads can then resolve out of order, and the LAST one to land wins.
     *
     * That is a real duplicate on screen, not a cosmetic flicker: a read that
     * started before OfflineSync dequeued a synced capture can resolve after the
     * one that started after it, pinning the prospect to this list as "On this
     * phone" while router.refresh() has already brought in their real row. The
     * coach sees the same person twice, one of them apparently unsaved, and it
     * never settles. Apply only the newest read.
     */
    let latest = 0;

    const refreshPending = async () => {
      const seq = ++latest;
      const queued = await listQueued();
      if (!cancelled && seq === latest) setPending(queued);
    };

    void refreshPending();
    window.addEventListener(QUEUE_CHANGED, refreshPending);
    window.addEventListener("online", refreshPending);
    return () => {
      cancelled = true;
      window.removeEventListener(QUEUE_CHANGED, refreshPending);
      window.removeEventListener("online", refreshPending);
    };
  }, []);

  const due = useMemo(
    () =>
      prospects.filter(
        (p) => p.followupBucket === "overdue" || p.followupBucket === "today"
      ),
    [prospects]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = digitsOnly(query);
    let list = showDueOnly ? due : prospects;
    if (stageFilter) list = list.filter((p) => toStage(p.stage) === stageFilter);
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (qDigits.length > 0 && digitsOnly(p.phone).includes(qDigits))
      );
    }
    // Overdue first, then today, then everyone else newest-first (F5). Applied in
    // BOTH modes — the due-only view is the one a coach works down in order, so
    // showing it newest-first would bury the person who has waited longest.
    const rank = (b: FollowupBucket) => (b === "overdue" ? 0 : b === "today" ? 1 : 2);
    return [...list].sort((a, b) => {
      const byBucket = rank(a.followupBucket) - rank(b.followupBucket);
      if (byBucket !== 0) return byBucket;
      // Within a bucket, whoever was due earliest comes first.
      if (a.nextFollowupAt && b.nextFollowupAt) {
        return a.nextFollowupAt.localeCompare(b.nextFollowupAt);
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [prospects, due, query, stageFilter, showDueOnly]);

  const total = prospects.length + pending.length;
  const filtering = query.trim() !== "" || stageFilter !== null || showDueOnly;

  return (
    <>
      {justSaved && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-gem-green">
          Saved. Nice work — that&apos;s one more person in your list.
        </p>
      )}
      {pending.length > 0 && (
        <p className="rounded-xl bg-surface px-4 py-3 text-sm">
          <b>{pending.length}</b> waiting to upload · will upload by itself when you have
          network
        </p>
      )}

      {total === 0 ? (
        <EmptyState
          icon={<ProspectsIcon className="h-7 w-7" />}
          title="No prospects yet"
          body="Tap + after your next walk. Or show your QR code and let them fill it in themselves."
        >
          <Link
            href="/prospects/new"
            className="mt-2 flex h-12 items-center neopop metal-gold px-5 font-semibold text-on-gold"
          >
            Add first person
          </Link>
        </EmptyState>
      ) : (
        <>
          {due.length > 0 && (
            <button
              onClick={() => setShowDueOnly((v) => !v)}
              aria-pressed={showDueOnly}
              className={`flex min-h-14 items-center justify-between gap-3 rounded-2xl px-5 py-3 text-left ${
                showDueOnly ? "bg-elevated text-text" : "bg-elevated"
              }`}
            >
              <span>
                <CountUp value={due.length} className="numeral block text-3xl text-text" />
                <span className={`text-sm ${showDueOnly ? "text-text-dim" : "text-text-dim"}`}>
                  to follow up today
                </span>
              </span>
              <span className={`text-sm font-medium ${showDueOnly ? "text-gold-ink" : "text-gold-ink"}`}>
                {showDueOnly ? "Show everyone" : "Show only these"}
              </span>
            </button>
          )}

          <label className="sr-only" htmlFor="prospect-search">
            Search prospects
          </label>
          <input
            id="prospect-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or number"
            className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
            autoComplete="off"
          />

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button
              onClick={() => setStageFilter(null)}
              aria-pressed={stageFilter === null}
              className={`h-12 shrink-0 rounded-xl px-4 font-medium ${
                stageFilter === null
                  ? "bg-elevated text-text"
                  : "border border-hairline text-text-dim"
              }`}
            >
              All
            </button>
            {STAGES.map((s) => {
              const count = prospects.filter((p) => toStage(p.stage) === s).length;
              return (
                <button
                  key={s}
                  onClick={() => setStageFilter(stageFilter === s ? null : s)}
                  aria-pressed={stageFilter === s}
                  className={`h-12 shrink-0 rounded-xl px-4 font-medium ${
                    stageFilter === s
                      ? "bg-elevated text-text"
                      : "border border-hairline text-text-dim"
                  }`}
                >
                  {STAGE_LABELS[s]}
                  <span className="ml-1.5 opacity-70">{count}</span>
                </button>
              );
            })}
          </div>

          {visible.length === 0 && pending.length === 0 ? (
            <p className="rounded-2xl bg-surface px-5 py-8 text-center text-text-dim">
              Nobody matches that. Try a different name, number or stage.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {/* Unsynced captures stay pinned to the top regardless of filters, so
                  they can never look lost. */}
              {!filtering &&
                pending.map((p) => (
                  <li
                    key={p.clientId}
                    className="flex min-h-16 items-center gap-3 rounded-xl border border-dashed border-gold bg-elevated/40 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{p.name}</p>
                      <p className="truncate text-sm text-text-dim">{detailLine(p)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-elevated px-2.5 py-1 text-xs font-semibold text-gold-ink">
                      On this phone
                    </span>
                  </li>
                ))}
              {visible.map((p) => (
                <Row key={p.id} p={p} />
              ))}
            </ul>
          )}
        </>
      )}

      {total > 0 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/prospects/new"
            className="flex h-14 flex-1 items-center justify-center neopop metal-gold text-lg font-semibold text-on-gold"
          >
            + New Person
          </Link>
          <Link
            href={`/c/${referralCode}`}
            target="_blank"
            className="flex h-14 items-center justify-center rounded-xl border border-hairline px-4 font-medium"
          >
            Preview their form
          </Link>
        </div>
      )}
    </>
  );
}
