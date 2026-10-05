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
    // The sweep reports each missed period exactly once however many times it
    // runs (see src/lib/attendance/notPostedSweep.ts), so a failed run is safe
    // to retry - and a run that ends in an error is a FAILED run on the
    // platform (visible in its metrics, alertable), not a quiet success.
    retryCount: 2,
  },
  async () => {
    const url = appUrl.value();
    if (!url) {
      logger.error("APP_URL is not configured - skipping sweep. See functions/README.md.");
      // Misconfiguration: retrying cannot help, but it must not look like success.
      throw new Error("APP_URL is not configured");
    }
    const res = await fetch(`${url}/api/cron/attendance-not-posted`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cronSecret.value()}` },
    });
    const body = await res.text();
    if (!res.ok) {
      // A 500 here names the colleges that failed (the other colleges were still
      // swept). Throwing marks this execution failed so it is retried and alerted on.
      logger.error(`attendance-not-posted sweep failed: ${res.status} ${body}`);
      throw new Error(`attendance-not-posted sweep failed: ${res.status}`);
    }
    logger.info("attendance-not-posted sweep ok", { body });
  }
);

// Reminds an On Duty requester once 24h after their period ends with no proof
// uploaded yet - see src/app/api/cron/od-proof-reminders/route.ts, which owns
// the actual "who needs a reminder" logic. Hourly, not every 15 minutes like
// the attendance sweep above: a 24h-since-completion threshold doesn't need
// minute-level precision, and this halves the redundant Firestore reads for
// something checked over a multi-day grace window.
export const odProofReminderSweep = onSchedule(
  {
    schedule: "every 1 hours",
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
      const res = await fetch(`${url}/api/cron/od-proof-reminders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret.value()}` },
      });
      const body = await res.text();
      if (!res.ok) {
        logger.error(`od-proof-reminders sweep failed: ${res.status} ${body}`);
        return;
      }
      logger.info("od-proof-reminders sweep ok", { body });
    } catch (err) {
      logger.error("od-proof-reminders sweep threw", err);
    }
  }
);
