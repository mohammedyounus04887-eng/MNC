"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firebaseAuth, firebaseDb } from "@/lib/firebase";

/**
 * Makes a QR self-fill appear in the coach's pipeline without a refresh (F2,
 * v2 §3), closing the debt D10 recorded.
 *
 * ## Why a listener and not polling
 *
 * D10 rejected polling deliberately: background polling burns data on the cheap
 * plans this audience uses (v1 §4.4). A listener costs one open connection and
 * delivers nothing until something actually changes.
 *
 * ## Why the query looks like this
 *
 * `where("coachId", "==", uid)` is not a convenience — it is the only shape the
 * privacy rule will serve. An unfiltered listing of prospects is refused outright,
 * and a filtered one resolves a single `get()` on the coach document. The rules
 * tests cover both.
 *
 * ## It is an enhancement, never the source of truth
 *
 * The list is server-rendered and correct on its own. This only asks Next to
 * refresh it when the count changes. If the client has no Firebase Auth session —
 * the cookie outlives it, or storage was cleared — this quietly does nothing and
 * the coach still sees their prospects on the next load. Failing silent is right
 * here: a realtime nicety must never be able to break the screen it decorates.
 *
 * ## The window that dropped captures
 *
 * `ready` used to be set the moment Firebase Auth resolved — one line above the
 * subscription, and independent of whether it ever attached. A prospect submitted
 * in the gap between those two moments arrives inside the listener's FIRST
 * snapshot, which is deliberately discarded as the baseline, so its `added` change
 * was never seen and the screen never refreshed. The capture was in the database
 * and invisible until something else caused a reload.
 *
 * Small window, real one, and biased towards the worst case: it is widest on a
 * slow phone on a weak signal, which is where Mode B lives. `e2e/realtime.spec.ts`
 * hit it whenever the machine was busy — it passed alone in 3.6s and failed inside
 * the full suite — and was on its way to being filed as flaky for a third time.
 * D73 is the standing warning about exactly that, and this is the same shape: an
 * intermittent test describing a capture the product actually loses.
 *
 * `ready` is now set from inside the snapshot callback, so `data-live="1"` means
 * what the test always assumed it meant — the listener has delivered its baseline
 * — and everything after it is genuinely new.
 */
export default function RealtimeProspects() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  // Skip the snapshot that fires on attach, which carries the rows already rendered.
  const seeded = useRef(false);

  useEffect(() => {
    let stopSnapshot: (() => void) | undefined;

    const stopAuth = onAuthStateChanged(firebaseAuth(), (user) => {
      stopSnapshot?.();
      seeded.current = false;
      setReady(false);
      if (!user) return;

      stopSnapshot = onSnapshot(
        query(collection(firebaseDb(), "prospects"), where("coachId", "==", user.uid)),
        (snap) => {
          if (!seeded.current) {
            seeded.current = true;
            // The baseline has landed, so the listener is genuinely serving from
            // here on. Anything that arrived before this point is already in the
            // server-rendered list below.
            setReady(true);
            return;
          }
          // Only additions matter here — edits are made on this device and are
          // already on screen.
          if (snap.docChanges().some((c) => c.type === "added")) router.refresh();
        },
        () => {
          // Permission denied or the connection dropped. Nothing to do: the
          // server-rendered list is already correct.
          setReady(false);
        }
      );
    });

    return () => {
      stopSnapshot?.();
      stopAuth();
    };
  }, [router]);

  // Rendered only so a test can assert the listener is live; invisible to the coach.
  return <span data-testid="realtime" data-live={ready ? "1" : "0"} hidden />;
}
