import type { Firestore } from "firebase-admin/firestore";
import type { DayOfWeek } from "@/types";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import { istDateFromParts, istDateKey } from "@/lib/attendance/istTime";

// Whether classes are actually held on a calendar date, so student attendance
// can't be opened on - and the not-posted sweep doesn't chase faculty for - a
// day the college is closed. Three sources, all already maintained by College
// Office: the college's configured working days (settings/timetableRules),
// declared holidays (any audience: a students-only holiday closes classes too,
// unlike faculty attendance), and the academic-year summer break.

const DAY_BY_INDEX: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

export interface ClassDayInputs {
  dateISO: string; // YYYY-MM-DD, an IST calendar date
  workingDays: DayOfWeek[];
  holidays: { dateKey: string; name: string }[];
  summerBreaks: { fromKey: string; toKey: string }[];
}

/** Reason classes aren't held on `dateISO`, or null when it's a normal teaching day. */
export function noClassReason(input: ClassDayInputs): string | null {
  const [y, m, d] = input.dateISO.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  if (jsDay === 0) return "Sunday";
  const day = DAY_BY_INDEX[jsDay - 1];
  if (!input.workingDays.includes(day)) return "Not a working day";
  const holiday = input.holidays.find((h) => h.dateKey === input.dateISO);
  if (holiday) return holiday.name ? `Holiday: ${holiday.name}` : "Holiday";
  if (input.summerBreaks.some((b) => input.dateISO >= b.fromKey && input.dateISO <= b.toKey)) return "Summer break";
  return null;
}

/** Loads the college's calendar and evaluates `dateISO` - 3 small reads, in parallel. */
export async function getNoClassReason(db: Firestore, collegeId: string, dateISO: string): Promise<string | null> {
  const [y, m, d] = dateISO.split("-").map(Number);
  const start = istDateFromParts(y, m, d);
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const collegeRef = db.collection("colleges").doc(collegeId);

  const [rulesSnap, holidaySnap, summerSnap] = await Promise.all([
    collegeRef.collection("settings").doc("timetableRules").get(),
    // A holiday's stored instant is either IST midnight or UTC midnight of its
    // date (both fall on `dateISO` in IST), so a one-day IST window catches both.
    collegeRef.collection("holidays").where("date", ">=", start).where("date", "<", endExclusive).get(),
    collegeRef.collection("summerHolidays").where("toDate", ">=", start).get(),
  ]);

  const rules = rulesSnap.exists ? (rulesSnap.data() as { workingDays?: DayOfWeek[] }) : null;
  const workingDays = rules?.workingDays?.length ? rules.workingDays : DEFAULT_TIMETABLE_RULES.workingDays;

  return noClassReason({
    dateISO,
    workingDays,
    holidays: holidaySnap.docs.map((doc) => {
      const data = doc.data() as { date: { toDate(): Date }; name?: string };
      return { dateKey: istDateKey(data.date.toDate()), name: data.name ?? "" };
    }),
    summerBreaks: summerSnap.docs.map((doc) => {
      const data = doc.data() as { fromDate: { toDate(): Date }; toDate: { toDate(): Date } };
      return { fromKey: istDateKey(data.fromDate.toDate()), toKey: istDateKey(data.toDate.toDate()) };
    }),
  });
}
