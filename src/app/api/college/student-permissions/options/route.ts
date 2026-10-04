export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { isTypeDisabled, resolveLimits } from "@/lib/approvals";
import { actingUser, ANY_PERMISSION_ROLE, authenticate, failure } from "@/lib/studentPermissions/http";
import { loadStudentByUid } from "@/lib/studentPermissions/service";
import { loadPermissionConfig } from "@/lib/studentPermissions/configStore";
import { PERMISSION_GROUPS, categoryTypeKeys } from "@/lib/studentPermissions/categories";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import { DEFAULT_LIMITS } from "@/lib/studentPermissions/types";

// What the request form should offer: the permission types enabled for the
// requester's department and the limits that apply there. For faculty (who pick
// students from any department) the college-level view is returned and the
// server re-checks per department when the request is created.
//   ?department=CSE   optional, for faculty previewing one department
export async function GET(request: Request) {
  try {
    const session = await authenticate(...ANY_PERMISSION_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const config = await loadPermissionConfig(db, session.collegeId);

    let department = new URL(request.url).searchParams.get("department") ?? "";
    if (session.role === "STUDENT") {
      const student = await loadStudentByUid(db, session.collegeId, user.uid);
      if (student) {
        const sec = await findCurrentSectionDoc(db, session.collegeId, student);
        department = (sec?.data() as { department?: string } | undefined)?.department || student.department;
      }
    }

    const groups = PERMISSION_GROUPS.map((g) => ({
      id: g.id, label: g.label,
      items: g.items.map((c) => ({ id: c.id, label: c.label, enabled: !isTypeDisabled(config, department, categoryTypeKeys(c)) })),
    })).filter((g) => g.items.some((i) => i.enabled));
    return NextResponse.json({ enabled: config.enabled, department, groups, limits: resolveLimits(config, DEFAULT_LIMITS, department) });
  } catch (err) {
    return failure(err, "college/student-permissions/options GET");
  }
}
