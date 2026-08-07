export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAccessLeaveProfile } from "@/lib/leave/access";
import { getOrCreateProfile } from "@/lib/leave/profile";
import { resolveEmployeeIdentity } from "@/lib/leave/identity";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";
import { REQUESTS_COL, loadBalances, reservePending, computeEntitlement } from "@/lib/leave/balanceEngine";
import { countLeaveDays, todayISODate } from "@/lib/leave/dayCounter";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import type { LeaveRequest, LeaveTypeCode } from "@/types/leave";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF"
    );
    const url = new URL(request.url);
    const db = getAdminDb();

    // Approval queue: pending requests awaiting this caller's action.
    if (url.searchParams.get("scope") === "approvals") {
      if (session.role === "HOD") {
        const dept = await resolveUserDepartment(db, session.collegeId, session.uid);
        const snap = await REQUESTS_COL(session.collegeId, db)
          .where("department", "==", dept || "__NO_DEPARTMENT__")
          .where("status", "==", "PENDING_HOD")
          .orderBy("createdAt", "desc")
          .get();
        return NextResponse.json({ requests: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
      }
      if (session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") {
        const snap = await REQUESTS_COL(session.collegeId, db)
          .where("status", "==", "PENDING_PRINCIPAL")
          .orderBy("createdAt", "desc")
          .get();
        return NextResponse.json({ requests: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
      }
      return NextResponse.json({ requests: [] });
    }

    const targetUid = url.searchParams.get("uid") || session.uid;
    if (!(await canAccessLeaveProfile(db, session.collegeId, session.role, session.uid, targetUid))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const snap = await REQUESTS_COL(session.collegeId, db)
      .where("uid", "==", targetUid)
      .orderBy("createdAt", "desc")
      .get();

    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF"
    );
    const body = (await request.json()) as {
      leaveTypeCode?: LeaveTypeCode;
      isOtherRequest?: boolean;
      fromDate?: string;
      toDate?: string;
      isHalfDay?: boolean;
      reason?: string;
    };

    if (!body.fromDate || !body.toDate || !body.reason?.trim()) {
      return NextResponse.json({ error: "fromDate, toDate and reason are required" }, { status: 400 });
    }
    if (!body.leaveTypeCode && !body.isOtherRequest) {
      return NextResponse.json({ error: "leaveTypeCode or isOtherRequest is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const [profile, identity] = await Promise.all([
      getOrCreateProfile(db, session.collegeId, session.uid),
      resolveEmployeeIdentity(db, session.collegeId, session.uid),
    ]);
    if (!profile || !identity) {
      return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
    }

    const settings = await loadCollegeSettings(db, session.collegeId);
    const effectiveCategory = computeEffectiveCategory(profile, settings.newJoiningYears);

    let leaveType = null;
    if (body.leaveTypeCode) {
      leaveType = LEAVE_TYPE_SEED.find((lt) => lt.code === body.leaveTypeCode && lt.isActive) ?? null;
      if (!leaveType || !leaveType.rules.eligibleCategories.includes(effectiveCategory)) {
        return NextResponse.json({ error: "This leave type isn't available for your leave profile" }, { status: 400 });
      }
    }

    const fromDate = new Date(body.fromDate);
    const toDate = new Date(body.toDate);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || toDate < fromDate) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }
    if (body.fromDate < todayISODate() || body.toDate < todayISODate()) {
      return NextResponse.json({ error: "Leave cannot be applied for a date before today" }, { status: 400 });
    }
    const totalDays = countLeaveDays(fromDate, toDate, body.isHalfDay);
    const year = fromDate.getFullYear();

    if (leaveType && !leaveType.rules.unlimited) {
      const balances = await loadBalances(db, session.collegeId, session.uid, year);
      const bal = balances.find((b) => b.leaveTypeCode === leaveType!.code);
      const entitled = bal?.entitled ?? computeEntitlement(leaveType, effectiveCategory);
      const remaining = entitled - (bal?.used ?? 0) - (bal?.pending ?? 0);
      if (totalDays > remaining) {
        return NextResponse.json({ error: `Insufficient ${leaveType.label} balance (${remaining} day(s) remaining)` }, { status: 400 });
      }
    }

    const now = new Date();
    const initialStatus = session.role === "PANEL_MEMBER" ? "PENDING_HOD" : "PENDING_PRINCIPAL";

    const newRequest: Omit<LeaveRequest, "id"> = {
      collegeId: session.collegeId,
      uid: session.uid,
      employeeName: identity.name,
      department: identity.department,
      leaveTypeCode: body.leaveTypeCode,
      isOtherRequest: body.isOtherRequest || false,
      fromDate: fromDate as unknown as LeaveRequest["fromDate"],
      toDate: toDate as unknown as LeaveRequest["toDate"],
      totalDays,
      isHalfDay: body.isHalfDay || false,
      reason: body.reason.trim(),
      status: initialStatus,
      createdAt: now as unknown as LeaveRequest["createdAt"],
      updatedAt: now as unknown as LeaveRequest["updatedAt"],
    };

    const ref = await REQUESTS_COL(session.collegeId, db).add(newRequest);

    if (leaveType && !leaveType.rules.unlimited) {
      await reservePending(db, session.collegeId, session.uid, leaveType.code, year, totalDays);
    }

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "LEAVE_APPLIED",
      performedBy: session.uid,
      performedByName: identity.name,
      targetId: ref.id,
      details: { leaveTypeCode: body.leaveTypeCode ?? "OTHER", totalDays },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
