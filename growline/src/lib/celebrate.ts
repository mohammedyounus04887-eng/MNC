import { haptic, HAPTIC } from "./haptic";

/**
 * The celebration engine (v2 §4 dopamine map, week 2 of the delight plan).
 *
 * One imperative function, callable from anywhere: `celebrate()`. Not a React
 * provider and not a component, for a specific reason — the moments worth
 * celebrating are scattered across screens that share no ancestor (a target ring,
 * a pipeline control, a log form), and threading context through all of them to
 * draw pixels on top of everything would be architecture in service of confetti.
 *
 * ## Why hand-rolled and not a library
 *
 * canvas-confetti is ~5KB gzipped and does far more than this needs. The whole
 * mechanism below is one canvas, one requestAnimationFrame loop and some gravity.
 * On the phones this app targets, 5KB of parser work is a real cost for a thing
 * that runs a handful of times a week.
 *
 * ## The rules it enforces so no call site has to argue them
 *
 * **Under 1.5s, always** (G5). Hard-capped by the loop itself, not by a caller
 * remembering to stop it.
 *
 * **Never blocks input** (G5). `pointer-events: none` on the canvas — a coach can
 * tap straight through the confetti and carry on. This is why celebration cannot
 * be a modal.
 *
 * **Skippable by tap** (G5). One tap anywhere ends it immediately.
 *
 * **Silent under `prefers-reduced-motion`** (G5). Returns without drawing. The
 * information ("you crossed 50%") is always carried by the screen itself; this
 * only ever adds feeling on top, so removing it removes nothing.
 *
 * **Never on a Trust Zone** (G1). Not enforceable here — a payment screen simply
 * must not call this. Stated at every call site instead.
 *
 * **Scarcity is the mechanic** (G6). Deliberately no "small" variant for routine
 * saves: if an ordinary day fired confetti, day 30 would feel like nothing. Every
 * caller is a landmark.
 */

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
};

/** Hard ceiling from G5. The loop ends here whatever else happens. */
const MAX_MS = 1400;
/** Enough to read as a burst, few enough to stay at 60fps on a ₹10K Android. */
const COUNT = 70;

/**
 * The palette, read from the live theme rather than hard-coded.
 *
 * A previous reskin left a hard-coded gold glow behind that clashed with the new
 * accent for a full release. Reading the tokens means confetti follows the theme
 * — including a future one nobody has designed yet — with no second place to
 * remember to update.
 */
function palette(): string[] {
  const root = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) =>
    root.getPropertyValue(name).trim() || fallback;
  return [
    pick("--accent", "#c4490a"),
    pick("--accent-hi", "#e8590c"),
    pick("--gem-green-text", "#15803d"),
    pick("--gem-pink-text", "#be185d"),
  ];
}

let running = false;

export function celebrate(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  // A second call while one is playing would double the particle load for no
  // extra feeling — and two celebrations at once is what G5 means by "never two
  // glows touching".
  if (running) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  running = true;
  haptic(HAPTIC.milestone);

  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // capped: 3x costs frames
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    running = false;
    return;
  }
  ctx.scale(dpr, dpr);

  const colors = palette();
  const parts: Particle[] = Array.from({ length: COUNT }, () => ({
    // Launched from just below the top edge across the full width, so the burst
    // reads as falling INTO the screen rather than exploding from one point —
    // the moment belongs to the whole screen, not to one button.
    x: Math.random() * w,
    y: -20 - Math.random() * h * 0.25,
    vx: (Math.random() - 0.5) * 2.2,
    vy: 2 + Math.random() * 3.4,
    w: 5 + Math.random() * 5,
    h: 8 + Math.random() * 7,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.24,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const start = performance.now();
  let raf = 0;

  const stop = () => {
    cancelAnimationFrame(raf);
    document.removeEventListener("pointerdown", stop);
    canvas.remove();
    running = false;
  };

  // Skippable (G5). `once` so the listener cannot outlive the canvas.
  document.addEventListener("pointerdown", stop, { once: true });

  const frame = (now: number) => {
    const elapsed = now - start;
    if (elapsed >= MAX_MS) return stop();

    // Fade the last third rather than cutting to nothing — an abrupt disappearance
    // reads as a bug, a fade reads as an ending.
    ctx.globalAlpha = elapsed > MAX_MS * 0.66 ? 1 - (elapsed - MAX_MS * 0.66) / (MAX_MS * 0.34) : 1;
    ctx.clearRect(0, 0, w, h);

    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.09; // gravity
      p.vx *= 0.995; // air
      p.rot += p.vr;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
