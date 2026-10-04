import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { callScheduledRoute } from "./scheduledHttp";
import { purgeHealthRetention } from "./healthRetention";

setGlobalOptions({ region: "asia-south1", maxInstances: 10 });
initializeApp();
const db = getFirestore();

/** Recompute instead of incrementing: retries must never double the activity count. */
export const onDailyLogWritten = onDocumentWritten("dailyLogs/{logId}", async (event) => {
  if (process.env.GROWLINE_JOBS_ENABLED !== "true") return;
  const log = event.data?.after.data() ?? event.data?.before.data();
  if (typeof log?.userId !== "string" || typeof log.workspaceId !== "string" || !log.workspaceId) return;
  const userRef = db.doc(`users/${log.userId}`);
  const user = (await userRef.get()).data();
  if (user?.workspaceId !== log.workspaceId) return;
  // A delayed historical event must not replace the current month with an old one.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const month = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
  await db.runTransaction(async (tx) => {
    const current = await tx.get(userRef);
    if (current.data()?.workspaceId !== log.workspaceId) return;
    const logs = await tx.get(db.collection("dailyLogs").where("userId", "==", log.userId)
      .where("dayKey", ">=", `${month}-01`).where("dayKey", "<=", `${month}-31`));
    const count = logs.docs.filter((doc) => doc.get("workspaceId") === log.workspaceId).length;
    tx.update(userRef, { thisMonthActivity: { month, logs: count, updatedAt: FieldValue.serverTimestamp() } });
  });
});

export const morningReminder = onSchedule(
  { schedule: "every 60 minutes", timeZone: "Etc/UTC", secrets: ["CRON_SECRET"], maxInstances: 1, timeoutSeconds: 180, retryCount: 3 },
  async () => { await callScheduledRoute("morningReminder", "/api/notifications/daily"); },
);

/** 180 days of inactivity. No production purge is authorized by local development. */
export const purgeStaleHealthData = onSchedule(
  { schedule: "every day 03:00", timeZone: "Asia/Kolkata", maxInstances: 1, timeoutSeconds: 540, retryCount: 3 },
  async () => {
    if (process.env.GROWLINE_JOBS_ENABLED !== "true") return;
    const result = await purgeHealthRetention(db);
    console.log(JSON.stringify({ job: "purgeStaleHealthData", ...result }));
  },
);

// Nine existing background functions: eight schedules and the roll-up trigger above.
export { rebuildLeaderboards } from "./leaderboards";
export { evaluateQualifications, qualificationReminders } from "./qualifications";
export { rebuildDuplicationScores } from "./duplication";
export { silenceCheck } from "./silence";
export { purgeVoiceNotes } from "./voice-logs";
