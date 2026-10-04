export const dynamic = "force-dynamic";

import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { FieldValue } from "firebase-admin/firestore";
import { findUsersSnapshot } from "@/lib/roles/findUsersByRoles";
import { NextResponse } from "next/server";
import { isCollegeAdmin, requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAccessLeaveProfile } from "@/lib/leave/access";
import { resolveHodDepartments } from "@/lib/budget/departmentScope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { REQUESTS_COL, splitLeaveDays } from "@/lib/leave/balanceEngine";
import { LeaveStateConflictError, transitionLeaveRequest, type BalanceEffect } from "@/lib/leave/decisionTx";
import { decideFinalStageLeave } from "@/lib/leave/decideFinalStage";
import { getHolidayDateKeys } from "@/lib/leave/holidaysCount";
import { resolveStaffGender, resolveEmployeeIdentity } from "@/lib/leave/identity";
import { isoDateKey, yearsOfService, countWorkingDays, todayISODate } from "@/lib/leave/dayCounter";
import { getWorkingDayWeightsForRole } from "@/lib/attendance/workingDays";
import { loadUnavailability } from "@/lib/leave/availability";
import { resolveLeaveType } from "@/lib/leave/resolveLeaveTypes";
import { OTHER_CATEGORIES_COL } from "@/lib/leave/otherCategories";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import { evaluateODProof } from "@/lib/leave/odProof";
import { notifyODProofSubmitted, notifyODProofDecision } from "@/lib/leave/odProofNotify";
import { evaluateLeaveCertificate } from "@/lib/leave/leaveCertificate";
import { notifyCertificateSubmitted, notifyCertificateDecision, notifyCertificateRequested } from "@/lib/leave/leaveCertificateNotify";
import { syncApprovedLeaveToAttendance, revokeFutureLeaveFromAttendance } from "@/lib/leave/attendanceSync";
import { notify, notifyRole } from "@/lib/notify";
import { emitWorkflowNotification } from "@/lib/notifications/workflowNotifications";
import { validatePeriodSubstitutions, notifySubstitutes, type PeriodSubstitutionInput } from "@/lib/leave/periodCoverage";
import {
  buildAdjustmentRequests, notifyAdjustmentAssignees, notifyPendingApprover, mergeSubstituteEntry, withdrawSupersededPeriods,
} from "@/lib/leave/adjustmentRequests";
import { resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { resolveApproverStage, resolveApproverStageForHeldRoles, approverStageToStatus } from "@/lib/leave/approvalRouting";
import { listHandoverCandidates } from "@/lib/leave/handoverPool";
import { isLeaveRequestEditable } from "@/lib/leave/editability";
import { OTHER_LEAVE_CATEGORY_ORDER } from "@/types/leave";
import type { AdjustmentRequest, LeaveRequest, LeaveActionRecord, OtherLeaveCategory, PeriodSubstitution } from "@/types/leave";
import type { UserRole } from "@/types/core";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const db = getAdminDb();

    const snap = await REQUESTS_COL(session.collegeId, db).doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const req = { id: snap.id, ...snap.data() } as LeaveRequest;

    if (!(await canAccessLeaveProfile(db, session.collegeId, session.role, session.uid, req.uid))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ request: req });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Shared by VERIFY/REJECT_CERTIFICATE (and the REQUEST_CERTIFICATE nudge)
