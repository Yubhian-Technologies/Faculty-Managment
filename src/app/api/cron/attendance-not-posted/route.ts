export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { runNotPostedSweep } from "@/lib/attendance/notPostedSweep";

// Not a user-facing route - hit on a schedule (see functions/src/index.ts,
// or any external scheduler pointed at this URL) with a shared secret, the
// same convention a scheduler-triggered route needs regardless of which
// scheduler ends up calling it. No session/cookie auth applies here at all.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed - never run unconfigured
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Constant-time compare (mirrors sessionToken.ts's readSession) - a plain
  // === on a secret invites a timing side channel, however impractical here.
  if (auth.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// The sweep itself lives in lib/attendance/notPostedSweep.ts. A college that
// fails no longer takes the others down with it, and ANY failure is answered
// with a 500 (and the failed colleges named) instead of a 200 - the scheduler
// treats that as a failed run, retries it (the sweep is idempotent per period)
// and its log-based alerts can fire. A heartbeat is kept at
// systemJobs/attendance-not-posted for a staleness check.
export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runNotPostedSweep(getAdminDb(), new Date());
    const body = {
      collegesChecked: result.collegesChecked,
      collegesSwept: result.collegesSwept,
      facultyNotified: result.facultyNotified,
      periodsNotified: result.periodsNotified,
      ...(result.failed.length > 0 ? { failed: result.failed } : {}),
    };
    return NextResponse.json(body, { status: result.failed.length > 0 ? 500 : 200 });
  } catch (err) {
    console.error("[cron/attendance-not-posted]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
