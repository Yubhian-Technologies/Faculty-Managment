import type { Firestore } from "firebase-admin/firestore";
import { facultyManageableDepartmentNames } from "@/lib/departments/scope";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { actorOf } from "@/lib/audit/actorOf";
import { notify } from "@/lib/notify";
import { AVAILABLE_FACULTY_STATUSES } from "@/types";
import { resolveSelfMentor } from "./selfMentor";

// The two steps every way of giving students a mentor shares (by picking students, by roll numbers):
// who may be the mentor, and the audit entry + notification afterwards.

export type MentorCheck = { ok: true; name: string } | { ok: false; status: 400 | 403 | 404; error: string };

/** The mentor must be an available faculty member of the HOD's own (and sub-) departments - never a managed branch's - with a login - or the HOD themselves. */
export async function resolveMentorForHod(
  db: Firestore,
  collegeId: string,
  hodUid: string,
  scope: Parameters<typeof facultyManageableDepartmentNames>[0],
  mentorUid: string
): Promise<MentorCheck> {
  if (mentorUid === hodUid) {
    // The HOD may always pick themselves (also a Principal / VP with no faculty record - see selfMentor).
    const self = await resolveSelfMentor(db, collegeId, hodUid);
    return self ? { ok: true, name: self.name } : { ok: false, status: 400, error: "You are not available to mentor" };
  }
  const facSnap = await db.collection("colleges").doc(collegeId).collection("facultyMembers").where("userUid", "==", mentorUid).limit(1).get();
  const fac = facSnap.docs[0]?.data() as { legalName?: string; honorific?: string; department?: string; status?: string } | undefined;
  if (!fac) return { ok: false, status: 404, error: "Mentor not found" };
  if (!(AVAILABLE_FACULTY_STATUSES as string[]).includes(fac.status ?? "")) {
    return { ok: false, status: 400, error: "This faculty member is no longer available to mentor" };
  }
  if (!facultyManageableDepartmentNames(scope).includes(fac.department ?? "")) {
    return { ok: false, status: 403, error: "Mentor is outside your department" };
  }
  return { ok: true, name: facultyDisplayName(fac) };
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