// below - the exact same reviewer-tier rule VERIFY/REJECT_OD_PROOF apply
// inline (HOD only within their own department via hodAction, else
// Principal/VP, never a self-review, never a College-Admin-as-Principal).
// Factored out here rather than in odProof.ts's own inline copies, which stay
// untouched to avoid any risk to that working code - this is only for the
// post-leave SL/SCL certificate actions.
async function assertCanReviewLeaveProof(
  db: FirebaseFirestore.Firestore,
  session: { uid: string; role: string; collegeId: string; realRole?: string },
  req: Pick<LeaveRequest, "uid" | "hodAction" | "department">
): Promise<NextResponse | null> {
  if (req.uid === session.uid) {
    return NextResponse.json({ error: "You cannot verify your own leave" }, { status: 403 });
  }
  if (req.hodAction) {
    if (session.role === "HOD") {
      const hodDepts = await resolveHodDepartments(db, session.collegeId, session.uid);
      if (!req.department || !hodDepts.includes(req.department)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else if (isCollegeAdmin(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
    // Approved at the Principal tier - or by Management, which has no
    // reviewer UI for this either (see leaveCertificateNotify.ts's scope note).
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (isCollegeAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const body = (await readJsonBody(request)) as {
      action?: "APPROVE" | "REJECT" | "CANCEL" | "EDIT" | "PROPOSE_COVERAGE" | "REVISE_ADJUSTMENT"
        | "SUBMIT_OD_PROOF" | "VERIFY_OD_PROOF" | "REJECT_OD_PROOF" | "REQUEST_OD_PROOF"
        | "SUBMIT_CERTIFICATE" | "VERIFY_CERTIFICATE" | "REJECT_CERTIFICATE" | "REQUEST_CERTIFICATE";
      remarks?: string;
      isPaidLeave?: boolean;
      otherLeaveCategory?: OtherLeaveCategory;
      reason?: string;
      periodSubstitutions?: PeriodSubstitutionInput[];
      // REVISE_ADJUSTMENT only - which declined entry to replace, and who to
      // replace it with.
      declinedAssigneeUid?: string;
      newSubstituteFacultyId?: string;
      newHandoverUid?: string;
      // SUBMIT_OD_PROOF only - the URL /api/upload/leave-proof just returned.
      odProofUrl?: string;
      // SUBMIT_CERTIFICATE only - same upload endpoint, different field.
      certificateUrl?: string;
      // EDIT only.
      fromDate?: string;
      toDate?: string;
      isHalfDay?: boolean;
      halfDaySession?: "FN" | "AN";
      placeOfVisit?: string;
      pointOfContact?: string;
    };
    if (!body.action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }
    if (body.action === "CANCEL" && !body.reason?.trim()) {
      return NextResponse.json({ error: "A reason is required to cancel a leave request" }, { status: 400 });
    }
    if (body.action === "REJECT_OD_PROOF" && !body.reason?.trim()) {
      return NextResponse.json({ error: "A reason is required to reject proof of duty" }, { status: 400 });
    }
    if (body.action === "EDIT" && (!body.fromDate || !body.toDate || !body.reason?.trim())) {
      return NextResponse.json({ error: "fromDate, toDate and reason are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = REQUESTS_COL(session.collegeId, db).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const req = { id: snap.id, ...snap.data() } as LeaveRequest;

    const now = new Date();
    const year = (req.fromDate as unknown as { toDate(): Date }).toDate().getFullYear();

    // ─── Cancel (requester only) ─────────────────────────────────────────────
    // Works both while still pending (any stage - HOD/Principal/Management)
    // and after it's already been APPROVED, as long as the leave period
    // itself hasn't finished yet - cancelling something already lived
    // through doesn't make sense. Only the original requester can do this,
    // at either point.
    if (body.action === "CANCEL") {
      if (req.uid !== session.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (req.isLateAttendancePenalty) {
        return NextResponse.json({ error: "This is an automatic attendance-penalty deduction and cannot be cancelled" }, { status: 400 });
      }
      const wasApproved = req.status === "APPROVED";
      if (
        req.status !== "PENDING_ACCEPTANCE" && req.status !== "PENDING_HOD" && req.status !== "PENDING_PRINCIPAL" &&
        req.status !== "PENDING_VICE_PRINCIPAL" && req.status !== "PENDING_MANAGEMENT" && !wasApproved
      ) {
        return NextResponse.json({ error: "Only a pending or approved request can be cancelled" }, { status: 400 });
      }
      if (wasApproved) {
        const toD = (req.toDate as unknown as { toDate(): Date }).toDate();
        const toEnd = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate(), 23, 59, 59, 999);
        if (toEnd < now) {
          return NextResponse.json({ error: "This leave has already been completed and can no longer be cancelled" }, { status: 400 });
        }
      }
      const cancelReason = body.reason!.trim();
      // Balance release + status flip are one transaction against the request as
      // it was read here (decisionTx.ts) - a double-click or an approver acting
      // at the same moment can no longer release days twice or release them for
      // a request that was just decided the other way.
      const cancelledType = req.leaveTypeCode ? LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode) : undefined;
      let cancelBalance: BalanceEffect | undefined;
      if (req.leaveTypeCode && cancelledType && !cancelledType.rules.unlimited) {
        if (wasApproved) {
          // Restore whatever days approval had committed to `used` -
          // the extra beyond balance (lopDays) was never committed in the
          // first place, so only the within-balance portion is reversed.
          const committedDays = req.totalDays - (req.lopDays ?? 0);
          if (committedDays > 0) {
            cancelBalance = { kind: "RELEASE_APPROVAL", uid: req.uid, code: req.leaveTypeCode, year, days: committedDays };
          }
        } else {
          cancelBalance = { kind: "RELEASE_PENDING", uid: req.uid, code: req.leaveTypeCode, year, days: req.totalDays };
        }
      }
      await transitionLeaveRequest({
        db, collegeId: session.collegeId, id,
        expected: { status: req.status, updatedAt: req.updatedAt },
        balance: cancelBalance,
        buildUpdate: () => ({ status: "CANCELLED", cancelReason, updatedAt: now }),
      });
      if (wasApproved) {
        await revokeFutureLeaveFromAttendance(db, session.collegeId, req, id);
      }
      await writeAuditLogSafe(db, session.collegeId, { action: "LEAVE_CANCELLED", performedBy: session.uid, performedByName: req.employeeName, targetId: id, details: { wasApproved, cancelReason } });

      // Tell whoever sits above this requester in the approval chain - the same
      // college-configured routing applications/route.ts POST uses to decide
      // where a fresh request lands (Settings > Leave Approval Routing) - so
      // the reason is visible to them even if they never re-open this
      // person's history.
      const message = `${req.employeeName} cancelled their ${wasApproved ? "approved" : "pending"} leave request (${req.totalDays} day(s)). Reason: ${cancelReason}`;
      const cancelSettings = await loadCollegeSettings(db, session.collegeId);
      const approverStage = resolveApproverStage(cancelSettings.leaveApprovalRouting, session.role, !!req.department);
      if (approverStage === "HOD" && req.department) {
        const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments")
          .where("name", "==", req.department).limit(1).get();
        const hodUid = (deptSnap.docs[0]?.data() as { hodUid?: string } | undefined)?.hodUid;
        if (hodUid) {
          await notify(db, session.collegeId, hodUid, "LEAVE_CANCELLED", "Leave Request Cancelled", message, `/hod/leave-history/${req.uid}`);
        }
      } else if (approverStage === "MANAGEMENT") {
        await notifyRole(db, session.collegeId, "MANAGEMENT", "LEAVE_CANCELLED", "Leave Request Cancelled", message);
      } else if (approverStage === "VICE_PRINCIPAL") {
        // VP-routed - Principal can also decide these (senior override), so
        // both are told, same as before this stage existed.
        await notifyRole(db, session.collegeId, "VICE_PRINCIPAL", "LEAVE_CANCELLED", "Leave Request Cancelled", message, "/principal/leave-approvals");
        await notifyRole(db, session.collegeId, "PRINCIPAL", "LEAVE_CANCELLED", "Leave Request Cancelled", message, "/principal/leave-approvals");
      } else {
        // PRINCIPAL stage - routed specifically to the Principal, not VP.
        await notifyRole(db, session.collegeId, "PRINCIPAL", "LEAVE_CANCELLED", "Leave Request Cancelled", message, "/principal/leave-approvals");
      }

      return NextResponse.json({ ok: true });
    }

    // ─── Revise a declined adjustment pick (requester only) ─────────────────
    // Once a named substitute/handover person declines (see
    // /api/leave/applications/[id]/adjustment-response), the request stays at
    // PENDING_ACCEPTANCE and the requester picks someone else here for that
    // one declined slot - untouched (still-PENDING or already-ACCEPTED)
    // entries are left exactly as they are.
    if (body.action === "REVISE_ADJUSTMENT") {
      if (req.uid !== session.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (req.status !== "PENDING_ACCEPTANCE") {
        return NextResponse.json({ error: "This request is no longer awaiting acceptance" }, { status: 400 });
      }
      const declined = (req.adjustmentRequests ?? []).find(
        (a) => a.assigneeUid === body.declinedAssigneeUid && a.status === "DECLINED"
      );
      if (!declined) {
        return NextResponse.json({ error: "No declined pick found to revise" }, { status: 400 });
      }

      let periodSubstitutions = req.periodSubstitutions;
      let handoverToUid = req.handoverToUid;
      let handoverToName = req.handoverToName;
      // Everything except the declined entry, to start - the SUBSTITUTE
      // branch below re-adds it back with just its still-ACCEPTED periods
      // (if any), since a decline never touches periods this same person
      // already accepted within the same bundle.
      let adjustmentRequests = (req.adjustmentRequests ?? []).filter((a) => a.assigneeUid !== declined.assigneeUid);
      let newEntry: AdjustmentRequest;

      if (declined.kind === "SUBSTITUTE") {
        if (!body.newSubstituteFacultyId || !req.department) {
          return NextResponse.json({ error: "newSubstituteFacultyId is required" }, { status: 400 });
        }
        const declinedPeriods = (declined.periods ?? []).filter((p) => p.status === "DECLINED");
        const acceptedPeriods = (declined.periods ?? []).filter((p) => p.status === "ACCEPTED");
        if (declinedPeriods.length === 0) {
          return NextResponse.json({ error: "Nothing declined on this pick to revise" }, { status: 400 });
        }
        if (acceptedPeriods.length > 0) {
          // The declined person's still-accepted periods stay theirs -
          // reassigning is only for the ones they turned down.
          adjustmentRequests.push({ ...declined, periods: acceptedPeriods, status: "ACCEPTED" });
        }

        const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, req.uid);
        const reqFromDate = (req.fromDate as unknown as { toDate(): Date }).toDate();
        const reqToDate = (req.toDate as unknown as { toDate(): Date }).toDate();
        const holidayDates = await getHolidayDateKeys(db, session.collegeId, reqFromDate, reqToDate);
        const result = await validatePeriodSubstitutions({
          db, collegeId: session.collegeId, facultyMemberId, department: req.department,
          fromDate: reqFromDate, toDate: reqToDate, holidayDates,
          submitted: declinedPeriods.map((p) => ({ date: p.date, timetableSlotId: p.timetableSlotId, substituteFacultyId: body.newSubstituteFacultyId! })),
          mode: "PARTIAL",
          coverageOptions: { excludeRequestId: id },
        });
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        const byKey = new Map((req.periodSubstitutions ?? []).map((p) => [`${p.date}|${p.timetableSlotId}`, p]));
        for (const p of result.resolved) byKey.set(`${p.date}|${p.timetableSlotId}`, p);
        periodSubstitutions = Array.from(byKey.values());

        const newUid = await resolveLoginUidForFacultyMember(db, session.collegeId, body.newSubstituteFacultyId);
        if (!newUid || newUid === body.newSubstituteFacultyId) {
          return NextResponse.json({ error: "That faculty member has no login yet and can't be asked to accept" }, { status: 400 });
        }
        const newPeriods = result.resolved.map((p) => ({ date: p.date, timetableSlotId: p.timetableSlotId, status: "PENDING" as const }));
        // The new pick might already be covering OTHER periods on this same
        // leave - merge rather than create a second entry for them, so they
        // still only ever see one combined request.
        const existingForNewUid = adjustmentRequests.find((a) => a.assigneeUid === newUid && a.kind === "SUBSTITUTE");
        if (existingForNewUid) {
          adjustmentRequests = adjustmentRequests.filter((a) => a !== existingForNewUid);
          newEntry = { ...existingForNewUid, periods: [...(existingForNewUid.periods ?? []), ...newPeriods], status: "PENDING" };
        } else {
          newEntry = {
            kind: "SUBSTITUTE", assigneeUid: newUid,
            assigneeName: result.resolved[0]?.substituteFacultyName ?? "Unknown",
            assigneeFacultyId: body.newSubstituteFacultyId, periods: newPeriods, status: "PENDING",
          };
        }
      } else {
        if (!body.newHandoverUid) {
          return NextResponse.json({ error: "newHandoverUid is required" }, { status: 400 });
        }
        if (body.newHandoverUid === req.uid) {
          return NextResponse.json({ error: "You can't hand over to yourself" }, { status: 400 });
        }
        const pool = await listHandoverCandidates(
          db, session.collegeId,
          { uid: session.uid, role: session.role, department: req.department ?? "" },
          {
            fromISO: isoDateKey((req.fromDate as unknown as { toDate(): Date }).toDate()),
            toISO: isoDateKey((req.toDate as unknown as { toDate(): Date }).toDate()),
          }
        );
        const chosen = pool.find((c) => c.uid === body.newHandoverUid);
        if (!chosen) {
          return NextResponse.json(
            { error: "Pick a handover contact from the list offered for your role who is available on these dates" },
            { status: 400 }
          );
        }
        handoverToUid = chosen.uid;
        handoverToName = chosen.name;
        newEntry = { kind: "HANDOVER", assigneeUid: handoverToUid, assigneeName: handoverToName, status: "PENDING" };
      }

      adjustmentRequests = adjustmentRequests.concat(newEntry);

      await ref.update({
        adjustmentRequests,
        ...(periodSubstitutions ? { periodSubstitutions } : {}),
        ...(handoverToUid ? { handoverToUid, handoverToName } : {}),
        updatedAt: now,
      });
      await notifyAdjustmentAssignees(db, session.collegeId, { ...req, adjustmentRequests });
      return NextResponse.json({ ok: true });
    }

    // ─── Edit (requester only, before any approver has decided) ─────────────
    // Re-runs the same validation applications/route.ts POST applies when
    // this request was first created, against the NEW fromDate/toDate/reason/
    // etc, then overwrites the request in place. Deliberately does not allow
    // changing leaveTypeCode/isOtherRequest (a different leave type has its
    // own eligibility/reason/gender rules entirely - that's a big enough
    // change to warrant cancelling and re-applying, not "editing"). Balance
    // is untouched either way: nothing is reserved/committed until an
    // approver actually decides (see POST's own comment on this), so an edit
    // here never needs to release or re-reserve anything.
    if (body.action === "EDIT") {
      if (req.uid !== session.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!isLeaveRequestEditable(req)) {
        return NextResponse.json({ error: "This request can no longer be edited - an approver has already acted on it" }, { status: 400 });
      }

      const [identity, settings] = await Promise.all([
        resolveEmployeeIdentity(db, session.collegeId, req.uid),
        loadCollegeSettings(db, session.collegeId),
      ]);
      if (!identity) {
        return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
      }

      let leaveType = null;
      if (req.leaveTypeCode) {
        leaveType = resolveLeaveType(settings.leaveTypeRuleOverrides, req.leaveTypeCode);
        if (leaveType?.rules.reasonOptions?.length && !leaveType.rules.allowCustomReason) {
          if (!leaveType.rules.reasonOptions.some((o) => o.label === body.reason!.trim())) {
            return NextResponse.json({ error: "Pick one of the listed reasons for this leave type" }, { status: 400 });
          }
        }
      }
      if (body.isHalfDay && !leaveType?.rules.halfDayAllowed) {
        return NextResponse.json({ error: "Half day isn't available for this leave type" }, { status: 400 });
      }
      if (body.isHalfDay && body.halfDaySession !== "FN" && body.halfDaySession !== "AN") {
        return NextResponse.json({ error: "Select forenoon or afternoon for a half day request" }, { status: 400 });
      }

      const fromDate = new Date(body.fromDate!);
      const toDate = new Date(body.toDate!);
      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || toDate < fromDate) {
        return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
      }
      const requestSpanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
      if (!body.isHalfDay && leaveType?.rules.maxConsecutiveDays && requestSpanDays > leaveType.rules.maxConsecutiveDays) {
        return NextResponse.json(
          { error: `This leave type can't be applied for more than ${leaveType.rules.maxConsecutiveDays} consecutive day(s)` },
          { status: 400 }
        );
      }
      if (leaveType?.rules.minAdvanceNoticeDays && !req.extendsRequestId && req.leaveTypeCode !== "SH") {
        const noticeDays = Math.round((fromDate.getTime() - new Date(todayISODate()).getTime()) / 86400000);
        if (noticeDays < leaveType.rules.minAdvanceNoticeDays) {
          return NextResponse.json(
            { error: `This leave type requires at least ${leaveType.rules.minAdvanceNoticeDays} day(s) advance notice` },
            { status: 400 }
          );
        }
      }
      const blackoutHit = (settings.leaveBlackoutWindows ?? []).find((w) => {
        if (w.appliesToTypes && !(req.leaveTypeCode && w.appliesToTypes.includes(req.leaveTypeCode))) return false;
        return body.fromDate! <= w.toDate && w.fromDate <= body.toDate!;
      });
      if (blackoutHit) {
        return NextResponse.json(
          { error: `Leave can't be applied between ${blackoutHit.fromDate} and ${blackoutHit.toDate} - ${blackoutHit.reason}` },
          { status: 400 }
        );
      }
      if (req.leaveTypeCode === "SH") {
        const summerSnap = await db.collection("colleges").doc(session.collegeId).collection("summerHolidays").get();
        const withinDeclaredRange = summerSnap.docs.some((d) => {
          const s = d.data() as { fromDate?: FirebaseFirestore.Timestamp; toDate?: FirebaseFirestore.Timestamp };
          const rangeFrom = s.fromDate?.toDate();
          const rangeTo = s.toDate?.toDate();
          return !!rangeFrom && !!rangeTo && fromDate >= rangeFrom && toDate <= rangeTo;
        });
        if (!withinDeclaredRange) {
          return NextResponse.json(
            { error: "Summer Vacation dates must fall within a range declared by College Office" },
            { status: 400 }
          );
        }
      } else if (body.fromDate! < todayISODate() || body.toDate! < todayISODate()) {
        return NextResponse.json({ error: "Leave cannot be applied for a date before today" }, { status: 400 });
      }

      const existingSnap = await REQUESTS_COL(session.collegeId, db).where("uid", "==", req.uid).get();
      const overlapsApprovedLeave = existingSnap.docs.some((d) => {
        if (d.id === id) return false; // this request's own prior dates, being replaced
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

      const [holidayDates, workingDayWeights] = await Promise.all([
        getHolidayDateKeys(db, session.collegeId, fromDate, toDate),
        getWorkingDayWeightsForRole(db, session.collegeId, fromDate, toDate, session.role as UserRole),
      ]);
      const totalDays = countWorkingDays(fromDate, toDate, holidayDates, !!body.isHalfDay, workingDayWeights);

      let periodSubstitutions: PeriodSubstitution[] | undefined;
      if (!req.isOtherRequest && identity.isTeachingStaff && identity.department) {
        const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, req.uid);
        const unavailability = await loadUnavailability(
          db, session.collegeId, isoDateKey(fromDate), isoDateKey(toDate), { excludeRequestId: id }
        );
        if (unavailability.coveringFacultyIdsBetween(isoDateKey(fromDate), isoDateKey(toDate)).has(facultyMemberId)) {
          return NextResponse.json(
            { error: "You're already committed to cover another faculty member's periods during these dates - resolve that coverage before editing your leave to overlap them." },
            { status: 400 },
          );
        }
        const result = await validatePeriodSubstitutions({
          db, collegeId: session.collegeId, facultyMemberId, department: identity.department,
          fromDate, toDate, holidayDates,
          submitted: body.periodSubstitutions ?? [],
          mode: "FULL",
          coverageOptions: { excludeRequestId: id },
        });
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        if (result.resolved.length > 0) periodSubstitutions = result.resolved;
      }

      if (req.leaveTypeCode === "OD" && (!body.placeOfVisit?.trim() || !body.pointOfContact?.trim())) {
        return NextResponse.json({ error: "Place of visit and point of contact are required for On Duty" }, { status: 400 });
      }

      // Re-resolved against the (possibly edited) reason text - see
      // applications/route.ts POST's own version of this.
      const proofRoutedTo = leaveType?.rules.reasonOptions?.find((o) => o.label === body.reason!.trim())?.proofRoutedTo ?? "HOD";

      // The handover/point-of-contact pick (if any) rides along unchanged -
      // editing dates/reason/periods never touches it. Rebuilding
      // adjustmentRequests from scratch below still needs it passed back in,
      // or an existing handover invitation would be silently dropped.
      const existingHandover = req.handoverToUid ? { uid: req.handoverToUid, name: req.handoverToName ?? "" } : null;

      let approverStage = resolveApproverStageForHeldRoles(
        settings.leaveApprovalRouting, session.roles ?? [session.role], session.role, !!identity.department
      );
      if (approverStage === "HOD" && leaveType && !leaveType.rules.unlimited) {
        const tooLong = leaveType.rules.escalateAfterDays !== undefined && totalDays > leaveType.rules.escalateAfterDays;
        let tooMuchLop = false;
        if (!tooLong && leaveType.rules.maxLopDaysBeforeEscalation !== undefined) {
          const preview = await splitLeaveDays(db, session.collegeId, req.uid, leaveType, fromDate.getFullYear(), totalDays);
          tooMuchLop = preview.lopDays > leaveType.rules.maxLopDaysBeforeEscalation;
        }
        if (tooLong || tooMuchLop) approverStage = "PRINCIPAL";
      }
      const postAcceptanceStatus = approverStageToStatus(approverStage);

      // Rebuilt from scratch rather than diffed against the old picks - since
      // nothing here has been decided yet (isLeaveRequestEditable above), a
      // previously-accepted substitute simply gets asked again if they're
      // still covering under the new dates/periods. Simpler and safer than
      // trying to carry partial acceptance state across a date change that
      // may have altered which periods even need covering.
      const adjustmentRequests: AdjustmentRequest[] = await buildAdjustmentRequests(
        db, session.collegeId, periodSubstitutions, existingHandover
      );
      const newStatus = adjustmentRequests.length > 0 ? "PENDING_ACCEPTANCE" : postAcceptanceStatus;

      const updated: Partial<LeaveRequest> = {
        fromDate: fromDate as unknown as LeaveRequest["fromDate"],
        toDate: toDate as unknown as LeaveRequest["toDate"],
        totalDays,
        isHalfDay: !!body.isHalfDay,
        ...(body.isHalfDay ? { halfDaySession: body.halfDaySession } : {}),
        reason: body.reason!.trim(),
        ...(proofRoutedTo === "EXAM_CELL" ? { proofRoutedTo } : {}),
        ...(body.placeOfVisit?.trim() ? { placeOfVisit: body.placeOfVisit.trim() } : {}),
        ...(body.pointOfContact?.trim() ? { pointOfContact: body.pointOfContact.trim() } : {}),
        periodSubstitutions: periodSubstitutions ?? [],
        adjustmentRequests,
        ...(adjustmentRequests.length > 0 ? { postAcceptanceStatus } : {}),
        status: newStatus,
        updatedAt: now as unknown as LeaveRequest["updatedAt"],
      };
      // A prior EXAM_CELL routing that the edited reason no longer matches
      // has to be explicitly cleared - Firestore's update() leaves an
      // omitted field untouched, it doesn't reset it to the HOD default.
      const clearProofRouting = proofRoutedTo !== "EXAM_CELL" && !!req.proofRoutedTo;
      await ref.update(clearProofRouting ? { ...updated, proofRoutedTo: FieldValue.delete() } : updated);
      await writeAuditLogSafe(db, session.collegeId, { action: "LEAVE_EDITED", performedBy: session.uid, performedByName: identity.name, targetId: id, details: { totalDays } });
      if (adjustmentRequests.length > 0) {
        await notifyAdjustmentAssignees(db, session.collegeId, { ...req, ...updated, adjustmentRequests });
      } else {
        await notifyPendingApprover(db, session.collegeId, newStatus, { ...req, ...updated });
      }
      // Same "tell Exam Cell directly" as a fresh submission - only when this
      // edit newly routes here (wasn't already EXAM_CELL before the edit).
      if (proofRoutedTo === "EXAM_CELL" && req.proofRoutedTo !== "EXAM_CELL") {
        await notifyRole(
          db, session.collegeId, "EXAM_CELL", "LEAVE_PROOF_ROUTED_TO_EXAM_CELL",
          "Leave filed for an exam-duty reason",
          `${identity.name} applied for leave citing "${body.reason!.trim()}" - proof for this should be routed to Exam Cell.`,
        );
      }
      return NextResponse.json({ ok: true });
    }

    // ─── Propose coverage (HOD/Principal naming a NEW substitute) ───────────
    // Two callers: an HOD/Principal overriding a pick while a standard
    // request is still PENDING_HOD (previously bundled straight into the
    // same APPROVE call - see LeaveApprovalQueue.tsx), or revisiting an
    // already-APPROVED leave after the timetable added a period that was
    // never part of the original snapshot (buildPeriodCoverage picks up any
    // newly-added one automatically - see AdjustCoverageDialog.tsx). Either
    // way this only PROPOSES - re-validated fresh against current
    // availability, but a genuinely new/changed pick still needs that
    // person's own acceptance (see pendingPeriodSubstitutions in
    // types/leave.ts) before it actually takes effect on periodSubstitutions
    // (and the timetable). A period whose submitted pick is unchanged from
    // what's already recorded is a no-op here - re-approving your own
    // already-accepted picks doesn't ask anyone again.
    if (body.action === "PROPOSE_COVERAGE") {
      if (req.status !== "PENDING_HOD" && req.status !== "APPROVED") {
        return NextResponse.json({ error: "Coverage can only be proposed while pending HOD decision or already approved" }, { status: 400 });
      }
      // Authorization is against the leave-taker's OWN department only - the
      // proposed substitute's candidate pool (buildPeriodCoverage, below) is
      // deliberately college-wide, not narrowed to the HOD's own department.
      // Confirmed intentional (not a gap to close): a cross-department pick
      // still has to accept the assignment same as any other pick - see
      // pendingPeriodSubstitutions above - so this isn't a silent grant.
      if (session.role === "HOD") {
        const hodDepts = await resolveHodDepartments(db, session.collegeId, session.uid);
        if (!req.department || !hodDepts.includes(req.department)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!body.periodSubstitutions?.length) {
        return NextResponse.json({ error: "periodSubstitutions is required" }, { status: 400 });
      }
      if (!req.department) {
        return NextResponse.json({ error: "This request has no department to resolve coverage against" }, { status: 400 });
      }

      const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, req.uid);
      const reqFromDate = (req.fromDate as unknown as { toDate(): Date }).toDate();
      const reqToDate = (req.toDate as unknown as { toDate(): Date }).toDate();
      const holidayDates = await getHolidayDateKeys(db, session.collegeId, reqFromDate, reqToDate);
      const result = await validatePeriodSubstitutions({
        db, collegeId: session.collegeId, facultyMemberId, department: req.department,
        fromDate: reqFromDate, toDate: reqToDate, holidayDates,
        submitted: body.periodSubstitutions, mode: "PARTIAL",
        coverageOptions: { excludeRequestId: id },
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      const currentByKey = new Map((req.periodSubstitutions ?? []).map((p) => [`${p.date}|${p.timetableSlotId}`, p]));
      const changed = result.resolved.filter((p) => currentByKey.get(`${p.date}|${p.timetableSlotId}`)?.substituteFacultyId !== p.substituteFacultyId);
      if (changed.length === 0) {
        return NextResponse.json({ ok: true, changed: false });
      }

      const byFacultyId = new Map<string, { name: string; periods: typeof changed }>();
      for (const p of changed) {
        const entry = byFacultyId.get(p.substituteFacultyId) ?? { name: p.substituteFacultyName, periods: [] };
        entry.periods.push(p);
        byFacultyId.set(p.substituteFacultyId, entry);
      }
      let adjustmentRequests = req.adjustmentRequests ?? [];
      for (const [facultyId, { name, periods: facultyPeriods }] of byFacultyId) {
        const uid = await resolveLoginUidForFacultyMember(db, session.collegeId, facultyId);
        if (!uid || uid === facultyId) continue; // not provisioned with a login yet - nothing to ask
        adjustmentRequests = mergeSubstituteEntry(
          adjustmentRequests, { uid, name, facultyId },
          facultyPeriods.map((p) => ({ date: p.date, timetableSlotId: p.timetableSlotId, status: "PENDING" as const }))
        );
        // These periods are now this person's, so take them off whoever held
        // them before - otherwise the superseded assignee stays PENDING on
        // slots they no longer cover, and accepting would record two people
        // covering the same period.
        adjustmentRequests = withdrawSupersededPeriods(
          adjustmentRequests, uid,
          new Set(facultyPeriods.map((p) => `${p.date}|${p.timetableSlotId}`))
        );
      }

      const pendingByKey = new Map((req.pendingPeriodSubstitutions ?? []).map((p) => [`${p.date}|${p.timetableSlotId}`, p]));
      for (const p of changed) pendingByKey.set(`${p.date}|${p.timetableSlotId}`, p);
      const pendingPeriodSubstitutions = Array.from(pendingByKey.values());

      // The paid/unpaid decision rides along, when the approver has made one.
      // Naming a substitute is now its own step, so the approver leaves the
      // form and comes back once the substitute accepts - without this, that
      // choice lived only in the page's state and had to be re-entered, since
      // it was previously only ever written by APPROVE.
      await ref.update({
        adjustmentRequests,
        pendingPeriodSubstitutions,
        ...(typeof body.isPaidLeave === "boolean" ? { isPaidLeave: body.isPaidLeave } : {}),
        updatedAt: now,
      });
      await writeAuditLogSafe(db, session.collegeId, { action: "LEAVE_COVERAGE_PROPOSED", performedBy: session.uid, performedByName: session.email || session.role, targetId: id, details: { changedCount: changed.length } });
      await notifyAdjustmentAssignees(db, session.collegeId, { ...req, adjustmentRequests });
      return NextResponse.json({ ok: true, changed: true });
    }

    // ─── On Duty proof ────────────────────────────────────────────────────────
    // These act on an APPROVED request, so they belong here beside CANCEL and
    // PROPOSE_COVERAGE - past this point the handler only deals with requests
    // still awaiting a decision and would answer "no longer pending".
    //
    // Nothing below writes `status` or touches a balance. Whether unproven days
    // become Loss of Pay is derived at read time from these fields plus the
    // request's own dates (lib/leave/odProof.ts), never recorded as a verdict.
    if (body.action === "SUBMIT_OD_PROOF") {
      if (req.uid !== session.uid) {
        return NextResponse.json({ error: "You can only upload proof for your own leave" }, { status: 403 });
      }
      const evaluation = evaluateODProof(req, now);
      if (!evaluation.canUpload) {
        return NextResponse.json({
          error: evaluation.state === "VERIFIED"
            ? "This proof has already been verified"
            : "Proof can only be uploaded once the On Duty period has ended",
        }, { status: 400 });
      }
      // The upload route builds its path from the session and this request id
      // alone, so a URL carrying this exact prefix could only have come from
      // this user uploading against this request - the same host + path check
      // profilePhotoUrl gets in api/college/users/[uid].
      const expectedPrefix = `leave-proofs/${session.collegeId}/${session.uid}/${id}/`;
      if (
        !body.odProofUrl?.startsWith("https://firebasestorage.googleapis.com/") ||
        !body.odProofUrl.includes(encodeURIComponent(expectedPrefix))
      ) {
        return NextResponse.json({ error: "Invalid proof URL" }, { status: 400 });
      }

      const submissionCount = (req.odProofSubmissionCount ?? 0) + 1;
      await ref.update({
        odProofUrl: body.odProofUrl,
        odProofUploadedAt: now,
        odProofStatus: "PENDING_VERIFICATION",
        odProofSubmissionCount: submissionCount,
        // A resubmission must not keep showing the previous rejection.
        odProofRejectionReason: "",
        odProofReviewedBy: "",
        odProofReviewedByName: "",
        updatedAt: now,
      });
      await writeAuditLogSafe(db, session.collegeId, { action: "LEAVE_OD_PROOF_SUBMITTED", performedBy: session.uid, performedByName: session.email || session.role, targetId: id, details: { submissionCount } });
      await notifyODProofSubmitted(db, session.collegeId, { ...req, id }, submissionCount);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "VERIFY_OD_PROOF" || body.action === "REJECT_OD_PROOF") {
      // Checked first and without exception: an HOD's own OD carries their own
      // department, so the department check below would otherwise let them
      // sign off their own proof.
      if (req.uid === session.uid) {
        return NextResponse.json({ error: "You cannot verify proof for your own leave" }, { status: 403 });
      }
      if (req.odProofStatus !== "PENDING_VERIFICATION") {
        return NextResponse.json({ error: "There is no proof awaiting verification on this request" }, { status: 400 });
      }
      // Authorised off whichever tier actually approved the request, read from
      // the document - the requester's own role isn't stored on it. Principal/VP
      // are allowed on an HOD-tier request too (the same allowance
      // PROPOSE_COVERAGE makes), so a department with no sitting HOD isn't stuck.
      if (req.hodAction) {
        if (session.role === "HOD") {
          const hodDepts = await resolveHodDepartments(db, session.collegeId, session.uid);
          if (!req.department || !hodDepts.includes(req.department)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
          }
        } else if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        } else if (isCollegeAdmin(session)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
        // Approved at the Principal tier - or by Management, in which case it's
        // reviewed from the management route rather than here.
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      } else if (isCollegeAdmin(session)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const verified = body.action === "VERIFY_OD_PROOF";
      await ref.update({
        odProofStatus: verified ? "VERIFIED" : "REJECTED",
        odProofReviewedBy: session.uid,
        odProofReviewedByName: session.email || session.role,
        odProofReviewedAt: now,
        odProofRejectionReason: verified ? "" : (body.reason ?? "").trim(),
        updatedAt: now,
      });
      await writeAuditLogSafe(db, session.collegeId, { action: verified ? "LEAVE_OD_PROOF_VERIFIED" : "LEAVE_OD_PROOF_REJECTED", performedBy: session.uid, performedByName: session.email || session.role, targetId: id, details: { reason: body.reason ?? null } });
      await notifyODProofDecision(db, session.collegeId, { ...req, id }, verified, body.reason);
      return NextResponse.json({ ok: true });
    }

    // Manual nudge - same audience as VERIFY_OD_PROOF/REJECT_OD_PROOF above
    // (whoever would actually review this proof), but firing BEFORE anything
    // has been uploaded rather than after: the requester's period has ended,
    // nothing usable is on file yet, and this approver doesn't want to wait
    // on the automatic 24h reminder (api/cron/od-proof-reminders) alone.
    if (body.action === "REQUEST_OD_PROOF") {
      if (req.uid === session.uid) {
        return NextResponse.json({ error: "You cannot request proof for your own leave" }, { status: 403 });
      }
      const evaluation = evaluateODProof(req, now);
      if (!evaluation.canUpload || evaluation.awaitingVerification) {
        return NextResponse.json({ error: "There's nothing outstanding to request proof for on this request" }, { status: 400 });
      }
      if (req.hodAction) {
        if (session.role === "HOD") {
          const hodDepts = await resolveHodDepartments(db, session.collegeId, session.uid);
          if (!req.department || !hodDepts.includes(req.department)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
          }
        } else if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        } else if (isCollegeAdmin(session)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      } else if (isCollegeAdmin(session)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const requestedByLabel = session.role === "HOD" ? "Your HOD" : (session.email || session.role);
      await notify(
        db, session.collegeId, req.uid, "LEAVE_OD_PROOF_REQUESTED_BY_HOD",
        "Upload requested: On Duty proof",
        `${requestedByLabel} has requested you to upload your On Duty proof of duty document.`,
        `/leave/od-proof/${id}`
      );
      await writeAuditLogSafe(db, session.collegeId, { action: "LEAVE_OD_PROOF_REQUESTED", performedBy: session.uid, performedByName: session.email || session.role, targetId: id, details: {} });
      return NextResponse.json({ ok: true });
    }

    // ─── Post-leave certificate (SL, optional; SCL, chased) ─────────────────
    // Record-keeping (see lib/leave/leaveCertificate.ts) - unlike the On Duty
    // proof block above, nothing here ever affects lopDays, isPaidLeave, or
    // status, for EITHER leave type. Same "already approved" placement as OD
    // proof.
    if (body.action === "SUBMIT_CERTIFICATE") {
      if (req.uid !== session.uid) {
        return NextResponse.json({ error: "You can only upload a certificate for your own leave" }, { status: 403 });
      }
      const evaluation = evaluateLeaveCertificate(req, now);
      if (!evaluation.canUpload) {
        return NextResponse.json({
          error: evaluation.state === "VERIFIED"
            ? "This certificate has already been verified"
            : "A certificate can only be uploaded once the leave period has ended",
        }, { status: 400 });
      }
      const expectedPrefix = `leave-proofs/${session.collegeId}/${session.uid}/${id}/`;
      if (
        !body.certificateUrl?.startsWith("https://firebasestorage.googleapis.com/") ||
        !body.certificateUrl.includes(encodeURIComponent(expectedPrefix))
      ) {
        return NextResponse.json({ error: "Invalid certificate URL" }, { status: 400 });
      }

      const submissionCount = (req.certificateSubmissionCount ?? 0) + 1;
      await ref.update({
        certificateUrl: body.certificateUrl,
        certificateUploadedAt: now,
        certificateStatus: "PENDING_VERIFICATION",
        certificateSubmissionCount: submissionCount,
        // A resubmission must not keep showing the previous rejection.
        certificateRejectionReason: "",
        certificateReviewedBy: "",
        certificateReviewedByName: "",
        updatedAt: now,
      });
      await writeAuditLogSafe(db, session.collegeId, { action: "LEAVE_CERTIFICATE_SUBMITTED", performedBy: session.uid, performedByName: session.email || session.role, targetId: id, details: { submissionCount } });
      await notifyCertificateSubmitted(db, session.collegeId, { ...req, id }, submissionCount);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "VERIFY_CERTIFICATE" || body.action === "REJECT_CERTIFICATE") {
      if (req.certificateStatus !== "PENDING_VERIFICATION") {
        return NextResponse.json({ error: "There is no certificate awaiting verification on this request" }, { status: 400 });
      }
      const forbidden = await assertCanReviewLeaveProof(db, session, req);
      if (forbidden) return forbidden;

      const verified = body.action === "VERIFY_CERTIFICATE";
      await ref.update({
        certificateStatus: verified ? "VERIFIED" : "REJECTED",
        certificateReviewedBy: session.uid,
        certificateReviewedByName: session.email || session.role,
        certificateReviewedAt: now,
        certificateRejectionReason: verified ? "" : (body.reason ?? "").trim(),
        updatedAt: now,
      });
      await writeAuditLogSafe(db, session.collegeId, { action: verified ? "LEAVE_CERTIFICATE_VERIFIED" : "LEAVE_CERTIFICATE_REJECTED", performedBy: session.uid, performedByName: session.email || session.role, targetId: id, details: { reason: body.reason ?? null } });
      await notifyCertificateDecision(db, session.collegeId, { ...req, id }, verified, body.reason);
      return NextResponse.json({ ok: true });
    }

    // Manual nudge, SCL only in practice (SL's certificate is optional, so
    // nothing ever needs chasing) - same audience as VERIFY/REJECT_CERTIFICATE
    // above, mirrors REQUEST_OD_PROOF exactly.
    if (body.action === "REQUEST_CERTIFICATE") {
      const evaluation = evaluateLeaveCertificate(req, now);
      if (!evaluation.required || !evaluation.canUpload || evaluation.awaitingVerification) {
        return NextResponse.json({ error: "There's nothing outstanding to request a certificate for on this request" }, { status: 400 });
      }
      const forbidden = await assertCanReviewLeaveProof(db, session, req);
      if (forbidden) return forbidden;

      const requestedByLabel = session.role === "HOD" ? "Your HOD" : (session.email || session.role);
      await notifyCertificateRequested(db, session.collegeId, { ...req, id }, requestedByLabel);
      await writeAuditLogSafe(db, session.collegeId, { action: "LEAVE_CERTIFICATE_REQUESTED", performedBy: session.uid, performedByName: session.email || session.role, targetId: id, details: {} });
      return NextResponse.json({ ok: true });
    }

    // ─── HOD stage ────────────────────────────────────────────────────────────
    // Standard types (CL/SL/SCL/EL/OD): the HOD's decision is final - APPROVE
    // commits the balance and closes the request out; REJECT releases it.
    // "Other" requests: the HOD can REJECT outright, or tag isPaidLeave and
    // forward to the Principal for the real decision (Other is never
    // balance-tracked, so nothing is reserved/committed for it here).
    if (req.status === "PENDING_HOD") {
      // Authorised off whichever tier the request is currently sitting at.
      // Principal/VP are allowed on an HOD-tier decision too (the same
      // allowance PROPOSE_COVERAGE and VERIFY_OD_PROOF make), so a department
      // with no sitting HOD isn't stuck waiting on a seat nobody holds.
      if (session.role === "HOD") {
        const hodDepts = await resolveHodDepartments(db, session.collegeId, session.uid);
        if (!req.department || !hodDepts.includes(req.department)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      } else if (isCollegeAdmin(session)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const decidedByLabel = session.role === "HOD" ? "HOD" : (session.email || session.role);

      const actionRecord: LeaveActionRecord = {
        action: body.action === "APPROVE" ? "APPROVED" : "REJECTED",
        by: session.uid, byName: session.email || decidedByLabel, at: now as unknown as LeaveActionRecord["at"],
        ...(body.remarks ? { remarks: body.remarks } : {}),
      };

      if (body.action === "REJECT") {
        const rejectedType = req.leaveTypeCode ? LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode) : undefined;
        await transitionLeaveRequest({
          db, collegeId: session.collegeId, id,
          expected: { status: req.status, updatedAt: req.updatedAt },
          balance: req.leaveTypeCode && rejectedType && !rejectedType.rules.unlimited
            ? { kind: "RELEASE_PENDING", uid: req.uid, code: req.leaveTypeCode, year, days: req.totalDays }
            : undefined,
          buildUpdate: () => ({ status: "REJECTED", hodAction: actionRecord, updatedAt: now }),
        });
        await writeAuditLogSafe(db, session.collegeId, { action: "LEAVE_REJECTED", performedBy: session.uid, performedByName: session.email || decidedByLabel, targetId: id, details: {} });
        await notify(db, session.collegeId, req.uid, "LEAVE_REJECTED", "Leave Request Rejected",
          `Your leave request for ${req.totalDays} day(s) was rejected by ${decidedByLabel === "HOD" ? "your HOD" : decidedByLabel}.`, "/panel/leave");
        return NextResponse.json({ ok: true });
      }

      // APPROVE
      // Naming a NEW substitute (overriding a pick, or - for an Other
      // request - the HOD adding one for the first time) is a separate step
      // now (see PROPOSE_COVERAGE above) - that person must accept before
      // this can go through, so neither branch below still takes
      // periodSubstitutions inline.
      if (req.pendingPeriodSubstitutions?.length) {
        return NextResponse.json(
          { error: "Some substitute changes on this request are still awaiting acceptance" },
          { status: 400 }
        );
      }
      if (req.isOtherRequest) {
        if (typeof body.isPaidLeave !== "boolean") {
          return NextResponse.json({ error: "isPaidLeave is required to forward an Other request" }, { status: 400 });
        }
        actionRecord.isPaidLeave = body.isPaidLeave;

        // PENDING_VICE_PRINCIPAL, not PENDING_PRINCIPAL - this forward isn't
        // driven by the requester's own routing choice, and either the
        // Principal or the Vice Principal has always been able to decide it
        // (see the notify loop below, unchanged). PENDING_VICE_PRINCIPAL is
        // the status that keeps both of them eligible; PENDING_PRINCIPAL is
        // now Principal-only (see its comment in types/leave.ts).
        await transitionLeaveRequest({
          db, collegeId: session.collegeId, id,
          expected: { status: req.status, updatedAt: req.updatedAt },
          buildUpdate: () => ({
            status: "PENDING_VICE_PRINCIPAL", isPaidLeave: body.isPaidLeave, hodAction: actionRecord, updatedAt: now,
          }),
        });
        await writeAuditLogSafe(db, session.collegeId, { action: "LEAVE_HOD_FORWARDED", performedBy: session.uid, performedByName: session.email || decidedByLabel, targetId: id, details: { isPaidLeave: body.isPaidLeave } });

        const principalsSnap = await findUsersSnapshot(db, session.collegeId, ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_ADMIN"]);
        for (const p of principalsSnap.docs) {
          await emitWorkflowNotification({
            db, collegeId: session.collegeId, toUid: p.id,
            type: "LEAVE_PENDING_APPROVAL",
            title: "Leave Request Awaiting Approval",
            message: `${req.employeeName}'s "Other" leave request (${body.isPaidLeave ? "paid" : "unpaid"}) was forwarded by ${decidedByLabel === "HOD" ? "their HOD" : decidedByLabel} and needs your decision.`,
            link: "/principal/leave-approvals",
            entityType: "leaveRequest", entityId: id,
            dedupeKey: `leave-request-review:${id}:${p.id}`,
          });
        }
        return NextResponse.json({ ok: true });
      }

      // Standard type - HOD approval is final. Insufficient balance never
      // blocks this - the excess becomes Loss of Pay instead. Coverage is
      // whatever's already on record - the requester's own accepted
      // submission-time picks, plus any HOD override that's already cleared
      // PROPOSE_COVERAGE's acceptance gate above.
      const periodSubstitutions = req.periodSubstitutions;

      // Status precondition + balance commit + APPROVED all land in one
      // transaction (decisionTx.ts): two approvers, or a double-click, can no
      // longer deduct twice, and a failed update can't strand a deduction.
      const approvedType = req.leaveTypeCode ? LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode) : undefined;
      const { lopDays } = await transitionLeaveRequest({
        db, collegeId: session.collegeId, id,
        expected: { status: req.status, updatedAt: req.updatedAt },
        balance: req.leaveTypeCode && approvedType && !approvedType.rules.unlimited
          ? { kind: "COMMIT_SPLIT", uid: req.uid, code: req.leaveTypeCode, year, days: req.totalDays, leaveType: approvedType }
          : undefined,
        buildUpdate: (r) => ({
          status: "APPROVED", hodAction: actionRecord, lopDays: r.lopDays, updatedAt: now,
          ...(periodSubstitutions ? { periodSubstitutions } : {}),
          // An approved OD only stays PAID once the duty is evidenced: the
          // requester uploads proof after the period ends and an approver
          // verifies it (see lib/leave/odProof.ts). Stamping the obligation
          // here, rather than testing leaveTypeCode at read time, is what
          // keeps every OD approved before this shipped permanently exempt.
          ...(req.leaveTypeCode === "OD" ? { odProofRequired: true } : {}),
        }),
      });
      await writeAuditLogSafe(db, session.collegeId, { action: "LEAVE_HOD_APPROVED", performedBy: session.uid, performedByName: session.email || decidedByLabel, targetId: id, details: { lopDays } });
      await notify(db, session.collegeId, req.uid, "LEAVE_APPROVED", "Leave Request Approved",
        `Your leave request for ${req.totalDays} day(s) was approved by ${decidedByLabel === "HOD" ? "your HOD" : decidedByLabel}` +
          (lopDays > 0 ? ` — ${lopDays} day(s) exceed your balance and will be treated as Loss of Pay.` : "."),
        "/panel/leave");
      // Notified against the FINAL periodSubstitutions (post-adjustment),
      // not the stale `req` read at the top of this handler - otherwise an
      // HOD override here would notify the requester's original pick
      // instead of whoever's actually covering now.
      await notifySubstitutes(db, session.collegeId, { ...req, periodSubstitutions });
      await syncApprovedLeaveToAttendance(db, session.collegeId, req, id);
      return NextResponse.json({ ok: true });
    }

    // ─── Principal / Vice Principal stage (final) ────────────────────────────
    // Reached either by a non-PANEL_MEMBER's own leave request (any type,
    // unchanged from before - commits/releases its balance as always) or by
    // an HOD-forwarded "Other" request (isPaidLeave already set, never
    // balance-tracked). Either way this is the final decision. A PRINCIPAL's
    // own leave never lands here at all - it starts at PENDING_MANAGEMENT
    // instead (see applications/route.ts POST) and is decided via
    // /api/management/leave-approvals, not this route.
    //
    // PENDING_PRINCIPAL and PENDING_VICE_PRINCIPAL are two distinct routing
    // destinations (Settings > Leave Approval Routing) sharing this one
    // decision path: a request routed specifically to the Principal can only
    // be decided by the Principal; one routed to the Vice Principal can be
    // decided by either (Principal keeps a senior override) - see
    // PENDING_VICE_PRINCIPAL's comment in types/leave.ts.
    if (req.status === "PENDING_PRINCIPAL" || req.status === "PENDING_VICE_PRINCIPAL") {
      const isVPStage = req.status === "PENDING_VICE_PRINCIPAL";
      const roleAllowed = isVPStage
        ? session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL"
        : session.role === "PRINCIPAL";
      if (!roleAllowed) {
        return NextResponse.json(
          { error: isVPStage ? "Forbidden" : "This request is routed to the Principal specifically" },
          { status: 403 }
        );
      }
      // College Admin's login reads as "PRINCIPAL" too (see isCollegeAdmin),
      // but deciding a leave request is Principal/VP decision authority, not
      // College Admin's.
      if (isCollegeAdmin(session)) {
        return NextResponse.json({ error: "Only the Principal or Vice Principal can decide this leave request" }, { status: 403 });
      }
      // A Vice Principal's own leave request can never actually reach
      // PENDING_VICE_PRINCIPAL through normal routing (allowedStagesForRole
      // excludes it for their own role - see approvalRouting.ts), but this
      // stays as a server-side backstop against self-approval regardless.
      if (session.role === "VICE_PRINCIPAL" && req.uid === session.uid) {
        return NextResponse.json(
          { error: "Your own leave request must be approved by the Principal" },
          { status: 403 },
        );
      }

      if (body.action !== "APPROVE" && body.action !== "REJECT") {
        return NextResponse.json({ error: "action must be APPROVE or REJECT" }, { status: 400 });
      }
      // Approving an "Other" request is also where the Principal categorizes
      // it (Maternity/Family Planning/Quarantine/Extraordinary/Compensatory)
      // for their own record - required, not optional, and stored separately
      // from the request itself (see OTHER_CATEGORIES_COL) so it's never
      // visible anywhere else.
      if (body.action === "APPROVE" && req.isOtherRequest) {
        if (!body.otherLeaveCategory || !OTHER_LEAVE_CATEGORY_ORDER.includes(body.otherLeaveCategory)) {
          return NextResponse.json(
            { error: "Select a leave category (Maternity, Family Planning, Quarantine, Extraordinary, or Compensatory) before approving" },
            { status: 400 }
          );
        }
        // Maternity applies to female staff only, and only once they've
        // completed at least 1 year of service. The picker already hides
        // Maternity for anyone who isn't female (LeaveApprovalQueue), but
        // that's presentation - this is the guard, so a direct API call
        // can't set it either. Both reads are live from the requester's own
        // record rather than from anything copied onto the request,
        // matching how the queue decides what to offer. A requester with no
        // gender recorded is not eligible: the college should record it
        // rather than have the app assume. Service length uses the same
        // completed-years rule (yearsOfService) already used to gate the
        // new-joining leave category, off the same dateOfJoining
        // resolveEmployeeIdentity already falls back through for every
        // account shape.
        if (body.otherLeaveCategory === "MATERNITY") {
          const gender = await resolveStaffGender(db, session.collegeId, req.uid);
          if (gender !== "Female") {
            return NextResponse.json(
              { error: "Maternity leave applies to female staff only" },
              { status: 400 }
            );
          }
          const identity = await resolveEmployeeIdentity(db, session.collegeId, req.uid);
          const completedYears = identity ? yearsOfService(identity.dateOfJoining, new Date()) : 0;
          if (completedYears < 1) {
            return NextResponse.json(
              { error: "Maternity leave requires at least 1 completed year of service" },
              { status: 400 }
            );
          }
        }
        // Normally an HOD already tagged paid/unpaid when forwarding it here.
        // A Vice Principal's own Other leave skips the HOD stage entirely
        // though, landing here untagged - the Principal decides it themselves.
        if (req.isPaidLeave === undefined && typeof body.isPaidLeave !== "boolean") {
          return NextResponse.json({ error: "Select paid or unpaid before approving" }, { status: 400 });
        }
      }
      await decideFinalStageLeave({
        db, collegeId: session.collegeId, id, req,
        action: body.action, remarks: body.remarks,
        decidedByUid: session.uid, decidedByEmail: session.email,
        decider: "PRINCIPAL",
        isPaidLeave: body.isPaidLeave,
      });
      if (body.action === "APPROVE" && req.isOtherRequest && body.otherLeaveCategory) {
        await OTHER_CATEGORIES_COL(session.collegeId, db).doc(id).set({
          id,
          collegeId: session.collegeId,
          uid: req.uid,
          category: body.otherLeaveCategory,
          setBy: session.uid,
          setByName: session.email || "Principal",
          setAt: new Date(),
        });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "This request is no longer pending" }, { status: 400 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof LeaveStateConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[leave/applications/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
