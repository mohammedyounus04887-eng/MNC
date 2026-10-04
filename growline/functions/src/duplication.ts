import { onSchedule } from "firebase-functions/v2/scheduler";
import { callScheduledRoute } from "./scheduledHttp";
export const rebuildDuplicationScores = onSchedule(
  { schedule: "every day 04:00", timeZone: "Asia/Kolkata", secrets: ["CRON_SECRET"], maxInstances: 1, timeoutSeconds: 180, retryCount: 3 },
  async () => { await callScheduledRoute("rebuildDuplicationScores", "/api/duplication/rebuild"); },
);
