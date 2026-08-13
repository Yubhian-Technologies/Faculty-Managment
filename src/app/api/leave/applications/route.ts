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
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
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
        let requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LeaveRequest);
        // A Vice Principal's own leave request must go to the Principal, not
        // themselves - drop it from their own queue so there's nothing to
        // self-approve here (the PATCH handler below is the real guard).
        if (session.role === "VICE_PRINCIPAL") {
          requests = requests.filter((r) => r.uid !== session.uid);
        }
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
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const body = (await request.json()) as {
      leaveTypeCode?: LeaveTypeCode;
      isOtherRequest?: boolean;
      fromDate?: string;
      toDate?: string;
      isHalfDay?: boolean;
      reason?: string;
      extendsRequestId?: string;
    };

    if (!body.fromDate || !body.toDate || !body.reason?.trim()) {
      return NextResponse.json({ error: "fromDate, toDate and reason are required" }, { status: 400 });
    }
    if (!body.leaveTypeCode && !body.isOtherRequest) {
      return NextResponse.json({ error: "leaveTypeCode or isOtherRequest is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const [profile, identity, existingSnap] = await Promise.all([
      getOrCreateProfile(db, session.collegeId, session.uid),
      resolveEmployeeIdentity(db, session.collegeId, session.uid),
      REQUESTS_COL(session.collegeId, db).where("uid", "==", session.uid).get(),
    ]);
    if (!profile || !identity) {
      return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
    }
    // One outstanding request at a time - a faculty member can't submit
    // another while an earlier one is still awaiting HOD/Principal decision
    // (the Apply button is also disabled client-side for this, but the
    // server is the actual guard - see LeaveProfileView.tsx).
    const hasPendingRequest = existingSnap.docs.some((d) => {
      const status = (d.data() as LeaveRequest).status;
      return status === "PENDING_HOD" || status === "PENDING_PRINCIPAL" || status === "PENDING_MANAGEMENT";
    });
    if (hasPendingRequest) {
      return NextResponse.json(
        { error: "You already have a leave request pending approval. Please wait for it to be decided before applying again." },
        { status: 400 }
      );
    }

    // "Extend Leave" (see LeaveProfileView.tsx / LeaveApplyForm.tsx) - this is
    // otherwise a completely normal new request (own approval chain, own
    // balance/LOP handling), just tagged with which of the requester's own
    // already-APPROVED requests it's extending, so the approver has context
    // and the requester's history shows the link. Only ever points at one of
    // their own APPROVED requests - never someone else's, and never a
    // still-pending or rejected one (nothing to "extend" there). Sick Leave
    // only - every other type has a planned return date decided up front, so
    // there's nothing to extend (the client already only offers the button
    // for SL - see LeaveProfileView.tsx - this is the server-side guard).
    if (body.extendsRequestId) {
      const source = existingSnap.docs.find((d) => d.id === body.extendsRequestId);
      const sourceData = source?.data() as LeaveRequest | undefined;
      if (!source || sourceData?.status !== "APPROVED") {
        return NextResponse.json({ error: "The leave request you're trying to extend was not found" }, { status: 400 });
      }
      if (sourceData.leaveTypeCode !== "SL") {
        return NextResponse.json({ error: "Only Sick Leave can be extended" }, { status: 400 });
      }
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
    // hasPendingRequest above already blocks a second submission while one is
    // still undecided, but says nothing about a request that's already been
    // decided - an APPROVED leave for these same dates (e.g. tomorrow) must
    // still block re-applying for them, or the employee ends up with two
    // approved/overlapping leave records for the same day.
    const overlapsApprovedLeave = existingSnap.docs.some((d) => {
      const r = d.data() as LeaveRequest;
      if (r.status !== "APPROVED") return false;
      const rFrom = (r.fromDate as unknown as { toDate(): Date }).toDate();
      const rTo = (r.toDate as unknown as { toDate(): Date }).toDate();
      return fromDate <= rTo && rFrom <= toDate;
    });
    if (overlapsApprovedLeave) {
      return NextResponse.json(
        { error: "You already have an approved leave covering one or more of these dates." },
        { status: 400 }
      );
    }
    const totalDays = countLeaveDays(fromDate, toDate, body.isHalfDay);

    // Insufficient balance never blocks submission - days beyond what's
    // remaining are accepted and split into Loss of Pay at approval time
    // (see splitLeaveDays in applications/[id]/route.ts). The Apply form
    // warns the requester about this before they submit, but doesn't block it.

    const now = new Date();
    // Faculty (PANEL_MEMBER - covers both Teaching and Technical designations)
    // always report to their department's HOD. Supporting Staff (COLLEGE_STAFF,
    // Non-Technical only) report to an HOD only if assigned to a department;
    // DEAN/IQAC_COORDINATOR/T_AND_P/R_AND_D and any remaining label-only
    // COLLEGE_STAFF logins (Librarian, etc.) have no department and no HOD
    // above them - those correctly skip straight to PENDING_PRINCIPAL, same
    // as Vice Principal/office-leadership roles applying for their own leave.
    // A PRINCIPAL's own leave skips PENDING_PRINCIPAL too - there's no one
    // else within the college to decide it, so it goes straight to the
    // global MANAGEMENT role instead (see /api/management/leave-approvals).
    const reportsToHod = session.role === "PANEL_MEMBER" || (session.role === "COLLEGE_STAFF" && !!identity.department);
    const initialStatus = session.role === "PRINCIPAL"
      ? "PENDING_MANAGEMENT"
      : reportsToHod ? "PENDING_HOD" : "PENDING_PRINCIPAL";

    const newRequest: Omit<LeaveRequest, "id"> = {
      collegeId: session.collegeId,
      uid: session.uid,
      employeeName: identity.name,
      ...(identity.department ? { department: identity.department } : {}),
      ...(body.leaveTypeCode ? { leaveTypeCode: body.leaveTypeCode } : {}),
      isOtherRequest: body.isOtherRequest || false,
      ...(body.extendsRequestId ? { extendsRequestId: body.extendsRequestId } : {}),
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
