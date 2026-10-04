import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Fonts for the rendered report surfaces — the card PNG, the link preview and the
 * PDF (v2 §5.5).
 *
 * ## Why this file exists
 *
 * `next/og` bundles satori with exactly one face, Geist Regular. Two things follow,
 * and D18 flagged both rather than fixing them because the fix meant committing
 * binaries:
 *
 * 1. `fontWeight: 700` against a single 400-weight face is a silent no-op. The card
 *    built its hierarchy out of size and colour instead.
 * 2. **A glyph Geist does not have is fetched from Google at render time**, and the
 *    request carries the missing text: `next/og` calls
 *    `fonts.googleapis.com/css2?family=…&text=<the string>`. For a Devanagari or
 *    Kannada prospect, that is their name leaving the server, on the request path,
 *    to a third party — with the latency and the hard egress dependency thrown in.
 *
 * Shipping the faces ourselves fixes both. `satori` cannot parse `woff2`, and
 * `next/font` emits CSS rather than font bytes, so these have to be `.ttf` files on
 * disk. They live in `assets/fonts/` — NOT `public/`, which would serve 2.7MB of
 * fonts to browsers that never need them; only the server draws these images.
 *
 * ## Coverage, and why `safe()` exists
 *
 * Shipping five scripts makes the Google fetch unlikely. It does not make it
 * impossible — a Bengali name would still trigger it, silently, exactly as before.
 * So coverage is read out of each font's own `cmap` and anything no shipped face can
 * draw is replaced before it reaches satori. That is what turns "no network font
 * fetches at render time" from a hope into a property: satori is never handed a
 * character it has to go and look for.
 *
 * The cost is that an uncovered name renders as replacement marks instead of
 * correctly. That is the deliberate trade — see D66. Adding a script is one entry in
 * `SCRIPTS` plus two files.
 */

/** Scripts we ship faces for. `latin` is always loaded; the rest are on demand. */
export type ScriptKey = "latin" | "devanagari" | "kannada" | "tamil" | "telugu";

type ScriptSpec = {
  /** Basename of the two files in `assets/fonts/`, without the weight suffix. */
  file: string;
  /**
   * The family name this face is registered under. Must be UNIQUE per script — see
   * the note on `CARD_FONT_FAMILY`.
   */
  family: string;
  /**
   * The block that says "this script is present". Only used to decide which files
   * to READ — what can actually be drawn is decided by the cmap, below.
   */
  detect: RegExp | null;
};

/**
 * The five scripts the app itself offers as UI languages (D59). Latin is not
 * optional: every card carries English labels, the disclaimer, and digits.
 *
 * To add a script: drop `NotoSansX-Regular.ttf` and `-Bold.ttf` into
 * `assets/fonts/`, add a row here, and add a case to `tests/report-fonts.test.ts`.
 */
const SCRIPTS: Record<ScriptKey, ScriptSpec> = {
  latin: { file: "NotoSans", family: "Noto Sans", detect: null },
  // Devanagari proper, plus Devanagari Extended and the Vedic marks that sit
  // outside the main block.
  devanagari: {
    file: "NotoSansDevanagari",
    family: "Noto Sans Devanagari",
    detect: /[ऀ-ॿ꣠-ꣿ]/u,
  },
  kannada: { file: "NotoSansKannada", family: "Noto Sans Kannada", detect: /[ಀ-೿]/u },
  // Tamil, plus the Tamil Supplement plane.
  tamil: {
    file: "NotoSansTamil",
    family: "Noto Sans Tamil",
    detect: /[஀-௿]|[\u{11FC0}-\u{11FFF}]/u,
  },
  telugu: { file: "NotoSansTelugu", family: "Noto Sans Telugu", detect: /[ఀ-౿]/u },
};

