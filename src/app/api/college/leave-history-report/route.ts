export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { computeMonthlyLeaveSummary } from "@/lib/leave/monthlySummary";
import type { Department, FacultyMember, FMSUser } from "@/types";

interface ReportRow {
  uid: string;
  employeeId: string;
  name: string;
  role: "HOD" | "PANEL_MEMBER";
  category: string | null;
  types: Awaited<ReturnType<typeof computeMonthlyLeaveSummary>>["types"];
  lopDays: number;
}

// Monthly leave register: every faculty member with a login, plus per-type
// days taken this month + opening/closing balance (computeMonthlyLeaveSummary).
//  - PRINCIPAL/VICE_PRINCIPAL: pass ?departmentId=... (any department), roster
//    includes that department's HOD.
//  - HOD: no departmentId needed - self-resolves their own department, and
//    is excluded from their own roster (only their faculty's history).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD");
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let department: Department;
    let includeHod = true;

    if (session.role === "HOD") {
      includeHod = false;
      const deptName = await resolveUserDepartment(db, session.collegeId, session.uid);
      if (!deptName) return NextResponse.json({ error: "No department assigned" }, { status: 400 });
      const deptSnap = await collegeRef.collection("departments").where("name", "==", deptName).limit(1).get();
      if (deptSnap.empty) return NextResponse.json({ error: "Department not found" }, { status: 404 });
      department = { id: deptSnap.docs[0].id, ...deptSnap.docs[0].data() } as Department;
    } else {
      const departmentId = searchParams.get("departmentId");
      if (!departmentId) {
        return NextResponse.json({ error: "departmentId is required" }, { status: 400 });
      }
      const deptSnap = await collegeRef.collection("departments").doc(departmentId).get();
      if (!deptSnap.exists) return NextResponse.json({ error: "Department not found" }, { status: 404 });
      department = { id: deptSnap.id, ...deptSnap.data() } as Department;
    }

    const [facultySnap, hodUserSnap] = await Promise.all([
      collegeRef.collection("facultyMembers").where("department", "==", department.name).get(),
      includeHod && department.hodUid ? collegeRef.collection("users").doc(department.hodUid).get() : Promise.resolve(null),
    ]);

    const people: { uid: string; employeeId: string; name: string; role: "HOD" | "PANEL_MEMBER" }[] = [];

    if (hodUserSnap?.exists) {
      const hod = hodUserSnap.data() as FMSUser;
      people.push({ uid: hodUserSnap.id, employeeId: hod.employeeId ?? "-", name: hod.name, role: "HOD" });
    }
    for (const d of facultySnap.docs) {
      const f = d.data() as FacultyMember;
      if (!f.userUid) continue; // no login -> no leave account to report on
      people.push({ uid: f.userUid, employeeId: f.employeeId, name: f.name, role: "PANEL_MEMBER" });
    }

    const rows: ReportRow[] = await Promise.all(
      people.map(async (p) => {
        const summary = await computeMonthlyLeaveSummary(db, session.collegeId, p.uid, year, month);
        return { ...p, category: summary.category, types: summary.types, lopDays: summary.lopDays };
      })
    );

    return NextResponse.json({ department, rows });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/leave-history-report GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
