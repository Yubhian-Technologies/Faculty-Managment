import type { Firestore } from "firebase-admin/firestore";
import { dateKey } from "./dayCounter";

// A students-only holiday (e.g. a study holiday) doesn't exempt faculty from
// attendance/leave-day counting - only "BOTH" holidays do. Docs created
// before `appliesTo` existed have no such field; treat those as "BOTH" too,
// matching their prior (unconditional) behavior.
function appliesToFaculty(doc: { appliesTo?: string }): boolean {
  return doc.appliesTo !== "STUDENTS";
}

// Counts colleges/{collegeId}/holidays docs (the Academic Calendar Holiday
// list Office maintains - see api/college/holidays) whose `date` falls in
// [start, endExclusive) - shared by the monthly and yearly Leave History
// Report routes to fill the "Holidays" column, which used to be a bare "-".
// Students-only holidays are excluded - that column is about faculty's own
// leave register.

export async function countHolidaysInRange(
  db: Firestore,
  collegeId: string,
  start: Date,
  endExclusive: Date
): Promise<number> {
  const snap = await db
    .collection("colleges").doc(collegeId).collection("holidays")
    .where("date", ">=", start)
    .where("date", "<", endExclusive)
    .get();
  return snap.docs.filter((d) => appliesToFaculty(d.data() as { appliesTo?: string })).length;
}

// One query for the whole year, bucketed by month, instead of 12 separate
// range queries - same rationale as computeYearlyLeaveSummary batching its
// own Firestore reads.
export async function countHolidaysPerMonth(
  db: Firestore,
  collegeId: string,
  year: number
): Promise<number[]> {
  const start = new Date(year, 0, 1);
  const endExclusive = new Date(year + 1, 0, 1);
  const snap = await db
    .collection("colleges").doc(collegeId).collection("holidays")
    .where("date", ">=", start)
    .where("date", "<", endExclusive)
    .get();

  const counts = new Array(12).fill(0) as number[];
  for (const doc of snap.docs) {
    const data = doc.data() as { date: { toDate(): Date }; appliesTo?: string };
    if (!appliesToFaculty(data)) continue;
    counts[data.date.toDate().getMonth()]++;
  }
  return counts;
}

// dateKey()-set of every faculty-applicable holiday date in [from, to]
// (inclusive) - feeds countWorkingDays in dayCounter.ts so a leave request
// spanning a declared holiday doesn't draw down balance for that day. See
// applications/route.ts POST for the authoritative (server-side) use.
// Students-only holidays are excluded - faculty still work those days.
// Faculty-applicable holiday name for a single calendar date, or null if
// today isn't a declared holiday - feeds the self-attendance check-in gate
// (see check-in/route.ts and today-status/route.ts) so marking attendance is
// blocked on a declared holiday the same way isSunday() blocks it on Sundays.
export async function getHolidayNameForDate(
  db: Firestore,
  collegeId: string,
  date: Date
): Promise<string | null> {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endExclusive = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const snap = await db
    .collection("colleges").doc(collegeId).collection("holidays")
    .where("date", ">=", start)
    .where("date", "<", endExclusive)
    .get();
  const holiday = snap.docs
    .map((d) => d.data() as { name?: string; appliesTo?: string })
    .find(appliesToFaculty);
  return holiday?.name ?? null;
}

export async function getHolidayDateKeys(
  db: Firestore,
  collegeId: string,
  from: Date,
  to: Date
): Promise<Set<string>> {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const endExclusive = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  const snap = await db
    .collection("colleges").doc(collegeId).collection("holidays")
    .where("date", ">=", start)
    .where("date", "<", endExclusive)
    .get();
  return new Set(
    snap.docs
      .map((doc) => doc.data() as { date: { toDate(): Date }; appliesTo?: string })
      .filter(appliesToFaculty)
      .map((data) => dateKey(data.date.toDate()))
  );
}
