import { getDepartmentHeadUids, notify } from "@/lib/notify";
import { loadMidSettings } from "@/lib/exams/midSettings";
import { departmentNamesById } from "@/lib/subjects/ownerDepartment";
import { branchesOf, reviewDepartmentsForScope } from "./assignmentsServer";
import type { TeachingRow } from "./sections";
import type { Subject } from "@/types";
import { deadlineLabel } from "./deadline";
import { loginUidsOf, midBankRefs, teachingFor } from "./server";
import type { ExamMidSchedule, MidBankDeadline } from "@/types";

// Deadline helpers shared by the deadline routes: when a Mid starts (the
// deadline must be before it) and notifying the faculty a deadline concerns.

/** The day a Mid's exams start for this programme + semester, when its timings are published. */
export async function midStartDate(db: FirebaseFirestore.Firestore, collegeId: string, courseIds: string[], courseName: string, semester: number, midNumber: number): Promise<string | null> {
  const snap = await midBankRefs(db, collegeId).college.collection("examMidSchedules").where("midNumber", "==", midNumber).get();
  const starts = snap.docs.map((d) => d.data() as ExamMidSchedule)
    .filter((s) => s.semester === semester && ((s.courseId && courseIds.includes(s.courseId)) || s.courseName === courseName))
    .map((s) => s.fromDate).filter(Boolean).sort();
  return starts[0] ?? null;
}

/**
 * Tell everyone teaching a subject of the deadline's semester (one notification each). "The HOD assigns" colleges:
 * tell each subject's reviewing HOD (Subject Department, else the branch) to assign the setters instead.
 */
export async function notifyTeachers(db: FirebaseFirestore.Firestore, collegeId: string, d: MidBankDeadline, title: string): Promise<number> {
  const rows = await teachingFor(db, collegeId, d);
  if ((await loadMidSettings(db, collegeId)).midAssignment === "HOD") return notifyAssigningHods(db, collegeId, d, title, rows);
  const subjectsBy = new Map<string, Set<string>>();
  for (const r of rows) subjectsBy.set(r.facultyId, (subjectsBy.get(r.facultyId) ?? new Set()).add(r.subjectName));
  const uids = await loginUidsOf(db, collegeId, [...subjectsBy.keys()]);
  let sent = 0;
  for (const [facultyId, subjects] of subjectsBy) {
    const uid = uids.get(facultyId);
    if (!uid) continue;
    await notify(db, collegeId, uid, "MID_BANK_OPEN", title,
      `${[...subjects].join(", ")} - ${deadlineLabel(d.deadline)}. Prepare it under Question Bank.`, "/panel/mid-bank");
    sent++;
  }
  return sent;
}

async function notifyAssigningHods(db: FirebaseFirestore.Firestore, collegeId: string, d: MidBankDeadline, title: string, rows: TeachingRow[]): Promise<number> {
  const names = await departmentNamesById(db, collegeId);
  const subjectIds = [...new Set(rows.map((r) => r.subjectId))];
  const col = midBankRefs(db, collegeId).college.collection("subjects");
  const subjects = subjectIds.length ? await db.getAll(...subjectIds.map((id) => col.doc(id))) : [];
  const byDept = new Map<string, Set<string>>();
  for (const s of subjects) {
    if (!s.exists) continue;
    const subject = s.data() as Subject;
    for (const br of branchesOf(rows, s.id)) {
      for (const dep of reviewDepartmentsForScope(rows, subject, br, names)) byDept.set(dep, (byDept.get(dep) ?? new Set()).add(subject.name));
    }
  }
  const byUid = new Map<string, Set<string>>();
  for (const [dep, subs] of byDept) for (const uid of await getDepartmentHeadUids(db, collegeId, dep)) {
    const set = byUid.get(uid) ?? new Set<string>();
    subs.forEach((x) => set.add(x));
    byUid.set(uid, set);
  }
  for (const [uid, subs] of byUid) {
    await notify(db, collegeId, uid, "MID_BANK_ASSIGN", `${title} - assign the setters`,
      `${subs.size} subject${subs.size === 1 ? "" : "s"} (${[...subs].slice(0, 6).join(", ")}${subs.size > 6 ? " ..." : ""}) - ${deadlineLabel(d.deadline)}. Assign who prepares each under Mid Question Bank.`, "/hod/question-banks");
  }
  return byUid.size;
}
