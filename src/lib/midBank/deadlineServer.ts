import { notify } from "@/lib/notify";
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

/** Tell everyone teaching a subject of the deadline's semester (one notification each). */
export async function notifyTeachers(db: FirebaseFirestore.Firestore, collegeId: string, d: MidBankDeadline, title: string): Promise<number> {
  const rows = await teachingFor(db, collegeId, d);
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
