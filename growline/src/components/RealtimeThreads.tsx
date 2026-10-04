"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firebaseAuth, firebaseDb } from "@/lib/firebase";

/**
 * Two jobs on the Threads screen (F8, v2 §6):
 *
 *  1. the sender watches their own seen and ack counters move as their line responds
 *  2. a message from the coach's direct upline appears without a refresh
 *
 * and one side job: reporting the inbox as seen, once, in a single request.
 *
 * ## Why only the direct upline, and not the whole chain
 *
 * Rules for a list request are evaluated once against the QUERY, not per document
 * (D48), so every field the rule tests has to be pinned by the query. A listener for
 * a deeper ancestor must therefore pin `senderId == <that id>` AND `scope == "all"` —
 * one listener per ancestor. A coach four levels down would open four sockets to
 * watch for something that arrives on their next page load anyway.
 *
 * So: the direct upline is live, because that is the person whose message a coach is
 * actually waiting on, and deeper broadcasts arrive on next load or via push. That is
 * a deliberate line, not an oversight — and like RealtimeProspects this whole
 * component is an enhancement that must never be able to break the screen it
 * decorates. The server render is already correct and complete.
 */
export default function RealtimeThreads({
  uplineId,
  unseenIds,
}: {
  uplineId: string | null;
  unseenIds: string[];
}) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  /**
   * The seen report must fire once per set of ids, not once per render — and
   * `router.refresh()` re-renders this component with a NEW array identity holding
   * the same ids. Keying the guard on the ids themselves rather than on the array is
   * what stops a refresh loop: report seen, refresh, report seen, refresh.
   */
  const reported = useRef("");

  useEffect(() => {
    const key = unseenIds.join(",");
    if (key === "" || reported.current === key) return;
    reported.current = key;

    void fetch("/api/threads/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: unseenIds }),
      // Nothing depends on the answer. A coach whose signal dies mid-report is not
      // shown an error for a counter that belongs to somebody else's screen.
    }).catch(() => {});
  }, [unseenIds]);

  useEffect(() => {
    const stops: (() => void)[] = [];
    // Skips the snapshot that fires on attach, which carries what is already rendered.
    let seededMine = false;
    let seededUpline = false;

    const stopAuth = onAuthStateChanged(firebaseAuth(), (user) => {
      stops.forEach((s) => s());
      stops.length = 0;
      seededMine = false;
      seededUpline = false;
      setLive(false);
      if (!user) return;

      /**
       * Live means every listener we attached has delivered its baseline — not
       * that Firebase Auth resolved, which is what it used to mean and is one
       * subscription too early. A thread broadcast landing in that gap arrives
       * inside a FIRST snapshot, which is discarded as the baseline, so its change
       * is never seen and the screen never refreshes. See the same fix and the
       * fuller argument in RealtimeProspects.
       */
      const pending = uplineId ? 2 : 1;
      let seeded = 0;
      const baselineLanded = () => {
        seeded += 1;
        if (seeded >= pending) setLive(true);
      };

      const db = firebaseDb();
      const onError = () => {
        // Permission denied, or the connection dropped. The server-rendered screen is
        // already correct, so there is nothing to recover.
        setLive(false);
      };

      // (1) My own threads — any change here is my line responding, so the counters
      // on screen are stale. Allowed by `uid() == resource.data.senderId`.
      stops.push(
        onSnapshot(
          query(collection(db, "threads"), where("senderId", "==", user.uid)),
          (snap) => {
            if (!seededMine) {
              seededMine = true;
              baselineLanded();
              return;
            }
            // Modifications matter here, not just additions: an ack changes a count
            // on an existing document.
            if (snap.docChanges().length > 0) router.refresh();
          },
          onError
        )
      );

      // (2) My direct upline's threads. Allowed by `senderId == me().uplineId`, which
      // is decidable because this query pins senderId to one value.
      if (uplineId) {
        stops.push(
          onSnapshot(
            query(collection(db, "threads"), where("senderId", "==", uplineId)),
            (snap) => {
              if (!seededUpline) {
                seededUpline = true;
                baselineLanded();
                return;
              }
              if (snap.docChanges().some((c) => c.type === "added")) router.refresh();
            },
            onError
          )
        );
      }
    });

    return () => {
      stops.forEach((s) => s());
      stopAuth();
    };
  }, [router, uplineId]);

  // Rendered only so a test can assert the listener is live; invisible to the coach.
  return <span data-testid="realtime-threads" data-live={live ? "1" : "0"} hidden />;
}
