/**
 * Body Transformation Challenge — server-side automation.
 *
 * Two scheduled jobs run nightly (IST 23:30):
 *   1. autoRejectMissedWeighIns
 *      For every club with an active BTC config, if "today" is the
 *      weigh-in day, find participants who didn't log a weigh-in this
 *      week and mark them rejected. (Rule: absent on weigh-in day =
 *      removed from the challenge.)
 *
 *   2. expireMealPhotos
 *      Find any `btcMeals` doc whose `expiresAt` has passed (default 6
 *      months from upload) and:
 *        - Delete the photo from Firebase Storage
 *        - Delete the doc
 *      Approved meals + rejected meals are both retained for the same
 *      6-month window so the coordinator's audit trail stays intact.
 *
 * Plus: pushNewMealNotification fires on every new pending meal upload
 * and pings the BTC coordinators (registered via fcmTokens on their
 * member docs).
 */

import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";

const SCHED_OPTS = { region: "us-central1", timeZone: "Asia/Kolkata", maxInstances: 1 } as const;
const FN_OPTS = { region: "us-central1", maxInstances: 5 } as const;

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/**
 * Nightly: auto-reject participants who missed today's weigh-in. Runs
 * at 23:30 IST so the day's coordinator entries are already in.
 */
export const autoRejectMissedWeighIns = onSchedule(
    { ...SCHED_OPTS, schedule: "30 23 * * *" },
    async () => {
        const db = admin.firestore();
        const clubsSnap = await db.collection("clubs").get();
        let totalRejected = 0;

        for (const clubDoc of clubsSnap.docs) {
            const clubId = clubDoc.id;
            const cfgRef = db.doc(`clubs/${clubId}/btcConfig/current`);
            const cfgSnap = await cfgRef.get();
            if (!cfgSnap.exists) continue;
            const cfg = cfgSnap.data() as any;
            if (!cfg.isActive) continue;

            const today = startOfDay(new Date());
            const todayDow = today.getDay();
            const weighInDow: number = cfg.weighInDayOfWeek ?? 0;

            // Only act on the official weigh-in day
            if (todayDow !== weighInDow) continue;

            // Range = the calendar week that contains today (Sun-Sat)
            const weekStart = addDays(today, -todayDow);
            const weekEnd = addDays(weekStart, 7);

            const participantsSnap = await db.collection(`clubs/${clubId}/members`)
                .where("isBTCParticipant", "==", true)
                .get();

            for (const pDoc of participantsSnap.docs) {
                const p = pDoc.data() as any;
                if (p.btcRejected) continue;

                // Check for any weigh-in this week
                const weighInsSnap = await db.collection(`clubs/${clubId}/members/${pDoc.id}/weighIns`).get();
                const hasThisWeek = weighInsSnap.docs.some(d => {
                    const t = (d.data().createdAt as admin.firestore.Timestamp | undefined)?.toDate();
                    if (!t) return false;
                    return t >= weekStart && t < weekEnd;
                });

                if (!hasThisWeek) {
                    await pDoc.ref.update({
                        btcRejected: true,
                        btcRejectedReason: "Missed weigh-in",
                        btcRejectedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    totalRejected++;
                    logger.info(`[BTC auto-reject] ${clubId}/${pDoc.id} (${p.name}) — missed week ${cfg.weeks ? "—" : "—"}`);
                }
            }
        }

        logger.info(`[BTC auto-reject] complete · ${totalRejected} marked rejected`);
    },
);

/**
 * Nightly: expire and clean up meal photos older than 6 months.
 */
export const expireMealPhotos = onSchedule(
    { ...SCHED_OPTS, schedule: "0 1 * * *" },
    async () => {
        const db = admin.firestore();
        const storage = admin.storage();
        const now = admin.firestore.Timestamp.now();
        const clubsSnap = await db.collection("clubs").get();
        let deleted = 0;

        for (const clubDoc of clubsSnap.docs) {
            const clubId = clubDoc.id;
            const expiredSnap = await db.collection(`clubs/${clubId}/btcMeals`)
                .where("expiresAt", "<=", now)
                .get();

            for (const m of expiredSnap.docs) {
                const data = m.data();
                const url: string | undefined = data.photoUrl;
                if (url) {
                    try {
                        // Pull the path out of the download URL
                        const match = url.match(/\/o\/([^?]+)/);
                        if (match) {
                            const path = decodeURIComponent(match[1]);
                            await storage.bucket().file(path).delete().catch(() => null);
                        }
                    } catch (e) {
                        logger.warn(`[BTC expire] storage delete failed for ${m.id}: ${e}`);
                    }
                }
                await m.ref.delete();
                deleted++;
            }
        }

        logger.info(`[BTC expire] complete · ${deleted} meal photos deleted`);
    },
);

/**
 * Notify BTC coordinators when a new meal upload lands in the queue.
 * Coordinators are members with `isBTCCoordinator: true` and an FCM
 * token registered on their member doc.
 */
export const notifyCoordinatorOnMealUpload = onDocumentCreated(
    { ...FN_OPTS, document: "clubs/{clubId}/btcMeals/{mealId}" },
    async (event) => {
        const meal = event.data?.data();
        if (!meal || meal.status !== "pending") return;
        const clubId = event.params.clubId;

        const db = admin.firestore();
        const coordsSnap = await db.collection(`clubs/${clubId}/members`)
            .where("isBTCCoordinator", "==", true)
            .get();

        const tokens: string[] = [];
        for (const c of coordsSnap.docs) {
            const t = (c.data().fcmTokens || []) as string[];
            tokens.push(...t);
        }
        if (tokens.length === 0) return;

        const messaging = admin.messaging();
        await messaging.sendEachForMulticast({
            tokens,
            notification: {
                title: "New meal to review 🍽️",
                body: `${meal.memberName || "A member"} uploaded a ${meal.mealType || "meal"} photo`,
            },
            webpush: {
                fcmOptions: { link: "/btc" },
            },
        }).catch(err => logger.warn("[BTC meal notify]", err));
    },
);