/**
 * The family the card names in `fontFamily`. Everything else is reached by
 * fallback.
 *
 * **Each script must be registered under its OWN family name.** The obvious design
 * — every face called "Noto Sans", let satori pick per glyph — silently does not
 * work: satori keeps one face per (family, weight, style), so the Indic faces were
 * being dropped on load and the Devanagari name still went to Google. Measured, all
 * five scripts, in `tests/report-fonts.test.ts`.
 *
 * What DOES work is satori's cross-family fallback: name one family on the element,
 * register the rest under their own names, and a glyph the named family lacks is
 * looked up in the other loaded families before anything reaches the network. The
 * card therefore never has to know which script the prospect's name is in.
 */
export const CARD_FONT_FAMILY = SCRIPTS.latin.family;

export type CardFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
};

/**
 * Formatting characters that carry no ink. If a face has no `cmap` entry for one,
 * DROPPING it is right and substituting is wrong: a replacement mark would be a
 * visible box where the author intended nothing visible at all. ZWJ and ZWNJ in
 * particular are ordinary parts of correctly typed Indic text.
 */
const INVISIBLE = new Set([
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff,
]);

const REPLACEMENT = "�";

const FONT_DIR = join(process.cwd(), "assets", "fonts");

type LoadedFace = { data: Buffer; covers: Set<number> };

/**
 * Read once, keep for the life of the process. The faces do not depend on the
 * request, and re-reading 2.7MB off disk per image would be the slowest thing on
 * this path. Promises are cached rather than buffers so two concurrent renders of
 * the same script share one read instead of racing.
 */
const faceCache = new Map<string, Promise<LoadedFace>>();

