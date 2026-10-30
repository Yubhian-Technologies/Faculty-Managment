export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { isTypeDisabled, resolveLimits } from "@/lib/approvals";
import { actingUser, ANY_PERMISSION_ROLE, authenticate, failure } from "@/lib/studentPermissions/http";
import { loadStudentByUid } from "@/lib/studentPermissions/service";
import { loadPermissionConfig } from "@/lib/studentPermissions/configStore";
import { ALL_CATEGORIES, PERMISSION_GROUPS, categoryTypeKeys } from "@/lib/studentPermissions/categories";
import { mayRequest, resolveProofRequired, resolveRequesters } from "@/lib/studentPermissions/rules";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import { DEFAULT_LIMITS } from "@/lib/studentPermissions/types";
import { getSectionTimetableData } from "@/lib/students/sectionTimetableData";
import { buildTimetableColumns } from "@/lib/timetable/gridModel";
import type { Section } from "@/types";

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
    let isClassRepresentative = false;
    let periods: { number: number; start?: string; end?: string }[] | undefined;
    let studentInfo: { name: string; rollNumber: string; department: string; year: number; section: string } | undefined;
    if (session.role === "STUDENT") {
      const student = await loadStudentByUid(db, session.collegeId, user.uid);
      if (student) {
        const sec = await findCurrentSectionDoc(db, session.collegeId, student);
        department = (sec?.data() as { department?: string } | undefined)?.department || student.department;
        // The periods the student's class really has (and their times), so the form offers exactly those. Reuses the
        // section timetable's 60-second shared cache, so this is usually no extra read; if it can't be had the form falls back to 1-8.
        if (sec) {
          try {
            const { timing } = await getSectionTimetableData(db, session.collegeId, { id: sec.id, ...sec.data() } as Section & { id: string });
            if (timing) periods = buildTimetableColumns(timing).flatMap((c) => (c.kind === "period" ? [{ number: c.periodNumber, start: c.startTime, end: c.endTime }] : []));
          } catch { /* optional detail */ }
        }
        isClassRepresentative = !!(sec?.data() as { classRepresentatives?: { studentId: string }[] } | undefined)?.classRepresentatives?.some((r) => r.studentId === student.id);
        studentInfo = {
          name: student.name,
          rollNumber: student.rollNumber,
          department,
          year: student.year,
          section: student.section,
        };
      }
    }

    const layers = [config.departments?.[department]?.override?.limits, config.college?.limits];
    const proofRequiredByCategory = Object.fromEntries(ALL_CATEGORIES.map((c) => [c.id, resolveProofRequired(layers, categoryTypeKeys(c))]));
    const groups = PERMISSION_GROUPS.map((g) => ({
      id: g.id, label: g.label,
      items: g.items.map((c) => ({ id: c.id, label: c.label, enabled: !isTypeDisabled(config, department, categoryTypeKeys(c)) && mayRequest(resolveRequesters(layers, categoryTypeKeys(c)), user.roles) })),
    })).filter((g) => g.items.some((i) => i.enabled));
    return NextResponse.json({ enabled: config.enabled, department, studentInfo, periods, isClassRepresentative, groups, limits: resolveLimits(config, DEFAULT_LIMITS, department), proofRequiredByCategory });
  } catch (err) {
    return failure(err, "college/student-permissions/options GET");
  }
}
