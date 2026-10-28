import { canHodEditDepartment, getHodDepartmentScope } from "@/lib/departments/scope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import { findOwnStudent } from "@/lib/students/ownContext";
import { teachingFor } from "@/lib/midBank/server";
import type { ExamMidSchedule, MidExamPlan, MidTimetable, Section, TeachingAssignment } from "@/types";
import type { BranchSubject } from "./rules";

// Server side of the Mid Timetable: where it is stored, the Mid's published
// dates, each branch's Theory subjects (the same source as the question bank:
// subjects of the semester taught to the branch's sections) and which published
// timetables a viewer may see.

type Db = FirebaseFirestore.Firestore;
type Session = { uid: string; role: string; collegeId: string };

export const MID_TIMETABLE_EDITORS = ["EXAM_CELL", "SUPER_ADMIN"];
/** See every branch's published timetable. */
export const MID_TIMETABLE_ALL_VIEWERS = ["EXAM_CELL", "SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"];
export const MID_TIMETABLE_VIEWERS = [...MID_TIMETABLE_ALL_VIEWERS, "HOD", "PANEL_MEMBER", "STUDENT"];

export function midTimetableRefs(db: Db, collegeId: string) {
  const college = db.collection("colleges").doc(collegeId);
  return { college, plans: college.collection("midExamPlans"), timetables: college.collection("midTimetables") };
}

export const planIdFor = (courseKey: string, year: number, semester: number, midNumber: number) =>
  `${courseKey}__y${year}__s${semester}__m${midNumber}`.replace(/[/\s]+/g, "-");

export async function loadPlan(db: Db, collegeId: string, id: string): Promise<MidExamPlan | null> {
  const s = await midTimetableRefs(db, collegeId).plans.doc(id).get();
  return s.exists ? ({ id: s.id, ...(s.data() as Omit<MidExamPlan, "id">) }) : null;
}

/** The Mid's published dates and time (Mid Timings & Dates) for the programme + semester, if set. */
export async function midWindow(db: Db, collegeId: string, p: Pick<MidExamPlan, "courseIds" | "courseName" | "semester" | "midNumber">): Promise<{ from: string; to: string; fromTime: string; toTime: string } | null> {
  const snap = await midTimetableRefs(db, collegeId).college.collection("examMidSchedules").where("midNumber", "==", p.midNumber).get();
  const rows = snap.docs.map((d) => d.data() as ExamMidSchedule)
    .filter((s) => s.semester === p.semester && ((s.courseId && p.courseIds.includes(s.courseId)) || s.courseName === p.courseName))
    .filter((s) => s.fromDate && s.toDate);
  if (rows.length === 0) return null;
  const from = rows.map((r) => r.fromDate).sort()[0];
  const to = rows.map((r) => r.toDate).sort().reverse()[0];
  return { from, to, fromTime: rows[0].fromTime, toTime: rows[0].toTime };
}

/** Each branch's Theory subjects for the plan's semester, by subject code. */
export async function branchSubjects(db: Db, collegeId: string, p: Pick<MidExamPlan, "courseIds" | "year" | "semester">): Promise<Map<string, BranchSubject[]>> {
  const rows = await teachingFor(db, collegeId, p);
  const out = new Map<string, Map<string, BranchSubject>>();
  for (const r of rows) {
    const m = out.get(r.branch) ?? new Map<string, BranchSubject>();
    m.set(r.subjectId, { subjectId: r.subjectId, subjectCode: r.subjectCode, subjectName: r.subjectName });
    out.set(r.branch, m);
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([b, m]) => [b, [...m.values()].sort((x, y) => x.subjectCode.localeCompare(y.subjectCode) || x.subjectName.localeCompare(y.subjectName))]));
}

const matches = (t: MidTimetable, courseId: string, year: number, branch: string) =>
  t.courseIds.includes(courseId) && t.year === year && t.branch === branch;

/**
 * The published timetables a viewer may see: every branch (Exam Cell, Principal,
 * VP), the HOD's departments and the branches they teach, the branches a faculty
 * member teaches, a student's own branch (their current section).
 */
export async function visibleTimetables(db: Db, session: Session): Promise<MidTimetable[]> {
  const refs = midTimetableRefs(db, session.collegeId);
  const published = (await refs.timetables.where("status", "==", "PUBLISHED").get()).docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<MidTimetable, "id">) }));
  if (MID_TIMETABLE_ALL_VIEWERS.includes(session.role)) return published;

  if (session.role === "STUDENT") {
    const own = await findOwnStudent(db, session.collegeId, session.uid);
    if (!own.ok) return [];
    const sec = await findCurrentSectionDoc(db, session.collegeId, own.student);
    if (!sec) return [];
    const s = sec.data() as Section;
    return published.filter((t) => matches(t, s.courseId, Number(s.year), s.department));
  }

  // Faculty (and an HOD, who also teaches): the branches of the sections they teach.
  const facultyId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
  const keys = new Set<string>();
  if (facultyId) {
    const tas = (await refs.college.collection("teachingAssignments").where("facultyId", "==", facultyId).get()).docs
      .map((d) => d.data() as TeachingAssignment).filter((t) => !t.isPast && t.sectionId);
    const sectionIds = [...new Set(tas.map((t) => t.sectionId!))];
    const secs = sectionIds.length ? await db.getAll(...sectionIds.map((id) => refs.college.collection("sections").doc(id))) : [];
    for (const s of secs) {
      if (!s.exists) continue;
      const x = s.data() as Section;
      keys.add(`${x.courseId}|${Number(x.year)}|${x.department}`);
    }
  }
  const scope = session.role === "HOD" ? await getHodDepartmentScope(db, session.collegeId, session.uid) : null;
  return published.filter((t) =>
    (scope && canHodEditDepartment(scope, t.branch))
    || t.courseIds.some((c) => keys.has(`${c}|${t.year}|${t.branch}`)));
}
