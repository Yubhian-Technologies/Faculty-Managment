export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAccessLeaveProfile } from "@/lib/leave/access";
import { getOrCreateProfile } from "@/lib/leave/profile";
import { resolveEmployeeIdentity } from "@/lib/leave/identity";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import { countLeaveDays, todayISODate } from "@/lib/leave/dayCounter";
import { LEAVE_TYPE_SEED, HALF_DAY_ELIGIBLE_TYPES } from "@/lib/leave/seedData";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import type { LeaveRequest, LeaveTypeCode } from "@/types/leave";

// Sorts newest-first in memory instead of chaining .orderBy() onto a
// .where() on a different field - that combination needs a Firestore
// composite index (see resolveUserDepartment's comment in
// lib/budget/departmentScope.ts for the same concern elsewhere).
function sortByCreatedAtDesc(requests: LeaveRequest[]): LeaveRequest[] {
  return [...requests].sort((a, b) => {
    const at = (a.createdAt as unknown as { toMillis?(): number })?.toMillis?.() ?? 0;
    const bt = (b.createdAt as unknown as { toMillis?(): number })?.toMillis?.() ?? 0;
    return bt - at;
  });
}

// Attaches each requester's current effective category (New Joining /
// Vacation / Non-Vacation) - not stored on the request itself, computed the
// same way the Leave Profiles roster and Leave History register do - so the
// approvals queue can offer the same three-way tab split.
async function attachCategory(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  requests: LeaveRequest[]
): Promise<LeaveRequest[]> {
  const settings = await loadCollegeSettings(db, collegeId);
  return Promise.all(
    requests.map(async (r) => {
      const profile = await getOrCreateProfile(db, collegeId, r.uid);
      return { ...r, category: profile ? computeEffectiveCategory(profile, settings.newJoiningYears) : undefined };
    })
  );
}

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
          .where("status", "==", "PENDING_HOD")
          .get();
        const requests = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as LeaveRequest)
          .filter((r) => r.department === (dept || "__NO_DEPARTMENT__"));
        return NextResponse.json({ requests: sortByCreatedAtDesc(await attachCategory(db, session.collegeId, requests)) });
      }
      if (session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") {
        const snap = await REQUESTS_COL(session.collegeId, db)
          .where("status", "==", "PENDING_PRINCIPAL")
          .get();
        const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LeaveRequest);
        return NextResponse.json({ requests: sortByCreatedAtDesc(await attachCategory(db, session.collegeId, requests)) });
      }
      return NextResponse.json({ requests: [] });
    }

    const targetUid = url.searchParams.get("uid") || session.uid;
    if (!(await canAccessLeaveProfile(db, session.collegeId, session.role, session.uid, targetUid))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const snap = await REQUESTS_COL(session.collegeId, db)
      .where("uid", "==", targetUid)
      .get();

    const requests = sortByCreatedAtDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LeaveRequest));
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
    if (body.isHalfDay && !(body.leaveTypeCode && HALF_DAY_ELIGIBLE_TYPES.includes(body.leaveTypeCode))) {
      return NextResponse.json({ error: "Half day is only available for Sick Leave, Special Casual Leave, and On Duty" }, { status: 400 });
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

    // Insufficient balance never blocks submission - days beyond what's
    // remaining are accepted and split into Loss of Pay at approval time
    // (see splitLeaveDays in applications/[id]/route.ts). The Apply form
    // warns the requester about this before they submit, but doesn't block it.

    const now = new Date();
    // Technical Staff (COLLEGE_STAFF backed by a departmental SupportingStaff
    // record) report to an HOD just like PANEL_MEMBER faculty, so their
    // requests start at PENDING_HOD too. Non-Technical/label-only COLLEGE_STAFF
    // logins (Dean/IQAC/T&P, Librarian, etc.) have no department and no HOD
    // above them - those correctly skip straight to PENDING_PRINCIPAL, same as
    // HOD/Principal/office-leadership roles applying for their own leave.
    const reportsToHod = session.role === "PANEL_MEMBER" || (session.role === "COLLEGE_STAFF" && !!identity.department);
    const initialStatus = reportsToHod ? "PENDING_HOD" : "PENDING_PRINCIPAL";

    const newRequest: Omit<LeaveRequest, "id"> = {
      collegeId: session.collegeId,
      uid: session.uid,
      employeeName: identity.name,
      ...(identity.department ? { department: identity.department } : {}),
      ...(body.leaveTypeCode ? { leaveTypeCode: body.leaveTypeCode } : {}),
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

    // Balance is only committed on final approval (see [id]/route.ts) - a
    // pending/unapproved request never reduces the visible remaining count.

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
