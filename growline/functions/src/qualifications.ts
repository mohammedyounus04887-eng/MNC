import { onSchedule } from "firebase-functions/v2/scheduler";
import { callScheduledRoute } from "./scheduledHttp";
export const evaluateQualifications = onSchedule(
  { schedule: "every 3 hours", timeZone: "Asia/Kolkata", secrets: ["CRON_SECRET"], maxInstances: 1, timeoutSeconds: 180, retryCount: 3 },
  async () => { await callScheduledRoute("evaluateQualifications", "/api/qualifications/evaluate"); },
);
export const qualificationReminders = onSchedule(
  { schedule: "0 9 * * *", timeZone: "Asia/Kolkata", secrets: ["CRON_SECRET"], maxInstances: 1, timeoutSeconds: 180, retryCount: 3 },
  async () => { await callScheduledRoute("qualificationReminders", "/api/qualifications/reminders"); },
);
