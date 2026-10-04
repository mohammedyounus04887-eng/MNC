import { describe, expect, it } from "vitest";
import {
    cleanTranscript,
    dedupeConsecutiveWords,
    dedupeRepeatedPhrases,
    mergeOverlap,
} from "./transcriptCleanup";

describe("dedupeConsecutiveWords", () => {
    it("collapses adjacent duplicates", () => {
        expect(dedupeConsecutiveWords("good good morning")).toBe("good morning");
        expect(dedupeConsecutiveWords("good morning morning sir")).toBe("good morning sir");
    });
    it("is case-insensitive but keeps first casing", () => {
        expect(dedupeConsecutiveWords("GOOD good morning")).toBe("GOOD morning");
    });
    it("does not collapse non-adjacent repeats", () => {
        expect(dedupeConsecutiveWords("rahul and rahul")).toBe("rahul and rahul");
    });
    it("handles empty and single", () => {
        expect(dedupeConsecutiveWords("")).toBe("");
        expect(dedupeConsecutiveWords("hi")).toBe("hi");
    });
});

describe("dedupeRepeatedPhrases", () => {
    it("collapses a doubled bigram", () => {
        expect(dedupeRepeatedPhrases("good morning good morning")).toBe("good morning");
    });
    it("collapses a doubled phrase mid-sentence", () => {
        expect(dedupeRepeatedPhrases("orange shake orange shake with ice")).toBe("orange shake with ice");
    });
    it("collapses a tripled phrase", () => {
        expect(dedupeRepeatedPhrases("for rahul for rahul for rahul please")).toBe("for rahul please");
    });
    it("leaves distinct phrases alone", () => {
        expect(dedupeRepeatedPhrases("good morning hello there")).toBe("good morning hello there");
    });
});

describe("mergeOverlap", () => {
    it("drops the overlap when the suffix matches the prefix", () => {
        expect(mergeOverlap("good morning", "morning sir")).toBe("good morning sir");
    });
    it("handles multi-word overlap", () => {
        expect(mergeOverlap("hello good morning", "good morning sir")).toBe("hello good morning sir");
    });
    it("returns next when prev is empty", () => {
        expect(mergeOverlap("", "good morning")).toBe("good morning");
    });
    it("returns prev when next is empty", () => {
        expect(mergeOverlap("good morning", "")).toBe("good morning");
    });
    it("concatenates when there is no overlap", () => {
        expect(mergeOverlap("hello there", "good morning")).toBe("hello there good morning");
    });
    it("is case-insensitive on the overlap detection", () => {
        expect(mergeOverlap("good Morning", "morning Sir")).toBe("good Morning Sir");
    });
});

describe("cleanTranscript (end-to-end)", () => {
    it("flattens the canonical Android-Chrome avalanche", () => {
        // The literal pattern the user reported:
        //   onresult finals on Android often arrive as a concat like below.
        const raw = "good good morning morning good morning";
        expect(cleanTranscript(raw)).toBe("good morning");
    });
    it("handles realistic noisy order phrasing", () => {
        const raw = "orange shake orange shake with ice for rahul for rahul";
        expect(cleanTranscript(raw)).toBe("orange shake with ice for rahul");
    });
    it("is idempotent", () => {
        const a = cleanTranscript("good good morning morning good morning");
        const b = cleanTranscript(a);
        expect(a).toBe(b);
    });
    it("leaves clean input unchanged", () => {
        const raw = "orange shake with ice for rahul";
        expect(cleanTranscript(raw)).toBe(raw);
    });
});
