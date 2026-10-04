import type { MetadataRoute } from "next";

/**
 * The web app manifest — what makes Growline installable (v1 §10).
 *
 * ## What was actually broken
 *
 * `public/sw.js` has cached routes for the weak-signal case since Phase 2, so the
 * offline half of "installable PWA" has always worked. The other half never did: with
 * no manifest, Chrome on Android offers no "Add to home screen", there is no standalone
 * window, no launcher icon, and no splash. A coach told to "install the app" had nothing
 * to install. The 2026-08-19 audit found it; no status document had recorded it.
 *
 * ## Why a route and not a static file
 *
 * `app/manifest.ts` is Next's metadata route: it emits `/manifest.webmanifest` AND
 * injects the `<link rel="manifest">` into every page, so the two can never drift the
 * way a hand-written file in `public/` plus a hand-written tag in the layout eventually
 * do. It is static — no request-time API is used here — so it is cached, not rendered
 * per request.
 *
 * The route name is already in `RESERVED_SLUGS`, so no coach could have claimed
 * `growline.in/manifest` and shadowed it. `icons` is reserved alongside it for the same
 * reason, now that `/icons/*` serves real files.
 *
 * ## Colours are the dark theme's, deliberately
 *
 * `background_color` paints the splash screen while the app boots, and `theme_color` the
 * status bar. Both are `--bg` from `globals.css`. Dark is the default theme (v2 §4), and
 * a light splash flashing before a dark app is the exact "light flash" the ThemeScript
 * exists to prevent — reintroducing it at the launcher would undo that work one layer up.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable identity for the installed app. Without it the install is keyed on
    // start_url, and changing that later would strand the existing installs as orphans.
    id: "/",
    name: "Growline: Coach Business App",
    short_name: "Growline",
    description:
      "Capture a person in 30 seconds, send their wellness report on WhatsApp, log today's work, and watch your line grow.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    /**
     * The splash ground, and the one place a theme-aware app has to pick a side:
     * the manifest takes a single value and cannot carry a media query the way
     * `viewport.themeColor` can.
     *
     * It is the light Sunrise ground, which is the app's default. Before this it
     * was `#0B1020` — the near-black navy of "Dark Achiever", a design system
     * deleted two reskins ago. Every cold start on Android, the whole target
     * platform, painted a navy splash and then loaded a cream app.
     *
     * A coach whose phone is in system dark mode still gets one wrong frame, in
     * the other direction. That is not fixable here; it is fixed as far as it can
     * be in `layout.tsx`, where the status bar DOES get a media query.
     */
    background_color: "#fff9f2",
    theme_color: "#fff9f2",
    lang: "en-IN",
    dir: "ltr",
    categories: ["business", "productivity"],

    /**
     * Chrome requires a 192 and a 512 to offer installation at all, and wants a
     * `maskable` set as well — without one, Android pads the square icon into a white
     * circle, which on a dark icon looks like a rendering fault. The maskable art is
     * drawn smaller so it survives the circular crop. See `scripts/make-icons.ts`.
     */
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],

    /**
     * Long-press the launcher icon and these three are one tap away. They are the three
     * daily actions the 30-second rule (v1 §4.1) is written about — capture on the road,
     * log in the evening, check the line — so the shortcut menu is the daily loop rather
     * than a menu of screens.
     *
     * Signed out they land on /login like any other route; that is the ordinary path,
     * not a special case worth handling.
     */
    shortcuts: [
      {
        name: "New person",
        short_name: "New person",
        description: "Capture someone you just met",
        url: "/prospects/new",
      },
      {
        name: "Today's work",
        short_name: "Today's work",
        description: "Log what you did today",
        url: "/log",
      },
      {
        name: "My team",
        short_name: "My team",
        description: "See your line",
        url: "/team",
      },
    ],
  };
}
