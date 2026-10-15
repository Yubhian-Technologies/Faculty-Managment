import type { Firestore } from "firebase-admin/firestore";
import { istDateKey } from "@/lib/attendance/istTime";
import { effectiveJoiningDate } from "@/lib/studentAttendance/joiningDate";
import { computeStudentAttendanceWindows, studentDepartmentsForHistory, type StudentAttendanceHistory } from "@/lib/studentAttendance/history";
import { calcPercent } from "@/lib/studentAttendance/percentage";
import { currentSemesterOf, type SemesterRange } from "@/lib/studentAttendance/studentReportRange";
import { orderSittings, studentStanding, type GpaSubject } from "@/lib/examResults/gpa";
import { loadResultRules } from "@/lib/examResults/store";
import { asGpaSitting, finalSubjectsOfSemester, loadPublishedSittings, type PublishedSitting } from "@/lib/examResults/studentSittings";
import { cachedCollectionDocs } from "@/lib/firestore/sharedReads";
import type { ExamMidSchedule, StudentRecord } from "@/types";
import type { ExamResultSubject } from "@/types/examResults";
import type {
  MentoringSemesterOption,
  MentoringSemesterSheet,
  SheetBacklog,
  SheetSubject,
} from "@/types/mentoring";
import { loadMenteeInternalMarks, loadStudentSemesterRanges, type MenteeInternalSubject } from "./progress";
import { resolveSemesterSubjects, semesterDocRef, type SnapshotSubject } from "./semesterSnapshot";
import {
  codeKey,
  monthYearLabel,
  semesterHeading,
  windowEndOfSemester,
  windowUpToMid,
  type AttendanceWindow,
} from "./semesterWindows";

// One semester page of the Student Mentoring Record, assembled from what the
// system already holds: the subject list kept for this student (semesterSnapshot),
// attendance marked by the faculty, the Exam Cell's published grades and the
// faculty's submitted internal marks. Read-only apart from the subject-list copy
// semesterSnapshot keeps. Authorization is the caller's job (access.ts).

// The month a sitting is labelled with: the month the exam was held ("2026-11"), else when it was imported.
function sittingMonthMs(s: PublishedSitting): number {
  const m = /^(\d{4})-(\d{2})$/.exec(s.examHeld ?? "");
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, 15) : s.at;
}

// Only what the Exam Cell has published (a sheet whose publish completed) - the same sittings, and the
// same engine, as the student's own Results page.
const loadPublishedRecords = loadPublishedSittings;

function optionOf(semester: number, year: number | null, inYear: number | null, current: number | null): MentoringSemesterOption {
  return { semester, label: semesterHeading(semester, year, inYear), isCurrent: current === semester };
}

/** The semesters the booklet has a page for: every one the student has reached, plus any with published results. */
export async function loadSemesterOptions(
  db: Firestore,
  collegeId: string,
  student: StudentRecord & { id: string }
): Promise<MentoringSemesterOption[]> {
  const [ranges, records] = await Promise.all([
    loadStudentSemesterRanges(db, collegeId, student),
    loadPublishedRecords(db, collegeId, student.id),
  ]);
  const current = currentSemesterOf(ranges, istDateKey(new Date()))?.semester ?? null;
  const byNumber = new Map<number, MentoringSemesterOption>();
  for (const r of ranges) byNumber.set(r.semester, optionOf(r.semester, r.year ?? null, r.inYear ?? null, current));
  for (const r of records) if (!byNumber.has(r.semester)) byNumber.set(r.semester, optionOf(r.semester, r.year || null, null, current));
  return [...byNumber.values()].sort((a, b) => a.semester - b.semester);
}

// Mid I / Mid II start dates the Exam Cell published for this student's course and semester.
async function loadMidStarts(
  db: Firestore,
  collegeId: string,
  student: Pick<StudentRecord, "courseId" | "course">,
  semester: number
): Promise<{ mid1: string | null; mid2: string | null }> {
  const out: { mid1: string | null; mid2: string | null } = { mid1: null, mid2: null };
  try {
    const courseDocs = await cachedCollectionDocs(db, collegeId, "courses");
    const own = courseDocs.find((c) => c.id === student.courseId);
    const catalogId = (own?.data() as { catalogId?: string } | undefined)?.catalogId;
    const courseIds = new Set<string>(student.courseId ? [student.courseId] : []);
    if (catalogId) for (const c of courseDocs) if ((c.data() as { catalogId?: string }).catalogId === catalogId) courseIds.add(c.id);
    const courseName = (student.course ?? "").trim().toLowerCase();

    const snap = await db.collection("colleges").doc(collegeId).collection("examMidSchedules").where("semester", "==", semester).get();
    for (const d of snap.docs) {
      const s = d.data() as ExamMidSchedule;
      const ours = (s.courseId && courseIds.has(s.courseId)) || (courseName && (s.courseName ?? "").trim().toLowerCase() === courseName);
      if (!ours || !s.fromDate) continue;
      const key = s.midNumber === 1 ? "mid1" : s.midNumber === 2 ? "mid2" : null;
      if (key && (!out[key] || s.fromDate < (out[key] as string))) out[key] = s.fromDate;
    }
  } catch (err) {
    console.error("[mentoring/semesterSheet midSchedules]", err);
  }
  return out;
}

