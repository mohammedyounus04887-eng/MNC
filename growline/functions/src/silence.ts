import { onSchedule } from "firebase-functions/v2/scheduler";
import { callScheduledRoute } from "./scheduledHttp";
export const silenceCheck = onSchedule(
  { schedule: "0 9 * * *", timeZone: "Asia/Kolkata", secrets: ["CRON_SECRET"], maxInstances: 1, timeoutSeconds: 180, retryCount: 3 },
  async () => { await callScheduledRoute("silenceCheck", "/api/silence"); },
);
