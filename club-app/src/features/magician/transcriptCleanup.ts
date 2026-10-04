// ─── Transcript cleanup ──────────────────────────────────────────────────
// Web Speech API on Android/Chrome (tablets, phones) is noisy: it ends
// and restarts recognition sessions aggressively, and each new session
// often "re-hears" the tail of the previous utterance, producing patterns
// like:
//     "good" → "good morning" → "morning" → "good morning"
// Result, naively concatenated: "good good morning morning good morning"
//
// We can't change microphone sensitivity from JS. What we can do is clean
// up the text deterministically:
//   1. Merge two strings by collapsing the longest overlap of
//      (suffix of A) == (prefix of B)
//   2. Collapse consecutive duplicate words
//   3. Collapse repeated short phrases ("good morning good morning" → "good morning")
//
// Pure functions — no DOM, no React, easy to unit test.

const norm = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

/**
 * Merge `next` into `prev`, removing the largest overlap where the suffix
 * of `prev` (word-aligned, case-insensitive, punctuation-insensitive) is
 * equal to a prefix of `next`.
 *
 *   mergeOverlap("good morning", "morning sir")  → "good morning sir"
 *   mergeOverlap("hello there", "good morning")  → "hello there good morning"
 *   mergeOverlap("", "good morning")             → "good morning"
 */
export function mergeOverlap(prev: string, next: string): string {
    if (!prev) return next.trim();
    if (!next) return prev.trim();
    const prevWords = prev.trim().split(/\s+/);
    const nextWords = next.trim().split(/\s+/);
    const nPrev = norm(prev).split(/\s+/).filter(Boolean);
    const nNext = norm(next).split(/\s+/).filter(Boolean);
    const maxOverlap = Math.min(nPrev.length, nNext.length);
    let best = 0;
    for (let n = maxOverlap; n >= 1; n--) {
        let match = true;
        for (let i = 0; i < n; i++) {
            if (nPrev[nPrev.length - n + i] !== nNext[i]) { match = false; break; }
        }
        if (match) { best = n; break; }
    }
    // Drop `best` leading words of next (use the source words, not normalized)
    // The normalized arrays should be 1-to-1 with source arrays in length;
    // if normalization removed a whole token (purely punctuation), the source
    // would still have it. Worst case we lose a punctuation token — fine.
    const remaining = nextWords.slice(best);
    return [...prevWords, ...remaining].join(" ");
}

/**
 * Collapse runs of the same word, case-insensitive.
 *   "good good morning"           → "good morning"
 *   "good morning morning sir"    → "good morning sir"
 *   "GOOD good morning Morning"   → "GOOD morning"  (keeps first casing)
 */
export function dedupeConsecutiveWords(text: string): string {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (const w of words) {
        const prev = out[out.length - 1];
        if (prev && prev.toLowerCase() === w.toLowerCase()) continue;
        out.push(w);
    }
    return out.join(" ");
}

/**
 * Collapse `[phrase][phrase]` runs for phrase lengths 2..maxLen.
 *   "good morning good morning sir"                   → "good morning sir"
 *   "orange shake orange shake with ice"              → "orange shake with ice"
 *   "for rahul for rahul please"                      → "for rahul please"
 * Runs of 3+ copies also collapse to one.
 */
export function dedupeRepeatedPhrases(text: string, maxLen = 5): string {
    let words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length < 4) return words.join(" ");
    for (let len = Math.min(maxLen, Math.floor(words.length / 2)); len >= 2; len--) {
        const out: string[] = [];
        let i = 0;
        while (i < words.length) {
            // Look ahead: if words[i..i+len] equals words[i+len..i+2*len], skip the duplicate
            let dupFound = false;
            if (i + 2 * len <= words.length) {
                let allEqual = true;
                for (let k = 0; k < len; k++) {
                    if (words[i + k].toLowerCase() !== words[i + len + k].toLowerCase()) {
                        allEqual = false; break;
                    }
                }
                if (allEqual) {
                    // Keep this copy; skip the next. Re-check from same i to
                    // also collapse 3+ runs.
                    out.push(...words.slice(i, i + len));
                    i += 2 * len;
                    // Continue skipping further duplicate copies after the pair
                    while (i + len <= words.length) {
                        let again = true;
                        for (let k = 0; k < len; k++) {
                            if (words[i + k - len].toLowerCase() !== words[i + k].toLowerCase()) {
                                again = false; break;
                            }
                        }
                        if (again) i += len; else break;
                    }
                    dupFound = true;
                }
            }
            if (!dupFound) {
                out.push(words[i]);
                i++;
            }
        }
        words = out;
    }
    return words.join(" ");
}

/**
 * Pipeline: dedupe word runs first (the cheap fix), then dedupe phrase runs
 * up to length 5. Idempotent.
 */
export function cleanTranscript(text: string): string {
    if (!text) return "";
    let t = text.replace(/\s+/g, " ").trim();
    t = dedupeConsecutiveWords(t);
    t = dedupeRepeatedPhrases(t, 5);
    return t;
}
