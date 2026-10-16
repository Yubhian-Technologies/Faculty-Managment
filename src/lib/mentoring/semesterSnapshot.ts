import type { Firestore } from "firebase-admin/firestore";
import { cachedCollectionDocs } from "@/lib/firestore/sharedReads";
import { getInChunks } from "@/lib/firestore/inQuery";
import { sectionAssignmentScope } from "@/lib/departments/sectionAssignmentScope";
import type { Course, Department, StudentRecord, SubjectSemesterAssignment } from "@/types";
import type { SubjectsSource } from "@/types/mentoring";
import { academicYearOfStudentYear } from "./semesterWindows";

// Which subjects (code, name, credits) were THIS student's for a semester.
//
// The curriculum a semester's subjects come from (subjectSemesterAssignments) is
// one live set per (department, year, semester) that the Academics edits in
// place: when a subject is added or changed for the next batch the same rows
// change, so reading them later would show an earlier batch the wrong subjects.
// The record therefore keeps its own copy per student per semester
// (students/{id}/mentoringSemesters/{n}):
//   - while the semester is running it is a LIVE copy, refreshed whenever the
//     sheet is opened;
//   - once the semester is over it is FROZEN and never rewritten;
//   - a semester that ended before any copy was taken is rebuilt from the
//     published results (which snapshot code / name / credits at import) and
//     frozen from then on.

export interface SnapshotSubject {
  subjectId: string;
  code: string;
  shortCode?: string;
  name: string;
  credits: number | null;
  serial?: number;
}

export interface SemesterSubjectSet {
  subjects: SnapshotSubject[];
  source: SubjectsSource;
  regulation: string;
  academicYear: string;
  note: string;
}

export const semesterDocRef = (db: Firestore, collegeId: string, studentId: string, semester: number) =>
  db.collection("colleges").doc(collegeId).collection("students").doc(studentId).collection("mentoringSemesters").doc(String(semester));

interface StoredSemester {
  subjects?: SnapshotSubject[];
  frozen?: boolean;
  source?: string;
  regulation?: string;
  academicYear?: string;
}

const sameSubjects = (a: SnapshotSubject[], b: SnapshotSubject[]) =>
  a.length === b.length && a.every((s, i) => s.subjectId === b[i].subjectId && s.code === b[i].code && s.name === b[i].name && s.credits === b[i].credits);

/** The subjects the curriculum assigns to this student's course / year / semester right now. */
export async function loadLiveSemesterSubjects(
  db: Firestore,
  collegeId: string,
  student: Pick<StudentRecord, "department" | "secondaryDepartment" | "courseId" | "regulation">,
  year: number,
  semester: number
): Promise<{ subjects: SnapshotSubject[]; regulation: string }> {
  const [courseDocs, deptDocs] = await Promise.all([
    cachedCollectionDocs(db, collegeId, "courses"),
    cachedCollectionDocs(db, collegeId, "departments"),
  ]);
  const scope = sectionAssignmentScope(
    { department: student.department, secondaryDepartment: student.secondaryDepartment ?? undefined, courseId: student.courseId, year },
    courseDocs.map((d) => ({ id: d.id, ...d.data() })) as Pick<Course, "id" | "departmentId" | "catalogId">[],
    deptDocs.map((d) => ({ id: d.id, ...d.data() })) as (Department & { id: string })[]
  );
  if (scope.departmentIds.length === 0) return { subjects: [], regulation: "" };

  const docs = await getInChunks(scope.departmentIds, (chunk) =>
    db.collection("colleges").doc(collegeId).collection("subjectSemesterAssignments").where("departmentId", "in", chunk)
  );
  const courseSet = new Set(scope.courseIds);
  const branch = student.secondaryDepartment || student.department;

  const rows = docs
    .map((d) => d.data() as SubjectSemesterAssignment)
    .filter((a) =>
      a.semester === semester &&
      a.isActive !== false &&
      (a.courseId == null || courseSet.has(a.courseId)) &&
      (a.year == null || a.year === year) &&
      // A batch follows its own regulation; a row with none is open to every regulation.
      !(student.regulation && a.regulation && a.regulation !== student.regulation) &&
      // A row narrowed to specific core branches counts only for those.
      (!a.secondaryDepartmentNames?.length || a.secondaryDepartmentNames.includes(branch))
    )
    .sort((a, b) => (a.serialNumber ?? Number.MAX_SAFE_INTEGER) - (b.serialNumber ?? Number.MAX_SAFE_INTEGER) || (a.subjectCode ?? "").localeCompare(b.subjectCode ?? "", undefined, { numeric: true }));

  const seen = new Set<string>();
  const subjects: SnapshotSubject[] = [];
  for (const a of rows) {
    const id = a.masterSubjectId || a.subjectId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    subjects.push({
      subjectId: id,
      code: a.subjectCode ?? "",
      ...(a.shortCode ? { shortCode: a.shortCode } : {}),
      name: a.subjectName ?? "",
      credits: typeof a.credits === "number" ? a.credits : null,
      ...(a.serialNumber != null ? { serial: a.serialNumber } : {}),
    });
  }
  return { subjects, regulation: rows.find((r) => r.regulation)?.regulation ?? "" };
}

