# Flow — M5-F3: Attendance Not-Posted Sweep (cron)

- **Flow ID:** M5-F3
- **Actors:** Cloud Scheduler (system)
- **Trigger:** every 15 minutes IST (functions/src/index.ts:24-28)
- **Preconditions:** Firebase Blaze plan; APP_URL + CRON_SECRET configured; per-college reminder enabled in settings
- **Main success scenario:**
  1. Scheduler POSTs `{APP_URL}/api/cron/attendance-not-posted` with Bearer CRON_SECRET (functions/src/index.ts:34-39).
  2. Route: for each college with reminder enabled (`notPostedSettings.ts:24`): if cutoff passed for today AND `lastRunDate` != today:
  3. Compute every faculty member's scheduled periods for the day using the same period-window/completion logic as today-periods (functions comment:9-13; currentPeriod engine).
  4. Notify each faculty with an ended-but-unsubmitted period (notifications collection).
  5. Stamp `lastRunDate` on settings doc.
- **Alternate/error:** APP_URL unset → log + skip (index.ts:31-34); non-200 → logged, retried next tick; already-run → silent no-op.
- **UI (consumers):** HOD `/hod/faculty-not-posted`, Principal `/principal/faculty-not-posted` (lists from completion/faculty-not-posted APIs), settings card (`attendance-not-posted-settings`).
- **API:** cron route + settings GET/PUT.
- **DB:** settings, timetableSlots, studentAttendance, notifications.
- **Permission checks:** Bearer secret only.
- **Idempotency:** lastRunDate once-per-day per college (15-min tick controls latency, not repetition — functions/README.md).
- **Side effects:** notifications only.
- **Code evidence:** functions/src/index.ts:20-44; functions/README.md; AGENTS.md cron note.
