import type { Firestore } from "firebase-admin/firestore";
import { facultyManageableDepartmentNames } from "@/lib/departments/scope";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { actorOf } from "@/lib/audit/actorOf";
import { notify } from "@/lib/notify";
import { AVAILABLE_FACULTY_STATUSES } from "@/types";
import { resolveSelfMentor } from "./selfMentor";

// The two steps every way of giving students a mentor shares (by picking students, by Regd. Nos):
// who may be the mentor, and the audit entry + notification afterwards.

/** Where a student sits: what a mentor from another department must teach. */
export interface StudentPlace { department?: string; secondaryDepartment?: string; section?: string; year?: number }

export type MentorCheck =
  | {
      ok: true;
      name: string;
      /** From another department: may mentor only students of the sections they teach (`covers`). */
      otherDepartment: boolean;
      covers: (student: StudentPlace) => boolean;
    }
  | { ok: false; status: 400 | 403 | 404; error: string };

const placeKey = (department: string | undefined, section: string | undefined, year: number | undefined) =>
  `${(department ?? "").trim().toLowerCase()}|${(section ?? "").trim().toLowerCase()}|${Number(year) || 0}`;

/** The sections (department + name + year) a faculty member currently teaches - their teaching assignments, past ones left out. */
export async function sectionsTaughtBy(db: Firestore, collegeId: string, facultyId: string): Promise<Set<string>> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const ta = await collegeRef.collection("teachingAssignments").where("facultyId", "==", facultyId).select("sectionId", "isPast").get();
  const sectionIds = [...new Set(ta.docs.filter((d) => !d.get("isPast")).map((d) => d.get("sectionId") as string | undefined).filter((x): x is string => !!x))];
  if (sectionIds.length === 0) return new Set();
  const docs = await db.getAll(...sectionIds.map((id) => collegeRef.collection("sections").doc(id)));
  return new Set(docs.filter((d) => d.exists).map((d) => placeKey(d.get("department"), d.get("name"), d.get("year"))));
}

/** Whether a student sits in one of the taught sections (their own department, or the branch they are filed under). */
export function studentInSections(taught: Set<string>, s: StudentPlace): boolean {
  return taught.has(placeKey(s.department, s.section, s.year)) || (!!s.secondaryDepartment && taught.has(placeKey(s.secondaryDepartment, s.section, s.year)));
}

/**
 * Who may be the mentor: an available faculty member with a login, either of the HOD's own (and sub-) departments,
 * or of another department who teaches the students' section (then only for those students - `covers`), or the
 * HOD themselves.
 */
export async function resolveMentorForHod(
  db: Firestore,
  collegeId: string,
  hodUid: string,
  scope: Parameters<typeof facultyManageableDepartmentNames>[0],
  mentorUid: string
): Promise<MentorCheck> {
  const everyone = () => true;
  if (mentorUid === hodUid) {
    // The HOD may always pick themselves (also a Principal / VP with no faculty record - see selfMentor).
    const self = await resolveSelfMentor(db, collegeId, hodUid);
    return self ? { ok: true, name: self.name, otherDepartment: false, covers: everyone } : { ok: false, status: 400, error: "You are not available to mentor" };
  }
  const facSnap = await db.collection("colleges").doc(collegeId).collection("facultyMembers").where("userUid", "==", mentorUid).limit(1).get();
  const facDoc = facSnap.docs[0];
  const fac = facDoc?.data() as { legalName?: string; honorific?: string; department?: string; status?: string } | undefined;
  if (!fac) return { ok: false, status: 404, error: "Mentor not found" };
  if (!(AVAILABLE_FACULTY_STATUSES as string[]).includes(fac.status ?? "")) {
    return { ok: false, status: 400, error: "This faculty member is no longer available to mentor" };
  }
  if (facultyManageableDepartmentNames(scope).includes(fac.department ?? "")) {
    return { ok: true, name: facultyDisplayName(fac), otherDepartment: false, covers: everyone };
  }
  // Another department's faculty member: only for the sections they teach.
  const taught = await sectionsTaughtBy(db, collegeId, facDoc.id);
  if (taught.size === 0) {
    return { ok: false, status: 403, error: "This faculty member is outside your department and doesn't teach any section. Pick a faculty member who teaches these students." };
  }
  return { ok: true, name: facultyDisplayName(fac), otherDepartment: true, covers: (st) => studentInSections(taught, st) };
}

/** Audit entry for the change, and a notification to the mentor (not when the HOD assigned themselves). */
export async function announceMentorChange(
  db: Firestore,
  session: { collegeId: string; uid: string; email?: string },
  change: { mentorUid: string | null; mentorName: string; studentIds: string[] }
): Promise<void> {
  if (change.studentIds.length === 0) return;
  const actor = await actorOf(db, session.collegeId, session.uid, session.email);
  await writeAuditLogSafe(db, session.collegeId, {
    action: change.mentorUid ? "STUDENT_MENTOR_ASSIGNED" : "STUDENT_MENTOR_REMOVED",
    performedBy: session.uid,
    performedByName: actor.name,
    targetId: change.mentorUid ?? undefined,
    details: { mentorName: change.mentorName || undefined, students: change.studentIds.length, studentIds: change.studentIds.slice(0, 50) },
  });
  if (change.mentorUid && change.mentorUid !== session.uid) {
    const n = change.studentIds.length;
    await notify(
      db, session.collegeId, change.mentorUid, "MENTEES_ASSIGNED",
      "Students assigned to you for mentoring",
      `${n} student${n === 1 ? "" : "s"} ${n === 1 ? "has" : "have"} been assigned to you as mentee${n === 1 ? "" : "s"}.`,
      "/panel/mentoring"
    );
  }
}
