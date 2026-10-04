import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

/**
 * Generates the app icons from one vector source.
 *
 * Run: `npx tsx scripts/make-icons.ts`
 *
 * ## Why a script and not eight committed PNGs from somewhere
 *
 * The icons ARE committed — a build must not depend on this running. But an icon set
 * with no source is a set nobody can change: the next person who needs a different size,
 * or who wants the mark a shade lighter, has to redraw it. The SVG below is the source
 * and this turns it into the sizes the platforms ask for.
 *
 * `sharp` is already a dependency (Next uses it for image optimisation), so this adds
 * nothing to install.
 *
 * ## The mark
 *
 * A rising line with a lit apex. The name is literally grow + line, and the same shape
 * reads as both the growth chart a coach is chasing and the line of people they build.
 * Nothing here is or resembles any company's logo (RULES L1) — it is a geometric mark
 * drawn from the app's own tokens.
 *
 * The stroke uses a gradient rather than a flat fill: flat colour reads as cheap at
 * 48px, which is the size that actually matters on a launcher.
 *
 * ## The palette moved, and this file did not follow it for two releases
 *
 * The mark was drawn for "Dark Achiever" — a champagne-gold line on a near-black
 * navy ground. That design system was replaced twice and is gone; the app is now
 * Sunrise (warm cream ground, burnt terracotta accent). The icon kept shipping in
 * the old palette because nothing about it is wrong on its own — an icon is only
 * wrong NEXT to the app, and no test compares the two.
 *
 * The relationship worth preserving is not the colours, it is the contrast job:
 * a bright mark on a deep ground, so the shape survives at 48px among thirty other
 * icons. Sunrise assigns those roles to different hues, so the ground is now the
 * terracotta core and the mark is the cream. Same drawing, same reason.
 */

const GROUND = "#c4490a"; // --accent, the terracotta core
const MARK_HI = "#fff9f2"; // --bg, the cream ground doing duty as the highlight
const MARK = "#ffddc0";
/**
 * The gradient's depth stop, and the ONE value that could not be carried over
 * literally. Dark Achiever's was #8a5a0a — a brown gold that still read against a
 * near-black ground. The same move here (--accent-lo #8f3406 on --accent #c4490a)
 * is 1.3:1: the foot of the stroke would disappear into the ground entirely, and
 * the foot is where the line starts. This is 2.8:1 against the ground — enough to
 * hold an edge on a thick stroke while still reading as depth rather than a
 * second colour.
 */
const MARK_LO = "#f0b689";
/** The three bars sit UNDER the stroke, so they go the other way: darker than the
 *  ground, a shadow of it rather than a mark on it. */
const SHADOW = "#8f3406";

/**
 * @param radius  corner rounding in the 512 space. 0 for maskable and Apple, which do
 *                their own masking and must be full-bleed.
 * @param scale   how much of the square the mark occupies. Maskable icons are cropped
 *                to a circle of 80% width on some launchers, so the art shrinks to stay
 *                inside that safe zone.
 */
function svg(radius: number, scale: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${MARK_HI}"/>
      <stop offset="0.55" stop-color="${MARK}"/>
      <stop offset="1" stop-color="${MARK_LO}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="512" height="512" rx="${radius}" ry="${radius}" fill="${GROUND}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-272 -270)">
    <!-- Three rising members: the line a coach builds, and the chart it produces.
         Drawn under the stroke so the stroke reads as the through-line. -->
    <g fill="${SHADOW}" opacity="0.55">
      <rect x="92"  y="330" width="58" height="86"  rx="16"/>
      <rect x="198" y="270" width="58" height="146" rx="16"/>
      <rect x="304" y="208" width="58" height="208" rx="16"/>
    </g>
    <!-- Shallow, then steep: growth that accelerates. The elbow has to survive a
         34px stroke at 48px, which is why the second segment turns hard. -->
    <path d="M 118 352 L 224 300 L 330 236 L 410 132"
          fill="none" stroke="url(#metal)" stroke-width="34"
          stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Ground-coloured ring separates the apex from the stroke, so it stays a
         distinct point of light instead of fusing into a pin head. -->
    <circle cx="410" cy="132" r="40" fill="${GROUND}"/>
    <circle cx="410" cy="132" r="32" fill="${MARK_HI}"/>
  </g>
</svg>`;
}

type Job = { file: string; size: number; radius: number; scale: number };

const JOBS: Job[] = [
  // `purpose: any` — shown as drawn, so it rounds its own corners.
  { file: "icon-192.png", size: 192, radius: 112, scale: 1.0 },
  { file: "icon-512.png", size: 512, radius: 112, scale: 1.0 },
  // `purpose: maskable` — full bleed, art inside the 80% safe circle.
  { file: "icon-maskable-192.png", size: 192, radius: 0, scale: 0.7 },
  { file: "icon-maskable-512.png", size: 512, radius: 0, scale: 0.7 },
  // iOS applies its own squircle and does NOT read the manifest.
  { file: "apple-touch-icon.png", size: 180, radius: 0, scale: 0.86 },
];

async function main() {
  const outDir = "public/icons";
  mkdirSync(outDir, { recursive: true });

  for (const job of JOBS) {
    const png = await sharp(Buffer.from(svg(job.radius, job.scale)))
      .resize(job.size, job.size)
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(`${outDir}/${job.file}`, png);
    console.log(`  ${job.file.padEnd(26)} ${String(png.length).padStart(6)} bytes`);
  }

  // The source, committed beside the output so the mark can be edited.
  writeFileSync(`${outDir}/icon.svg`, svg(112, 1.0));
  console.log("  icon.svg (source)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
