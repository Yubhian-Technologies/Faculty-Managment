import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

// Deliberately a thin pinger, not a reimplementation of the attendance
// business logic - the real "which faculty haven't posted" check lives in
// the Next.js app itself (src/app/api/cron/attendance-not-posted/route.ts),
// reusing the exact same period-window/completion-status logic the rest of
// the attendance module already relies on. This function's only job is to
// hit that route on a schedule with the shared secret.
const cronSecret = defineSecret("CRON_SECRET");
// The deployed app's own origin (e.g. "https://your-app.example.com") - set
// once via `firebase functions:config:set` (v1) is deprecated for v2; for
// v2, set it as a plain env var in functions/.env (APP_URL=...), which
// defineString picks up automatically. See functions/README.md.
const appUrl = defineString("APP_URL");

export const attendanceNotPostedSweep = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Kolkata",
    secrets: [cronSecret],
  },
  async () => {
    const url = appUrl.value();
    if (!url) {
      logger.error("APP_URL is not configured - skipping sweep. See functions/README.md.");
      return;
    }
    try {
      const res = await fetch(`${url}/api/cron/attendance-not-posted`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret.value()}` },
      });
      const body = await res.text();
      if (!res.ok) {
        logger.error(`attendance-not-posted sweep failed: ${res.status} ${body}`);
        return;
      }
      logger.info("attendance-not-posted sweep ok", { body });
    } catch (err) {
      logger.error("attendance-not-posted sweep threw", err);
    }
  }
);