const toResultSubject = (s: ExamResultSubject): SnapshotSubject => ({ subjectId: s.subjectId, code: s.subjectCode, name: s.subjectName, credits: s.credits });

export async function buildSemesterSheet(
  db: Firestore,
  collegeId: string,
  student: StudentRecord & { id: string },
  semester: number
): Promise<MentoringSemesterSheet | null> {
  const today = istDateKey(new Date());
  // Everything that depends on nothing but the student and the semester starts now, together with the
  // timings / results below, instead of one after another further down.
  const midsP = loadMidStarts(db, collegeId, student, semester);
  const departmentsP = studentDepartmentsForHistory(db, collegeId, student);
  const internalP = loadMenteeInternalMarks(db, collegeId, student)
    .catch((err) => { console.error("[mentoring/semesterSheet internal]", err); return { subjects: [] as MenteeInternalSubject[] }; });
  const remarksP = semesterDocRef(db, collegeId, student.id, semester).get();
  const meetingsP = db.collection("colleges").doc(collegeId).collection("students").doc(student.id).collection("mentoringEntries")
    .where("section", "==", "meetings").where("semester", "==", semester).count().get()
    .then((c) => c.data().count).catch(() => 0);
  // Started early; if the page turns out to have nothing to show they are never awaited, so a failure must not go unhandled.
  for (const p of [midsP, departmentsP, remarksP]) p.catch(() => undefined);
  const [ranges, records, { rules }] = await Promise.all([
    loadStudentSemesterRanges(db, collegeId, student),
    loadPublishedRecords(db, collegeId, student.id),
    loadResultRules(db, collegeId),
  ]);
  const range: SemesterRange | null = ranges.find((r) => r.semester === semester) ?? null;
  // The semester's sittings, oldest first (Regular, then supplementaries); revaluations follow the sitting they re-grade.
  const own = orderSittings(records.filter((r) => r.semester === semester && r.examType !== "REVALUATION"));
  const revals = records.filter((r) => r.semester === semester && r.examType === "REVALUATION");
  if (!range && own.length === 0) return null;

  const current = currentSemesterOf(ranges, today);
  const isCurrent = !!range && current?.semester === semester && range.endDate >= today;
  const isPast = !range || range.endDate < today || (current != null && semester < current.semester);
  const year = range?.year ?? (own[0]?.year || null);

  // Attendance windows: cumulative from the semester's start.
  const mids = range ? await midsP : { mid1: null, mid2: null };
  const start = range?.startDate ?? null;
  const end = range?.endDate ?? null;
  const windows: { mid1: AttendanceWindow | null; mid2: AttendanceWindow | null; end: AttendanceWindow | null } = {
    mid1: windowUpToMid(start, end, mids.mid1, today),
    mid2: windowUpToMid(start, end, mids.mid2, today),
    end: windowEndOfSemester(start, end, today),
  };
  const departments = await departmentsP;
  const joinedOn = effectiveJoiningDate(student);
  // The three windows are cumulative from the semester start: one scan of the department's sessions serves all.
  const attendanceAll: Promise<(StudentAttendanceHistory | null)[]> = computeStudentAttendanceWindows(
    db, collegeId, student.id, departments, [windows.mid1, windows.mid2, windows.end], { joinedOn }
  ).catch((err) => { console.error("[mentoring/semesterSheet attendance]", err); return [null, null, null]; });
  const attendance = {
    mid1: attendanceAll.then((a) => a[0]),
    mid2: attendanceAll.then((a) => a[1]),
    end: attendanceAll.then((a) => a[2]),
  };

  const mergedResults = finalSubjectsOfSemester(records, semester);
  const set = await resolveSemesterSubjects({
    db, collegeId, student, semester, year, isPast,
    resultsAcademicYear: own[0]?.academicYear || null,
    resultSubjects: mergedResults.map(toResultSubject),
    attendanceSubjects: async () => {
      const h = await attendance.end;
      return (h?.subjects ?? []).map((s) => ({ subjectId: s.subjectId, code: s.shortCode || s.subjectCode, name: s.subjectName, credits: null }));
    },
  });

  const [attMid1, attMid2, attEnd, internal, remarksDoc, meetings] = await Promise.all([
    attendance.mid1, attendance.mid2, attendance.end, internalP, remarksP, meetingsP,
  ]);

  const percentFor = (h: StudentAttendanceHistory | null, s: SnapshotSubject): number | null => {
    const row = h?.subjects.find((r) => r.subjectId === s.subjectId)
      ?? h?.subjects.find((r) => codeKey(r.subjectCode) === codeKey(s.code) || (!!r.shortCode && codeKey(r.shortCode) === codeKey(s.code)));
    return row ? calcPercent(row.attend, row.held) : null;
  };
  const overallOf = (h: StudentAttendanceHistory | null) => (h ? calcPercent(h.total.attend, h.total.held) : null);

  const internalFor = (s: SnapshotSubject): SheetSubject["internal"] => {
    const candidates = internal.subjects.filter((m) => codeKey(m.subjectCode) === codeKey(s.code));
    const pick = candidates.filter((m) => m.year === year).pop() ?? (year == null ? candidates.pop() : undefined);
    return pick ? { components: pick.components, total: pick.total, maxTotal: pick.maxTotal } : null;
  };

  const subjects: SheetSubject[] = set.subjects.map((s) => {
    // A result row names its subject by id and by the college's or the university's code.
    const keys = [s.code, s.universityCode, s.shortCode].filter(Boolean).map(codeKey);
    const graded = mergedResults.find((r) => r.subjectId === s.subjectId) ?? mergedResults.find((r) => keys.includes(codeKey(r.subjectCode)));
    return {
      subjectId: s.subjectId,
      code: s.code,
      name: s.name,
      credits: s.credits ?? graded?.credits ?? null,
      attendance: { mid1: percentFor(attMid1, s), mid2: percentFor(attMid2, s), end: percentFor(attEnd, s) },
      internal: internalFor(s),
      grade: graded ? { grade: graded.grade, points: graded.points, isPass: graded.isPass } : null,
    };
  });
  // A graded subject the curriculum copy does not list still belongs on the page.
  for (const g of mergedResults) {
    if (subjects.some((s) => codeKey(s.code) === codeKey(g.subjectCode) || s.subjectId === g.subjectId)) continue;
    subjects.push({
      subjectId: g.subjectId, code: g.subjectCode, name: g.subjectName, credits: g.credits,
      attendance: { mid1: null, mid2: null, end: null }, internal: null,
      grade: { grade: g.grade, points: g.points, isPass: g.isPass },
    });
  }

  // Backlog table: every subject that failed a sitting, with each later attempt.
  const backlogs: SheetBacklog[] = [];
  const codes = [...new Set(own.flatMap((r) => (r.subjects ?? []).map((s) => codeKey(s.subjectCode))))];
  for (const code of codes) {
    const attempts: SheetBacklog["attempts"] = [];
    let supple = 0;
    let name = "";
    for (const r of own) {
      const s = (r.subjects ?? []).find((x) => codeKey(x.subjectCode) === code);
      if (!s) continue;
      name = s.subjectName || name;
      const month = sittingMonthMs(r);
      const label = r.examType === "REGULAR" ? "Regular" : `Supple ${++supple}${month ? ` (${monthYearLabel(month)})` : ""}`;
      attempts.push({ label, grade: s.grade, isPass: s.isPass });
      // A revaluation of this sitting follows it; the final grade (best of the two) is the one in the table above.
      for (const rv of orderSittings(revals.filter((x) => x.revaluesBatchId === r.batchId))) {
        const re = (rv.subjects ?? []).find((x) => codeKey(x.subjectCode) === code);
        if (re) attempts.push({ label: "Revaluation", grade: re.grade, isPass: re.isPass });
      }
    }
    if (attempts.some((a) => !a.isPass)) backlogs.push({ code: own.flatMap((r) => r.subjects ?? []).find((x) => codeKey(x.subjectCode) === code)?.subjectCode ?? code, name, attempts });
  }

  // Overall standing up to this semester, from every published sitting.
  const standing = studentStanding(records.map(asGpaSitting), semester, rules);
  const perSemester = new Map<number, GpaSubject[]>();
  for (const n of [...new Set(records.filter((r) => r.semester <= semester).map((r) => r.semester))]) {
    perSemester.set(n, finalSubjectsOfSemester(records, n));
  }
  const all = [...perSemester.values()].flat();
  const remarks = remarksDoc.data() as { remarks?: string; remarksByName?: string; remarksAt?: { toDate?: () => Date } } | undefined;

  return {
    semester,
    year,
    inYear: range?.inYear ?? null,
    academicYear: set.academicYear || own[0]?.academicYear || "",
    regulation: set.regulation || own[0]?.regulation || student.regulation || "",
    startDate: start,
    endDate: end,
    isCurrent,
    subjectsSource: set.source,
    subjectsNote: set.note,
    mids,
    attendanceTo: { mid1: windows.mid1?.to ?? null, mid2: windows.mid2?.to ?? null, end: windows.end?.to ?? null },
    subjects,
    attendanceOverall: { mid1: overallOf(attMid1), mid2: overallOf(attMid2), end: overallOf(attEnd) },
    backlogs,
    overall: {
      published: own.length > 0,
      creditsEarned: all.filter((s) => s.isPass).reduce((n, s) => n + s.credits, 0),
      creditsRegistered: all.filter((s) => s.credits > 0).reduce((n, s) => n + s.credits, 0),
      sgpa: standing.sgpa,
      sgpaWithheld: standing.sgpaWithheld,
      cgpa: standing.cgpa,
      cgpaWithheld: standing.cgpaWithheld,
      backlogCodes: standing.backlogs,
      decimals: rules.decimals,
    },
    remarks: remarks?.remarks
      ? { text: remarks.remarks, byName: remarks.remarksByName ?? "", at: remarks.remarksAt?.toDate?.().toISOString() ?? null }
      : null,
    meetingCount: meetings,
  };
}
