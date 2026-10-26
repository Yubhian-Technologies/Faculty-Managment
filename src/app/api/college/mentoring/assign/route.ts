export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { loadHodStudentScope } from "@/lib/mentoring/access";
import { announceMentorChange, resolveMentorForHod } from "@/lib/mentoring/assignMentor";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { type StudentRecord } from "@/types";

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
    const { scope, canAssign } = await loadHodStudentScope(db, session.collegeId, session.uid);

    let mentorName = "";
    if (mentorUid) {
      const mentor = await resolveMentorForHod(db, session.collegeId, session.uid, scope, mentorUid);
      if (!mentor.ok) return NextResponse.json({ error: mentor.error }, { status: mentor.status });
      mentorName = mentor.name;
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
      if (!(await canAssign(student))) { skipped.push({ id: snap.id, reason: "Outside your department" }); continue; }
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

    await announceMentorChange(db, session, { mentorUid, mentorName, studentIds: assigned });

    return NextResponse.json({ assigned, skipped });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/assign POST]");
  }
}
