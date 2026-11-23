import { nowInIndia } from "@/lib/leave/dayCounter";
import { istDateKey } from "@/lib/attendance/istTime";
import { toDate } from "@/lib/utils";
import { loadEffectiveTiming, matchesCurrentSemester, resolveCurrentSemester } from "@/lib/college/semester";
import { loadAcademicYearConfig, sessionInAcademicYear, windowForAcademicYear } from "@/lib/studentAttendance/academicYearWindow";
import { indexSessions, isOnDutyMark, tallyStudent } from "@/lib/studentAttendance/counting";
import { effectiveJoiningDate } from "@/lib/studentAttendance/joiningDate";
import { calcPercent } from "@/lib/studentAttendance/percentage";
import type { StudentAttendanceSession } from "@/types";

// Attendance figures for the HOD Students page overview - only the sections the page shows: each student's semester
// % (the current semester of their section's course-year, from its start to today, counted the same way as every
// report: own roster entries, Date of Joining, on duty left out) and today's mark. One query per section for the
// semester and one per 30 sections for today - no timetable reads, so it stays quick.

type Db = FirebaseFirestore.Firestore;
export interface OverviewSectionRef { id: string; courseId: string; year: number }
export interface OverviewStudentRef { id: string; sectionId: string | null; dateOfJoining?: string | null }

export interface OverviewAttendance {
  pct: Record<string, number>;
  today: Record<string, "P" | "A" | "OD">;
  section: Record<string, { pct: number | null; below: number; todayPct: number | null }>;
}

export async function overviewAttendance(db: Db, collegeId: string, sections: OverviewSectionRef[], students: OverviewStudentRef[], short = 75): Promise<OverviewAttendance> {
  const college = db.collection("colleges").doc(collegeId);
  const today = nowInIndia().dateISO;
  const cfg = await loadAcademicYearConfig(db, collegeId);
  const window = windowForAcademicYear(cfg.currentLabel, cfg);
  const timing = new Map<string, ReturnType<typeof loadEffectiveTiming>>();
  const timingOf = (courseId: string, year: number) => {
    const k = `${courseId}_${year}`;
    if (!timing.has(k)) timing.set(k, loadEffectiveTiming(db, collegeId, courseId, year).catch(() => null));
    return timing.get(k)!;
  };
  const bySection = new Map<string, OverviewStudentRef[]>();
  for (const s of students) if (s.sectionId) bySection.set(s.sectionId, [...(bySection.get(s.sectionId) ?? []), s]);

  const out: OverviewAttendance = { pct: {}, today: {}, section: {} };
  const todaySessions: StudentAttendanceSession[] = [];
  await Promise.all(sections.filter((s) => bySection.has(s.id)).map(async (sec) => {
    const t = await timingOf(sec.courseId, sec.year);
    const current = resolveCurrentSemester(t, new Date());
    const startRaw = t?.semesters?.find((x) => x.semester === current)?.startDate;
    const start = startRaw ? toDate(startRaw) : null;
    const from = start ? istDateKey(start) : window?.from;
    let q: FirebaseFirestore.Query = college.collection("studentAttendance").where("sectionId", "==", sec.id).where("status", "==", "SUBMITTED");
    if (from) q = q.where("date", ">=", from);
    q = q.where("date", "<=", today);
    const list = (await q.get()).docs.map((d) => d.data() as StudentAttendanceSession)
      .filter((r) => matchesCurrentSemester(r.semester, current) && sessionInAcademicYear(r, window ?? null));
    todaySessions.push(...list.filter((r) => r.date === today));
    const indexed = indexSessions(list);
    let held = 0, attended = 0, below = 0;
    for (const stu of bySection.get(sec.id) ?? []) {
      const tally = tallyStudent(indexed, stu.id, effectiveJoiningDate(stu));
      const p = calcPercent(tally.attended, tally.held);
      if (p == null) continue;
      out.pct[stu.id] = p;
      held += tally.held; attended += tally.attended;
      if (p < short) below += 1;
    }
    out.section[sec.id] = { pct: calcPercent(attended, held), below, todayPct: null };
  }));

  // Today: P if present in any period, OD if only on duty, A if absent in every period marked so far.
  const todayCounts = new Map<string, { marked: number; present: number }>();
  for (const s of todaySessions) {
    const c = todayCounts.get(s.sectionId ?? "") ?? { marked: 0, present: 0 };
    for (const e of s.entries ?? []) {
      const cur = out.today[e.studentId];
      if (e.status === "PRESENT") out.today[e.studentId] = "P";
      else if (isOnDutyMark(e.status)) { if (cur !== "P") out.today[e.studentId] = "OD"; }
      else if (!cur) out.today[e.studentId] = "A";
      if (isOnDutyMark(e.status)) continue;
      c.marked += 1;
      if (e.status === "PRESENT") c.present += 1;
    }
    todayCounts.set(s.sectionId ?? "", c);
  }
  for (const [id, c] of todayCounts) if (out.section[id]) out.section[id].todayPct = calcPercent(c.present, c.marked);
  return out;
}
