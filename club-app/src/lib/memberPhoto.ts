/**
 * A member's picture — one writer, one reader.
 *
 * The problem this fixes: a member's photo lives under **two** field names.
 *
 *   `photo`      written by the member app's profile edit
 *   `photoUrl`   written by face enrolment at reception
 *
 * and roughly ninety screens read them as `photoUrl || photo`, i.e. the
 * reception one wins. So a member who was ever enrolled at the desk could
 * change their picture in the app, see it update on their own profile, and
 * keep showing the **old** face on the reception grid, the kitchen cards, the
 * TV and every report — because those all preferred `photoUrl`, which the app
 * never touched.
 *
 * Rather than pick a winner and migrate ~90 read sites (any one missed would
 * silently keep showing a stale face), `setMemberPhoto` writes **both** names
 * together. Whichever field a screen prefers, it now gets the same, newest
 * picture. New code should read through `memberPhotoOf`.
 *
 * Note on orders: an order stores a *copy* of the photo as `memberPhoto` at the
 * moment it is placed, so the kitchen card keeps showing the face that was
 * current when the shake was ordered. That is deliberate — it is a record of
 * who ordered, not a live lookup — and changing a photo does not rewrite
 * yesterday's tickets. Orders placed after the change pick up the new one.
 */

import { doc, serverTimestamp, updateDoc, type WriteBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Every field name a member's picture has ever been stored under. */
export interface MemberPhotoFields {
    photo: string;
    photoUrl: string;
    photoUpdatedAt: unknown;
}

/**
 * The fields to write for a new picture. Exposed separately so a caller that is
 * already building a batch (face enrolment writes the photo alongside the
 * descriptors) can merge them in rather than issuing a second round-trip.
 */
export function memberPhotoFields(url: string): MemberPhotoFields {
    return { photo: url, photoUrl: url, photoUpdatedAt: serverTimestamp() };
}

/**
 * Set a member's picture everywhere it is read from.
 *
 * `url` should already be a usable download URL (or a data URI, as face
 * enrolment produces). Cache-busting is the caller's business — the member app
 * appends a timestamp so the browser doesn't keep serving the old file from the
 * same storage path.
 */
export async function setMemberPhoto(
    clubId: string,
    memberId: string,
    url: string,
): Promise<void> {
    if (!clubId || !memberId || !url) return;
    await updateDoc(doc(db, "clubs", clubId, "members", memberId), { ...memberPhotoFields(url) });
}

/** Batch form, for callers already writing other member fields at the same time. */
export function addMemberPhotoToBatch(
    batch: WriteBatch,
    clubId: string,
    memberId: string,
    url: string,
): void {
    if (!clubId || !memberId || !url) return;
    batch.update(doc(db, "clubs", clubId, "members", memberId), memberPhotoFields(url) as any);
}

/**
 * Read a member's picture. Accepts anything member-shaped, including the
 * denormalised copies carried on orders and attendance records.
 *
 * Members who existed before `setMemberPhoto` can hold two *different*
 * pictures — an old face captured at enrolment and a newer one uploaded from
 * the phone. There is no timestamp to compare, but there is a reliable tell:
 * face enrolment stores a `data:` URI straight from the camera canvas, while
 * an upload from the app is an `https` Storage URL. When the two disagree, the
 * uploaded one is the deliberate profile picture and wins. Once a member's
 * photo is set through the writer above both fields agree and this never
 * applies.
 */
export function memberPhotoOf(member: any): string {
    if (!member) return "";
    const enrolled = member.photoUrl || "";
    const uploaded = member.photo || "";
    if (enrolled && uploaded && enrolled !== uploaded) {
        const enrolledIsCameraCapture = enrolled.startsWith("data:");
        const uploadedIsRealFile = /^https?:/i.test(uploaded);
        if (enrolledIsCameraCapture && uploadedIsRealFile) return uploaded;
    }
    return enrolled || uploaded || member.memberPhoto || member.userPhoto || "";
}
