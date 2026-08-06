export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import type { ExamType, InternalMark, StudentRecord, TeachingAssignment } from "@/types";

// Only the assigned faculty may enter/view marks for a section+subject they
// actively teach — confirmed against teachingAssignments, not trusted from
// the request. Returns the matching assignment (for its sectionName/
// department/facultyName) or null.
async function findOwnAssignment(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  facultyId: string,
  sectionId: string,
  subjectId: string
): Promise<(TeachingAssignment & { id: string }) | null> {
  const snap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("teachingAssignments")
    .where("facultyId", "==", facultyId)
    .where("sectionId", "==", sectionId)
    .where("subjectId", "==", subjectId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as TeachingAssignment & { id: string };
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { searchParams } = new URL(request.url);
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // HOD: read-only oversight of every internal-marks record recorded by
    // faculty across their department (+ sub-departments) — no entry here.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!scope.departmentName) return NextResponse.json({ marks: [] });
      const depts = [scope.departmentName, ...scope.childDepartmentNames].slice(0, 30);
      const snap = await collegeRef.collection("internalMarks").where("department", "in", depts).get();
      const marks = snap.docs.map((d) => ({ id: d.id, ...d.data() } as InternalMark));
      return NextResponse.json({ marks });
    }

    // PANEL_MEMBER: roster + marks for one (section, subject, examType) they teach.
    const sectionId = searchParams.get("sectionId");
    const subjectId = searchParams.get("subjectId");
    const examType = searchParams.get("examType") as ExamType | null;
    const assessmentName = searchParams.get("assessmentName");
    if (!sectionId || !subjectId || !examType) {
      return NextResponse.json({ error: "sectionId, subjectId and examType are required" }, { status: 400 });
    }

    const facultyId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    const assignment = await findOwnAssignment(db, session.collegeId, facultyId, sectionId, subjectId);
    if (!assignment) {
      return NextResponse.json({ error: "You do not teach this subject for this section" }, { status: 403 });
    }

    let marksQuery: FirebaseFirestore.Query = collegeRef.collection("internalMarks")
      .where("facultyId", "==", facultyId)
      .where("sectionId", "==", sectionId)
      .where("subjectId", "==", subjectId)
      .where("examType", "==", examType);
    if (assessmentName) marksQuery = marksQuery.where("assessmentName", "==", assessmentName);

    const [studentsSnap, marksSnap] = await Promise.all([
      collegeRef.collection("students").where("section", "==", assignment.sectionName).get(),
      marksQuery.get(),
    ]);

    const students = studentsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as StudentRecord))
      .sort((a, b) => (a.rollNumber ?? "").localeCompare(b.rollNumber ?? ""));
    const marks = marksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ students, marks });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/internal-marks GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const body = (await request.json()) as {
      sectionId: string;
      subjectId: string;
      examType: ExamType;
      assessmentName: string;
      maxMarks: number;
      entries: { studentId: string; studentName: string; rollNumber: string; marksObtained: number }[];
    };

    const { sectionId, subjectId, examType, assessmentName, maxMarks, entries } = body;
    if (!sectionId || !subjectId || (examType !== "THEORY" && examType !== "LAB") || !assessmentName?.trim() || !maxMarks || maxMarks <= 0) {
      return NextResponse.json(
        { error: "sectionId, subjectId, a valid examType, assessmentName and a positive maxMarks are required" },
        { status: 400 }
      );
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: "entries must be a non-empty array" }, { status: 400 });
    }
    for (const e of entries) {
      if (typeof e.marksObtained !== "number" || e.marksObtained < 0 || e.marksObtained > maxMarks) {
        return NextResponse.json(
          { error: `Marks for ${e.studentName || e.studentId} must be between 0 and ${maxMarks}` },
          { status: 400 }
        );
      }
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const facultyId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    const assignment = await findOwnAssignment(db, session.collegeId, facultyId, sectionId, subjectId);
    if (!assignment) {
      return NextResponse.json({ error: "You do not teach this subject for this section" }, { status: 403 });
    }

    // Only students currently in this section may receive marks under it.
    const studentsSnap = await collegeRef.collection("students").where("section", "==", assignment.sectionName).get();
    const validStudentIds = new Set(studentsSnap.docs.map((d) => d.id));
    if (entries.some((e) => !validStudentIds.has(e.studentId))) {
      return NextResponse.json({ error: "One or more students are not in this section" }, { status: 400 });
    }

    const existingSnap = await collegeRef.collection("internalMarks")
      .where("facultyId", "==", facultyId)
      .where("sectionId", "==", sectionId)
      .where("subjectId", "==", subjectId)
      .where("examType", "==", examType)
      .where("assessmentName", "==", assessmentName)
      .get();
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    const now = new Date();
    const batch = db.batch();
    for (const e of entries) {
      const id = `${sectionId}_${subjectId}_${examType}_${assessmentName}_${e.studentId}`;
      const ref = collegeRef.collection("internalMarks").doc(id);
      batch.set(ref, {
        collegeId: session.collegeId,
        department: assignment.department,
        facultyId,
        facultyName: assignment.facultyName,
        sectionId,
        sectionName: assignment.sectionName,
        subjectId,
        subjectName: assignment.subjectName,
        studentId: e.studentId,
        studentName: e.studentName,
        rollNumber: e.rollNumber,
        examType,
        assessmentName,
        maxMarks: Number(maxMarks),
        marksObtained: Number(e.marksObtained),
        updatedAt: now,
        ...(existingIds.has(id) ? {} : { createdAt: now }),
      }, { merge: true });
    }
    await batch.commit();

    return NextResponse.json({ ok: true, count: entries.length });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/internal-marks POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
