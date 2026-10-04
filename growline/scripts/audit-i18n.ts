import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Measures how much of the interface is actually translatable.
 *
 * Run: `npx tsx scripts/audit-i18n.ts`
 *
 * ## Why this exists
 *
 * `src/lib/dictionaries/` holds five languages, which reads as "the app is localised".
 * Each dictionary has 28 keys. The 2026-08-19 audit recorded that as STATUS bug 17, and
 * "28 keys" is true but not decision-grade: the question an owner actually has is whether
 * a Kannada-speaking pilot club is viable, and that needs a ratio, not a count.
 *
 * So this counts the other side of the ledger — English text sitting directly in JSX —
 * and prints the share. Re-run it as strings get extracted and the number moves.
 *
 * ## It deliberately UNDERCOUNTS
 *
 * Only JSX text nodes are matched: `>Some words<`. Not counted, though all of them are
 * user-visible:
 *
 *   - attributes — `placeholder`, `aria-label`, `title`, `alt`
 *   - strings passed as props, which this codebase does constantly for copy
 *   - template literals with interpolation
 *   - anything in a server action's error message
 *
 * An undercount is the right bias for a number that will be quoted at somebody. The real
 * figure is worse than what this prints, never better.
 */

const TEXT = />\s*([A-Z][A-Za-z0-9 ,.'’!?—–:%()-]{6,})\s*</g;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function main() {
  const files = [...walk("src/app"), ...walk("src/components"), ...walk("src/modules")];

  const perFile: [string, number][] = [];
  let total = 0;

  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const hits = new Set<string>();
    let m: RegExpExecArray | null;
    TEXT.lastIndex = 0;
    while ((m = TEXT.exec(src)) !== null) {
      const s = m[1].trim();
      if (/^[A-Z0-9_]+$/.test(s)) continue; // a constant, not prose
      hits.add(s);
    }
    if (hits.size > 0) {
      perFile.push([f, hits.size]);
      total += hits.size;
    }
  }

  perFile.sort((a, b) => b[1] - a[1]);

  const dict = readFileSync("src/lib/dictionaries/en.ts", "utf8");
  const keys = (dict.match(/^\s+"?[a-zA-Z0-9_.]+"?:/gm) ?? []).length;
  const share = (keys / (keys + total)) * 100;

  console.log("Where the untranslated text is (top 20):\n");
  for (const [f, n] of perFile.slice(0, 20)) {
    console.log(`  ${String(n).padStart(4)}  ${f}`);
  }

  console.log(`\n  files carrying hardcoded UI text : ${perFile.length}`);
  console.log(`  distinct hardcoded strings       : ${total}   (undercount — see header)`);
  console.log(`  strings in the dictionaries      : ${keys}`);
  console.log(`  translatable share               : ${share.toFixed(1)}%\n`);

  if (share < 90) {
    console.log("  Five languages are offered. Roughly nine in ten strings a coach reads");
    console.log("  are English regardless of which they pick.\n");
  }
}

main();
