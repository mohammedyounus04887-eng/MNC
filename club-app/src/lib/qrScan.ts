/**
 * Reading the member cards.
 *
 * USB and Bluetooth QR readers behave like keyboards: they type the code and
 * press Enter. That means no camera, no permissions, and a scan that lands in
 * a few milliseconds — considerably faster and more reliable than pointing a
 * tablet camera at a card.
 *
 * `useCardScanner` listens globally, so the receptionist never has to click
 * into a field first. Characters arriving slowly are treated as somebody typing
 * and ignored; a burst ending in Enter is a scan.
 */

import { useEffect, useRef } from "react";

/** Cards encode `MNC:<memberDocId>` — see MemberCardsPage.cardQrValue. */
export const CARD_PREFIX = "MNC:";

/**
 * Pull the member id out of a scanned code.
 * Returns null for anything that isn't one of our cards.
 */
export function parseCardCode(raw: string): string | null {
    const s = (raw || "").trim();
    if (!s) return null;
    if (s.startsWith(CARD_PREFIX)) {
        const id = s.slice(CARD_PREFIX.length).trim();
        return id || null;
    }
    return null;
}

interface Options {
    /** Called with the member id when one of our cards is read. */
    onCard: (memberId: string) => void;
    /** Called for a code that isn't one of ours — usually a stray QR. */
    onUnknown?: (raw: string) => void;
    /** Ignore a repeat of the same card within this window. Default 2500ms. */
    repeatWindowMs?: number;
    enabled?: boolean;
}

/**
 * Listen for a hardware card reader anywhere on the page.
 *
 * The repeat guard matters in practice: these readers commonly fire twice if
 * the card lingers in front of the beam, which would otherwise mark attendance
 * and place a second order.
 */
export function useCardScanner({ onCard, onUnknown, repeatWindowMs = 2500, enabled = true }: Options) {
    const buf = useRef("");
    const lastKeyAt = useRef(0);
    const lastCard = useRef<{ id: string; at: number }>({ id: "", at: 0 });
    const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cbCard = useRef(onCard);
    const cbUnknown = useRef(onUnknown);
    cbCard.current = onCard;
    cbUnknown.current = onUnknown;

    useEffect(() => {
        if (!enabled) return;

        const clearFlush = () => {
            if (flushTimer.current) {
                clearTimeout(flushTimer.current);
                flushTimer.current = null;
            }
        };

        /** Decide what the buffered burst was, and hand it on. */
        const commit = (typingInField: boolean, e?: KeyboardEvent) => {
            clearFlush();
            const raw = buf.current;
            buf.current = "";
            if (raw.length < 4) return;

            const id = parseCardCode(raw);
            if (!id) {
                cbUnknown.current?.(raw);
                return;
            }
            // Same card again within the window — the reader double-fired, or
            // the card is being held in the beam.
            const now = Date.now();
            if (lastCard.current.id === id && now - lastCard.current.at < repeatWindowMs) return;
            lastCard.current = { id, at: now };

            if (typingInField) e?.preventDefault();
            cbCard.current(id);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            // Let people type in real inputs — the reader works regardless
            // because it types far faster than the gap check below allows.
            const el = e.target as HTMLElement | null;
            const typingInField = !!(
                el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
            );

            const now = Date.now();
            // A pause means a new code is starting (or a human is at the keys).
            if (now - lastKeyAt.current > 120) {
                buf.current = "";
                clearFlush();
            }
            lastKeyAt.current = now;

            // Enter is the usual terminator; plenty of readers ship configured
            // to send Tab instead, and some send nothing at all.
            if (e.key === "Enter" || e.key === "Tab") {
                if (buf.current.length >= 4 && parseCardCode(buf.current)) {
                    // Swallow the key so Tab doesn't move focus and Enter
                    // doesn't submit whatever form is on screen.
                    e.preventDefault();
                }
                commit(typingInField, e);
                return;
            }

            if (e.key.length === 1) {
                buf.current += e.key;
                // Fallback for readers with no terminator configured: once the
                // characters stop arriving, take what we have. Well past the
                // 120ms burst gap, so it can't fire mid-scan.
                clearFlush();
                if (parseCardCode(buf.current)) {
                    flushTimer.current = setTimeout(() => commit(typingInField), 250);
                }
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            clearFlush();
        };
    }, [enabled, repeatWindowMs]);
}
