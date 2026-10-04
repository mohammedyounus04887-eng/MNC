"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  isQueueSupported,
  listQueued,
  listQueuedLogs,
  syncQueue,
} from "@/lib/offline-queue";

/** Fired after the queue changes so any mounted list can re-read it. */
export const QUEUE_CHANGED = "growline:queue-changed";

/**
 * How long to wait before trying a stuck queue again. Backs off, then holds at 30s.
 *
 * A coach on a train tunnel or a village edge is offline for minutes, not milliseconds,
 * so the tail matters more than the head: 30s forever costs nothing on a phone and means
 * the queue drains within half a minute of the signal actually returning.
 */
const RETRY_MS = [2_000, 4_000, 8_000, 15_000, 30_000];

/**
 * Drains the offline capture queue from anywhere in the app. Mounted in the
 * authenticated layout on purpose: a coach who captures ten people on a walk may
 * never open the Prospects list, and their work still has to reach the server.
 *
 * ## Why this retries, and what it cost to learn
 *
 * It used to drain on four triggers — mount, the `online` event, a queue write, and a
 * tab becoming visible — and on nothing else. Every one of those is an EDGE, and if the
 * queue was still full after the last edge passed, it sat there. `if (!navigator.onLine)
 * return` in particular treated "offline right now" as terminal rather than as "come
 * back in a moment".
 *
 * That is not hypothetical. `e2e/offline-capture.spec.ts` failed in every full-suite run
 * for days and passed alone every time, and it was recorded as a flaky test. It was not.
 * The trace showed exactly one `POST /api/prospects`, aborted while offline, and no
 * second attempt ever: the signal came back a few milliseconds before the next page
 * loaded, so the `online` event fired on the page being torn down, and the fresh mount
 * read `navigator.onLine` before the renderer had caught up. Both edges missed, and the
 * captured person was stranded in IndexedDB.
 *
 * On a phone that is the failure this file's own header warns about — the coach was told
 * "saved on this phone" and the person never arrives — and it needs no test to happen:
 * one flaky drain on a weak signal is enough. Timing races cannot be fixed by adding a
 * fifth edge, so the fix is a level rather than an edge: while anything is queued, keep
 * coming back.
 */
export default function OfflineSync() {
  const router = useRouter();

  useEffect(() => {
    if (!isQueueSupported()) return;
    let cancelled = false;
    let running = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      // One timer at a time: four triggers can all fire around a signal returning, and
      // each scheduling its own would turn a backoff into a burst.
      if (cancelled || timer !== undefined) return;
      const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
      timer = setTimeout(() => {
        timer = undefined;
        void drain();
      }, wait);
    };

    const drain = async () => {
      if (running || cancelled) return;

      // Read the queue BEFORE checking the network. An empty queue needs no retry
      // whatever the signal is doing, and that is the common case on every mount.
      const [prospects, logs] = await Promise.all([listQueued(), listQueuedLogs()]);
      if (cancelled) return;
      if (prospects.length + logs.length === 0) {
        attempt = 0;
        return;
      }

      // Something IS queued. Being offline is now a reason to come back, not to stop.
      if (!navigator.onLine) {
        attempt++;
        schedule();
        return;
      }

      running = true;
      let result;
      try {
        result = await syncQueue();
      } finally {
        running = false;
      }
      if (cancelled) return;

      if (result.synced > 0) {
        window.dispatchEvent(new Event(QUEUE_CHANGED));
        router.refresh();
      }
      // A partial drain still counts as progress, but whatever is left needs another
      // pass — `syncQueue` stops at the first item the server would not take.
      if (result.remaining > 0) {
        attempt++;
        schedule();
      } else {
        attempt = 0;
      }
    };

    const onOnline = () => {
      // A fresh signal resets the backoff: the reason the last attempt failed is gone.
      attempt = 0;
      void drain();
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void drain();
    };

    void drain();
    window.addEventListener("online", onOnline);
    window.addEventListener(QUEUE_CHANGED, drain);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(QUEUE_CHANGED, drain);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
