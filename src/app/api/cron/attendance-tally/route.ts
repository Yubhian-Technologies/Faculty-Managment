export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { istDateKey } from "@/lib/attendance/istTime";
import { rebuildDay, setTallyReadyFrom } from "@/lib/studentAttendance/dayTally";

// Maintenance for the student attendance tally (lib/studentAttendance/dayTally.ts):
// not user-facing, Bearer CRON_SECRET like cron/attendance-not-posted.
//
//   POST ?from=YYYY-MM-DD&to=YYYY-MM-DD [&collegeId=..] [&setReady=1]   backfill (<= 31 days per call)
//   POST ?date=YYYY-MM-DD                                                one day
//   POST (no params)                                                     reconcile: yesterday
//
// Rebuilding a day OVERWRITES that day's tally from its sessions, so it is safe
// to repeat and repairs any drift. Run the backfill for dates BEFORE today (the
// live path keeps today exact). `setReady=1` records `from` as the date the
// dashboard may trust the tally from.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length <= MAX_DAYS; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const single = searchParams.get("date");
    const yesterday = new Date(Date.now() - 86_400_000);
    const from = single ?? searchParams.get("from") ?? istDateKey(yesterday);
    const to = single ?? searchParams.get("to") ?? from;
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      return NextResponse.json({ error: "from/to must be valid YYYY-MM-DD dates, from <= to" }, { status: 400 });
    }
    const dates = datesBetween(from, to);
    if (dates.length > MAX_DAYS) {
      return NextResponse.json({ error: `At most ${MAX_DAYS} days per call` }, { status: 400 });
    }

    const db = getAdminDb();
    const onlyCollege = searchParams.get("collegeId");
    const colleges = onlyCollege ? [onlyCollege] : (await db.collection("colleges").get()).docs.map((d) => d.id);

    const written: Record<string, number> = {};
    for (const collegeId of colleges) {
      let n = 0;
      for (const date of dates) n += await rebuildDay(db, collegeId, date);
      written[collegeId] = n;
      if (searchParams.get("setReady") === "1") await setTallyReadyFrom(db, collegeId, from);
    }
    return NextResponse.json({ dates: dates.length, written });
  } catch (err) {
    console.error("[cron/attendance-tally]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
