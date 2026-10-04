import { onSchedule } from "firebase-functions/v2/scheduler";
import { callScheduledRoute } from "./scheduledHttp";
export const rebuildLeaderboards = onSchedule(
  { schedule: "every 3 hours", timeZone: "Asia/Kolkata", secrets: ["CRON_SECRET"], maxInstances: 1, timeoutSeconds: 180, retryCount: 3 },
  async () => { await callScheduledRoute("rebuildLeaderboards", "/api/leaderboards/rebuild"); },
);
