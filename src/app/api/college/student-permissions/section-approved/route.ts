export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ApprovalError } from "@/lib/approvals";
import { actingUser, ANY_PERMISSION_ROLE, authenticate, failure, pageOptions } from "@/lib/studentPermissions/http";
import { listSectionApproved, loadStudentByUid } from "@/lib/studentPermissions/service";

// GET /api/college/student-permissions/section-approved?department=...&section=...&year=...
// Retrieves approved student permission records for a section (for Class Representatives and Section views).
export async function GET(request: Request) {
  try {
    const session = await authenticate(...ANY_PERMISSION_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const url = new URL(request.url);
    const opts = pageOptions(url);

    let department = url.searchParams.get("department");
    let section = url.searchParams.get("section");
    let year = Number(url.searchParams.get("year"));

    // If params are omitted and user is a student, automatically infer section from student profile
    if (!department || !section || !year) {
      if (session.role === "STUDENT") {
        const student = await loadStudentByUid(db, user.collegeId, user.uid);
        if (!student) throw new ApprovalError("NOT_FOUND", "Student record not found", 404);
        department = student.department;
        section = student.section;
        year = student.year;
      } else {
        throw new ApprovalError("INVALID", "Missing department, section, or year parameter", 400);
      }
    }

    const requests = await listSectionApproved(db, user, department, section, year, opts);
    return NextResponse.json({ requests, sectionInfo: { department, section, year } });
  } catch (err) {
    return failure(err, "college/student-permissions/section-approved GET");
  }
}
