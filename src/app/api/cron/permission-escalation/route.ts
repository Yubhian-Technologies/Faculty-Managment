export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { runPermissionEscalation } from "@/lib/studentPermissions/escalation";

// Not a user-facing route - hit on a schedule (see functions/src/index.ts) with a shared secret, the same
// convention as cron/attendance-not-posted. Moves student-permission requests that nobody answered within the
// hours set for their level up to the next level, and retries failed attendance updates.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed - never run unconfigured
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const report = await runPermissionEscalation(getAdminDb());
    // Any failed college is a 500 so the scheduler retries and alerts; the sweep is idempotent.
    return NextResponse.json(report, { status: report.failedColleges.length ? 500 : 200 });
  } catch (err) {
    console.error("[cron/permission-escalation]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
