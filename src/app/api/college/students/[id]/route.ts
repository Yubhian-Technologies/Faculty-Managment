export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { getFacultyIdCandidates } from "@/lib/faculty/resolveFacultyMemberId";
import type { Section, StudentRecord } from "@/types";

// Move a single student to a different section (roster-management fix-up -
// e.g. correcting a student who landed under the wrong one of two
// identically-named, differently-cross-listed sections) and/or remove them
// outright. Distinct from students/promote (Principal/VP-only, cohort-wide,
// forces REGULAR + a fixed target for the whole group) - this is a
// per-student correction available to whoever already manages this roster.

async function loadStudentAndScope(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string,
  role: string
) {
  const scope = role === "HOD" ? await getHodDepartmentScope(db, collegeId, uid) : null;
  const inHodScope = (dept: string) =>
    !scope || dept === scope.departmentName || scope.childDepartmentNames.includes(dept);
  return { scope, inHodScope };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE"
    );
    const { id } = await params;
    const body = (await request.json()) as { targetSectionId?: string; secondaryDepartment?: string | null };
    if (!body.targetSectionId) {
      return NextResponse.json({ error: "targetSectionId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const studentRef = collegeRef.collection("students").doc(id);

    const [studentSnap, targetSnap] = await Promise.all([
      studentRef.get(),
      collegeRef.collection("sections").doc(body.targetSectionId).get(),
    ]);
    if (!studentSnap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    if (!targetSnap.exists) return NextResponse.json({ error: "Target section not found" }, { status: 404 });

    const student = studentSnap.data() as StudentRecord;
    const targetSection = { id: targetSnap.id, ...(targetSnap.data() as object) } as Section;

    if (session.role === "PANEL_MEMBER") {
      const candidateIds = await getFacultyIdCandidates(db, session.collegeId, session.uid);
      if (!targetSection.facultyInchargeUid || !candidateIds.includes(targetSection.facultyInchargeUid)) {
        return NextResponse.json({ error: "You are not in charge of the target section" }, { status: 403 });
      }
      const currentSectionSnap = await collegeRef.collection("sections")
        .where("department", "==", student.department)
        .where("name", "==", student.section)
        .where("year", "==", student.year)
        .limit(1)
        .get();
      const currentInchargeUid = currentSectionSnap.docs[0]?.data().facultyInchargeUid;
      if (currentSectionSnap.empty || !currentInchargeUid || !candidateIds.includes(currentInchargeUid)) {
        return NextResponse.json({ error: "You are not in charge of this student's current section" }, { status: 403 });
      }
    }
    if (session.role === "HOD") {
      const { inHodScope } = await loadStudentAndScope(db, session.collegeId, session.uid, session.role);
      if (!inHodScope(student.department) || !inHodScope(targetSection.department)) {
        return NextResponse.json({ error: "Outside your department" }, { status: 403 });
      }
    }

    // Same cross-listing rule as the bulk importer: only default to the
    // section's single cross-listed department, and never silently accept a
    // secondaryDepartment the target section doesn't actually offer.
    const sectionSecondaryDepts = targetSection.secondaryDepartments ?? [];
    let secondaryDept = "";
    if (body.secondaryDepartment?.trim()) {
      secondaryDept = body.secondaryDepartment.trim();
      if (!sectionSecondaryDepts.some((d) => d.toLowerCase() === secondaryDept.toLowerCase())) {
        return NextResponse.json(
          { error: `Section ${targetSection.name} is not cross-listed to "${secondaryDept}"` },
          { status: 400 }
        );
      }
    } else if (sectionSecondaryDepts.length === 1) {
      secondaryDept = sectionSecondaryDepts[0];
    } else if (sectionSecondaryDepts.length > 1) {
      return NextResponse.json(
        { error: `Section ${targetSection.name} is cross-listed to multiple departments (${sectionSecondaryDepts.join(", ")}) - specify which one` },
        { status: 400 }
      );
    }

    const roll = student.rollNumber;
    const dupSnap = await collegeRef.collection("students")
      .where("rollNumber", "==", roll)
      .where("section", "==", targetSection.name)
      .where("year", "==", targetSection.year)
      .get();
    if (dupSnap.docs.some((d) => d.id !== id)) {
      return NextResponse.json({ error: "Roll number already exists in the target section" }, { status: 400 });
    }

    const now = new Date();
    const batch = db.batch();
    batch.update(studentRef, {
      department: targetSection.department,
      section: targetSection.name,
      year: targetSection.year,
      secondaryDepartment: secondaryDept || null,
      updatedAt: now,
    });
    const history = departmentHistoryEntry(
      db, session.collegeId, id, targetSection.department, targetSection.name, targetSection.year, now
    );
    batch.set(history.ref, history.data);
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE"
    );
    const { id } = await params;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const studentRef = collegeRef.collection("students").doc(id);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    const student = studentSnap.data() as StudentRecord;

    if (session.role === "PANEL_MEMBER") {
      const candidateIds = await getFacultyIdCandidates(db, session.collegeId, session.uid);
      const currentSectionSnap = await collegeRef.collection("sections")
        .where("department", "==", student.department)
        .where("name", "==", student.section)
        .where("year", "==", student.year)
        .limit(1)
        .get();
      const currentInchargeUid = currentSectionSnap.docs[0]?.data().facultyInchargeUid;
      if (currentSectionSnap.empty || !currentInchargeUid || !candidateIds.includes(currentInchargeUid)) {
        return NextResponse.json({ error: "You are not in charge of this student's section" }, { status: 403 });
      }
    }
    if (session.role === "HOD") {
      const { inHodScope } = await loadStudentAndScope(db, session.collegeId, session.uid, session.role);
      if (!inHodScope(student.department)) {
        return NextResponse.json({ error: "Outside your department" }, { status: 403 });
      }
    }

    const historySnap = await studentRef.collection("departmentHistory").get();
    const batch = db.batch();
    for (const h of historySnap.docs) batch.delete(h.ref);
    batch.delete(studentRef);
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
