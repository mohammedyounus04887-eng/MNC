/**
 * Sets `data-theme` before the first paint.
 *
 * Without this the page renders in the default theme and then snaps to the stored
 * one — a flash of the wrong theme on every load. It has to be a blocking inline
 * script for the same reason: any React-based approach runs after paint, which is
 * exactly too late.
 *
 * Resolution order:
 *   1. an explicit choice in Settings
 *   2. otherwise the system preference on first run
 *   3. otherwise LIGHT, which is now the default
 *
 * The default flipped with Design System 3.1 "Sunrise". v2 §4 made dark the
 * default on the reasoning that this audience is "overwhelmingly on dark" — a
 * claim never tested against a real coach. Sunrise IS a light identity, so
 * shipping it behind a dark default would mean nobody ever sees the chosen
 * design; and the app's defining use is a morning walk outdoors, where a warm
 * light ground beats a dark one on a cheap screen in Indian sun. Dark remains a
 * first-class option for evening use, one tap away in Settings.
 */
export const THEME_KEY = "growline:theme";

const script = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_KEY)});
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
      return;
    }
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } catch (e) {
    // Private mode, storage disabled, anything else: fall back to the default.
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
`;

export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
