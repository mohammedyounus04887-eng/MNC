import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Generates the next Member ID for a club.
 * Format: {PREFIX}-{LETTER}-{NUMBER}
 * e.g. MNC-A-001, MNC-A-002 ... MNC-A-999, MNC-B-001 ...
 */
export function generatePrefixFromName(clubName: string): string {
    return clubName
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0].toUpperCase())
        .join("");
}

export async function generateMemberId(clubId: string, prefix: string): Promise<string> {
    const snap = await getDocs(
        query(collection(db, `clubs/${clubId}/members`))
    );

    let highestLetter = "A";
    let highestNumber = 0;

    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const memberId: string | undefined = data.memberId;
        if (!memberId) continue;
        // Expected format: PREFIX-LETTER-NUMBER
        const parts = memberId.split("-");
        if (parts.length < 3) continue;
        const letter = parts[parts.length - 2]; // second-to-last part
        const number = parseInt(parts[parts.length - 1], 10);
        if (isNaN(number)) continue;

        // Compare: letter first, then number
        if (
            letter > highestLetter ||
            (letter === highestLetter && number > highestNumber)
        ) {
            highestLetter = letter;
            highestNumber = number;
        }
    }

    // Increment
    let nextLetter = highestLetter;
    let nextNumber = highestNumber + 1;

    if (nextNumber > 999) {
        // Increment letter (A→B, B→C, ..., Z→AA — but Z is unlikely)
        const charCode = highestLetter.charCodeAt(0) + 1;
        nextLetter = String.fromCharCode(charCode);
        nextNumber = 1;
    }

    const paddedNumber = String(nextNumber).padStart(3, "0");
    return `${prefix}-${nextLetter}-${paddedNumber}`;
}
