export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { collegeSettingsRef, loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { sanitizeLeaveApprovalRouting, defaultApproverStage, ROUTABLE_REQUESTER_ROLES } from "@/lib/leave/approvalRouting";
import { sanitizeLeaveVacationRoles } from "@/lib/leave/staffCategoryRouting";
import type { FacultyNorms } from "@/types/core";

// colleges/{collegeId}/settings/general - basic college info a Principal
// manages for their own college (student:faculty ratio, teaching hours,
// position norms, and the leave module's new-joining conversion threshold).
// Super Admin can view/edit any college via ?collegeId=.
function resolveCollegeId(request: Request, role: string, sessionCollegeId: string): string | null {
  if (role === "SUPER_ADMIN") {
    return new URL(request.url).searchParams.get("collegeId");
  }
  return sessionCollegeId || null;
}

export async function GET(request: Request) {
  try {
    const session = await requireRole("SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL", "HOD");
    const collegeId = resolveCollegeId(request, session.role, session.collegeId);
    if (!collegeId) {
      return NextResponse.json({ error: "collegeId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const settings = await loadCollegeSettings(db, collegeId);
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/general GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireRole("SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as Partial<FacultyNorms> & { collegeId?: string };

    const collegeId = session.role === "SUPER_ADMIN" ? body.collegeId : session.collegeId;
    if (!collegeId) {
      return NextResponse.json({ error: "collegeId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const current = await loadCollegeSettings(db, collegeId);

    const settings: FacultyNorms = {
      regulatoryBody: body.regulatoryBody ?? current.regulatoryBody,
      studentFacultyRatio: Number(body.studentFacultyRatio ?? current.studentFacultyRatio),
      teachingHoursPerWeek: Number(body.teachingHoursPerWeek ?? current.teachingHoursPerWeek),
      defaultMinFacultyPerDept: Number(body.defaultMinFacultyPerDept ?? current.defaultMinFacultyPerDept),
      minimumQualifications: body.minimumQualifications ?? current.minimumQualifications,
      positionNorms: body.positionNorms ?? current.positionNorms,
      newJoiningYears: Number(body.newJoiningYears ?? current.newJoiningYears),
      updatedAt: new Date() as unknown as FacultyNorms["updatedAt"],
      updatedByName: session.email || "Unknown",
    };

    if (settings.newJoiningYears < 0) {
      return NextResponse.json({ error: "newJoiningYears must be 0 or more" }, { status: 400 });
    }

    // Sent whole (one entry per role) by the Leave Approval Routing card, so a
    // plain replace is right - merge:true below would otherwise deep-merge the
    // map and never let an entry be removed.
    let leaveApprovalRouting: FacultyNorms["leaveApprovalRouting"];
    if (body.leaveApprovalRouting !== undefined) {
      const checked = sanitizeLeaveApprovalRouting(body.leaveApprovalRouting);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      leaveApprovalRouting = checked.routing;
    }

    let leaveVacationRoles: FacultyNorms["leaveVacationRoles"];
    if (body.leaveVacationRoles !== undefined) {
      const checked = sanitizeLeaveVacationRoles(body.leaveVacationRoles);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      leaveVacationRoles = checked.value;
    }

    await collegeSettingsRef(db, collegeId).set(settings, { merge: true });
    if (leaveApprovalRouting) {
      await collegeSettingsRef(db, collegeId).update({ leaveApprovalRouting });
    }
    if (leaveVacationRoles) {
      await collegeSettingsRef(db, collegeId).update({ leaveVacationRoles });
    }

    await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
      collegeId,
      action: "COLLEGE_SETTINGS_UPDATED",
      performedBy: session.uid,
      performedByName: settings.updatedByName,
      details: {
        newJoiningYears: settings.newJoiningYears,
        studentFacultyRatio: settings.studentFacultyRatio,
        ...(leaveApprovalRouting ? { leaveApprovalRouting } : {}),
        ...(leaveVacationRoles ? { leaveVacationRoles } : {}),
      },
      timestamp: new Date(),
    });

    // A separate, dedicated entry (rather than relying on whoever reads
    // COLLEGE_SETTINGS_UPDATED to notice a leaveApprovalRouting key buried in
    // its details) - LeaveApprovalRoutingCard's own History section filters
    // on this action specifically, so it shows only routing changes, not
    // every unrelated settings edit (ratio, teaching hours, ...) that also
    // goes through this same PUT. performedByRole is recorded alongside the
    // name so the history reads "changed by Principal - X" / "Vice Principal
    // - Y", not just an email, which is what actually answers "who".
    if (leaveApprovalRouting) {
      // Per-role diff against what was saved before this write - answers
      // "for which role did the routing change, and from what to what",
      // not just "the routing was touched". A role the client sent
      // unchanged (same resolved stage before and after, accounting for the
      // same default-fill the card itself uses) produces no entry, so a
      // save that only touched one role's dropdown shows exactly that one
      // role here, not all sixteen.
      const changes = ROUTABLE_REQUESTER_ROLES
        .map((role) => {
          const from = current.leaveApprovalRouting?.[role] ?? defaultApproverStage(role);
          const to = leaveApprovalRouting?.[role] ?? defaultApproverStage(role);
          return { role, from, to };
        })
        .filter((c) => c.from !== c.to);

      if (changes.length > 0) {
        await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
          collegeId,
          action: "LEAVE_ROUTING_UPDATED",
          performedBy: session.uid,
          performedByName: settings.updatedByName,
          // realRole (not the normalized role) so a College Admin's save is
          // recorded as "College Admin", not indistinguishable from "Principal" -
          // see isCollegeAdmin in verifySession.ts.
          performedByRole: session.realRole || session.role,
          details: { leaveApprovalRouting, changes },
          timestamp: new Date(),
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/general PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
