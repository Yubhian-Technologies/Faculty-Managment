export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { STUDENT_FACULTY_RATIO, CADRE_PARTS, CADRE_TOTAL_PARTS, requiredFacultyCount } from "@/lib/college/facultyRatio";

export type CadreEntry = {
  key: "PROFESSOR" | "ASSOCIATE_PROFESSOR" | "ASSISTANT_PROFESSOR";
  label: string;
  cadreRatioPart: number;
  required: number;
  current: number;
  gap: number;
  surplus: number;
};

export type FacultyRequirementResult = {
  department: string;
  totalStudents: number;
  studentFacultyRatio: number;
  cadreRatio: string;
  totalRequired: number;
  totalCurrent: number;
  totalGap: number;
  cadre: CadreEntry[];
};

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);

    // Allow principal to query a specific dept
    const deptParam = searchParams.get("department");

    const db = getAdminDb();

    // Resolve department
    let dept = deptParam ?? "";
    if (!dept && session.role === "HOD") {
      const userSnap = await db
        .collection("colleges").doc(session.collegeId)
        .collection("users").doc(session.uid)
        .get();
      dept = (userSnap.data() as { department?: string } | undefined)?.department ?? "";
    }

    if (!dept) {
      return NextResponse.json({ error: "Department not found" }, { status: 400 });
    }

    // ── Student strength ──────────────────────────────────────────────────────
    // Sum studentCount across all sections owned by this department.
    // HOD only creates sections for their own dept:
    //   Basic Science → Year 1 sections
    //   Core depts    → Year 2, 3, 4 sections
    const sectionsSnap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("sections")
      .where("department", "==", dept)
      .get();

    const totalStudents = sectionsSnap.docs.reduce(
      (sum, d) => sum + ((d.data() as { studentCount?: number }).studentCount ?? 0),
      0
    );

    // ── Total faculty required (1:15) ─────────────────────────────────────────
    const totalRequired = requiredFacultyCount(totalStudents);

    // ── Cadre split (1:2:6) ───────────────────────────────────────────────────
    const unit = totalRequired / CADRE_TOTAL_PARTS;
    const profRequired  = Math.ceil(CADRE_PARTS.prof  * unit);
    const assocRequired = Math.ceil(CADRE_PARTS.assoc * unit);
    const asstRequired  = Math.max(0, totalRequired - profRequired - assocRequired);

    // ── Current active faculty by designation ─────────────────────────────────
    const facultySnap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("facultyMembers")
      .where("department", "==", dept)
      .where("status", "==", "ACTIVE")
      .get();

    let profCurrent = 0;
    let assocCurrent = 0;
    let asstCurrent = 0;   // includes LECTURER

    for (const doc of facultySnap.docs) {
      const desig = (doc.data() as { designation?: string }).designation ?? "";
      if (desig === "PROFESSOR") profCurrent++;
      else if (desig === "ASSOCIATE_PROFESSOR") assocCurrent++;
      else if (desig === "ASSISTANT_PROFESSOR" || desig === "LECTURER") asstCurrent++;
      // VISITING_FACULTY, ADJUNCT_FACULTY, LAB_ASSISTANT excluded from cadre ratio
    }

    const totalCurrent = profCurrent + assocCurrent + asstCurrent;

    const cadre: CadreEntry[] = [
      {
        key: "PROFESSOR",
        label: "Professor",
        cadreRatioPart: 1,
        required: profRequired,
        current: profCurrent,
        gap: Math.max(0, profRequired - profCurrent),
        surplus: Math.max(0, profCurrent - profRequired),
      },
      {
        key: "ASSOCIATE_PROFESSOR",
        label: "Associate Professor",
        cadreRatioPart: 2,
        required: assocRequired,
        current: assocCurrent,
        gap: Math.max(0, assocRequired - assocCurrent),
        surplus: Math.max(0, assocCurrent - assocRequired),
      },
      {
        key: "ASSISTANT_PROFESSOR",
        label: "Asst. Professor / Lecturer",
        cadreRatioPart: 6,
        required: asstRequired,
        current: asstCurrent,
        gap: Math.max(0, asstRequired - asstCurrent),
        surplus: Math.max(0, asstCurrent - asstRequired),
      },
    ];

    const result: FacultyRequirementResult = {
      department: dept,
      totalStudents,
      studentFacultyRatio: STUDENT_FACULTY_RATIO,
      cadreRatio: "1:2:6",
      totalRequired,
      totalCurrent,
      totalGap: Math.max(0, totalRequired - totalCurrent),
      cadre,
    };

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[faculty-requirement GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
