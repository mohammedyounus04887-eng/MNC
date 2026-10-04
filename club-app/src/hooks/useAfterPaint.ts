/**
 * False until the screen has been drawn, then true.
 *
 * For work that belongs on a page but is not what the page is *for*. The member
 * home shows the week's top performer, and finding that costs a read of every
 * member plus a weigh-in query each — around two hundred round trips, all of
 * them ahead of the member seeing their own credits and today's menu.
 *
 * Gating on this puts the page first: it paints from its own data, and the
 * extra arrives a moment later into a screen somebody is already reading.
 *
 * `requestIdleCallback` where it exists (Chrome, which is what the club's
 * Android tablets and phones run), a timeout everywhere else — Safari still
 * does not have it.
 */

import { useEffect, useState } from "react";

export function useAfterPaint(): boolean {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const go = () => { if (!cancelled) setReady(true); };

        const ric = (window as unknown as {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        }).requestIdleCallback;

        // The timeout is a floor, not a target: idle may never come on a busy
        // page, and the top performer should still turn up.
        if (typeof ric === "function") {
            const id = ric(go, { timeout: 2000 });
            return () => {
                cancelled = true;
                (window as unknown as { cancelIdleCallback?: (h: number) => void })
                    .cancelIdleCallback?.(id);
            };
        }

        const t = setTimeout(go, 300);
        return () => { cancelled = true; clearTimeout(t); };
    }, []);

    return ready;
}
