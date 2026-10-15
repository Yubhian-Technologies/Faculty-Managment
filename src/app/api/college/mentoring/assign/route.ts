export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { editableDepartmentNames } from "@/lib/departments/scope";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { actorOf } from "@/lib/audit/actorOf";
import { notify } from "@/lib/notify";
import { loadHodStudentScope } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { resolveSelfMentor } from "@/lib/mentoring/selfMentor";
import { AVAILABLE_FACULTY_STATUSES, type StudentRecord } from "@/types";

const MAX_STUDENTS_PER_CALL = 200;

// Give students a mentor, or take it away (mentorUid null). HOD only, and only
// for students the HOD manages. A refused student never blocks the others: the
// answer lists who was assigned and who was skipped (with a reason).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const body = (await readJsonBody(request)) as { mentorUid?: string | null; studentIds?: unknown };
    const mentorUid = typeof body.mentorUid === "string" && body.mentorUid.trim() ? body.mentorUid.trim() : null;
    const studentIds = Array.isArray(body.studentIds)
      ? [...new Set(body.studentIds.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()))]
      : [];
    if (studentIds.length === 0) return NextResponse.json({ error: "Pick at least one student" }, { status: 400 });
    if (studentIds.length > MAX_STUDENTS_PER_CALL) {
      return NextResponse.json({ error: `Pick at most ${MAX_STUDENTS_PER_CALL} students at a time` }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const { scope, canManage } = await loadHodStudentScope(db, session.collegeId, session.uid);

    // The mentor must be an available faculty member of this HOD's departments with a login.
    let mentorName = "";
    if (mentorUid && mentorUid === session.uid) {
      // The HOD may always pick themselves (also a Principal / VP with no faculty record - see selfMentor).
      const self = await resolveSelfMentor(db, session.collegeId, session.uid);
      if (!self) return NextResponse.json({ error: "You are not available to mentor" }, { status: 400 });
      mentorName = self.name;
    } else if (mentorUid) {
      const facSnap = await collegeRef.collection("facultyMembers").where("userUid", "==", mentorUid).limit(1).get();
      const fac = facSnap.docs[0]?.data() as { legalName?: string; honorific?: string; department?: string; status?: string } | undefined;
      if (!fac) return NextResponse.json({ error: "Mentor not found" }, { status: 404 });
      if (!(AVAILABLE_FACULTY_STATUSES as string[]).includes(fac.status ?? "")) {
        return NextResponse.json({ error: "This faculty member is no longer available to mentor" }, { status: 400 });
      }
      if (!editableDepartmentNames(scope).includes(fac.department ?? "")) {
        return NextResponse.json({ error: "Mentor is outside your department" }, { status: 403 });
      }
      mentorName = facultyDisplayName(fac);
    }

    const snaps = await Promise.all(studentIds.map((id) => collegeRef.collection("students").doc(id).get()));
    const now = new Date();
    const writer = new ChunkedBatch(db);
    const assigned: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const snap of snaps) {
      if (!snap.exists) { skipped.push({ id: snap.id, reason: "Student not found" }); continue; }
      const student = snap.data() as StudentRecord;
      if (student.status === "GRADUATED") { skipped.push({ id: snap.id, reason: "Graduated" }); continue; }
      if (!(await canManage(student))) { skipped.push({ id: snap.id, reason: "Outside your department" }); continue; }
      if ((student.mentorUid ?? null) === mentorUid) { assigned.push(snap.id); continue; }
      // A student who already has a mentor is not offered to another one: the mentor is removed
      // first, then the new one assigned. Removing only clears the mentor fields - the record
      // (notes, entries, semester sheets) hangs off the student and stays for the next mentor.
      if (mentorUid && student.mentorUid) { skipped.push({ id: snap.id, reason: "Already has a mentor - remove the current mentor first" }); continue; }
      writer.update(snap.ref, mentorUid
        ? { mentorUid, mentorName, mentorAssignedBy: session.uid, mentorAssignedAt: now }
        : { mentorUid: FieldValue.delete(), mentorName: FieldValue.delete(), mentorAssignedBy: FieldValue.delete(), mentorAssignedAt: FieldValue.delete() });
      assigned.push(snap.id);
    }
    await writer.commit();

    if (assigned.length > 0) {
      const actor = await actorOf(db, session.collegeId, session.uid, session.email);
      await writeAuditLogSafe(db, session.collegeId, {
        action: mentorUid ? "STUDENT_MENTOR_ASSIGNED" : "STUDENT_MENTOR_REMOVED",
        performedBy: session.uid,
        performedByName: actor.name,
        targetId: mentorUid ?? undefined,
        details: { mentorName: mentorName || undefined, students: assigned.length, studentIds: assigned.slice(0, 50) },
      });
      if (mentorUid && mentorUid !== session.uid) {
        await notify(
          db, session.collegeId, mentorUid, "MENTEES_ASSIGNED",
          "Students assigned to you for mentoring",
          `${assigned.length} student${assigned.length === 1 ? "" : "s"} ${assigned.length === 1 ? "has" : "have"} been assigned to you as mentee${assigned.length === 1 ? "" : "s"}.`,
          "/panel/mentoring"
        );
      }
    }

    return NextResponse.json({ assigned, skipped });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/assign POST]");
  }
}
