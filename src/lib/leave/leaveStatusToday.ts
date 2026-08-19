import type { Firestore } from "firebase-admin/firestore";
import { REQUESTS_COL } from "./balanceEngine";

function toJsDate(v: unknown): Date | null {
  const ts = v as { toDate?: () => Date } | undefined;
  return ts?.toDate?.() ?? null;
}

// Calendar-day comparison (not millisecond) - fromDate/toDate are stored as
// midnight timestamps, so this avoids an off-by-one from time-of-day
// differences. Mirrors coversToday() in leave-history-report/absent-today/
// route.ts, generalized here into a single-uid, importable check.
function coversDay(day: Date, from: Date, to: Date): boolean {
  const d = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  const f = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const l = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return d >= f && d <= l;
}

// Is this person on an APPROVED leave that covers `today`? Feeds the
// self-attendance check-in gate (see check-in/route.ts and
// today-status/route.ts) - attendance shouldn't be markable on a day already
// covered by approved leave.
export async function isOnApprovedLeaveToday(
  db: Firestore,
  collegeId: string,
  uid: string,
  today: Date = new Date()
): Promise<boolean> {
  const snap = await REQUESTS_COL(collegeId, db)
    .where("uid", "==", uid)
    .where("status", "==", "APPROVED")
    .get();
  return snap.docs.some((doc) => {
    const r = doc.data() as { fromDate?: unknown; toDate?: unknown };
    const from = toJsDate(r.fromDate);
    const to = toJsDate(r.toDate);
    return !!from && !!to && coversDay(today, from, to);
  });
}
