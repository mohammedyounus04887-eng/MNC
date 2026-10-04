/**
 * Screen-to-screen motion for the signed-in app (v2 §4 motion budget).
 *
 * A template remounts on every navigation below it, unlike the layout — which
 * is the entire trick: the nav shell in layout.tsx stays put while the screen
 * content re-enters with the existing 220ms gl-rise (fade + 6px lift). Without
 * this, tapping a tab swapped the pixels in a single frame, which is the
 * "old 1990s application" feel the first field test reported — no screen ever
 * arrived, it was simply suddenly there.
 *
 * Budget compliance: 220ms ease-out (G5's 150–250 window), transform+opacity
 * only (compositor-friendly on a ₹10K Android), non-blocking (input works
 * mid-animation), and prefers-reduced-motion collapses it to an instant state
 * change via the global override in globals.css.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-rise">{children}</div>;
}
