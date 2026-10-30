import type { Firestore } from "firebase-admin/firestore";
import type { ExamMidSchedule, TimetableSlot } from "@/types";
import { loadEffectiveTiming } from "@/lib/college/semester";
import { istDateKey } from "@/lib/attendance/istTime";
import { dayBefore } from "@/lib/mentoring/semesterWindows";

// Which dates a timetable slot is active on when it is scoped to one mid exam (TimetableSlot.midScope):
// "Mid k" is the teaching stretch that leads up to Mid k - from the day after the previous mid ended (or the
// semester's first day) to the day before Mid k begins. Windows come from the Exam Cell's published mid dates and
// are worked out when needed, never stored, so a changed schedule moves them by itself. There is no window after
// the last mid: attendance for a mid-scoped slot is closed from the day its mid begins.

export interface MidWindow {
  /** First active day; null = open from the start (the semester's first day is unknown). */
  from: string | null;
  to: string;
}
export type MidWindows = Record<number, MidWindow>;

function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Windows per mid number from the published schedules (earliest start / latest end when a mid has several rows). */
export function buildMidWindows(
  semesterStart: string | null,
  mids: { midNumber: number; fromDate: string; toDate: string }[],
): MidWindows {
  const byMid = new Map<number, { from: string; to: string }>();
  for (const m of mids) {
    const cur = byMid.get(m.midNumber);
    byMid.set(m.midNumber, {
      from: !cur || m.fromDate < cur.from ? m.fromDate : cur.from,
      to: !cur || m.toDate > cur.to ? m.toDate : cur.to,
    });
  }
  const out: MidWindows = {};
  let previousEnd: string | null = null;
  for (const n of [...byMid.keys()].sort((a, b) => a - b)) {
    const m = byMid.get(n)!;
    out[n] = { from: previousEnd ? dayAfter(previousEnd) : semesterStart, to: dayBefore(m.from) };
    previousEnd = m.to;
  }
  return out;
}

/**
 * Whether a slot is in force on `date`. A slot with no midScope always is. A mid with no published dates has no
 * window yet and is treated as open - parked by product until the Exam Cell publishes the mid dates.
 */
export function slotActiveOn(slot: Pick<TimetableSlot, "midScope">, date: string, windows: MidWindows): boolean {
  if (slot.midScope == null) return true;
  const w = windows[slot.midScope];
  if (!w) return true;
  return (w.from == null || date >= w.from) && date <= w.to;
}

const toDateKey = (v: unknown): string | null => {
  const d = (v as { toDate?: () => Date } | undefined)?.toDate?.();
  return d ? istDateKey(d) : null;
};

type CourseYearSemester = Pick<TimetableSlot, "courseId" | "year" | "semester">;

/** The mid windows for one course-year's semester: the semester start from its timing, the mids from the Exam Cell. */
export async function loadMidWindows(db: Firestore, collegeId: string, slot: CourseYearSemester): Promise<MidWindows> {
  if (slot.semester == null) return {};
  const collegeRef = db.collection("colleges").doc(collegeId);
  const [timing, schedSnap, courseSnap] = await Promise.all([
    loadEffectiveTiming(db, collegeId, slot.courseId, slot.year),
    collegeRef.collection("examMidSchedules").where("semester", "==", slot.semester).get(),
    collegeRef.collection("courses").doc(slot.courseId).get(),
  ]);
  const semesterStart = toDateKey(timing?.semesters?.find((s) => s.semester === slot.semester)?.startDate);

  // A schedule is ours when it is for this course, or for the same catalog course filed under another department.
  const own = courseSnap.data() as { catalogId?: string; name?: string } | undefined;
  const catalogOf = new Map<string, string | undefined>();
  const mids: { midNumber: number; fromDate: string; toDate: string }[] = [];
  for (const d of schedSnap.docs) {
    const s = d.data() as ExamMidSchedule;
    if (!s.fromDate || !s.toDate) continue;
    let ours = s.courseId === slot.courseId;
    if (!ours && s.courseId && own?.catalogId) {
      if (!catalogOf.has(s.courseId)) {
        catalogOf.set(s.courseId, ((await collegeRef.collection("courses").doc(s.courseId).get()).data() as { catalogId?: string } | undefined)?.catalogId);
      }
      ours = catalogOf.get(s.courseId) === own.catalogId;
    }
    if (!ours && own?.name && (s.courseName ?? "").trim().toLowerCase() === own.name.trim().toLowerCase()) ours = true;
    if (ours) mids.push({ midNumber: s.midNumber, fromDate: s.fromDate, toDate: s.toDate });
  }
  return buildMidWindows(semesterStart, mids);
}

/**
 * The slots that are in force on `date`. Slots with no midScope (every slot that exists today) pass straight
 * through with no extra read; windows are loaded only for the course-years that actually have a mid-scoped slot.
 */
export async function activeSlotsOn<T extends CourseYearSemester & Pick<TimetableSlot, "midScope">>(
  db: Firestore,
  collegeId: string,
  slots: T[],
  date: string,
): Promise<T[]> {
  if (!slots.some((s) => s.midScope != null)) return slots;
  const windowsByClass = new Map<string, Promise<MidWindows>>();
  const windowsFor = (s: CourseYearSemester) => {
    const key = `${s.courseId}|${s.year}|${s.semester ?? ""}`;
    if (!windowsByClass.has(key)) windowsByClass.set(key, loadMidWindows(db, collegeId, s));
    return windowsByClass.get(key)!;
  };
  const keep = await Promise.all(slots.map(async (s) => (s.midScope == null ? true : slotActiveOn(s, date, await windowsFor(s)))));
  return slots.filter((_, i) => keep[i]);
}
