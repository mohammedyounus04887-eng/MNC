/**
 * The one place that answers "which member is logged in?".
 *
 * Everything the club records against a member — orders, payments,
 * attendance, credits — is keyed by the member's **Firestore document id**.
 * Reception writes `memberId: member.id`, and that is the id the QR cards
 * encode too.
 *
 * The member app was asking a different question. Several screens used
 * `firebaseUser.uid`, the Firebase Auth id, as if it were the same thing. It
 * is the same thing only for members who signed themselves up through
 * `Join.tsx`, which creates the member document *at* the uid. Members created
 * by the club — `hooks/owner/useMembers.ts` uses `addDoc` — get a random
 * document id that has nothing to do with their login. For those members,
 * which is most of them, every uid-keyed query matched nothing: the order
 * history page was simply empty, with no error to explain it.
 *
 * `lib/auth.tsx` already resolves the member document properly (uid first,
 * then email) and exposes it as `userProfile`. This hook is the single
 * expression for reading the right id off it, so no screen has to remember
 * which of the two ids it wants.
 */

import { useAuth } from "@/lib/auth";

/**
 * The logged-in member's Firestore document id, or null if nobody is signed
 * in / the profile hasn't resolved yet.
 *
 * Falls back to the auth uid so self-signed-up members keep working while the
 * profile is still loading — for them the two ids are identical anyway.
 */
export function useMyMemberId(): string | null {
    const { userProfile, firebaseUser } = useAuth();
    return userProfile?.id ?? firebaseUser?.uid ?? null;
}
