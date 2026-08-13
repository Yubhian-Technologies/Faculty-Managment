export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";

function toDate(v: unknown): Date | null {
  const ts = v as { toDate?: () => Date } | undefined;
  return ts?.toDate?.() ?? null;
}

// Calendar-day comparison (not millisecond) - a leave request's fromDate/
// toDate are stored as midnight timestamps, so this avoids an off-by-one
// from time-of-day differences.
function coversToday(today: Date, from: Date, to: Date): boolean {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const f = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const l = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return t >= f && t <= l;
}

// Count of people on APPROVED leave today, grouped by department name
// (how LeaveRequest.department is stored) - powers the "N absent today"
// badge on the Principal/College Office Leave History department picker.
export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const db = getAdminDb();
    const today = new Date();

    const snap = await REQUESTS_COL(session.collegeId, db).where("status", "==", "APPROVED").get();

    const counts: Record<string, number> = {};
    for (const doc of snap.docs) {
      const r = doc.data() as { department?: string; fromDate?: unknown; toDate?: unknown };
      if (!r.department) continue;
      const from = toDate(r.fromDate);
      const to = toDate(r.toDate);
      if (!from || !to || !coversToday(today, from, to)) continue;
      counts[r.department] = (counts[r.department] ?? 0) + 1;
    }

    return NextResponse.json({ counts });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave-history-report/absent-today GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
