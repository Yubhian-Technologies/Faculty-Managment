export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAccessLeaveProfile } from "@/lib/leave/access";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { REQUESTS_COL, commitApproval, releasePending, releaseApproval, splitLeaveDays } from "@/lib/leave/balanceEngine";
import { decideFinalStageLeave } from "@/lib/leave/decideFinalStage";
import { getHolidayDateKeys } from "@/lib/leave/holidaysCount";
import { OTHER_CATEGORIES_COL } from "@/lib/leave/otherCategories";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import { notify, notifyRole } from "@/lib/notify";
import { emitWorkflowNotification } from "@/lib/notifications/workflowNotifications";
import { validatePeriodSubstitutions, notifySubstitutes, type PeriodSubstitutionInput } from "@/lib/leave/periodCoverage";
import { OTHER_LEAVE_CATEGORY_ORDER } from "@/types/leave";
import type { LeaveRequest, LeaveActionRecord, OtherLeaveCategory, PeriodSubstitution } from "@/types/leave";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
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
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const body = (await request.json()) as {
      action?: "APPROVE" | "REJECT" | "CANCEL" | "ADJUST_COVERAGE";
      remarks?: string;
      isPaidLeave?: boolean;
      otherLeaveCategory?: OtherLeaveCategory;
      reason?: string;
      periodSubstitutions?: PeriodSubstitutionInput[];
    };
    if (!body.action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }
    if (body.action === "CANCEL" && !body.reason?.trim()) {
      return NextResponse.json({ error: "A reason is required to cancel a leave request" }, { status: 400 });
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
        req.status !== "PENDING_HOD" && req.status !== "PENDING_PRINCIPAL" &&
        req.status !== "PENDING_MANAGEMENT" && !wasApproved
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
      if (req.leaveTypeCode) {
        const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
        if (lt && !lt.rules.unlimited) {
          if (wasApproved) {
            // Restore whatever days approval had committed to `used` -
            // the extra beyond balance (lopDays) was never committed in the
            // first place, so only the within-balance portion is reversed.
            const committedDays = req.totalDays - (req.lopDays ?? 0);
            if (committedDays > 0) {
              await releaseApproval(db, session.collegeId, req.uid, req.leaveTypeCode, year, committedDays);
            }
          } else {
            await releasePending(db, session.collegeId, req.uid, req.leaveTypeCode, year, req.totalDays);
          }
        }
      }
      const cancelReason = body.reason!.trim();
      await ref.update({ status: "CANCELLED", cancelReason, updatedAt: now });
      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId, action: "LEAVE_CANCELLED", performedBy: session.uid,
        performedByName: req.employeeName, targetId: id, details: { wasApproved, cancelReason }, timestamp: now,
      });

      // Tell whoever sits above this requester in the approval chain - same
      // routing rule applications/route.ts POST uses to decide where a fresh
      // request lands (PANEL_MEMBER/departmental COLLEGE_STAFF -> their HOD,
      // PRINCIPAL -> MANAGEMENT (no one else within the college), everyone
      // else -> Principal/VP tier) - so the reason is visible to them even if
      // they never re-open this person's history.
      const message = `${req.employeeName} cancelled their ${wasApproved ? "approved" : "pending"} leave request (${req.totalDays} day(s)). Reason: ${cancelReason}`;
      const reportsToHod = session.role === "PANEL_MEMBER" || (session.role === "COLLEGE_STAFF" && !!req.department);
      if (reportsToHod && req.department) {
        const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments")
          .where("name", "==", req.department).limit(1).get();
        const hodUid = (deptSnap.docs[0]?.data() as { hodUid?: string } | undefined)?.hodUid;
        if (hodUid) {
          await notify(db, session.collegeId, hodUid, "LEAVE_CANCELLED", "Leave Request Cancelled", message, `/hod/leave-history/${req.uid}`);
        }
      } else if (session.role === "PRINCIPAL") {
        await notifyRole(db, session.collegeId, "MANAGEMENT", "LEAVE_CANCELLED", "Leave Request Cancelled", message);
      } else {
        await notifyRole(db, session.collegeId, "PRINCIPAL", "LEAVE_CANCELLED", "Leave Request Cancelled", message, "/principal/leave-approvals");
        await notifyRole(db, session.collegeId, "VICE_PRINCIPAL", "LEAVE_CANCELLED", "Leave Request Cancelled", message, "/principal/leave-approvals");
      }

      return NextResponse.json({ ok: true });
    }

    // ─── Adjust coverage (already-decided leave only) ───────────────────────
    // Every substitute pick above (the requester's own at submission, or an
    // HOD's override while approving) is a snapshot taken at DECISION time.
    // If the section's timetable is edited/republished afterward - a new
    // period added to what this faculty member teaches on a day within the
    // leave range - that new period was never part of the snapshot and
    // silently shows no coverage on the timetable, with no way to go back
    // and fix it once the request is already APPROVED. This lets the
    // department's own HOD (or Principal-tier) revisit an approved leave and
    // add/change coverage - re-validated fresh against the CURRENT timetable
    // and current availability (buildPeriodCoverage picks up any newly-added
    // period automatically), merged over whatever was already recorded so
    // untouched periods keep their existing substitute.
    if (body.action === "ADJUST_COVERAGE") {
      if (req.status !== "APPROVED") {
        return NextResponse.json({ error: "Only an approved leave request's coverage can be adjusted" }, { status: 400 });
      }
      if (session.role === "HOD") {
        const hodDept = await resolveUserDepartment(db, session.collegeId, session.uid);
        if (!hodDept || req.department !== hodDept) {
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
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      const byKey = new Map((req.periodSubstitutions ?? []).map((p) => [`${p.date}|${p.timetableSlotId}`, p]));
      for (const p of result.resolved) byKey.set(`${p.date}|${p.timetableSlotId}`, p);
      const periodSubstitutions = Array.from(byKey.values());

      await ref.update({ periodSubstitutions, updatedAt: now });
      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId, action: "LEAVE_COVERAGE_ADJUSTED", performedBy: session.uid,
        performedByName: session.email || session.role, targetId: id, details: {}, timestamp: now,
      });
      await notifySubstitutes(db, session.collegeId, { ...req, periodSubstitutions });
      return NextResponse.json({ ok: true, periodSubstitutions });
    }

    // ─── HOD stage ────────────────────────────────────────────────────────────
    // Standard types (CL/SL/SCL/EL/OD): the HOD's decision is final - APPROVE
    // commits the balance and closes the request out; REJECT releases it.
    // "Other" requests: the HOD can REJECT outright, or tag isPaidLeave and
    // forward to the Principal for the real decision (Other is never
    // balance-tracked, so nothing is reserved/committed for it here).
    if (req.status === "PENDING_HOD") {
      if (session.role !== "HOD") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const hodDept = await resolveUserDepartment(db, session.collegeId, session.uid);
      if (!hodDept || req.department !== hodDept) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const actionRecord: LeaveActionRecord = {
        action: body.action === "APPROVE" ? "APPROVED" : "REJECTED",
        by: session.uid, byName: session.email || "HOD", at: now as unknown as LeaveActionRecord["at"],
        ...(body.remarks ? { remarks: body.remarks } : {}),
      };

      if (body.action === "REJECT") {
        if (req.leaveTypeCode) {
          const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
          if (lt && !lt.rules.unlimited) {
            await releasePending(db, session.collegeId, req.uid, req.leaveTypeCode, year, req.totalDays);
          }
        }
        await ref.update({ status: "REJECTED", hodAction: actionRecord, updatedAt: now });
        await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
          collegeId: session.collegeId, action: "LEAVE_REJECTED", performedBy: session.uid,
          performedByName: session.email || "HOD", targetId: id, details: {}, timestamp: now,
        });
        await notify(db, session.collegeId, req.uid, "LEAVE_REJECTED", "Leave Request Rejected",
          `Your leave request for ${req.totalDays} day(s) was rejected by your HOD.`, "/panel/leave");
        return NextResponse.json({ ok: true });
      }

      // APPROVE
      if (req.isOtherRequest) {
        if (typeof body.isPaidLeave !== "boolean") {
          return NextResponse.json({ error: "isPaidLeave is required to forward an Other request" }, { status: 400 });
        }
        actionRecord.isPaidLeave = body.isPaidLeave;

        // Optional - unlike a standard leave type (where the requester must
        // name a substitute for every affected period up front), an "Other"
        // request never collects that at submission. The HOD may adjust/
        // replace some or all of the requester's periods here while
        // forwarding - anything left unpicked is simply left for the
        // Principal/HOD to sort out manually (see periodCoverage.ts's
        // "PARTIAL" mode).
        let periodSubstitutions: PeriodSubstitution[] | undefined;
        if (body.periodSubstitutions?.length && req.department) {
          const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, req.uid);
          const reqFromDate = (req.fromDate as unknown as { toDate(): Date }).toDate();
          const reqToDate = (req.toDate as unknown as { toDate(): Date }).toDate();
          const holidayDates = await getHolidayDateKeys(db, session.collegeId, reqFromDate, reqToDate);
          const result = await validatePeriodSubstitutions({
            db, collegeId: session.collegeId, facultyMemberId, department: req.department,
            fromDate: reqFromDate, toDate: reqToDate, holidayDates,
            submitted: body.periodSubstitutions, mode: "PARTIAL",
          });
          if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: 400 });
          }
          if (result.resolved.length > 0) periodSubstitutions = result.resolved;
        }

        await ref.update({
          status: "PENDING_PRINCIPAL", isPaidLeave: body.isPaidLeave, hodAction: actionRecord, updatedAt: now,
          ...(periodSubstitutions ? { periodSubstitutions } : {}),
        });
        await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
          collegeId: session.collegeId, action: "LEAVE_HOD_FORWARDED", performedBy: session.uid,
          performedByName: session.email || "HOD", targetId: id, details: { isPaidLeave: body.isPaidLeave }, timestamp: now,
        });

        const principalsSnap = await db
          .collection("colleges").doc(session.collegeId)
          .collection("users").where("role", "in", ["PRINCIPAL", "VICE_PRINCIPAL"]).get();
        for (const p of principalsSnap.docs) {
          await emitWorkflowNotification({
            db, collegeId: session.collegeId, toUid: p.id,
            type: "LEAVE_PENDING_APPROVAL",
            title: "Leave Request Awaiting Approval",
            message: `${req.employeeName}'s "Other" leave request (${body.isPaidLeave ? "paid" : "unpaid"}) was forwarded by their HOD and needs your decision.`,
            link: "/principal/leave-approvals",
            entityType: "leaveRequest", entityId: id,
            dedupeKey: `leave-request-review:${id}:${p.id}`,
          });
        }
        return NextResponse.json({ ok: true });
      }

      // Standard type - HOD approval is final. Insufficient balance never
      // blocks this - the excess becomes Loss of Pay instead.

      // The requester already named a substitute for every affected period
      // at submission time (mode: "FULL" in applications/route.ts POST) -
      // but that pick may no longer hold by the time the HOD actually
      // decides (the substitute got scheduled elsewhere, went on leave
      // themselves, or the HOD simply knows a better fit). The HOD may
      // override any subset of those picks here (see LeaveApprovalQueue's
      // Adjustment/Replacement panel, pre-filled with the requester's
      // original choices) - re-validated fresh against current
      // availability. Anything not resubmitted keeps the requester's
      // original pick untouched, same merge behavior as the Other-request
      // branch above.
      let periodSubstitutions = req.periodSubstitutions;
      if (body.periodSubstitutions?.length && req.department) {
        const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, req.uid);
        const reqFromDate = (req.fromDate as unknown as { toDate(): Date }).toDate();
        const reqToDate = (req.toDate as unknown as { toDate(): Date }).toDate();
        const holidayDates = await getHolidayDateKeys(db, session.collegeId, reqFromDate, reqToDate);
        const result = await validatePeriodSubstitutions({
          db, collegeId: session.collegeId, facultyMemberId, department: req.department,
          fromDate: reqFromDate, toDate: reqToDate, holidayDates,
          submitted: body.periodSubstitutions, mode: "PARTIAL",
        });
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        const byKey = new Map((req.periodSubstitutions ?? []).map((p) => [`${p.date}|${p.timetableSlotId}`, p]));
        for (const p of result.resolved) byKey.set(`${p.date}|${p.timetableSlotId}`, p);
        periodSubstitutions = Array.from(byKey.values());
      }

      let lopDays = 0;
      if (req.leaveTypeCode) {
        const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
        if (lt && !lt.rules.unlimited) {
          const split = await splitLeaveDays(db, session.collegeId, req.uid, lt, year, req.totalDays);
          lopDays = split.lopDays;
          if (split.withinBalance > 0) {
            await commitApproval(db, session.collegeId, req.uid, req.leaveTypeCode, year, split.withinBalance);
          }
        }
      }
      await ref.update({
        status: "APPROVED", hodAction: actionRecord, lopDays, updatedAt: now,
        ...(periodSubstitutions ? { periodSubstitutions } : {}),
      });
      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId, action: "LEAVE_HOD_APPROVED", performedBy: session.uid,
        performedByName: session.email || "HOD", targetId: id, details: { lopDays }, timestamp: now,
      });
      await notify(db, session.collegeId, req.uid, "LEAVE_APPROVED", "Leave Request Approved",
        `Your leave request for ${req.totalDays} day(s) was approved by your HOD` +
          (lopDays > 0 ? ` — ${lopDays} day(s) exceed your balance and will be treated as Loss of Pay.` : "."),
        "/panel/leave");
      // Notified against the FINAL periodSubstitutions (post-adjustment),
      // not the stale `req` read at the top of this handler - otherwise an
      // HOD override here would notify the requester's original pick
      // instead of whoever's actually covering now.
      await notifySubstitutes(db, session.collegeId, { ...req, periodSubstitutions });
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
    if (req.status === "PENDING_PRINCIPAL") {
      if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // A Vice Principal's own leave request must be decided by the
      // Principal, not themselves - the approvals queue (GET .../
      // applications?scope=approvals) already hides it from their own list,
      // this is the server-side backstop for that.
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
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
