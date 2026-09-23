export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment, getRelatedDepartmentNames } from "@/lib/departments/scope";
import type { MidNumber, Subject, TeachingAssignment } from "@/types";

const READ_ROLES = ["HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER"];

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get("subjectId");
    const listFaculty = searchParams.get("listFaculty") === "true";

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Faculty picker for a chosen subject - whoever currently (non-past)
    // teaches it, per teachingAssignments. Same source HOD's Teaching
    // Assignments page itself uses, so this can never list someone who
    // isn't actually assigned to teach the subject.
    if (listFaculty) {
      if (!subjectId) return NextResponse.json({ error: "subjectId is required" }, { status: 400 });
      const snap = await collegeRef.collection("teachingAssignments").where("subjectId", "==", subjectId).get();
      const byFaculty = new Map<string, string>();
      for (const doc of snap.docs) {
        const a = doc.data() as TeachingAssignment;
        if (a.isPast) continue;
        byFaculty.set(a.facultyId, a.facultyName);
      }
      const faculty = Array.from(byFaculty, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
      return NextResponse.json({ faculty });
    }

    let query: FirebaseFirestore.Query = collegeRef.collection("midPaperAssignments");
    if (session.role === "PANEL_MEMBER") {
      query = query.where("facultyId", "==", session.uid);
    } else if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const relatedNameLists = await Promise.all(
        scope.ownDepartmentNames.map((n) => getRelatedDepartmentNames(db, session.collegeId, n))
      );
      const names = Array.from(new Set([...relatedNameLists.flat(), ...scope.managedDepartmentNames]));
      if (names.length === 1) query = query.where("department", "==", names[0]);
      else if (names.length > 1) query = query.where("department", "in", names.slice(0, 30));
      else return NextResponse.json({ assignments: [] });
    }
    // PRINCIPAL/VICE_PRINCIPAL/SUPER_ADMIN: unscoped, every assignment in the college.

    const snap = await query.get();
    const assignments = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { subjectName?: string }).subjectName ?? "").localeCompare((b as { subjectName?: string }).subjectName ?? ""));
    return NextResponse.json({ assignments });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/mid-paper-assignments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Assign (or reassign) one faculty to prepare a Mid's question bank for a
// subject. Upsert at a deterministic id - re-submitting the same
// subject+mid just hands it to a different faculty, no separate unassign step.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "SUPER_ADMIN");
    const body = (await request.json()) as { subjectId?: string; midNumber?: number; facultyId?: string };
    const { subjectId, facultyId } = body;
    const midNumber = body.midNumber as MidNumber | undefined;

    if (!subjectId) return NextResponse.json({ error: "subjectId is required" }, { status: 400 });
    if (midNumber !== 1 && midNumber !== 2) return NextResponse.json({ error: "midNumber must be 1 or 2" }, { status: 400 });
    if (!facultyId) return NextResponse.json({ error: "facultyId is required" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const subjectSnap = await collegeRef.collection("subjects").doc(subjectId).get();
    if (!subjectSnap.exists) return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    const subject = subjectSnap.data() as Subject;

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, subject.department)) {
        return NextResponse.json({ error: "This subject isn't in your department" }, { status: 403 });
      }
    }

    // Defense in depth - the facultyId must actually be someone currently
    // (non-past) teaching this exact subject, same set the picker offers.
    const assignSnap = await collegeRef.collection("teachingAssignments")
      .where("subjectId", "==", subjectId)
      .where("facultyId", "==", facultyId)
      .get();
    const teachingAssignment = assignSnap.docs
      .map((d) => d.data() as TeachingAssignment)
      .find((a) => !a.isPast);
    if (!teachingAssignment) {
      return NextResponse.json({ error: "This faculty doesn't currently teach this subject" }, { status: 400 });
    }

    const actorSnap = await collegeRef.collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "HOD";

    const now = new Date();
    const id = `${subjectId}_mid${midNumber}`;
    const data = {
      collegeId: session.collegeId,
      department: subject.department,
      courseId: subject.courseId,
      courseName: subject.courseName,
      year: subject.year ?? 0,
      subjectId,
      subjectName: subject.name,
      subjectCode: subject.code,
      midNumber,
      facultyId,
      facultyName: teachingAssignment.facultyName,
      assignedBy: session.uid,
      assignedByName: actorName,
      status: "ASSIGNED" as const,
      createdAt: now,
      updatedAt: now,
    };
    await collegeRef.collection("midPaperAssignments").doc(id).set(data, { merge: true });

    return NextResponse.json({ assignment: { id, ...data } }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/mid-paper-assignments POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
