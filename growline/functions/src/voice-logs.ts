import { onSchedule } from "firebase-functions/v2/scheduler";
import { callScheduledRoute } from "./scheduledHttp";
export const purgeVoiceNotes = onSchedule(
  { schedule: "every day 03:30", timeZone: "Asia/Kolkata", secrets: ["CRON_SECRET"], maxInstances: 1, timeoutSeconds: 180, retryCount: 3 },
  async () => { await callScheduledRoute("purgeVoiceNotes", "/api/voice-logs/purge"); },
);