export interface ResolveSemesterArgs {
  db: Firestore;
  collegeId: string;
  student: StudentRecord & { id: string };
  semester: number;
  /** The semester's course year (from the calendar), when known. */
  year: number | null;
  /** The semester has ended (or a later one has begun): its subject list must now stay as it is. */
  isPast: boolean;
  /** Academic year printed on this student's published results for the semester, when there are any. */
  resultsAcademicYear: string | null;
  /** The semester's subjects as the published results snapshotted them. */
  resultSubjects: SnapshotSubject[];
  /** Subjects the attendance marked in the semester names (no credits) - the last resort. */
  attendanceSubjects: () => Promise<SnapshotSubject[]>;
}

export async function resolveSemesterSubjects(args: ResolveSemesterArgs): Promise<SemesterSubjectSet> {
  const { db, collegeId, student, semester, isPast } = args;
  const year = args.year ?? student.year;
  const ref = semesterDocRef(db, collegeId, student.id, semester);
  const stored = (await ref.get()).data() as StoredSemester | undefined;
  const storedSubjects = stored?.subjects ?? [];
  const academicYear = stored?.academicYear || args.resultsAcademicYear || academicYearOfStudentYear(student.batch, student.studentType, year) || "";
  const regulation = stored?.regulation || student.regulation || "";

  const save = async (data: Record<string, unknown>) => {
    try { await ref.set({ semester, year, ...data, updatedAt: new Date() }, { merge: true }); }
    catch (err) { console.error("[mentoring/semesterSnapshot save]", err); }
  };

  // 1. A frozen copy is the record - nothing is looked up again.
  if (stored?.frozen && storedSubjects.length > 0) {
    return {
      subjects: storedSubjects, source: "SNAPSHOT", regulation, academicYear,
      note: `Subjects exactly as they stood for this student in ${academicYear || "that semester"}, kept on the record. Later curriculum changes do not affect them.`,
    };
  }

  // 2. A running semester follows the curriculum, and keeps a copy of it.
  if (!isPast) {
    const live = await loadLiveSemesterSubjects(db, collegeId, student, year, semester);
    if (live.subjects.length > 0) {
      if (!sameSubjects(storedSubjects, live.subjects)) {
        await save({ subjects: live.subjects, regulation: live.regulation || regulation, academicYear, frozen: false, source: "LIVE", capturedAt: new Date() });
      }
      return {
        subjects: live.subjects, source: "LIVE", regulation: live.regulation || regulation, academicYear,
        note: "Taken from the curriculum assigned for this semester. A copy is kept on this student's record, and it is frozen when the semester ends, so later changes never alter it.",
      };
    }
    if (storedSubjects.length > 0) {
      return { subjects: storedSubjects, source: "SNAPSHOT", regulation, academicYear, note: "The curriculum no longer lists this semester; showing the copy kept on this student's record." };
    }
  }

  // 3. A finished semester: freeze what was captured while it ran...
  if (isPast && storedSubjects.length > 0) {
    await save({ frozen: true, frozenAt: new Date() });
    return {
      subjects: storedSubjects, source: "SNAPSHOT", regulation, academicYear,
      note: `Subjects as they stood for this student in ${academicYear || "that semester"}; now frozen on the record.`,
    };
  }

  // 4. ...else rebuild it from the published results, which snapshot code / name / credits when imported.
  if (args.resultSubjects.length > 0) {
    if (isPast) {
      await save({ subjects: args.resultSubjects, regulation, academicYear, frozen: true, frozenAt: new Date(), source: "RESULTS" });
    }
    return {
      subjects: args.resultSubjects, source: "RESULTS", regulation, academicYear,
      note: "Rebuilt from this semester's published results, because the subject list was not saved while the semester ran.",
    };
  }

  // 5. Last resort: the subjects attendance was marked for.
  const fromAttendance = await args.attendanceSubjects();
  if (fromAttendance.length > 0) {
    return {
      subjects: fromAttendance, source: "ATTENDANCE", regulation, academicYear,
      note: "No curriculum copy or published result exists for this semester, so the subjects are taken from the attendance marked in it (credits unknown).",
    };
  }
  return { subjects: [], source: "NONE", regulation, academicYear, note: "No subjects could be found for this semester." };
}
