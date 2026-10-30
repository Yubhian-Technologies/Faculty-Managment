import type { Firestore } from "firebase-admin/firestore";
import type { DayOfWeek } from "@/types";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import { istDateFromParts, istDateKey } from "@/lib/attendance/istTime";

// Whether classes are actually held on a calendar date, so student attendance
// can't be opened on - and the not-posted sweep doesn't chase faculty for - a
// day the college is closed. Sources, all maintained by College Office: the
// college's configured working days (settings/timetableRules), declared
// holidays (any audience: a students-only holiday or suspension closes classes
// too, unlike faculty attendance), the academic-year summer break, the
// students-only winter/summer sem breaks, and compensatory Sundays the
// Principal has switched on (a Sunday that IS a class day, running another
// weekday's timetable).

const DAY_BY_INDEX: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

export interface ClassDayInputs {
  dateISO: string; // YYYY-MM-DD, an IST calendar date
  workingDays: DayOfWeek[];
  holidays: { dateKey: string; name: string }[];
  summerBreaks: { fromKey: string; toKey: string; label?: string }[];
  /** Enabled compensatory Sundays: the date and the weekday whose timetable it runs. */
  compensatory?: { dateKey: string; followsDay: DayOfWeek }[];
}

/** Reason classes aren't held on `dateISO`, or null when it's a normal teaching day. */
export function noClassReason(input: ClassDayInputs): string | null {
  const [y, m, d] = input.dateISO.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const isCompensatory = jsDay === 0 && !!input.compensatory?.some((c) => c.dateKey === input.dateISO);
  if (jsDay === 0 && !isCompensatory) return "Sunday";
  if (!isCompensatory) {
    const day = DAY_BY_INDEX[jsDay - 1];
    if (!input.workingDays.includes(day)) return "Not a working day";
  }
  const holiday = input.holidays.find((h) => h.dateKey === input.dateISO);
  if (holiday) return holiday.name ? `Holiday: ${holiday.name}` : "Holiday";
  const hit = input.summerBreaks.find((b) => input.dateISO >= b.fromKey && input.dateISO <= b.toKey);
  if (hit) return hit.label ?? "Summer break";
  return null;
}

/**
 * The timetable weekday a class date runs: the date's own weekday, or the
 * weekday a compensatory Sunday follows. Null for an ordinary Sunday.
 */
export function timetableDayFor(
  dateISO: string,
  compensatory?: { dateKey: string; followsDay: DayOfWeek }[]
): DayOfWeek | null {
  const [y, m, d] = dateISO.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (jsDay !== 0) return DAY_BY_INDEX[jsDay - 1];
  return compensatory?.find((c) => c.dateKey === dateISO)?.followsDay ?? null;
}

/** The college calendar for [fromISO, toISO] - 5 small reads, in parallel, however long the range. */
export async function loadClassCalendar(
  db: Firestore,
  collegeId: string,
  fromISO: string,
  toISO: string
): Promise<Omit<ClassDayInputs, "dateISO">> {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const start = istDateFromParts(fy, fm, fd);
  const endExclusive = new Date(istDateFromParts(ty, tm, td).getTime() + 24 * 60 * 60 * 1000);
  const collegeRef = db.collection("colleges").doc(collegeId);

  const [rulesSnap, holidaySnap, summerSnap, semBreakSnap, compSnap] = await Promise.all([
    collegeRef.collection("settings").doc("timetableRules").get(),
    // A holiday's stored instant is either IST midnight or UTC midnight of its
    // date (both fall on that date in IST), so an IST day window catches both.
    collegeRef.collection("holidays").where("date", ">=", start).where("date", "<", endExclusive).get(),
    collegeRef.collection("summerHolidays").where("toDate", ">=", start).get(),
    collegeRef.collection("semBreaks").where("toDate", ">=", start).get(),
    collegeRef.collection("holidays").where("compensatoryDateKey", ">=", fromISO).where("compensatoryDateKey", "<=", toISO).get(),
  ]);

  const rules = rulesSnap.exists ? (rulesSnap.data() as { workingDays?: DayOfWeek[] }) : null;
  const workingDays = rules?.workingDays?.length ? rules.workingDays : DEFAULT_TIMETABLE_RULES.workingDays;

  const summerBreaks = [
    ...summerSnap.docs.map((doc) => {
      const data = doc.data() as { fromDate: { toDate(): Date }; toDate: { toDate(): Date } };
      return { fromKey: istDateKey(data.fromDate.toDate()), toKey: istDateKey(data.toDate.toDate()) };
    }),
    ...semBreakSnap.docs.map((doc) => {
      const data = doc.data() as { kind?: string; fromDate: { toDate(): Date }; toDate: { toDate(): Date } };
      return {
        fromKey: istDateKey(data.fromDate.toDate()),
        toKey: istDateKey(data.toDate.toDate()),
        label: data.kind === "WINTER" ? "Winter sem break" : "Summer sem break",
      };
    }),
  ];

  const compensatory = compSnap.docs.flatMap((doc) => {
    const data = doc.data() as { compensatoryEnabled?: boolean; compensatoryDateKey?: string; compensatoryFollowsDay?: DayOfWeek };
    return data.compensatoryEnabled && data.compensatoryDateKey && data.compensatoryFollowsDay
      ? [{ dateKey: data.compensatoryDateKey, followsDay: data.compensatoryFollowsDay }]
      : [];
  });

  return {
    workingDays,
    holidays: holidaySnap.docs.map((doc) => {
      const data = doc.data() as { date: { toDate(): Date }; name?: string };
      return { dateKey: istDateKey(data.date.toDate()), name: data.name ?? "" };
    }),
    summerBreaks,
    compensatory,
  };
}

/** Loads the college's calendar and evaluates `dateISO`. */
export async function getNoClassReason(db: Firestore, collegeId: string, dateISO: string): Promise<string | null> {
  const calendar = await loadClassCalendar(db, collegeId, dateISO, dateISO);
  return noClassReason({ dateISO, ...calendar });
}

/**
 * The timetable weekday classes follow on `dateISO` (a compensatory Sunday runs
 * another weekday's), or null for an ordinary Sunday. One tiny read.
 */
export async function getTimetableDay(db: Firestore, collegeId: string, dateISO: string): Promise<DayOfWeek | null> {
  const [y, m, d] = dateISO.split("-").map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) return DAY_BY_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay() - 1];
  const snap = await db.collection("colleges").doc(collegeId).collection("holidays")
    .where("compensatoryDateKey", "==", dateISO).get();
  for (const doc of snap.docs) {
    const data = doc.data() as { compensatoryEnabled?: boolean; compensatoryFollowsDay?: DayOfWeek };
    if (data.compensatoryEnabled && data.compensatoryFollowsDay) return data.compensatoryFollowsDay;
  }
  return null;
}

/**
 * The dates in [fromISO, toISO] (inclusive) on which classes are actually held.
 * Loads the college calendar ONCE for the whole range.
 */
export async function getClassDays(db: Firestore, collegeId: string, fromISO: string, toISO: string): Promise<string[]> {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const calendar = await loadClassCalendar(db, collegeId, fromISO, toISO);

  const out: string[] = [];
  for (let t = Date.UTC(fy, fm - 1, fd); t <= Date.UTC(ty, tm - 1, td) && out.length < 400; t += 86_400_000) {
    const dateISO = new Date(t).toISOString().slice(0, 10);
    if (noClassReason({ dateISO, ...calendar }) === null) out.push(dateISO);
  }
  return out;
}
