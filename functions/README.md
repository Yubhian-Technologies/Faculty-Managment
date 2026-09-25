# Scheduled Functions

A separate deploy target from the Next.js app - its own `package.json`, its own
`npm install`, deployed with `firebase deploy --only functions` (not part of
the app's normal build/deploy).

## What this does

`attendanceNotPostedSweep` runs every 15 minutes and calls
`POST /api/cron/attendance-not-posted` on the deployed app. That route (in the
main app, `src/app/api/cron/attendance-not-posted/route.ts`) does the actual
work: for every college with the reminder enabled (Principal/College Admin ->
Settings -> "Attendance Not-Posted Reminder"), once the configured cutoff
time has passed for the day, it checks every faculty member's scheduled
periods and sends a notification to anyone with a period that ended without a
submitted attendance session. It only sweeps once per college per day
(tracked via `lastRunDate` on the college's settings doc), so the 15-minute
tick rate just controls how soon after the cutoff it fires, not how often it
re-notifies.

## Requirements

- **Firebase Blaze (pay-as-you-go) plan.** Scheduled functions need Cloud
  Scheduler + Pub/Sub, which the free Spark plan does not support. There is a
  small free tier within Blaze that easily covers a function this size and
  frequency, but the project must be upgraded off Spark before this can
  deploy at all.
- Node 20 (matches `"engines"` in package.json).

## One-time setup

```bash
cd functions
npm install

# The shared secret this function and the app route both check - generate
# any long random string, e.g.:
#   openssl rand -hex 32
firebase functions:secrets:set CRON_SECRET
# Set the SAME value as the CRON_SECRET environment variable on the deployed
# Next.js app (wherever its other env vars/secrets are configured).

# The deployed app's own public URL, e.g. https://your-app.example.com
echo "APP_URL=https://your-app.example.com" > .env
```

## Deploy

```bash
npm run deploy
# or: npm run build && firebase deploy --only functions
```

## Verifying it's working

- Cloud Functions logs (Firebase Console -> Functions -> Logs, or
  `firebase functions:log`) show one line per 15-minute tick; a college that
  hasn't hit its cutoff yet or already ran today is a normal, silent no-op.
- The settings card shows the reminder as configured, but the actual proof is
  a faculty member's notification box after the cutoff time on a day they
  genuinely missed a period.

## Note on testing

This function's own code (the scheduler wiring, the secret/URL plumbing) has
not been run against a live Firebase project or emulator in this session - no
Firebase CLI project context or deploy credentials were available here. The
logic it calls out to (`/api/cron/attendance-not-posted`) is regular Next.js
app code, type-checked and reusing already-tested attendance-module
functions, but the end-to-end scheduled trigger itself should be verified
once after the first deploy (e.g. `firebase functions:call
attendanceNotPostedSweep` or waiting for the first natural tick) before
relying on it.
