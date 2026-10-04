import { execFileSync } from "child_process";
import path from "path";
import type { NextConfig } from "next";

/**
 * Which commit is actually serving, resolved once at BUILD time.
 *
 * ## Why the deployment needs to say this out loud
 *
 * A failed App Hosting rollout does not take the site down — the previous good
 * build keeps serving. So "the site loads" is not evidence that a rollout
 * succeeded, and for the whole life of this project there has been no way to tell
 * the two apart from outside. That is the same gap D83 opened `/status` to close:
 * the person who can see the problem is on a phone and cannot read Cloud Run logs.
 *
 * ## Why a chain, and why it can never throw
 *
 * Which variables App Hosting's builder exposes is not something this repo can
 * verify from here, so it asks in order and falls through: an explicit override,
 * then Cloud Build's own, then git (the builder clones the repo, so `.git` is
 * usually present), then nothing. A build stamp that could fail a build would be a
 * diagnostic that causes outages, which is worse than no diagnostic.
 *
 * `BUILT_AT` is the belt to that braces: a timestamp always resolves, so even when
 * the SHA comes back "unknown" the page can still say whether what is serving is
 * from ten minutes ago or from last week.
 */
function buildSha(): string {
  const fromEnv =
    process.env.BUILD_SHA ?? process.env.COMMIT_SHA ?? process.env.SHORT_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  // Inlined at compile time. Not secret — this repo is public, and the commit it
  // was built from is exactly what someone diagnosing a bad rollout needs.
  env: {
    BUILD_SHA: buildSha(),
    BUILT_AT: new Date().toISOString(),
  },
  reactCompiler: true,
  // Pin the workspace root: a stray package-lock.json in the parent folder
  // otherwise makes Turbopack guess C:\Users\pc.
  turbopack: { root: path.resolve(__dirname) },
  // The report fonts are read from disk at render time (report-fonts.ts), so the
  // tracer cannot see them — there is no `import` to follow, only a `readFile` of a
  // path built at runtime. Without this the three image routes deploy without their
  // fonts and fall straight back to fetching Google, which is the thing D66 exists
  // to stop. `assets/fonts` is server-only on purpose and is NOT under `public/`.
  outputFileTracingIncludes: {
    "/r/[token]/card.png": ["./assets/fonts/**"],
    "/r/[token]/preview.png": ["./assets/fonts/**"],
    "/r/[token]/snapshot.pdf": ["./assets/fonts/**"],
  },
  async headers() {
    return [
      {
        // A wellness snapshot link is a bearer credential holding someone else's
        // personal details, and it travels through WhatsApp forwards and chat
        // backups. Keep it out of indexes, caches and referrer headers.
        source: "/r/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        // The public capture form collects personal details; same reasoning.
        source: "/c/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