function loadFace(file: string, weight: "Regular" | "Bold"): Promise<LoadedFace> {
  const key = `${file}-${weight}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const pending = readFile(join(FONT_DIR, `${key}.ttf`)).then((data) => ({
    data,
    covers: readCoverage(data),
  }));
  faceCache.set(key, pending);
  // A failed read must not be cached as a permanent failure — a transient EMFILE
  // under load would otherwise disable the script for the rest of the process.
  pending.catch(() => faceCache.delete(key));
  return pending;
}

/** Which of our scripts appear in the given strings. `latin` is always first. */
export function scriptsIn(texts: readonly (string | null | undefined)[]): ScriptKey[] {
  const joined = texts.filter(Boolean).join(" ");
  const found: ScriptKey[] = ["latin"];
  for (const [key, spec] of Object.entries(SCRIPTS) as [ScriptKey, ScriptSpec][]) {
    if (spec.detect && spec.detect.test(joined)) found.push(key);
  }
  return found;
}

/**
 * The faces to hand `ImageResponse`, plus a `safe()` that guarantees satori is never
 * asked to draw something it would have to fetch.
 *
 * `variableText` is every string on the card that comes from data rather than from
 * `report-copy.ts` — realistically the prospect's first name, the coach's name and
 * their city. Static English copy is covered by Latin by construction.
 */
export async function cardFonts(
  variableText: readonly (string | null | undefined)[]
): Promise<{
  fonts: CardFont[];
  scripts: ScriptKey[];
  safe: (s: string) => string;
  safeOrNull: (s: string | null) => string | null;
}> {
  const scripts = scriptsIn(variableText);

  const faces = await Promise.all(
    scripts.flatMap((key) => {
      const { file, family } = SCRIPTS[key];
      return [
        loadFace(file, "Regular").then((f) => ({ f, family, weight: 400 as const })),
        loadFace(file, "Bold").then((f) => ({ f, family, weight: 700 as const })),
      ];
    })
  );

  const covers = new Set<number>();
  for (const { f } of faces) for (const cp of f.covers) covers.add(cp);

  const safe = (s: string) => sanitise(s, covers);

  return {
    fonts: faces.map(({ f, family, weight }) => ({
      name: family,
      // `Buffer` is a `Uint8Array` view that may sit inside a larger pool, so the
      // whole pool would be handed over without the byteOffset slice.
      data: f.data.buffer.slice(
        f.data.byteOffset,
        f.data.byteOffset + f.data.byteLength
      ) as ArrayBuffer,
      weight,
      style: "normal" as const,
    })),
    scripts,
    safe,
    safeOrNull: (s) => (s === null ? null : safe(s)),
  };
}

/**
 * Replaces every character no loaded face can draw. Iterates by code point, so an
 * astral character is one unit and never gets split into lone surrogates.
 */
function sanitise(text: string, covers: Set<number>): string {
  let out = "";
  let dropped = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (covers.has(cp)) {
      out += ch;
    } else if (INVISIBLE.has(cp)) {
      // Nothing to draw; leaving it out is invisible either way.
    } else {
      out += REPLACEMENT;
      dropped += 1;
    }
  }
  if (dropped > 0) {
    // Logged, never thrown: a name we cannot draw must not take the whole report
    // down. This line is the signal that a script needs adding to SCRIPTS.
    console.warn(
      `[growline] report card: ${dropped} character(s) outside the shipped fonts were replaced`
    );
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * cmap reading
 *
 * Only enough of the spec to answer "can this face draw this code point".
 * Formats 4 (BMP) and 12 (full range) are the two the Noto TTFs use.
 * ------------------------------------------------------------------ */

function readCoverage(font: Buffer): Set<number> {
  const covers = new Set<number>();
  const cmap = findTable(font, "cmap");
  if (cmap === null) return covers;

  const numSubtables = font.readUInt16BE(cmap + 2);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < numSubtables; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = font.readUInt16BE(rec);
    const encoding = font.readUInt16BE(rec + 2);
    const offset = cmap + font.readUInt32BE(rec + 4);
    // Prefer the widest Unicode mapping available.
    const score =
      (platform === 3 && encoding === 10) || (platform === 0 && encoding >= 4)
        ? 3
        : (platform === 3 && encoding === 1) || (platform === 0 && encoding >= 0)
          ? 2
          : 0;
    if (score > bestScore && offset + 4 <= font.length) {
      best = offset;
      bestScore = score;
    }
  }
  if (best < 0) return covers;

  const format = font.readUInt16BE(best);
  if (format === 4) readFormat4(font, best, covers);
  else if (format === 12) readFormat12(font, best, covers);
  return covers;
}

function findTable(font: Buffer, tag: string): number | null {
  if (font.length < 12) return null;
  const numTables = font.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > font.length) return null;
    if (font.toString("latin1", rec, rec + 4) === tag) return font.readUInt32BE(rec + 8);
  }
  return null;
}

function readFormat4(font: Buffer, at: number, covers: Set<number>) {
  const segCount = font.readUInt16BE(at + 6) / 2;
  const endAt = at + 14;
  const startAt = endAt + segCount * 2 + 2;
  const deltaAt = startAt + segCount * 2;
  const rangeAt = deltaAt + segCount * 2;

  for (let s = 0; s < segCount; s++) {
    const end = font.readUInt16BE(endAt + s * 2);
    const start = font.readUInt16BE(startAt + s * 2);
    if (start > end) continue;
    const delta = font.readInt16BE(deltaAt + s * 2);
    const rangeOffset = font.readUInt16BE(rangeAt + s * 2);

    for (let cp = start; cp <= end; cp++) {
      // The final segment is the mandatory 0xFFFF terminator; it maps to .notdef.
      if (cp === 0xffff) continue;
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (cp + delta) & 0xffff;
      } else {
        const gi = rangeAt + s * 2 + rangeOffset + (cp - start) * 2;
        if (gi + 2 > font.length) continue;
        const raw = font.readUInt16BE(gi);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) covers.add(cp);
    }
  }
}

function readFormat12(font: Buffer, at: number, covers: Set<number>) {
  const nGroups = font.readUInt32BE(at + 12);
  for (let g = 0; g < nGroups; g++) {
    const rec = at + 16 + g * 12;
    if (rec + 12 > font.length) return;
    const start = font.readUInt32BE(rec);
    const end = font.readUInt32BE(rec + 4);
    const startGlyph = font.readUInt32BE(rec + 8);
    if (startGlyph === 0 && start === end) continue;
    // Guard against a malformed group claiming the whole plane.
    if (end - start > 0x10ffff) return;
    for (let cp = start; cp <= end; cp++) {
      if (startGlyph + (cp - start) !== 0) covers.add(cp);
    }
  }
}
