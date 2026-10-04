"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { cardText, shareText, type WallCard } from "./model";

/**
 * The wall, as a coach reads it (Feature B).
 *
 * ## One reaction and no comments
 *
 * 👏 is the entire interaction surface. RULES S3 bans group chat, and a comment box under
 * a recognition card is a group chat that arrives one feature request at a time. A clap
 * is unambiguous, needs no moderation, and cannot be used to say anything unkind.
 *
 * The count moves optimistically because a clap is the one action here that must feel
 * instant — and because the server is idempotent per person, an optimistic bump that
 * loses its request settles back to the truth on the next load rather than double-counting.
 *
 * ## Sharing is the earner's own card only
 *
 * The share button appears on YOUR cards, never on somebody else's. The Weekly Recap
 * established the brag loop (v2 §4.6) as the user's pride becoming the product's
 * marketing; sharing a colleague's achievement to your own status is a different and
 * much stranger act.
 */
export default function WallFeed({
  initialCards,
  viewerId,
  optedOut: initialOptedOut,
}: {
  initialCards: WallCard[];
  viewerId: string;
  optedOut: boolean;
}) {
  const [cards, setCards] = useState(initialCards);
  const [optedOut, setOptedOut] = useState(initialOptedOut);
  const [busy, setBusy] = useState(false);

  const toggleOptOut = async () => {
    if (busy) return;
    const next = !optedOut;
    setBusy(true);
    try {
      const res = await fetch("/api/wall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "opt-out", optOut: next }),
      });
      if (res.ok) {
        setOptedOut(next);
        // Leaving empties the wall immediately rather than waiting for a reload —
        // opting out is leaving the room, and the room should go quiet at once.
        if (next) setCards([]);
        else window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  };

  if (optedOut) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-surface p-5">
        <p className="font-medium">You are not on the wall.</p>
        <p className="text-sm text-text-dim">
          Nobody in your group sees your milestones, and you do not see theirs. Everything
          else in Growline works exactly the same.
        </p>
        <button
          type="button"
          onClick={toggleOptOut}
          disabled={busy}
          className="h-12 self-start rounded-xl border border-hairline px-4 font-medium disabled:opacity-50"
        >
          {busy ? "Saving…" : "Join the wall"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {cards.length === 0 ? (
        <div className="rounded-2xl bg-surface p-5">
          <p className="font-medium">Nothing on the wall yet.</p>
          <p className="mt-1 text-sm text-text-dim">
            Log a day, meet a person, reach a target — the first one to do it lands here,
            and everyone in your group sees it.
          </p>
        </div>
      ) : (
        cards.map((card) => (
          <Card key={card.id} card={card} isMine={card.earnerId === viewerId} setCards={setCards} />
        ))
      )}

      <button
        type="button"
        onClick={toggleOptOut}
        disabled={busy}
        className="h-12 self-start px-1 text-sm text-text-dim underline disabled:opacity-50"
      >
        Take me off the wall
      </button>
    </div>
  );
}

function Card({
  card,
  isMine,
  setCards,
}: {
  card: WallCard;
  isMine: boolean;
  setCards: React.Dispatch<React.SetStateAction<WallCard[]>>;
}) {
  const { title, line } = cardText(card);
  const [shared, setShared] = useState(false);

  const doClap = () => {
    if (card.clappedByMe) return;
    // Optimistic: the server is idempotent per person, so a lost request settles back
    // to the truth on the next load rather than double-counting.
    setCards((cs) =>
      cs.map((c) => (c.id === card.id ? { ...c, claps: c.claps + 1, clappedByMe: true } : c))
    );
    void fetch("/api/wall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clap", cardId: card.id }),
      keepalive: true,
    }).catch(() => {});
  };

  const share = () => {
    const text = shareText(card);
    // `wa.me` with no number opens the contact picker, which is the closest WhatsApp
    // allows to "post to Status" from the web (same limitation the Weekly Recap hit).
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    setShared(true);
  };

  return (
    <article className="flex flex-col gap-3 rounded-2xl bg-surface p-5">
      <div className="flex items-center gap-3">
        <Avatar name={card.earnerName} photoUrl={card.earnerPhotoUrl} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{title}</p>
          <p className="truncate text-sm text-text-dim">{line}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={doClap}
          disabled={card.clappedByMe}
          aria-pressed={card.clappedByMe}
          aria-label={card.clappedByMe ? "You clapped this" : "Clap for this"}
          className={`flex h-12 items-center gap-2 rounded-xl px-4 font-medium ${
            card.clappedByMe
              ? "bg-elevated text-text-dim"
              : "border border-hairline text-text"
          }`}
        >
          <span aria-hidden="true">👏</span>
          <span className="tabular-nums">{card.claps}</span>
        </button>

        {isMine && (
          <button
            type="button"
            onClick={share}
            className="h-12 rounded-xl border border-hairline px-4 font-medium"
          >
            {shared ? "Shared" : "Share"}
          </button>
        )}
      </div>
    </article>
  );
}
