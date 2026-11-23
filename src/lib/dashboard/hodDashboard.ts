import { isOnDutyMark } from "@/lib/studentAttendance/counting";

// Pure figures for the HOD dashboard (components/hod/HodDashboardHome.tsx, GET /api/college/hod/dashboard). The
// server loads; everything that turns records into numbers lives here so it can be tested.

/** One class (section + period) today. */
export type ClassStatus = "POSTED" | "NOW" | "OVERDUE" | "UPCOMING";

export interface ClassCell {
  status: ClassStatus;
  /** Taught by a substitute or through a class adjustment. */
  covered: boolean;
  subject: string;
  faculty: string;
  facultyId?: string;
  facultyDepartment?: string;
  start: string;
  end: string;
  /** A posted period: students present / marked (on duty counts as present; the "/" number is everyone marked). */
  present?: number;
  total?: number;
  /** Those marked absent in it (for the cell's detail). */
  absent?: { name: string; rollNumber: string }[];
}

const RANK: Record<ClassStatus, number> = { POSTED: 3, NOW: 2, OVERDUE: 1, UPCOMING: 0 };

/** A period's state at `nowHHMM` ("HH:MM", India time): posted wins; otherwise running, ended (overdue) or later. */
export function classStatus(posted: boolean, start: string, end: string, nowHHMM: string): ClassStatus {
  if (posted) return "POSTED";
  if (end && nowHHMM >= end) return "OVERDUE";
  if (start && nowHHMM >= start) return "NOW";
  return "UPCOMING";
}

/** Two faculty can hold the same section + period (a split lab, a substitute): the one further along stands for it. */
export function mergeCell(a: ClassCell | undefined, b: ClassCell): ClassCell {
  if (!a) return b;
  const pick = RANK[b.status] > RANK[a.status] ? b : a;
  return { ...pick, covered: a.covered || b.covered };
}

export interface TodaySession {
  sectionId: string;
  date: string;
  periodNumber?: number;
  entries: { studentId: string; status: string | null }[];
}

export interface SectionToday {
  sectionId: string;
  /** Marks counted (on duty left out) and of those present - over every posted period today. */
  counted: number;
  present: number;
  pct: number | null;
  /** Students marked in at least one period today and present in none. */
  absentAllDay: number;
  students: number;
}

/** Each section's student attendance so far today, from its posted periods (the same marks every report counts). */
export function sectionAttendanceToday(sessions: TodaySession[]): SectionToday[] {
  const by = new Map<string, { counted: number; present: number; perStudent: Map<string, { held: number; present: number }> }>();
  for (const s of sessions) {
    const cur = by.get(s.sectionId) ?? { counted: 0, present: 0, perStudent: new Map() };
    for (const e of s.entries) {
      if (isOnDutyMark(e.status)) continue;
      cur.counted += 1;
      const st = cur.perStudent.get(e.studentId) ?? { held: 0, present: 0 };
      st.held += 1;
      if (e.status === "PRESENT") { cur.present += 1; st.present += 1; }
      cur.perStudent.set(e.studentId, st);
    }
    by.set(s.sectionId, cur);
  }
  return [...by.entries()].map(([sectionId, v]) => ({
    sectionId,
    counted: v.counted,
    present: v.present,
    pct: v.counted ? Math.round((v.present / v.counted) * 1000) / 10 : null,
    absentAllDay: [...v.perStudent.values()].filter((x) => x.held > 0 && x.present === 0).length,
    students: v.perStudent.size,
  }));
}

/** Department average per day (present / counted marks) for the last `days` dates that had classes, oldest first. */
export function dailyTrend(sessions: TodaySession[], days: number, upTo: string): { date: string; pct: number }[] {
  const by = new Map<string, { counted: number; present: number }>();
  for (const s of sessions) {
    if (s.date > upTo) continue;
    const d = by.get(s.date) ?? { counted: 0, present: 0 };
    for (const e of s.entries) {
      if (isOnDutyMark(e.status)) continue;
      d.counted += 1;
      if (e.status === "PRESENT") d.present += 1;
    }
    by.set(s.date, d);
  }
  return [...by.entries()]
    .filter(([, v]) => v.counted > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-days)
    .map(([date, v]) => ({ date, pct: Math.round((v.present / v.counted) * 1000) / 10 }));
}

/** Share of students who passed every subject of a sheet (a student with no subjects is left out). */
export function passRate(records: { subjects?: { isPass: boolean }[] }[]): { students: number; passed: number; pct: number | null } {
  const withSubjects = records.filter((r) => (r.subjects?.length ?? 0) > 0);
  const passed = withSubjects.filter((r) => r.subjects!.every((s) => s.isPass)).length;
  return { students: withSubjects.length, passed, pct: withSubjects.length ? Math.round((passed / withSubjects.length) * 1000) / 10 : null };
}

/** Roman year label for a section heading ("III-A"). */
export function yearRoman(year: number): string {
  return ["", "I", "II", "III", "IV", "V", "VI"][year] ?? String(year);
}
