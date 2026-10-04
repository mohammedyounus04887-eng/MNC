import webpush from "web-push";
import { COLLECTIONS } from "./collections";
import { db } from "./firebase-admin";

/**
 * Web push over VAPID rather than FCM (see DECISIONS.md D22). Same delivery
 * mechanism a Firebase web integration uses underneath, with no external account,
 * so follow-up reminders work before any vendor is signed up.
 *
 * Notifications are an enhancement: if the keys are not configured, everything here
 * no-ops and the in-app follow-up queue still does its job.
 */

export type PushPayload = {
  title: string;
  body: string;
  /** Where tapping the notification should land. */
  url: string;
  tag?: string;
};

let configured: boolean | null = null;

export function isPushConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    configured = false;
    return configured;
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:support@growline.in",
    publicKey,
    privateKey
  );
  configured = true;
  return configured;
}

export type SendResult = { sent: number; removed: number; failed: number };

/**
 * Sends to every device a coach has registered.
 *
 * A 404 or 410 from the push service means that subscription is dead — the app was
 * uninstalled or the browser rotated it — so the row is deleted. Leaving dead rows
 * would make every future send slower and the counts meaningless.
 */
export async function sendToUser(
  userId: string,
  payload: PushPayload
): Promise<SendResult> {
  if (!isPushConfigured()) return { sent: 0, removed: 0, failed: 0 };

  // Still Web Push over VAPID (D22). v2.1b replaces this wholesale with FCM;
  // moving the collection now is only about removing the last Prisma dependency,
  // not about changing how a notification is delivered.
  const snap = await db
    .collection(COLLECTIONS.pushSubscriptions)
    .where("userId", "==", userId)
    .get();
  const subs = snap.docs.map((d) => ({
    id: d.id,
    endpoint: d.data().endpoint as string,
    p256dh: d.data().p256dh as string,
    auth: d.data().auth as string,
  }));
  const result: SendResult = { sent: 0, removed: 0, failed: 0 };

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload)
        );
        result.sent++;
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await db
            .collection(COLLECTIONS.pushSubscriptions)
            .doc(sub.id)
            .delete()
            .catch(() => {});
          result.removed++;
        } else {
          console.error("[growline] push failed", status, err);
          result.failed++;
        }
      }
    })
  );

  return result;
}
